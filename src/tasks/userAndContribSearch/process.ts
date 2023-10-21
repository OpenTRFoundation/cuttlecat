// import {graphql} from "@octokit/graphql";
// import {v4 as uuidv4} from 'uuid';
// import {UserAndContribSearchQuery} from "../../generated/queries";
// import {bool, cleanEnv, num, str} from 'envalid'
// import {createWriteStream, readFileSync, writeFileSync} from 'fs'
//
// import {TaskQueue} from "../../taskqueue";
// import {addDays, daysInPeriod, formatDate, now as getNow, parseDate, subtractDays} from "../../utils";
// import FileSystem from "../../fileSystem";
// import {shuffle} from "lodash";
// import {FileOutput, ProcessState, QueueConfig, TaskOptions} from "./types";
// import {Task} from "./task";
// import fetch from "node-fetch";
// import {createLogger} from "../../log";
//
// const logger = createLogger("userAndContribSearch/process");
//
// export class Process {
//     private readonly processState:ProcessState;
//     private readonly taskQueue:TaskQueue<UserAndContribSearchQuery, TaskOptions>;
//     private readonly graphqlFn:typeof graphql;
//     private readonly currentRunOutput:FileOutput[];
//     private readonly options:{
//         retryCount:number,
//         rateLimitStopPercent:number,
//     };
//
//     constructor(processState:ProcessState, taskQueue:TaskQueue<UserAndContribSearchQuery, TaskOptions>, graphqlFn:typeof graphql, currentRunOutput:FileOutput[], options:{
//         retryCount:number;
//         rateLimitStopPercent:number
//     }) {
//         this.processState = processState;
//         this.taskQueue = taskQueue;
//         this.graphqlFn = graphqlFn;
//         this.currentRunOutput = currentRunOutput;
//         this.options = options;
//     }
//
//     initialize() {
//         // Queue already retries any errored items, until they fail for RETRY_COUNT times.
//         // Afterward, queue will only keep the errored items in the errored list, and remove them from the unresolved list.
//         // So, we don't actually need to check the errored list here.
//         // However, when the RETRY_COUNT is increased, we should retry the errored tasks from the previous run.
//         logger.info("Checking if the errored tasks should be retried, according to RETRY_COUNT.")
//         for (let key in this.processState.errored) {
//             let erroredTask = this.processState.errored[key];
//             if (this.processState.unresolved[erroredTask.task.id]) {
//                 // errored task is already in the unresolved list, and it will be retried by the queue.
//                 continue;
//             }
//
//             if (erroredTask.errors.length < this.options.retryCount + 1) {    // +1 since retry count is not the same as the number of errors
//                 logger.debug(`Going to retry errored task: ${erroredTask.task.id} as it has ${erroredTask.errors.length} errors, and RETRY_COUNT is ${this.options.retryCount}`);
//                 this.processState.unresolved[erroredTask.task.id] = erroredTask.task;
//                 // keep in unresolved though, as it will be retried by the task queue
//             }
//         }
//
//         for (let key in this.processState.unresolved) {
//             const task = new Task(this.graphqlFn, this.options.rateLimitStopPercent, this.currentRunOutput, this.processState.unresolved[key]);
//             logger.debug(`Adding task to queue: ${task.getId()}`);
//             // DO NOT await here, as it will block the loop
//             // fire and forget.
//             // the task will be added to the queue, and the queue will start executing it.
//             // noinspection ES6MissingAwait
//             this.taskQueue.add(task);
//         }
//     }
//
//     async start() {
//         logger.info("Starting the task queue");
//         this.taskQueue.start();
//         try {
//             await this.taskQueue.finish();
//         } catch (e) {
//             logger.error(`Error while finishing the task queue: ${e}`);
//             logger.error(e);
//         }
//         logger.info("Task queue finished");
//     }
// }
//
// function buildProcessConfigFromEnvVars() {
//     return cleanEnv(process.env, {
//         GITHUB_TOKEN: str({
//             desc: "(not persisted in process file) GitHub API token. Token doesn't need any permissions."
//         }),
//         RECORD_HTTP_CALLS: bool({
//             desc: "Record HTTP calls to disk for debugging purposes.",
//             default: false,
//         }),
//         DATA_DIRECTORY: str({
//             desc: "(not persisted in process file) Data directory to read and store the output."
//         }),
//         RENEW_PERIOD_IN_DAYS: num({
//             default: 7,
//             desc: "(not persisted in process file) if previous queue is completed, create the next one after RENEW_PERIOD_IN_DAYS days"
//         }),
//
//         // As this search is IO bound and CPU bound, we can have many concurrent tasks (more than the number of cores).
//         // However, because of rate limiting, we will have a lot of idle tasks. So, let's not do that and keep the concurrency low.
//         CONCURRENCY: num({
//             default: 6,
//             desc: "number of concurrent tasks"
//         }),
//
//         // Keeping the timeout too long will end up using too many GitHub actions minutes.
//         // Keeping the timeout too short will result in too many errored items.
//         PER_TASK_TIMEOUT_IN_MS: num({
//             default: 30000,
//             desc: "timeout for each task"
//         }),
//
//         // About rate limits...
//         // ref1: https://docs.github.com/en/free-pro-team@latest/rest/search/search?apiVersion=2022-11-28#search-users
//         // ref2: https://docs.github.com/en/free-pro-team@latest/rest/search/search?apiVersion=2022-11-28#rate-limit
//         // ref3: https://docs.github.com/en/rest/overview/resources-in-the-rest-api?apiVersion=2022-11-28#rate-limits-for-requests-from-personal-accounts
//         // ref4: https://docs.github.com/en/rest/overview/resources-in-the-rest-api?apiVersion=2022-11-28#rate-limits-for-requests-from-github-actions
//         // Numbers:
//         // The REST API has a custom rate limit for searching. ... you can make up to 30 requests per minute
//         // User access token requests are limited to 5,000 requests per hour ...
//         // When using GITHUB_TOKEN, the rate limit is 1,000 requests per hour per repository.
//         //
//         // Bottleneck is search endpoint, which is limited to 30 requests per minute.
//         // And the worst part is, that it's not reported by the RateLimit object in GraphQL response.
//         // We only know when we reached the limit.
//         // The queue will abort when primary (1000 requests per hour) or secondary (30 requests per minute) rate limit is reached.
//         // So that we can retry later, instead of waiting and using the GitHub action minutes.
//         //
//         // Another note is that instead of using an interval of 60 seconds and a cap of 30, we should use shorter intervals and a lower cap.
//         // Otherwise, what happens is that queue will execute 30 tasks in ~10 seconds, and then wait for 50 seconds.
//         // That's a burst-y behavior, and we should avoid that.
//         // A good number to start with is 10 seconds and 5 tasks.
//         //
//         // Finally, let's leave some gap for the secondary rate limit.
//         // Instead of 10 seconds and 5 tasks, let's use 12 seconds and 4 tasks (means 20 reqs/sec).
//         //
//         // These numbers can be overridden by env vars.
//
//         RATE_LIMIT_STOP_PERCENT: num({
//             default: 10,
//             desc: "if rate limit remaining is less than RATE_LIMIT_STOP_PERCENT * rate limit (typically 1000) / 100, stop the queue."
//         }),
//         INTERVAL_CAP: num({
//             default: 4,
//             desc: "max number of tasks to execute in one interval"
//         }),
//         INTERVAL_IN_MS: num({
//             default: 20000,
//             desc: "interval for the cap in milliseconds"
//         }),
//
//
//         RETRY_COUNT: num({
//             default: 3,
//             desc: "number of retries for each task before giving up"
//         }),
//
//         REPORT_PERIOD_IN_MS: num({
//             default: 5000,
//             desc: "period to print the queue state (0 for disabled)"
//         }),
//     });
// }
//
// function buildNewQueueConfigFromEnvVars():QueueConfig {
//     return cleanEnv(process.env, {
//         // Project search query parameters (applies to new queues only)
//         LOCATIONS: str({
//             default: "Turkey, Turkiye, Türkiye",
//             desc: "minimum number of stars (applies to new queues only)"
//         }),
//         MIN_FORKS: num({
//             default: 50,
//             desc: "minimum number of forks (applies to new queues only)"
//         }),
//         MIN_SIZE_IN_KB: num({
//             default: 1000,
//             desc: "minimum size in KB (applies to new queues only)"
//         }),
//         MAX_INACTIVITY_DAYS: num({
//             default: 90,
//             desc: "maximum number of days since last commit; ignore projects that have been inactive for longer than this (applies to new queues only)"
//         }),
//         EXCLUDE_PROJECTS_CREATED_BEFORE: str({
//             default: "2008-01-01",
//             desc: "ignore projects created before this date (format: YYYY-MM-DD) (applies to new queues only)"
//         }),
//         MIN_AGE_IN_DAYS: num({
//             default: 365,
//             desc: "ignore projects younger than this (applies to new queues only)"
//         }),
//
//         // Search batch size parameters (applies to new queues only)
//         SEARCH_PERIOD_IN_DAYS: num({
//             default: 5,
//             desc: "Number of days to search for projects in one call (applies to new queues only)"
//         }),
//         PAGE_SIZE: num({
//             default: 100,
//             desc: "Max number of projects to return in one batch (applies to new queues only)"
//         }),
//     });
// }
//
//
// export function createNewProcessState(startingConfig:QueueConfig, outputFileName:string, nowFn:() => Date):ProcessState {
//     let startDate = parseDate(startingConfig.EXCLUDE_PROJECTS_CREATED_BEFORE);
//     let endDate = subtractDays(nowFn(), startingConfig.MIN_AGE_IN_DAYS);
//
//     // GitHub search API is inclusive for the start date and the end date.
//     //
//     // Example call with a 2-day period:
//     //
//     // curl -G \
//     //   -H "Accept: application/vnd.github+json" \
//     //   -H "X-GitHub-Api-Version: 2022-11-28" \
//     //   --data-urlencode 'q=stars:>50 forks:>10 is:public pushed:>2023-06-19 size:>1000 template:false archived:false created:2010-01-12..2010-01-13' \
//     //   "https://api.github.com/search/repositories" | jq '.items[] | "\(.created_at)   \(.full_name)"'
//     // Results:
//     // "2010-01-12T09:37:53Z   futuretap/InAppSettingsKit"
//     // "2010-01-13T05:52:38Z   vasi/pixz"
//     //
//     // Example call with a 1-day period:
//     //
//     // curl -G \
//     //   -H "Accept: application/vnd.github+json" \
//     //   -H "X-GitHub-Api-Version: 2022-11-28" \
//     //   --data-urlencode 'q=stars:>50 forks:>10 is:public pushed:>2023-06-19 size:>1000 template:false archived:false created:2010-01-13..2010-01-13' \
//     //   "https://api.github.com/search/repositories" | jq '.items[] | "\(.created_at)   \(.full_name)"'
//     // Results:
//     // "2010-01-13T05:52:38Z   vasi/pixz"
//     //
//     // So, to prevent any duplicates, we need to make sure that the intervals are exclusive.
//     // Like these:
//     // - 2023-01-01 - 2023-01-05
//     // - 2023-01-06 - 2023-01-10
//
//     let interval = daysInPeriod(startDate, endDate, startingConfig.SEARCH_PERIOD_IN_DAYS);
//     let hasActivityAfter = formatDate(subtractDays(nowFn(), startingConfig.MAX_INACTIVITY_DAYS))
//
//     logger.info(`Creating a new process state, startDate: ${formatDate(startDate)}, endDate: ${formatDate(endDate)}, hasActivityAfter: ${hasActivityAfter}`);
//
//     let newTasks:TaskOptions[] = [];
//
//     for (let i = 0; i < interval.length; i++) {
//         let createdAfter = formatDate(interval[i]);
//         let createdBefore = formatDate(addDays(interval[i], startingConfig.SEARCH_PERIOD_IN_DAYS - 1));
//         let key = uuidv4();
//         newTasks.push({
//             id: key,
//             parentId: null,
//             originatingTaskId: null,
//             minStars: startingConfig.MIN_STARS,
//             minForks: startingConfig.MIN_FORKS,
//             minSizeInKb: startingConfig.MIN_SIZE_IN_KB,
//             hasActivityAfter: hasActivityAfter,
//             createdAfter: createdAfter,
//             createdBefore: createdBefore,
//             pageSize: startingConfig.PAGE_SIZE,
//             startCursor: null,
//         });
//     }
//
//     // tasks for some date ranges return lots of data and some return very little data.
//     // let's shuffle to have a more even distribution of request durations.
//     newTasks = shuffle(newTasks);
//
//     let unresolved:{ [key:string]:TaskOptions } = {};
//     for (let i = 0; i < newTasks.length; i++) {
//         const task = newTasks[i];
//         unresolved[task.id] = task;
//         logger.debug(`Created unresolved task: ${JSON.stringify(task)}`);
//     }
//
//     return {
//         startingConfig: startingConfig,
//         unresolved: unresolved,
//         resolved: {},
//         errored: {},
//         archived: {},
//         startDate: nowFn(),
//         completionDate: null,
//         completionError: null,
//         outputFileName: outputFileName,
//     }
// }
//
// function saveProcessRunOutput(fileSystem:FileSystem, stateFile:string, processState:ProcessState, currentRunOutput:FileOutput[]) {
//     logger.info(`Writing process state to file ${stateFile}`);
//     writeFileSync(stateFile, JSON.stringify(processState, null, 2));
//
//     const outputFileFullPath = fileSystem.getOutputFilePath(processState.outputFileName);
//     logger.info(`Writing output to file: ${outputFileFullPath}`);
//     const outputStream = createWriteStream(outputFileFullPath, {flags: 'a'});
//
//     // we don't write as an array. just add new items as new json objects
//     // the good thing is, we can use jq to filter the output
//     // jq has a slurp option:
//     // -s               read (slurp) all inputs into an array; apply filter to it;
//     for (let i = 0; i < currentRunOutput.length; i++) {
//         const output = currentRunOutput[i];
//         const outputStr = JSON.stringify(output, null, 0);
//         outputStream.write(outputStr + "\n");
//     }
//     outputStream.end();
// }
//
// function reportTaskQueue(taskQueue:TaskQueue<UserAndContribSearchQuery, TaskOptions>, processState:ProcessState) {
//     let queueState = taskQueue.getState();
//     logger.info(`---- Task queue state: ${JSON.stringify(queueState)}`);
//     logger.info(`---- Task store      : unresolved: ${Object.keys(processState.unresolved).length}, resolved: ${Object.keys(processState.resolved).length}, errored: ${Object.keys(processState.errored).length}, archived: ${Object.keys(processState.archived).length}`);
//     return queueState;
// }
//
// function getFileSystem(processConfig:any) {
//     return new FileSystem(
//         processConfig.DATA_DIRECTORY,
//         "process-state-",
//         ".json",
//         "process-output-",
//         ".json",
//     );
// }
//
// export function printIsLatestFileComplete() {
//     const processConfig = buildProcessConfigFromEnvVars();
//     const fileSystem = getFileSystem(processConfig);
//     const latestProcessStateFile = fileSystem.getLatestProcessStateFile();
//     if (latestProcessStateFile == null) {
//         // do not use logger here, as the caller will use the process output
//         console.log("true");
//         return;
//     }
//
//     const processState = JSON.parse(readFileSync(latestProcessStateFile, "utf8"));
//
//     // do not use logger here, as the caller will use the process output
//     console.log(processState.completionDate != null);
// }
//
// export async function main() {
//     logger.info("Starting user and contribution search");
//     const processConfig = buildProcessConfigFromEnvVars();
//     const newQueueConfig = buildNewQueueConfigFromEnvVars();
//     // store the output of current run as an array of objects
//     // these objects will be written to the output file at the end of the run
//     const currentRunOutput:FileOutput[] = [];
//
//     const fileSystem = getFileSystem(processConfig);
//
//     logger.info(`Read process config:` + JSON.stringify(processConfig, (key, value) => {
//         if (key == "GITHUB_TOKEN") {
//             // print only the first 3 characters of the token, if it's available
//             if (value && value.length > 3) {
//                 return value.substring(0, 3) + "...[REDACTED]";
//             }
//             return value;
//         }
//         return value;
//     }));
//
//     logger.info(`Read new queue config: ${JSON.stringify(newQueueConfig)}`);
//
//     let processState:ProcessState;
//
//     let stateFile = fileSystem.getLatestProcessStateFile();
//     if (stateFile == null) {
//         stateFile = fileSystem.getPathOfNewProcessStateFile();
//         logger.info(`There are no process state files, starting a new process. Path of state file will be: ${stateFile}`);
//         processState = createNewProcessState(newQueueConfig, fileSystem.getNewProcessOutputFileName(), getNow);
//     } else {
//         logger.info(`Found latest process state file: ${stateFile}`)
//         processState = JSON.parse(readFileSync(stateFile, "utf8"));
//     }
//
//     logger.debug(`Latest process state: ${JSON.stringify(processState)}`);
//
//     if (processState.completionDate) {
//         // convert to date
//         processState.completionDate = new Date(processState.completionDate);
//
//         logger.info("Previous queue is completed.");
//         // start a new one, but only if RENEW_PERIOD_IN_DAYS has passed
//         const now = getNow();
//         const daysSinceCompletion = (now.getTime() - processState.completionDate.getTime()) / (1000 * 60 * 60 * 24);
//         if (daysSinceCompletion < processConfig.RENEW_PERIOD_IN_DAYS) {
//             logger.info(`Previous process is completed, but RENEW_PERIOD_IN_DAYS of ${processConfig.RENEW_PERIOD_IN_DAYS} hasn't passed yet. It has been ${daysSinceCompletion} days. Exiting.`);
//             return;
//         }
//         logger.info("Previous queue is completed, and RENEW_PERIOD_IN_DAYS has passed. Starting a new queue.");
//         stateFile = fileSystem.getPathOfNewProcessStateFile();
//         processState = createNewProcessState(newQueueConfig, fileSystem.getNewProcessOutputFileName(), getNow);
//         logger.info(`New process state file: ${stateFile}`);
//         logger.debug(`New process state: ${JSON.stringify(processState)}`);
//     }
//
//     logger.info("Starting the search now...");
//     logger.info(`Number of unresolved tasks: ${Object.keys(processState.unresolved).length}`);
//     logger.info(`Number of resolved tasks: ${Object.keys(processState.resolved).length}`);
//     logger.info(`Number of errored tasks: ${Object.keys(processState.errored).length}`);
//
//     const taskStore = {
//         unresolved: processState.unresolved,
//         resolved: processState.resolved,
//         errored: processState.errored,
//         archived: processState.archived,
//     };
//
//     const taskQueue = new TaskQueue<UserAndContribSearchQuery, TaskOptions>(
//         taskStore,
//         {
//             concurrency: processConfig.CONCURRENCY,
//             perTaskTimeout: processConfig.PER_TASK_TIMEOUT_IN_MS,
//             intervalCap: processConfig.INTERVAL_CAP,
//             interval: processConfig.INTERVAL_IN_MS,
//             retryCount: processConfig.RETRY_COUNT,
//         });
//
//     let graphqlWithAuth = graphql.defaults({
//         headers: {
//             Authorization: `bearer ${processConfig.GITHUB_TOKEN}`,
//         },
//         request: {
//             fetch: fetch,
//         }
//     });
//
//     if (processConfig.RECORD_HTTP_CALLS) {
//         graphqlWithAuth = graphqlWithAuth.defaults({
//             headers: {
//                 // nock doesn't really support gzip, so we need to disable it
//                 "accept-encoding": 'identity'
//             }
//         });
//     }
//
//     const process = new Process(
//         processState, taskQueue, graphqlWithAuth, currentRunOutput, {
//             retryCount: processConfig.RETRY_COUNT,
//             rateLimitStopPercent: processConfig.RATE_LIMIT_STOP_PERCENT,
//         }
//     );
//
//     process.initialize();
//
//     // Print the queue state periodically
//     // noinspection ES6MissingAwait
//     (async () => {
//         if (processConfig.REPORT_PERIOD_IN_MS == 0) {
//             return;
//         }
//         while (true) {
//             let queueState = reportTaskQueue(taskQueue, processState);
//             await new Promise(r => setTimeout(r, processConfig.REPORT_PERIOD_IN_MS));
//
//             // There are some cases here:
//             // queue size is 0, but there are unresolved tasks --> hit the rate limit, should stop reporting
//             // queue size is 0, there are no unresolved tasks --> queue is completed, should stop reporting
//
//             if (queueState.size == 0) {
//                 break;
//             }
//         }
//     })();
//
//     await process.start();
//
//     if (Object.keys(processState.unresolved).length === 0) {
//         // no unresolved tasks, so the queue is completed.
//         processState.completionDate = getNow();
//
//         // However, there might be some errored tasks.
//         // TaskQueue itself is retrying those tasks, and it finishes if it gives up after N retries.
//         // So, if there are still errored items, they are the ones that have failed after retries.
//         // Let's mark that in the completionError.
//
//         if (Object.keys(processState.errored).length > 0) {
//             processState.completionError = "Errored tasks";
//         }
//     }
//
//     // do a final report before ending
//     reportTaskQueue(taskQueue, processState);
//
//     // Write to both of the files when queue is aborted too, so we can pick up from where we left off.
//     saveProcessRunOutput(fileSystem, stateFile, processState, currentRunOutput);
//
// }
