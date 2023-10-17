import {graphql, GraphqlResponseError} from "@octokit/graphql";
import {v4 as uuidv4} from 'uuid';
import {RepositorySearch, RepositorySearchQuery, RepositorySummaryFragment} from "./generated/queries";
import {cleanEnv, num, str} from 'envalid'
import {createWriteStream, readFileSync, writeFileSync} from 'fs'

import {BaseTask, ErroredTask, TaskQueue} from "./tasks/taskqueue";
import {addDays, daysInPeriod, formatDate, parseDate, splitPeriodIntoHalves, subtractDays} from "./utils";
import FileSystem from "./fileSystem";
import {shuffle} from "lodash";

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
    id:string;
    parentId:string | null;
    originatingTaskId:string | null;
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
    startingConfig:QueueConfig,
    unresolved:{ [key:string]:ProjectSearchTaskOptions },
    resolved:{ [key:string]:ProjectSearchTaskOptions },
    errored:{ [key:string]:ErroredTask<ProjectSearchTaskOptions> },
    archived:{ [key:string]:ErroredTask<ProjectSearchTaskOptions> },
    startDate:Date,
    completionDate:Date | null,
    completionError:string | null,
    outputFileName:string,
}

interface FileOutput {
    taskId:string;  // to identify which task found this result
    result:RepositorySummaryFragment,
}

function buildProcessConfigFromEnvVars() {
    return cleanEnv(process.env, {
        GITHUB_TOKEN: str({
            desc: "(not persisted in process file) GitHub API token. Token doesn't need any permissions."
        }),
        DATA_DIRECTORY: str({
            desc: "(not persisted in process file) Data directory to read and store the output."
        }),
        RENEW_PERIOD_IN_DAYS: num({
            default: 7,
            desc: "(not persisted in process file) if previous queue is completed, create the next one after RENEW_PERIOD_IN_DAYS days"
        }),

        // As this search is IO bound and CPU bound, we can have many concurrent tasks (more than the number of cores).
        // However, because of rate limiting, we will have a lot of idle tasks. So, let's not do that and keep the concurrency low.
        CONCURRENCY: num({
            default: 6,
            desc: "number of concurrent tasks"
        }),

        // Keeping the timeout too long will end up using too many GitHub actions minutes.
        // Keeping the timeout too short will result in too many errored items.
        PER_TASK_TIMEOUT_IN_MS: num({
            default: 30000,
            desc: "timeout for each task"
        }),

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
        // And the worst part is, that it's not reported by the RateLimit object in GraphQL response.
        // We only know when we reached the limit.
        // The queue will abort when primary (1000 requests per hour) or secondary (30 requests per minute) rate limit is reached.
        // So that we can retry later, instead of waiting and using the GitHub action minutes.
        //
        // Another note is that instead of using an interval of 60 seconds and a cap of 30, we should use shorter intervals and a lower cap.
        // Otherwise, what happens is that queue will execute 30 tasks in ~10 seconds, and then wait for 50 seconds.
        // That's a burst-y behavior, and we should avoid that.
        // A good number to start with is 10 seconds and 5 tasks.
        //
        // Finally, let's leave some gap for the secondary rate limit.
        // Instead of 10 seconds and 5 tasks, let's use 12 seconds and 4 tasks (means 20 reqs/sec).
        //
        // These numbers can be overridden by env vars.

        RATE_LIMIT_STOP_PERCENT: num({
            default: 10,
            desc: "if rate limit remaining is less than RATE_LIMIT_STOP_PERCENT * rate limit (typically 1000) / 100, stop the queue."
        }),
        INTERVAL_CAP: num({
            default: 4,
            desc: "max number of tasks to execute in one interval"
        }),
        INTERVAL_IN_MS: num({
            default: 20000,
            desc: "interval for the cap in milliseconds"
        }),


        RETRY_COUNT: num({
            default: 3,
            desc: "number of retries for each task before giving up"
        }),

        REPORT_PERIOD_IN_MS: num({
            default: 5000,
            desc: "period to print the queue state (0 for disabled)"
        }),
    });
}

