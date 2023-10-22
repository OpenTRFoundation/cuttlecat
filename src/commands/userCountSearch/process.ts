import {graphql} from "@octokit/graphql";
import {v4 as uuidv4} from 'uuid';
import {UserCountSearchQuery} from "../../generated/queries";
import {createWriteStream, readFileSync, writeFileSync} from 'fs'

import {TaskQueue} from "../../taskqueue";
import {now as getNow} from "../../utils";
import FileSystem from "../../fileSystem";
import {shuffle} from "lodash";
import {FileOutput, ProcessState, TaskOptions} from "./types";
import {Task} from "./task";
import fetch from "node-fetch";
import {createLogger} from "../../log";
import {LocationsOutput} from "../locationGeneration/generate";
import {Arguments} from "../../arguments";
import {buildConfig, Config, extractNewQueueConfig, extractProcessConfig, QueueConfig} from "./config";
import {GraphqlProcess} from "../graphqlProcess";
import {GraphqlTask} from "../graphqlTask";

const logger = createLogger("userCountSearch/process");

export const commandName = "user-count-search";
export const commandDescription = "Search for user counts for given search criteria.";

export async function main(mainConfig:Arguments) {
    const config:Config = buildConfig();
    await start(mainConfig, config);
}

export class Process extends GraphqlProcess<QueueConfig, TaskOptions, UserCountSearchQuery> {
    private readonly graphqlFn:typeof graphql;
    private readonly currentRunOutput:FileOutput[];

    constructor(processState:ProcessState, taskQueue:TaskQueue<UserCountSearchQuery, TaskOptions>, graphqlFn:typeof graphql, currentRunOutput:FileOutput[], options:{
        retryCount:number;
        rateLimitStopPercent:number
    }) {
        super(processState, taskQueue, options);
        this.graphqlFn = graphqlFn;
        this.currentRunOutput = currentRunOutput;
    }

    protected createNewTask(taskSpec:TaskOptions):GraphqlTask<UserCountSearchQuery, TaskOptions> {
        return new Task(this.graphqlFn, this.options.rateLimitStopPercent, this.currentRunOutput, taskSpec);
    }

}

export function createNewProcessState(startingConfig:QueueConfig, outputFileName:string, nowFn:() => Date):ProcessState {
    // read JSON file and create an entry for each location
    const locationsOutput:LocationsOutput = JSON.parse(readFileSync(startingConfig.locationJsonFile, "utf8"));
    const locations:string[] = [];
    for (let key in locationsOutput) {
        locations.push(...locationsOutput[key].alternatives);
    }

    logger.info(`Creating a new process state, MIN_REPOS: ${startingConfig.minRepositories}, MIN_FOLLOWERS: ${startingConfig.minFollowers}, number of locations: ${locations.length}`);

    let newTasks:TaskOptions[] = [];

    for (let i = 0; i < locations.length; i++) {
        let key = uuidv4();
        newTasks.push({
            id: key,
            parentId: null,
            originatingTaskId: null,
            location: locations[i],
            minRepos: startingConfig.minRepositories,
            minFollowers: startingConfig.minFollowers,
        });
    }

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

function reportTaskQueue(taskQueue:TaskQueue<UserCountSearchQuery, TaskOptions>, processState:ProcessState) {
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
    logger.info(`Starting ${commandName}...`);
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

    const taskQueue = new TaskQueue<UserCountSearchQuery, TaskOptions>(
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
