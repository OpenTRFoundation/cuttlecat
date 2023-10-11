import {graphql} from "@octokit/graphql";
import {v4 as uuidv4} from 'uuid';
import {RepositorySearch, RepositorySearchQuery, RepositorySummaryFragment} from "./generated/queries";
import {cleanEnv, num, str} from 'envalid'
import {appendFileSync, createWriteStream, readdirSync, readFileSync, writeFileSync} from 'fs'
import {join} from 'path'
import {addDays, eachDayOfInterval, format as doFormatDate, parse as doParseDate, startOfDay, subDays} from 'date-fns'

import {BaseTask, TaskQueue, TaskResult} from "./tasks/taskqueue";

// TODO: add comments + docs

interface QueueConfig {
    MIN_STARS:number;
    MIN_FORKS:number;
    MIN_SIZE_IN_KB:number;
    MAX_INACTIVITY_DAYS:number;
    EXCLUDE_PROJECTS_CREATED_BEFORE:string;
    MIN_AGE_IN_DAYS:number;
    SEARCH_PERIOD_IN_DAYS:number;
    PAGE_SIZE:number;
}

interface ProjectSearchTaskOptions {
    id:string;  // TODO: do we actually need this here?
    minStars:number;
    minForks:number;
    minSizeInKb:number;
    hasActivityAfter:string;
    createdAfter:string;
    createdBefore:string;
    pageSize:number;
    startCursor:string | null;
}

interface ProcessState {
    startingConfig:object,
    unresolved:{ [key:string]:ProjectSearchTaskOptions },
    resolved:{ [key:string]:ProjectSearchTaskOptions },
    errored:{ [key:string]:ProjectSearchTaskOptions },
    startDate:Date,
    completionDate:Date | null,
    outputFilePath:string,
}

interface FileOutput {
    taskId:string;  // to identify which task found this result
    result:RepositorySummaryFragment,
}

function buildProcessConfigFromEnvVars() {
    return cleanEnv(process.env, {
        GITHUB_TOKEN: str({desc: "(not persisted in process file) GitHub API token. Token doesn't need any permissions."}),
        RENEW_PERIOD_IN_DAYS: num({desc: "(not persisted in process file) if previous queue is completed, create the next one after RENEW_PERIOD_IN_DAYS days"}),
        RATE_LIMIT_STOP_PERCENT: num({desc: "if rate limit remaining is less than RATE_LIMIT_STOP_PERCENT * rate limit (typically 1000) / 100, stop the queue."}),
    });
}

function buildNewQueueConfigFromEnvVars():QueueConfig {
    return cleanEnv(process.env, {
        // Project search query parameters (applies to new queues only)
        MIN_STARS: num({desc: "minimum number of stars (applies to new queues only)"}),
        MIN_FORKS: num({desc: "minimum number of forks (applies to new queues only)"}),
        MIN_SIZE_IN_KB: num({desc: "minimum size in KB (applies to new queues only)"}),
        MAX_INACTIVITY_DAYS: num({desc: "maximum number of days since last commit; ignore projects that have been inactive for longer than this (applies to new queues only)"}),
        EXCLUDE_PROJECTS_CREATED_BEFORE: str({desc: "ignore projects created before this date (applies to new queues only)"}),
        MIN_AGE_IN_DAYS: num({desc: "ignore projects younger than this (applies to new queues only)"}),

        // Search batch size parameters (applies to new queues only)
        SEARCH_PERIOD_IN_DAYS: num({desc: "Number of days to search for projects in one batch (applies to new queues only)"}),
        PAGE_SIZE: num({desc: "Max number of projects to return in one batch (applies to new queues only)"}),
    });
}

const DATA_DIR_PATH = "../data/focus-project-search";
const PROCESS_STATE_FILE_PREFIX = "process-state-";
const PROCESS_STATE_FILE_EXTENSION = ".json";
const PROCESS_OUTPUT_PREFIX = "process-output-";
const PROCESS_OUTPUT_EXTENSION = ".json";

