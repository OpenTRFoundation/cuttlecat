import {graphql} from "@octokit/graphql";
import {v4 as uuidv4} from 'uuid';
import {RepositorySearch, RepositorySearchQuery} from "./generated/queries";
import {cleanEnv, num, str} from 'envalid'
import {readdirSync, readFileSync} from 'fs'
import {join} from 'path'
import {eachDayOfInterval, format as doFormatDate, parse as doParseDate, startOfDay, subDays, addDays} from 'date-fns'

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

// store the output of current run as an array of objects
// these objects will be written to the output file at the end of the run
// TODO: how about, write to file as we go?
const currentRunOutput = [];

function buildProcessConfigFromEnvVars() {
    return cleanEnv(process.env, {
        GITHUB_TOKEN: str({desc: "(not persisted in process file) GitHub API token. Token doesn't need any permissions."}),
        RENEW_PERIOD_IN_DAYS: num({desc: "(not persisted in process file) if previous queue is completed, create the next one after RENEW_PERIOD_IN_DAYS days"}),
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

const DATA_DIR_PATH = "../data/focusprojectsearch";
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

export function main() {
    console.log("Starting focus project search");
    const processConfig = buildProcessConfigFromEnvVars();
    const newQueueConfig = buildNewQueueConfigFromEnvVars();

    console.log(`Read process config. GITHUB_TOKEN: "${processConfig.GITHUB_TOKEN.slice(0, 3)}...", RENEW_PERIOD_IN_DAYS: ${processConfig.RENEW_PERIOD_IN_DAYS}`);
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
        console.log("Previous queue is completed.");
        // start a new one, but only if RENEW_PERIOD_IN_DAYS has passed
        const now = new Date();
        const daysSinceCompletion = (now.getTime() - processState.completionDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceCompletion < processConfig.RENEW_PERIOD_IN_DAYS) {
            console.log("Previous process is completed, but RENEW_PERIOD_IN_DAYS hasn't passed yet. Exiting.");
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

    // TODO: use the AbortController
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
    // TODO: however, instead of using p-queue's cap limiting capabilities, we can just use as much as possible and
    // TODO: stop processing when we've used the rate limit. This would help with using less GitHub action minutes.
    // TODO: So, we should go with a higher cap.

    const taskQueue = new TaskQueue({
        // TODO: as this search is IO bound, we can increase concurrency
        concurrency: 1,
        // TODO: this is a bit too much, but needs experimenting.
        // Keeping the timeout too long will end up using too many GitHub actions minutes.
        // Keeping the timeout too short will result in too many errored items.
        perTaskTimeout: 20000,
        intervalCap: 30,
        interval: 60 * 1000,
        signal: abortController.signal
    });

    taskQueue.on('taskcomplete', (result:TaskResult<RepositorySearchQuery>) => {
        let taskId = result.task.getId();
        if (result.success) {
            console.log(`Task complete with success: ${taskId}, hasNextPage: ${result.result.search.pageInfo.hasNextPage}, endCursor: ${result.result.search.pageInfo.endCursor}`);

            // TODO: store the result in the output map
            // TODO: add new item to unresolved list from the output

            console.log(`Moving resolved task to resolved list: ${taskId}`);
            processState.resolved[taskId] = processState.unresolved[taskId];
            delete processState.unresolved[taskId];
        } else{
            console.log(`Task complete with error: ${taskId}, error: ${result.error}`);

            console.log(`Moving errored task to errored list: ${taskId}`);
            delete processState.unresolved[taskId];
        }

        // TODO: check the rate limit and abort if we are close to the limit
    });

    taskQueue.on('taskerror', (error) => {
        // TODO: is the following correct?
        // This listener is called when the task queue itself encounters an error.
        // We don't have a reference to the task that caused the error, so we can't
        // move it to the errored list.
        // It will stay in the unresolved list, and will be retried later on.
        // TODO
        console.log("taskerror", error);
    });

    const graphqlWithAuth = graphql.defaults({
        headers: {
            Authorization: `bearer ${processConfig.GITHUB_TOKEN}`,
        },
    });

    // TODO: instead of this single task, add the tasks from the `processState.unresolved` map
    const task = new ProjectSearchTask(graphqlWithAuth, {
        id: uuidv4(),
        minStars: 100,
        minForks: 100,
        minSizeInKb: 1000,
        hasActivityAfter: "2023-06-01",
        createdAfter: "2018-01-01",
        createdBefore: "2018-01-05",
        pageSize: 100,
        startCursor: null,
    });
    taskQueue.add(task);

    taskQueue.start();
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

        return this.graphqlWithAuth(
            RepositorySearch.loc!.source.body,
            {
                "searchString": search_string,
                "first": this.options.pageSize,
                "after": this.options.startCursor,
            }
        ).then((res:RepositorySearchQuery) => {
            return res;
        });
        // TODO: catch, finally
    }
}