function buildNewQueueConfigFromEnvVars():QueueConfig {
    return cleanEnv(process.env, {
        // Project search query parameters (applies to new queues only)
        MIN_STARS: num({
            default: 50,
            desc: "minimum number of stars (applies to new queues only)"
        }),
        MIN_FORKS: num({
            default: 50,
            desc: "minimum number of forks (applies to new queues only)"
        }),
        MIN_SIZE_IN_KB: num({
            default: 1000,
            desc: "minimum size in KB (applies to new queues only)"
        }),
        MAX_INACTIVITY_DAYS: num({
            default: 90,
            desc: "maximum number of days since last commit; ignore projects that have been inactive for longer than this (applies to new queues only)"
        }),
        EXCLUDE_PROJECTS_CREATED_BEFORE: str({
            default: "2008-01-01",
            desc: "ignore projects created before this date (format: YYYY-MM-DD) (applies to new queues only)"
        }),
        MIN_AGE_IN_DAYS: num({
            default: 365,
            desc: "ignore projects younger than this (applies to new queues only)"
        }),

        // Search batch size parameters (applies to new queues only)
        SEARCH_PERIOD_IN_DAYS: num({
            default: 5,
            desc: "Number of days to search for projects in one call (applies to new queues only)"
        }),
        PAGE_SIZE: num({
            default: 100,
            desc: "Max number of projects to return in one batch (applies to new queues only)"
        }),
    });
}


function createNewProcessState(startingConfig:QueueConfig, outputFileName:string):ProcessState {
    let startDate = parseDate(startingConfig.EXCLUDE_PROJECTS_CREATED_BEFORE);
    let endDate = subtractDays(new Date(), startingConfig.MIN_AGE_IN_DAYS);

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

    let interval = daysInPeriod(startDate, endDate, startingConfig.SEARCH_PERIOD_IN_DAYS);
    let hasActivityAfter = formatDate(subtractDays(new Date(), startingConfig.MAX_INACTIVITY_DAYS))

    console.log(`Creating a new process state, startDate: ${formatDate(startDate)}, endDate: ${formatDate(endDate)}, hasActivityAfter: ${hasActivityAfter}`);

    let newTasks:ProjectSearchTaskOptions[] = [];

    for (let i = 0; i < interval.length; i++) {
        let createdAfter = formatDate(interval[i]);
        let createdBefore = formatDate(addDays(interval[i], startingConfig.SEARCH_PERIOD_IN_DAYS));
        let key = uuidv4();
        newTasks.push({
            id: key,
            parentId: null,
            originatingTaskId: null,
            minStars: startingConfig.MIN_STARS,
            minForks: startingConfig.MIN_FORKS,
            minSizeInKb: startingConfig.MIN_SIZE_IN_KB,
            hasActivityAfter: hasActivityAfter,
            createdAfter: createdAfter,
            createdBefore: createdBefore,
            pageSize: startingConfig.PAGE_SIZE,
            startCursor: null,
        });
    }

    // tasks for some date ranges return lots of data and some return very little data.
    // let's shuffle to have a more even distribution of request durations.
    newTasks = shuffle(newTasks);

    let unresolved:{ [key:string]:ProjectSearchTaskOptions } = {};
    for (let i = 0; i < newTasks.length; i++) {
        const task = newTasks[i];
        unresolved[task.id] = task;
        console.log(`Created unresolved task: ${JSON.stringify(task)}`);
    }

    return {
        startingConfig: startingConfig,
        unresolved: unresolved,
        resolved: {},
        errored: {},
        archived: {},
        startDate: new Date(),
        completionDate: null,
        completionError: null,
        outputFileName: outputFileName,
    }
}