function getLatestProcessStateFile() {
    // read data/focusprojectsearch directory and find the latest process state file
    // process state files start with "process-state-" and end with ".json"
    let files = readdirSync(DATA_DIR_PATH);
    files = files.filter((file) => file.startsWith(PROCESS_STATE_FILE_PREFIX) && file.endsWith(PROCESS_STATE_FILE_EXTENSION));
    files.sort();
    if (files.length == 0) {
        return null;
    }
    return join(DATA_DIR_PATH, files[files.length - 1]);
}

function nowTimestamp() {
    return doFormatDate(new Date(), "yyyy-MM-dd-HH-mm-ss");
}

function parseDate(s:string):Date {
    let date = doParseDate(s, "yyyy-MM-dd", new Date());
    return startOfDay(date);
}

function formatDate(d:Date):string {
    return doFormatDate(d, "yyyy-MM-dd");
}

function getPathOfNewProcessStateFile() {
    const timestamp = nowTimestamp();
    return join(DATA_DIR_PATH, PROCESS_STATE_FILE_PREFIX + timestamp + PROCESS_STATE_FILE_EXTENSION);
}

function getPathOfNewProcessOutputFile() {
    const timestamp = nowTimestamp();
    return join(DATA_DIR_PATH, PROCESS_OUTPUT_PREFIX + timestamp + PROCESS_OUTPUT_EXTENSION);
}

function createNewProcessState(startingConfig:QueueConfig, outputFilePath:string):ProcessState {
    let unresolved:{ [key:string]:ProjectSearchTaskOptions } = {};

    let startDate = parseDate(startingConfig.EXCLUDE_PROJECTS_CREATED_BEFORE);
    let endDate = subDays(new Date(), startingConfig.MIN_AGE_IN_DAYS);
    let interval = eachDayOfInterval({start: startDate, end: endDate}, {step: startingConfig.SEARCH_PERIOD_IN_DAYS});
    let hasActivityAfter = formatDate(subDays(new Date(), startingConfig.MAX_INACTIVITY_DAYS))

    console.log(`Creating a new process state, startDate: ${formatDate(startDate)}, endDate: ${formatDate(endDate)}, hasActivityAfter: ${hasActivityAfter}`);

    for (let i = 0; i < interval.length; i++) {
        let createdAfter = formatDate(interval[i]);
        let createdBefore = formatDate(addDays(interval[i], startingConfig.SEARCH_PERIOD_IN_DAYS));
        let key = uuidv4();
        unresolved[key] = {
            id: key,
            minStars: startingConfig.MIN_STARS,
            minForks: startingConfig.MIN_FORKS,
            minSizeInKb: startingConfig.MIN_SIZE_IN_KB,
            hasActivityAfter: hasActivityAfter,
            createdAfter: createdAfter,
            createdBefore: createdBefore,
            pageSize: startingConfig.PAGE_SIZE,
            startCursor: null,
        };
    }

    for (let key in unresolved) {
        console.log(`Created unresolved task: ${JSON.stringify(unresolved[key])}`);
    }

    return {
        startingConfig: startingConfig,
        unresolved: unresolved,
        resolved: {},
        errored: {},
        startDate: new Date(),
        completionDate: null,
        outputFilePath: outputFilePath,
    }
}

function saveProcessRunOutput(stateFile:string, processState:ProcessState, currentRunOutput:FileOutput[]) {
    console.log(`Writing process state to file ${stateFile}`);
    writeFileSync(stateFile, JSON.stringify(processState, null, 2));

    console.log(`Writing output to file: ${processState.outputFilePath}`);
    const outputStream = createWriteStream("append.txt", {flags: 'a'});

    // we don't write as an array. just add new items as new json objects
    // the good thing is, we can use jq to filter the output
    // jq has a slurp option:
    // -s               read (slurp) all inputs into an array; apply filter to it;
    for (let i = 0; i < currentRunOutput.length; i++) {
        const output = currentRunOutput[i];
        const outputStr = JSON.stringify(output, null, 0);
        outputStream.write(outputStr + "\n");
        appendFileSync(processState.outputFilePath, outputStr + "\n");
    }
    outputStream.end();
}

