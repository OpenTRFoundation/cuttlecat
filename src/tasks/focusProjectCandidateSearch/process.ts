import {graphql} from "@octokit/graphql";
import {v4 as uuidv4} from 'uuid';
import {FocusProjectCandidateSearchQuery} from "../../generated/queries";
import {createWriteStream, readFileSync, writeFileSync} from 'fs'

import {TaskQueue} from "../../taskqueue";
import {addDays, daysInPeriod, formatDate, now as getNow, parseDate, subtractDays} from "../../utils";
import FileSystem from "../../fileSystem";
import {shuffle} from "lodash";
import {FileOutput, ProcessState, TaskOptions} from "./types";
import {Task} from "./task";
import fetch from "node-fetch";
import {createLogger} from "../../log";
import {Arguments} from "../../arguments";
import {buildConfig, Config, extractNewQueueConfig, extractProcessConfig, QueueConfig} from "./config";

const logger = createLogger("focusProjectCandidateSearch/process");

export const commandName = "focus-project-candidate-search";
export const commandDescription = "Search for repositories that can be used to identify focus organizations and projects.";

export async function main(mainConfig:Arguments) {
    const config:Config = buildConfig();
    await start(mainConfig, config);
}


export class Process {
    private readonly processState:ProcessState;
    private readonly taskQueue:TaskQueue<FocusProjectCandidateSearchQuery, TaskOptions>;
    private readonly graphqlFn:typeof graphql;
    private readonly currentRunOutput:FileOutput[];
    private readonly options:{
        retryCount:number,
        rateLimitStopPercent:number,
    };

    constructor(processState:ProcessState, taskQueue:TaskQueue<FocusProjectCandidateSearchQuery, TaskOptions>, graphqlFn:typeof graphql, currentRunOutput:FileOutput[], options:{
        retryCount:number;
        rateLimitStopPercent:number
    }) {
        this.processState = processState;
        this.taskQueue = taskQueue;
        this.graphqlFn = graphqlFn;
        this.currentRunOutput = currentRunOutput;
        this.options = options;
    }

    initialize() {
        // Queue already retries any errored items, until they fail for RETRY_COUNT times.
        // Afterward, queue will only keep the errored items in the errored list, and remove them from the unresolved list.
        // So, we don't actually need to check the errored list here.
        // However, when the RETRY_COUNT is increased, we should retry the errored tasks from the previous run.
        logger.info("Checking if the errored tasks should be retried, according to RETRY_COUNT.")
        for (let key in this.processState.errored) {
            let erroredTask = this.processState.errored[key];
            if (this.processState.unresolved[erroredTask.task.id]) {
                // errored task is already in the unresolved list, and it will be retried by the queue.
                continue;
            }

            if (erroredTask.errors.length < this.options.retryCount + 1) {    // +1 since retry count is not the same as the number of errors
                logger.debug(`Going to retry errored task: ${erroredTask.task.id} as it has ${erroredTask.errors.length} errors, and RETRY_COUNT is ${this.options.retryCount}`);
                this.processState.unresolved[erroredTask.task.id] = erroredTask.task;
                // keep in unresolved though, as it will be retried by the task queue
            }
        }

        for (let key in this.processState.unresolved) {
            const task = new Task(this.graphqlFn, this.options.rateLimitStopPercent, this.currentRunOutput, this.processState.unresolved[key]);
            logger.debug(`Adding task to queue: ${task.getId()}`);
            // DO NOT await here, as it will block the loop
            // fire and forget.
            // the task will be added to the queue, and the queue will start executing it.
            // noinspection ES6MissingAwait
            this.taskQueue.add(task);
        }
    }

    async start() {
        logger.info("Starting the task queue");
        this.taskQueue.start();
        try {
            await this.taskQueue.finish();
        } catch (e) {
            logger.error(`Error while finishing the task queue: ${e}`);
            logger.error(e);
        }
        logger.info("Task queue finished");
    }
}