function saveProcessRunOutput(fileSystem:FileSystem, stateFile:string, processState:ProcessState, currentRunOutput:FileOutput[]) {
    console.log(`Writing process state to file ${stateFile}`);
    writeFileSync(stateFile, JSON.stringify(processState, null, 2));

    const outputFileFullPath = fileSystem.getOutputFilePath(processState.outputFileName);
    console.log(`Writing output to file: ${outputFileFullPath}`);
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

function reportTaskQueue(taskQueue:TaskQueue<RepositorySearchQuery, ProjectSearchTaskOptions>, processState:ProcessState) {
    let queueState = taskQueue.getState();
    console.log(`---- Task queue state: ${JSON.stringify(queueState)}`);
    console.log(`---- Task store      : unresolved: ${Object.keys(processState.unresolved).length}, resolved: ${Object.keys(processState.resolved).length}, errored: ${Object.keys(processState.errored).length}, archived: ${Object.keys(processState.archived).length}`);
    return queueState;
}

export async function main() {
    console.log("Starting focus project search");
    const processConfig = buildProcessConfigFromEnvVars();
    const newQueueConfig = buildNewQueueConfigFromEnvVars();
    // store the output of current run as an array of objects
    // these objects will be written to the output file at the end of the run
    const currentRunOutput:FileOutput[] = [];

    const fileSystem = new FileSystem(
        processConfig.DATA_DIRECTORY,
        "process-state-",
        ".json",
        "process-output-",
        ".json",
    );

    console.log(`Read process config:`, JSON.stringify(processConfig, (key, value) => {
        if (key == "GITHUB_TOKEN") {
            // print only the first 3 characters of the token, if it's available
            if (value && value.length > 3) {
                return value.substring(0, 3) + "...[REDACTED]";
            }
            return value;
        }
        return value;
    }));

    console.log(`Read new queue config: ${JSON.stringify(newQueueConfig)}`);

    let processState:ProcessState;

    let stateFile = fileSystem.getLatestProcessStateFile();
    if (stateFile == null) {
        stateFile = fileSystem.getPathOfNewProcessStateFile();
        console.log(`There are no process state files, starting a new process. Path of state file will be: ${stateFile}`);
        processState = createNewProcessState(newQueueConfig, fileSystem.getNewProcessOutputFileName());
    } else {
        console.log(`Found latest process state file: ${stateFile}`)
        processState = JSON.parse(readFileSync(stateFile, "utf8"));
    }

    console.log(`Latest process state: ${JSON.stringify(processState)}`);

    if (processState.completionDate) {
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
        stateFile = fileSystem.getPathOfNewProcessStateFile();
        processState = createNewProcessState(newQueueConfig, fileSystem.getNewProcessOutputFileName());
        console.log(`New process state file: ${stateFile}`);
        console.log(`New process state: ${JSON.stringify(processState)}`);
    }

    console.log("Starting the search now...");
    console.log(`Number of unresolved tasks: ${Object.keys(processState.unresolved).length}`);
    console.log(`Number of resolved tasks: ${Object.keys(processState.resolved).length}`);
    console.log(`Number of errored tasks: ${Object.keys(processState.errored).length}`);

    // Queue already retries any errored items, until they fail for RETRY_COUNT times.
    // Afterward, queue will only keep the errored items in the errored list, and remove them from the unresolved list.
    // So, we don't actually need to check the errored list here.
    // However, when the RETRY_COUNT is increased, we should retry the errored tasks from the previous run.
    console.log("Checking if the errored tasks should be retried, according to RETRY_COUNT.")
    for (let key in processState.errored) {
        let erroredTask = processState.errored[key];
        if (processState.unresolved[erroredTask.task.id]) {
            // errored task is already in the unresolved list, and it will be retried by the queue.
            continue;
        }

        if (erroredTask.errors.length < processConfig.RETRY_COUNT + 1) {    // +1 since retry count is not the same as the number of errors
            console.log(`Going to retry errored task: ${erroredTask.task.id} as it has ${erroredTask.errors.length} errors, and RETRY_COUNT is ${processConfig.RETRY_COUNT}`);
            processState.unresolved[erroredTask.task.id] = erroredTask.task;
            // keep in unresolved though, as it will be retried by the task queue
        }
    }

    const taskStore = {
        unresolved: processState.unresolved,
        resolved: processState.resolved,
        errored: processState.errored,
        archived: processState.archived,
    };

    const taskQueue = new TaskQueue<RepositorySearchQuery, ProjectSearchTaskOptions>(
        taskStore,
        {
            concurrency: processConfig.CONCURRENCY,
            perTaskTimeout: processConfig.PER_TASK_TIMEOUT_IN_MS,
            intervalCap: processConfig.INTERVAL_CAP,
            interval: processConfig.INTERVAL_IN_MS,
            retryCount: processConfig.RETRY_COUNT,
        });

    const graphqlWithAuth = graphql.defaults({
        headers: {
            Authorization: `bearer ${processConfig.GITHUB_TOKEN}`,
        },
    });

    for (let key in processState.unresolved) {
        const task = new ProjectSearchTask(graphqlWithAuth, processConfig.RATE_LIMIT_STOP_PERCENT, currentRunOutput, processState.unresolved[key]);
        console.log(`Adding task to queue: ${task.getId()}`);
        // DO NOT await here, as it will block the loop
        // fire and forget.
        // the task will be added to the queue, and the queue will start executing it.
        // noinspection ES6MissingAwait
        taskQueue.add(task);
    }

    // Print the queue state periodically
    // noinspection ES6MissingAwait
    (async () => {
        if (processConfig.REPORT_PERIOD_IN_MS == 0) {
            return;
        }
        while (true) {
            let queueState = reportTaskQueue(taskQueue, processState);
            await new Promise(r => setTimeout(r, processConfig.REPORT_PERIOD_IN_MS));

            // There are some cases here:
            // queue size is 0, but there are unresolved tasks --> hit the rate limit, should stop reporting
            // queue size is 0, there are no unresolved tasks --> queue is completed, should stop reporting

            if (queueState.size == 0) {
                break;
            }
        }
    })();

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
        processState.completionDate = new Date();

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

class ProjectSearchTask extends BaseTask<RepositorySearchQuery, ProjectSearchTaskOptions> {
    private readonly graphqlWithAuth:typeof graphql<RepositorySearchQuery>;
    private readonly rateLimitStopPercent:number;
    private readonly currentRunOutput:FileOutput[];
    private readonly options:ProjectSearchTaskOptions;


    constructor(graphqlWithAuth:typeof graphql, rateLimitStopPercent:number, currentRunOutput:FileOutput[], options:ProjectSearchTaskOptions) {
        super();
        this.graphqlWithAuth = graphqlWithAuth;
        this.rateLimitStopPercent = rateLimitStopPercent;
        this.currentRunOutput = currentRunOutput;
        this.options = options;
    }

    getId():string {
        return this.options.id;
    }

    setParentId(id:string):void {
        this.options.parentId = id;
    }

    setOriginatingTaskId(id:string):void {
        this.options.originatingTaskId = id;
    }

    async execute(signal:AbortSignal):Promise<RepositorySearchQuery> {
        console.log("Executing task: ", this.getId());
        if (signal.aborted) {
            // Should never reach here
            console.log("Task is aborted, throwing exception!");
            signal.throwIfAborted();
        }

        const graphqlWithSignal = this.graphqlWithAuth.defaults({
            // use the same signal for the graphql calls as well (HTTP requests)
            request: {
                signal: signal,
            }
        });

        try {
            return await graphqlWithSignal(
                RepositorySearch.loc!.source.body,
                this.buildQueryParameters()
            );
        } catch (e) {
            // do not swallow any errors here, as the task queue needs to receive them to re-queue tasks or abort the queue.
            console.log(`Error while executing task ${this.getId()}: `, (<any>e)?.message);
            throw e;
        }
    }

    private buildQueryParameters() {
        const searchString =
            "is:public template:false archived:false " +
            `stars:>${this.options.minStars} ` +
            `forks:>${this.options.minForks} ` +
            `size:>${this.options.minSizeInKb} ` +
            `pushed:>${this.options.hasActivityAfter} ` +
            // both ends are inclusive
            `created:${this.options.createdAfter}..${this.options.createdBefore}`;

        return {
            "searchString": searchString,
            "first": this.options.pageSize,
            "after": this.options.startCursor,
        };
    }

    nextTask(output:RepositorySearchQuery):ProjectSearchTask | null {
        if (output.search.pageInfo.hasNextPage) {
            console.log(`Next page available for task: ${this.getId()}`);
            return new ProjectSearchTask(
                this.graphqlWithAuth,
                this.rateLimitStopPercent,
                this.currentRunOutput,
                {
                    id: uuidv4(),
                    parentId: null,
                    originatingTaskId: this.getId(),
                    minStars: this.options.minStars,
                    minForks: this.options.minForks,
                    minSizeInKb: this.options.minSizeInKb,
                    hasActivityAfter: this.options.hasActivityAfter,
                    createdAfter: this.options.createdAfter,
                    createdBefore: this.options.createdBefore,
                    pageSize: this.options.pageSize,
                    startCursor: <string>output.search.pageInfo.endCursor,
                }
            );
        }

        return null;
    }

    narrowedDownTasks():ProjectSearchTask[] | null {
        // Project search can't narrow down the scopes of the tasks that start from a cursor.
        // That's because:
        // - The cursor is bound to the date range previously used.
        // In that case, add narrowed down tasks for the originating task. That's the task that caused the creation of
        // this task with a start cursor.
        // However, this means, some date ranges will be searched twice and there will be duplicate output.
        // It is fine though! We can filter the output later.
        if (this.options.startCursor) {
            console.log(`Narrowed down tasks can't be created for task ${this.getId()} as it has a start cursor.`);
            console.log(`Creating narrowed down tasks for the originating task ${this.options.originatingTaskId}`);
        }

        let newTasks:ProjectSearchTask[] = [];
        const startDate = parseDate(this.options.createdAfter);
        const endDate = parseDate(this.options.createdBefore);

        const halfPeriods = splitPeriodIntoHalves(startDate, endDate);
        if (halfPeriods.length < 1) {
            console.log(`Narrowed down tasks can't be created for task ${this.getId()}. as it can't be split into half periods.`);
            return null;
        }

        for (let i = 0; i < halfPeriods.length; i++) {
            const halfPeriod = halfPeriods[i];
            newTasks.push(
                new ProjectSearchTask(
                    this.graphqlWithAuth,
                    this.rateLimitStopPercent,
                    this.currentRunOutput,
                    {
                        id: uuidv4(),
                        parentId: this.getId(),
                        originatingTaskId: this.options.originatingTaskId,
                        minStars: this.options.minStars,
                        minForks: this.options.minForks,
                        minSizeInKb: this.options.minSizeInKb,
                        hasActivityAfter: this.options.hasActivityAfter,
                        createdAfter: formatDate(halfPeriod.start),
                        createdBefore: formatDate(halfPeriod.end),
                        pageSize: this.options.pageSize,
                        startCursor: null,
                    }
                )
            );
        }

        return newTasks;
    }

    getSpec():ProjectSearchTaskOptions {
        return this.options;
    }

    saveOutput(output:RepositorySearchQuery):void {
        console.log(`Saving output of the task: ${this.getId()}`);

        let nodes = output.search.nodes;

        if (!nodes || nodes.length == 0) {
            console.log(`No nodes found for ${this.getId()}.`);
            nodes = [];
        }

        console.log(`Number of nodes found for ${this.getId()}: ${nodes.length}`);

        for (let i = 0; i < nodes.length; i++) {
            const repoSummary = <RepositorySummaryFragment>nodes[i];
            this.currentRunOutput.push({
                taskId: this.getId(),
                result: repoSummary,
            });
        }
    }

    shouldAbort(output:RepositorySearchQuery):boolean {
        const taskId = this.getId();

        console.log(`Rate limit information after task the execution of ${taskId}: ${JSON.stringify(output.rateLimit)}`);

        let remainingCallPermissions = output.rateLimit?.remaining;
        let callLimit = output.rateLimit?.limit;

        if (remainingCallPermissions == null || callLimit == null) {
            console.log(`Rate limit information is not available after executing ${taskId}.`);
            return true;
        }

        remainingCallPermissions = remainingCallPermissions ? remainingCallPermissions : 0;

        if (callLimit && (remainingCallPermissions < (callLimit * this.rateLimitStopPercent / 100))) {
            console.log(`Rate limit reached after executing ${taskId}.`);
            console.log(`Remaining call permissions: ${remainingCallPermissions}, call limit: ${callLimit}, stop percent: ${this.rateLimitStopPercent}`);
            return true;
        }

        return false;
    }

    shouldAbortAfterError(error:any):boolean {
        // `e instanceof GraphqlResponseError` doesn't work
        // so, need to do this hack
        if ((<any>error).headers) {
            // first check if this is a secondary rate limit error
            // if so, we should abort the queue
            if (error.headers['retry-after']) {
                console.log(`Secondary rate limit error in task ${this.getId()}. 'retry-after'=${error.headers['retry-after']}. Aborting the queue.`);
                return true;
            }
        }
        return false;
    }

    getErrorMessage(error:any):string {
        // request: {
        //     query: '\n' +
        //       '    query RepositorySearch($searchString: String!, $first: Int!, $after: String) {\n' +
        //       '  rateLimit {\n' +
        //       '    cost\n' +
        //       '    limit\n' +
        //       '    nodeCount\n' +
        //       '    remaining\n' +
        //       '    resetAt\n' +
        //       '    used\n' +
        //       '  }\n' +
        //       '  search(type: REPOSITORY, query: $searchString, first: $first, after: $after) {\n' +
        //       '    pageInfo {\n' +
        //       '      startCursor\n' +
        //       '      hasNextPage\n' +
        //       '      endCursor\n' +
        //       '    }\n' +
        //       '    repositoryCount\n' +
        //       '    nodes {\n' +
        //       '      ...RepositorySummary\n' +
        //       '    }\n' +
        //       '  }\n' +
        //       '}\n' +
        //       '    \n' +
        //       '    fragment RepositorySummary on Repository {\n' +
        //       '  nameWithOwner\n' +
        //       '  isInOrganization\n' +
        //       '  owner {\n' +
        //       '    login\n' +
        //       '  }\n' +
        //       '  forkCount\n' +
        //       '  stargazerCount\n' +
        //       '  pullRequests {\n' +
        //       '    totalCount\n' +
        //       '  }\n' +
        //       '  issues {\n' +
        //       '    totalCount\n' +
        //       '  }\n' +
        //       '  mentionableUsers {\n' +
        //       '    totalCount\n' +
        //       '  }\n' +
        //       '  watchers {\n' +
        //       '    totalCount\n' +
        //       '  }\n' +
        //       '}\n' +
        //       '    ',
        //     variables: {
        //       searchString: 'is:public template:false archived:false stars:>50 forks:>50 size:>1000 pushed:>2023-07-19 created:2011-11-01..2011-11-06',
        //       first: 100,
        //       after: null
        //     }
        //   },
        //   headers: {
        //     'access-control-allow-origin': '*',
        //     'access-control-expose-headers': 'ETag, Link, Location, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset, X-OAuth-Scopes, X-Accepted-OAuth-Scopes, X-Poll-Interval, X-GitHub-Media-Type, X-GitHub-SSO, X-GitHub-Request-Id, Deprecation, Sunset',
        //     'content-encoding': 'gzip',
        //     'content-security-policy': "default-src 'none'",
        //     'content-type': 'application/json; charset=utf-8',
        //     date: 'Tue, 17 Oct 2023 15:25:57 GMT',
        //     'referrer-policy': 'origin-when-cross-origin, strict-origin-when-cross-origin',
        //     server: 'GitHub.com',
        //     'strict-transport-security': 'max-age=31536000; includeSubdomains; preload',
        //     'transfer-encoding': 'chunked',
        //     vary: 'Accept-Encoding, Accept, X-Requested-With',
        //     'x-content-type-options': 'nosniff',
        //     'x-frame-options': 'deny',
        //     'x-github-media-type': 'github.v3; format=json',
        //     'x-github-request-id': '9482:0A32:10DE46F:2241722:652EA781',
        //     'x-ratelimit-limit': '1000',
        //     'x-ratelimit-remaining': '844',
        //     'x-ratelimit-reset': '1697559058',
        //     'x-ratelimit-resource': 'graphql',
        //     'x-ratelimit-used': '156',
        //     'x-xss-protection': '0'
        //   },
        //   response: {
        //     data: { rateLimit: [Object], search: [Object] },
        //     errors: [ [Object] ]
        //   },
        //   errors: [
        //     {
        //       type: 'FORBIDDEN',
        //       path: [Array],
        //       extensions: [Object],
        //       locations: [Array],
        //       message: 'Although you appear to have the correct authorization credentials, the `heroku` organization has an IP allow list enabled, and your IP address is not permitted to access this resource.'
        //     }
        //   ],
        //   data: {
        //     rateLimit: {
        //       cost: 1,
        //       limit: 1000,
        //       nodeCount: 100,
        //       remaining: 844,
        //       resetAt: '2023-10-17T16:10:58Z',
        //       used: 156
        //     },
        //     search: { pageInfo: [Object], repositoryCount: 36, nodes: [Array] }
        //   }

        // `error instanceof GraphqlResponseError` doesn't work
        // so, need to do some hacks
        if ((<any>error).headers) {
            // First check if this is a secondary rate limit error
            // In this case, we should've already aborted earlier.
            if (error.headers['retry-after']) {
                throw new Error("Secondary rate limit error. This should have been aborted earlier.");
            }

            // throw a new and enriched error with the information from the response
            let message = `Error in task ${this.getId()}: ${error.message}.`;

            message += ` Headers: ${JSON.stringify(error.headers)}.`;

            if (error.errors) {
                error.errors.forEach((e:any) => {
                    message += ` Error: ${e.message}.`;
                });
            }

            if (error.data) {
                message += ` Data: ${JSON.stringify(error.data)}.`;
            }

            // TODO: temp change to log shit out
            if(error.data){
                console.log("There's partial data.")
                const partialData:RepositorySearchQuery = error.data;
                console.log("Rate limit: ", JSON.stringify(partialData.rateLimit));

                let nodes = error.data?.search?.nodes;

                if (!nodes || nodes.length == 0) {
                    console.log(`No nodes found for ${this.getId()}.`);
                    nodes = [];
                }

                console.log(`Number of nodes found for ${this.getId()}: ${nodes.length}`);

                for (let i = 0; i < nodes.length; i++) {
                    const repoSummary = <RepositorySummaryFragment>nodes[i];
                    console.log(JSON.stringify(repoSummary));
                }
            }

            return message;
        }

        if (error.message) {
            return error.message;
        }
        return JSON.stringify(error);
    }

    getDebugInstructions():string {
        const instructions = {
            "query": RepositorySearch.loc!.source.body,
            "variables": this.buildQueryParameters(),
        };

        return JSON.stringify(instructions, null, 2);
    }
}