export async function main() {
    console.log("Starting focus project search");
    const processConfig = buildProcessConfigFromEnvVars();
    const newQueueConfig = buildNewQueueConfigFromEnvVars();
    // store the output of current run as an array of objects
    // these objects will be written to the output file at the end of the run
    const currentRunOutput:FileOutput[] = [];

    console.log(`Read process config. GITHUB_TOKEN: "${processConfig.GITHUB_TOKEN.slice(0, 3)}...", RENEW_PERIOD_IN_DAYS: ${processConfig.RENEW_PERIOD_IN_DAYS}, RATE_LIMIT_STOP_PERCENT: ${processConfig.RATE_LIMIT_STOP_PERCENT}`);
    console.log(`Read new queue config: ${JSON.stringify(newQueueConfig)}`);

    let processState:ProcessState;

    let stateFile = getLatestProcessStateFile();
    if (stateFile == null) {
        stateFile = getPathOfNewProcessStateFile();
        console.log(`There are no process state files, starting a new process. Path of state file will be: ${stateFile}`);
        processState = createNewProcessState(newQueueConfig, getPathOfNewProcessOutputFile());
    } else {
        console.log(`Found latest process state file: ${stateFile}`)
        processState = JSON.parse(readFileSync(stateFile, "utf8"));
    }

    console.log(`Latest process state: ${JSON.stringify(processState)}`);

    if (processState.completionDate != null) {
        // convert to date
        processState.completionDate = new Date(processState.completionDate);

        console.log("Previous queue is completed.");
        // start a new one, but only if RENEW_PERIOD_IN_DAYS has passed
        const now = new Date();
        const daysSinceCompletion = (now.getTime() - processState.completionDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceCompletion < processConfig.RENEW_PERIOD_IN_DAYS) {
            console.log(`Previous process is completed, but RENEW_PERIOD_IN_DAYS of ${processConfig.RENEW_PERIOD_IN_DAYS} hasn't passed yet. It has been ${daysSinceCompletion} days. Exiting.`);
            return;
        }
        console.log("Previous queue is completed, and RENEW_PERIOD_IN_DAYS has passed. Starting a new queue.");
        stateFile = getPathOfNewProcessStateFile();
        processState = createNewProcessState(newQueueConfig, getPathOfNewProcessOutputFile());
        console.log(`New process state file: ${stateFile}`);
        console.log(`New process state: ${JSON.stringify(processState)}`);
    }

    console.log("Starting the search now...");
    console.log(`Number of unresolved tasks: ${Object.keys(processState.unresolved).length}`);
    console.log(`Number of resolved tasks: ${Object.keys(processState.resolved).length}`);
    console.log(`Number of errored tasks: ${Object.keys(processState.errored).length}`);

    let abortController = new AbortController();

    // About rate limits...
    // ref1: https://docs.github.com/en/free-pro-team@latest/rest/search/search?apiVersion=2022-11-28#search-users
    // ref2: https://docs.github.com/en/free-pro-team@latest/rest/search/search?apiVersion=2022-11-28#rate-limit
    // ref3: https://docs.github.com/en/rest/overview/resources-in-the-rest-api?apiVersion=2022-11-28#rate-limits-for-requests-from-personal-accounts
    // ref4: https://docs.github.com/en/rest/overview/resources-in-the-rest-api?apiVersion=2022-11-28#rate-limits-for-requests-from-github-actions
    // Numbers:
    // The REST API has a custom rate limit for searching. ... you can make up to 30 requests per minute
    // User access token requests are limited to 5,000 requests per hour ...
    // When using GITHUB_TOKEN, the rate limit is 1,000 requests per hour per repository.
    //
    // Bottleneck is search endpoint, which is limited to 30 requests per minute.
    //
    // However, instead of using p-queue's cap limiting capabilities, we can just use as much as possible and
    // stop processing when we've used the rate limit. This would help with using less GitHub action minutes.
    // So, we should go with a higher cap.

    const taskQueue = new TaskQueue<RepositorySearchQuery>({
        // As this search is IO bound, we should increase concurrency
        concurrency: 8,
        // TODO: this is a bit too much, but needs experimenting.
        // Keeping the timeout too long will end up using too many GitHub actions minutes.
        // Keeping the timeout too short will result in too many errored items.
        perTaskTimeout: 20000,
        // as explained above, let's increase the cap and abort when there's no rate limit left.
        intervalCap: 30 * 10,
        interval: 60 * 1000,
        signal: abortController.signal
    });

    taskQueue.on('taskcomplete', (result:TaskResult<RepositorySearchQuery>) => {
        let taskId = result.task.getId();
        if (result.success) {
            console.log(`Task complete with success: ${taskId}, hasNextPage: ${result.output.search.pageInfo.hasNextPage}, endCursor: ${result.output.search.pageInfo.endCursor}`);

            console.log(`Moving resolved task to resolved list: ${taskId}`);
            processState.resolved[taskId] = processState.unresolved[taskId];
            delete processState.unresolved[taskId];

            let nodes = result.output.search.nodes;

            if (nodes == null || nodes.length == 0) {
                console.log(`No nodes found for ${taskId}.`);
                nodes = [];
            }

            console.log(`Number of nodes found for ${taskId}: ${nodes.length}`);

            for (let i = 0; i < nodes.length; i++) {
                const repoSummary = <RepositorySummaryFragment>nodes[i];
                currentRunOutput.push({
                    taskId: taskId,
                    result: repoSummary,
                });
            }

            // region check rate limit
            console.log(`Rate limit information after task the execution of ${taskId}: ${JSON.stringify(result.output.rateLimit)}`);
            let rateLimitReached = false;

            let remainingCallRights = result.output.rateLimit?.remaining;
            let callLimit = result.output.rateLimit?.limit;

            if (remainingCallRights == null || callLimit == null) {
                console.log(`Rate limit information is not available after executing ${taskId}.`);
                rateLimitReached = true;
            }

            remainingCallRights = remainingCallRights ? remainingCallRights : 0;

            if (callLimit && (remainingCallRights > (callLimit * processConfig.RATE_LIMIT_STOP_PERCENT / 100))) {
                console.log(`Rate limit reached after executing ${taskId}.`);
                rateLimitReached = true;
            }
            // endregion

            if (result.output.search.pageInfo.hasNextPage) {
                const nextTask = <ProjectSearchTask>result.task.nextTask(result.output);
                console.log(`Adding next task to unresolved: ${nextTask.getId()}`);
                processState.unresolved[nextTask.getId()] = nextTask.options;

                // if limit reached and gonna abort, add the next page to the list to persist it to process is next time.
                // if not gonna abort, also add to the task queue to get it executed now.
                if (!rateLimitReached) {
                    // DO NOT await here, as it will block the loop
                    // fire and forget.
                    // the task will be added to the queue, and the queue will start executing it.
                    // noinspection ES6MissingAwait
                    console.log(`Adding next task to queue: ${nextTask.getId()}`);
                    taskQueue.add(nextTask);
                }
            }

            if (rateLimitReached) {
                console.log(`Rate limit reached. Aborting the queue.`);
                abortController.abort();
            }
        } else {
            console.log(`Task complete with error: ${taskId}, error: ${result.error}`);

            console.log(`Moving errored task to errored list: ${taskId}`);
            processState.errored[taskId] = processState.unresolved[taskId];
            delete processState.unresolved[taskId];
        }

        console.log(`Unresolved tasks: ${Object.keys(processState.unresolved).length}`);
    });

    // TODO: test with a task that throws an error

    taskQueue.on('taskerror', (error) => {
        // if abort error, do nothing.
        if (error.name !== 'AbortError') {
            console.log("Error in task:", error);
        }
        // TODO: Is this needed?
        // TODO: else, removed from unresolved list and add to errored list.

        // TODO: is the following correct?
        // This listener is called when the task queue itself encounters an error.
        // We don't have a reference to the task that caused the error, so we can't
        // move it to the errored list.
        // It will stay in the unresolved list, and will be retried later on.
        // TODO: need to identify if this was an abort, so the task was not actually errored and it should stay in the unresolved list.
        // console.log("taskerror", error);
    });

    const graphqlWithAuth = graphql.defaults({
        headers: {
            Authorization: `bearer ${processConfig.GITHUB_TOKEN}`,
        },
        // use the same signal for the graphql calls as well (HTTP requests)
        request: {
            signal: abortController.signal,
        }
    });

    for (let key in processState.unresolved) {
        const task = new ProjectSearchTask(graphqlWithAuth, processState.unresolved[key]);
        console.log(`Adding task to queue: ${task.getId()}`);
        // DO NOT await here, as it will block the loop
        // fire and forget.
        // the task will be added to the queue, and the queue will start executing it.
        // noinspection ES6MissingAwait
        taskQueue.add(task);
    }

    console.log("Starting the task queue");
    taskQueue.start();
    try {
        await taskQueue.finish();
    } catch (e) {
        console.log("Error while finishing the task queue", e);
        console.log(e);
    }
    console.log("Task queue finished");

    if (Object.keys(processState.unresolved).length === 0) {
        // no unresolved tasks, so the queue is completed.
        // TODO: think about errored ones! retry them at the end? (this would need a retry counter in tasks)
        processState.completionDate = new Date();
    }

    // TODO: write to both of the files when queue is aborted too!
    saveProcessRunOutput(stateFile, processState, currentRunOutput);

}