export function createNewProcessState(startingConfig:QueueConfig, outputFileName:string, nowFn:() => Date):ProcessState {
    let startDate = parseDate(startingConfig.excludeRepositoriesCreatedBefore);
    let endDate = subtractDays(nowFn(), startingConfig.minAgeInDays);

    // GitHub search API is inclusive for the start date and the end date.
    //
    // Example call with a 2-day period:
    //
    // curl -G \
    //   -H "Accept: application/vnd.github+json" \
    //   -H "X-GitHub-Api-Version: 2022-11-28" \
    //   --data-urlencode 'q=stars:>50 forks:>10 is:public pushed:>2023-06-19 size:>1000 template:false archived:false created:2010-01-12..2010-01-13' \
    //   "https://api.github.com/search/repositories" | jq '.items[] | "\(.created_at)   \(.full_name)"'
    // Results:
    // "2010-01-12T09:37:53Z   futuretap/InAppSettingsKit"
    // "2010-01-13T05:52:38Z   vasi/pixz"
    //
    // Example call with a 1-day period:
    //
    // curl -G \
    //   -H "Accept: application/vnd.github+json" \
    //   -H "X-GitHub-Api-Version: 2022-11-28" \
    //   --data-urlencode 'q=stars:>50 forks:>10 is:public pushed:>2023-06-19 size:>1000 template:false archived:false created:2010-01-13..2010-01-13' \
    //   "https://api.github.com/search/repositories" | jq '.items[] | "\(.created_at)   \(.full_name)"'
    // Results:
    // "2010-01-13T05:52:38Z   vasi/pixz"
    //
    // So, to prevent any duplicates, we need to make sure that the intervals are exclusive.
    // Like these:
    // - 2023-01-01 - 2023-01-05
    // - 2023-01-06 - 2023-01-10

    let interval = daysInPeriod(startDate, endDate, startingConfig.searchPeriodInDays);
    let hasActivityAfter = formatDate(subtractDays(nowFn(), startingConfig.maxInactivityDays))

    logger.info(`Creating a new process state, startDate: ${formatDate(startDate)}, endDate: ${formatDate(endDate)}, hasActivityAfter: ${hasActivityAfter}`);

    let newTasks:TaskOptions[] = [];

    for (let i = 0; i < interval.length; i++) {
        let createdAfter = formatDate(interval[i]);
        let createdBefore = formatDate(addDays(interval[i], startingConfig.searchPeriodInDays - 1));
        let key = uuidv4();
        newTasks.push({
            id: key,
            parentId: null,
            originatingTaskId: null,
            minStars: startingConfig.minStars,
            minForks: startingConfig.minForks,
            minSizeInKb: startingConfig.minSizeInKb,
            hasActivityAfter: hasActivityAfter,
            createdAfter: createdAfter,
            createdBefore: createdBefore,
            pageSize: startingConfig.pageSize,
            startCursor: null,
        });
    }

    // tasks for some date ranges return lots of data and some return very little data.
    // let's shuffle to have a more even distribution of request durations.
    newTasks = shuffle(newTasks);

    let unresolved:{ [key:string]:TaskOptions } = {};
    for (let i = 0; i < newTasks.length; i++) {
        const task = newTasks[i];
        unresolved[task.id] = task;
        logger.debug(`Created unresolved task: ${JSON.stringify(task)}`);
    }

    return {
        startingConfig: startingConfig,
        unresolved: unresolved,
        resolved: {},
        errored: {},
        archived: {},
        startDate: nowFn(),
        completionDate: null,
        completionError: null,
        outputFileName: outputFileName,
    }
}

function saveProcessRunOutput(fileSystem:FileSystem, stateFile:string, processState:ProcessState, currentRunOutput:FileOutput[]) {
    logger.info(`Writing process state to file ${stateFile}`);
    writeFileSync(stateFile, JSON.stringify(processState, null, 2));

    const outputFileFullPath = fileSystem.getOutputFilePath(processState.outputFileName);
    logger.info(`Writing output to file: ${outputFileFullPath}`);
    const outputStream = createWriteStream(outputFileFullPath, {flags: 'a'});

    // we don't write as an array. just add new items as new json objects
    // the good thing is, we can use jq to filter the output
    // jq has a slurp option:
    // -s               read (slurp) all inputs into an array; apply filter to it;
    for (let i = 0; i < currentRunOutput.length; i++) {
        const output = currentRunOutput[i];
        const outputStr = JSON.stringify(output, null, 0);
        outputStream.write(outputStr + "\n");
    }
    outputStream.end();
}

function reportTaskQueue(taskQueue:TaskQueue<FocusProjectCandidateSearchQuery, TaskOptions>, processState:ProcessState) {
    let queueState = taskQueue.getState();
    logger.info(`---- Task queue state: ${JSON.stringify(queueState)}`);
    logger.info(`---- Task store      : unresolved: ${Object.keys(processState.unresolved).length}, resolved: ${Object.keys(processState.resolved).length}, errored: ${Object.keys(processState.errored).length}, archived: ${Object.keys(processState.archived).length}`);
    return queueState;
}

export function getFileSystem(dataDirectory:string) {
    return new FileSystem(
        dataDirectory,
        "process-state-",
        ".json",
        "process-output-",
        ".json",
    );
}

export async function start(mainArgs:Arguments, config:Config) {
    logger.info("Starting focus project candidate search");
    const processConfig = extractProcessConfig(config);
    const newQueueConfig = extractNewQueueConfig(config);
    // store the output of current run as an array of objects
    // these objects will be written to the output file at the end of the run
    const currentRunOutput:FileOutput[] = [];

    const fileSystem = getFileSystem(processConfig.dataDirectory);

    logger.info(`Read process config:` + JSON.stringify(processConfig, (key, value) => {
        if (key == "githubToken") {
            // print only the first 3 characters of the token, if it's available
            if (value && value.length > 3) {
                return value.substring(0, 3) + "...[REDACTED]";
            }
            return value;
        }
        return value;
    }));

    logger.info(`Read new queue config: ${JSON.stringify(newQueueConfig)}`);

    let processState:ProcessState;

    let stateFile = fileSystem.getLatestProcessStateFile();
    if (stateFile == null) {
        stateFile = fileSystem.getPathOfNewProcessStateFile();
        logger.info(`There are no process state files, starting a new process. Path of state file will be: ${stateFile}`);
        processState = createNewProcessState(newQueueConfig, fileSystem.getNewProcessOutputFileName(), getNow);
    } else {
        logger.info(`Found latest process state file: ${stateFile}`)
        processState = JSON.parse(readFileSync(stateFile, "utf8"));
    }

    logger.debug(`Latest process state: ${JSON.stringify(processState)}`);

    if (processState.completionDate) {
        // convert to date
        processState.completionDate = new Date(processState.completionDate);

        logger.info("Previous queue is completed.");
        // start a new one, but only if RENEW_PERIOD_IN_DAYS has passed
        const now = getNow();
        const daysSinceCompletion = (now.getTime() - processState.completionDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceCompletion < processConfig.renewPeriodInDays) {
            logger.info(`Previous process is completed, but RENEW_PERIOD_IN_DAYS of ${processConfig.renewPeriodInDays} hasn't passed yet. It has been ${daysSinceCompletion} days. Exiting.`);
            return;
        }
        logger.info("Previous queue is completed, and RENEW_PERIOD_IN_DAYS has passed. Starting a new queue.");
        stateFile = fileSystem.getPathOfNewProcessStateFile();
        processState = createNewProcessState(newQueueConfig, fileSystem.getNewProcessOutputFileName(), getNow);
        logger.info(`New process state file: ${stateFile}`);
        logger.debug(`New process state: ${JSON.stringify(processState)}`);
    }

    logger.info("Starting the search now...");
    logger.info(`Number of unresolved tasks: ${Object.keys(processState.unresolved).length}`);
    logger.info(`Number of resolved tasks: ${Object.keys(processState.resolved).length}`);
    logger.info(`Number of errored tasks: ${Object.keys(processState.errored).length}`);

    const taskStore = {
        unresolved: processState.unresolved,
        resolved: processState.resolved,
        errored: processState.errored,
        archived: processState.archived,
    };

    const taskQueue = new TaskQueue<FocusProjectCandidateSearchQuery, TaskOptions>(
        taskStore,
        {
            concurrency: processConfig.concurrency,
            perTaskTimeout: processConfig.perTaskTimeoutInMs,
            intervalCap: processConfig.intervalCap,
            interval: processConfig.intervalInMs,
            retryCount: processConfig.retryCount,
        });

    let graphqlWithAuth = graphql.defaults({
        headers: {
            Authorization: `bearer ${processConfig.githubToken}`,
        },
        request: {
            fetch: fetch,
        }
    });

    if (mainArgs.recordHttpCalls) {
        graphqlWithAuth = graphqlWithAuth.defaults({
            headers: {
                // nock doesn't really support gzip, so we need to disable it
                "accept-encoding": 'identity'
            }
        });
    }

    const process = new Process(
        processState, taskQueue, graphqlWithAuth, currentRunOutput, {
            retryCount: processConfig.retryCount,
            rateLimitStopPercent: processConfig.rateLimitStopPercent,
        }
    );

    process.initialize();

    // Print the queue state periodically
    // noinspection ES6MissingAwait
    (async () => {
        if (processConfig.reportPeriodInMs == 0) {
            return;
        }
        while (true) {
            let queueState = reportTaskQueue(taskQueue, processState);
            await new Promise(r => setTimeout(r, processConfig.reportPeriodInMs));

            // There are some cases here:
            // queue size is 0, but there are unresolved tasks --> hit the rate limit, should stop reporting
            // queue size is 0, there are no unresolved tasks --> queue is completed, should stop reporting

            if (queueState.size == 0) {
                break;
            }
        }
    })();

    await process.start();

    if (Object.keys(processState.unresolved).length === 0) {
        // no unresolved tasks, so the queue is completed.
        processState.completionDate = getNow();

        // However, there might be some errored tasks.
        // TaskQueue itself is retrying those tasks, and it finishes if it gives up after N retries.
        // So, if there are still errored items, they are the ones that have failed after retries.
        // Let's mark that in the completionError.

        if (Object.keys(processState.errored).length > 0) {
            processState.completionError = "Errored tasks";
        }
    }

    // do a final report before ending
    reportTaskQueue(taskQueue, processState);

    // Write to both of the files when queue is aborted too, so we can pick up from where we left off.
    saveProcessRunOutput(fileSystem, stateFile, processState, currentRunOutput);

}