class ProjectSearchTask extends BaseTask<RepositorySearchQuery> {
    readonly graphqlWithAuth:typeof graphql<RepositorySearchQuery>;
    readonly options:ProjectSearchTaskOptions;

    constructor(graphqlWithAuth:typeof graphql, options:ProjectSearchTaskOptions) {
        super();
        this.graphqlWithAuth = graphqlWithAuth;
        this.options = options;
    }

    getId():string {
        return this.options.id;
    }

    execute(signal:AbortSignal):Promise<RepositorySearchQuery> {
        // return Promise.resolve(undefined);
        let search_string = "is:public template:false archived:false " +
            `stars:>${this.options.minStars} ` +
            `forks:>${this.options.minForks} ` +
            `size:>${this.options.minSizeInKb} ` +
            `pushed:>${this.options.hasActivityAfter} ` +
            `created:${this.options.createdAfter}..${this.options.createdBefore}`

        // console.log(RepositorySearch.loc!.source.body);

        // TODO: use await instead of stupid chain of promise handlers
        let promise = this.graphqlWithAuth(
            RepositorySearch.loc!.source.body,
            {
                "searchString": search_string,
                "first": this.options.pageSize,
                "after": this.options.startCursor,
            }
        ).then((res:RepositorySearchQuery) => {
            return res;
        }).catch((error) => {
            console.log(`Error in graphql call for task: ${this.getId()}`);
            if (error.name === 'AbortError') {
                console.log(`Graphql call for task ${this.getId()} was aborted.`);
                throw error;
            }
            console.log(error);
            throw error;
        });

        return promise;
    }

    nextTask(result:RepositorySearchQuery):ProjectSearchTask {
        return new ProjectSearchTask(this.graphqlWithAuth, {
            id: uuidv4(),
            minStars: this.options.minStars,
            minForks: this.options.minForks,
            minSizeInKb: this.options.minSizeInKb,
            hasActivityAfter: this.options.hasActivityAfter,
            createdAfter: this.options.createdAfter,
            createdBefore: this.options.createdBefore,
            pageSize: this.options.pageSize,
            startCursor: <string>result.search.pageInfo.endCursor,
        });
    }
}


