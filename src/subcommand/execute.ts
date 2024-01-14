import {createWriteStream, writeFileSync} from "fs";
import path from "node:path";
import {join} from "path";
import {graphql} from "@octokit/graphql";
import lodash from "lodash";
import nock from "nock";
import fetch from "node-fetch";
import winston from "winston";
import {Argv} from "yargs";

import {GetBuiltOptionsType} from "../arguments.js";
import {Command} from "../graphql/command.js";
import {TaskContext} from "../graphql/context.js";
import {Task} from "../graphql/task.js";
import {TaskResult} from "../graphql/taskResult.js";
import {TaskRunOutputItem} from "../graphql/taskRunOutputItem.js";
import {TaskSpec} from "../graphql/taskSpec.js";

import * as log from "../log.js";

import {ProcessFileHelper} from "../processFileHelper.js";
import {ErroredTask, ResolvedTask, TaskQueue} from "../queue/taskqueue.js";

import {SubCommand} from "../subcommand.js";
import {formatTimeStamp, now as getNow, nowTimestamp, shuffleDictionary, sortByKey} from "../utils.js";

type BaseResultType = any;
type BaseTaskSpec = TaskSpec;
type BaseTaskResult = TaskResult;
type BaseTask = Task<BaseResultType, BaseTaskSpec>;
type BaseCommand = Command<BaseTaskResult, BaseTaskSpec, BaseTask>;

export const CommandDefinition:SubCommand = {
    commandName: "execute",
    commandDescription: "Execute the command within the given file and store the result.",

    addArguments: function (y:Argv):Argv {
        return doAddArguments(y);
    },

    main: async function (args:any) {
        await start(args as Args);
    }
}

export interface ProcessState {
    unresolved:{ [key:string]:BaseTaskSpec },
    resolved:{ [key:string]:ResolvedTask<BaseTaskSpec> },
    errored:{ [key:string]:ErroredTask<BaseTaskSpec> },
    archived:{ [key:string]:ErroredTask<BaseTaskSpec> },
    startDate:Date,
    completionDate:Date | null,
    completionError:string | null,
}

type LatestProcessInformation = {
    latestProcessStateDir:string;
    processState:ProcessState;
} | null;


export async function start(argv:Args) {

    log.setLevel(argv.logLevel);

    const logger = log.createLogger("execute");

    logger.info(`Arguments:` + JSON.stringify(argv, (key, value) => {
        if (key == "githubToken") {
            // print only the first 3 characters of the token, if it's available
            if (value && value.length > 3) {
                return value.substring(0, 3) + "...[REDACTED]";
            }
            return value;
        }
        return value;
    }));

    const startTime = new Date();
    logger.info("Starting application. " + new Date().toString());

    // To get rid of following warning, which is irrelevant:
    // (node:46005) MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 abort listeners added to [AbortSignal]. Use events.setMaxListeners() to increase limit
    process.setMaxListeners(0);

    let graphqlWithAuth = graphql.defaults({
        headers: {
            Authorization: `bearer ${argv.githubToken}`,
        },
        request: {
            // need to override fetch to use node-fetch
            // otherwise, it uses window.fetch, which is not usable by "Nock Back" for testing
            //
            // BTW, the abort signal is added when task is to be executed, so it is passed to the graphql call there.
            fetch: fetch,
        }
    });

    const commandPath = argv.commandFile;
    if (!commandPath) {
        throw new Error(`commandPath is null`);
    }
    logger.info(`Loading command file: ${commandPath}`);

    let doNockDone;
    if (argv.recordHttpCalls) {
        logger.info("Recording HTTP calls to disk for debugging purposes.");

        // fixtures directory is where the HTTP calls will be dumped to.
        // use the command's directory, so that we can easily find the HTTP calls for a specific command.
        const commandDirectory = path.dirname(commandPath);
        const fixturesDirectory = join(commandDirectory, "nock-records");

        logger.info(`Using fixtures directory: ${fixturesDirectory}`);
        nock.back.fixtures = fixturesDirectory;
        nock.back.setMode("record");

        const httpCallDumpFileName = `dump_${nowTimestamp()}.json`;
        logger.info(`HTTP calls will be dumped to ${join(fixturesDirectory, httpCallDumpFileName)}`);

        const {nockDone} = await nock.back(httpCallDumpFileName);
        doNockDone = nockDone;

        graphqlWithAuth = graphqlWithAuth.defaults({
            headers: {
                // nock doesn't really support gzip, so we need to disable it
                "accept-encoding": 'identity'
            }
        });
    }

    const currentRunOutput:TaskRunOutputItem[] = [];
    const context = new TaskContext(graphqlWithAuth, argv.rateLimitStopPercent, logger, currentRunOutput);

    const command = await instantiateCommand(commandPath);
    logger.info(`Command file loaded.`);

    const processFileHelper = new ProcessFileHelper(argv.dataDirectory);

    const latestProcessInformation = getOrCreateLatestProcessState(processFileHelper, context, command, argv.renewPeriodInDays, getNow);

    if (!latestProcessInformation) {
        logger.info("No new process to start. Exiting.");
        return;
    }

    const {latestProcessStateDir, processState} = latestProcessInformation;

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
    const taskQueueOptions = {
        concurrency: argv.concurrency,
        perTaskTimeout: argv.perTaskTimeoutInMs,
        intervalCap: argv.intervalCap,
        interval: argv.intervalInMs,
        retryCount: argv.retryCount,
    };

    const taskQueue = new TaskQueue(taskStore, taskQueueOptions, context);
    // Queue already retries any errored items, until they fail for RETRY_COUNT times.
    // Afterwards, queue will only keep the errored items in the errored list, and remove them from the unresolved list.
    // So, we don't actually need to check the errored list here.
    // However, when the RETRY_COUNT is increased, we should retry the errored tasks from the previous run.
    logger.info(`Checking if the errored tasks should be retried, according to retry count (${argv.retryCount}).`)
    addErroredToUnresolved(logger, taskStore.errored, taskStore.unresolved, argv.retryCount);

    // shuffle the unresolved tasks, so that we don't hit the same rate limit for each run
    // otherwise, the queue will start with the same tasks each time.
    // and if the queue is aborted, and restarted, it will start with the same tasks again.
    // this will result in hitting the same rate limit again and again.
    taskStore.unresolved = processState.unresolved = shuffleDictionary(taskStore.unresolved);

    // now add the unresolved tasks to the queue
    initializeQueue(taskQueue, taskStore.unresolved, context, command);

    // Print the queue state periodically
    // noinspection ES6MissingAwait
    (async () => {
        if (argv.reportPeriodInMs == 0) {
            return;
        }
        // eslint-disable-next-line no-constant-condition
        while (true) {
            reportTaskQueue(logger, taskQueue, processState);
            await new Promise(r => setTimeout(r, argv.reportPeriodInMs));

            // There are some cases here:
            // queue size is 0, but there are unresolved tasks --> hit the rate limit, should stop reporting
            // queue size is 0, there are no unresolved tasks --> queue is completed, should stop reporting
            const queueState = taskQueue.getState();
            if (queueState.size == 0 && queueState.pending == 0) {
                logger.info("Queue is empty. Stopping regular reporting.");
                break;
            }
        }
    })();

    const maxRunTimeAbortController = new AbortController();

    let maxAbortTimeTimeout;
    if (argv.maxRunTimeInMinutes) {
        logger.info(`Maximum run time of ${argv.maxRunTimeInMinutes} minutes set. Exiting after that time.`);
        maxAbortTimeTimeout = setTimeout(() => {
            logger.info(`Maximum run time of ${argv.maxRunTimeInMinutes} minutes reached. Sending shutdown signal.`);
            maxRunTimeAbortController.abort();
        }, argv.maxRunTimeInMinutes * 60 * 1000);
    }

    maxRunTimeAbortController.signal.throwIfAborted();
    maxRunTimeAbortController.signal.onabort = () => {
        logger.info("Main abort signal received. Aborting...");
        taskQueue.abort();
    }

    // start the task queue
    await startTaskQueue(logger, taskQueue);

    // mark the file as completed, if it really is
    checkFileCompleted(processState, getNow);

    // do a final report before ending
    reportTaskQueue(logger, taskQueue, processState);

    // Write to both of the files when queue is aborted too, so we can pick up from where we left off.
    saveProcessRunOutput(logger, processFileHelper, latestProcessStateDir, processState, currentRunOutput, getNow);

    if (maxAbortTimeTimeout) {
        clearTimeout(maxAbortTimeTimeout);
    }

    if (doNockDone) {
        logger.info("Waiting for nock to finish recording HTTP calls to disk.");
        doNockDone();
    }

    logger.info("Application finished. " + new Date().toString());
    logger.info(`Application took ${(new Date().getTime() - startTime.getTime()) / 1000} seconds`);
}

async function instantiateCommand(commandPath:string):Promise<BaseCommand> {
    let commandModule:any;

    try {
        commandModule = await import(commandPath);
    } catch (e:any) {
        throw new Error(`Error while loading command file: ${e.message}`);
    }

    if (!commandModule) {
        throw new Error(`commandModule is null`);
    }

    try {
        return new commandModule.default();
    } catch (e:any) {
        throw new Error(`Error while creating command: ${e.message}`);
    }
}

export function addErroredToUnresolved<TaskSpec extends BaseTaskSpec>(
    logger:winston.Logger,
    errored:{ [key:string]:ErroredTask<TaskSpec> },
    unresolved:{ [key:string]:TaskSpec },
    retryCount:number) {
    for (const key in errored) {
        const erroredTask = errored[key];
        if (unresolved[erroredTask.task.id]) {
            // errored task is already in the unresolved list, and it will be retried by the queue.
            continue;
        }

        if (erroredTask.errors.length < retryCount + 1) {    // +1 since retry count is not the same as the number of errors
            logger.debug(`Going to retry errored task: ${erroredTask.task.id} as it has ${erroredTask.errors.length} errors, and RETRY_COUNT is ${retryCount}`);
            unresolved[erroredTask.task.id] = erroredTask.task;
            // keep in unresolved though, as it will be retried by the task queue
        }
    }
}

export function initializeQueue(
    taskQueue:TaskQueue<BaseTaskResult, TaskSpec, TaskContext>,
    unresolved:{
        [key:string]:TaskSpec
    },
    context:TaskContext,
    command:Command<BaseTaskResult, BaseTaskSpec, BaseTask>) {
    // then create tasks for unresolved items
    for (const key in unresolved) {
        const taskSpec = unresolved[key];
        const task = command.createTask(context, taskSpec);
        context.logger.debug(`Adding task to queue: ${task.getId(context)}`);
        // DO NOT await here, as it will block the loop
        // fire and forget.
        // the task will be added to the queue, and the queue will start executing it.
        // noinspection ES6MissingAwait
        taskQueue.add(task);
    }
}

function reportTaskQueue(logger:winston.Logger, taskQueue:TaskQueue<BaseResultType, BaseTaskSpec, TaskContext>, processState:ProcessState) {
    const queueState = taskQueue.getState();
    logger.info(`---- Task queue state: ${JSON.stringify(queueState)}`);
    logger.info(`---- Task store      : unresolved: ${Object.keys(processState.unresolved).length}, resolved: ${Object.keys(processState.resolved).length}, errored: ${Object.keys(processState.errored).length}, archived: ${Object.keys(processState.archived).length}`);
}

/**
 * Cases:
 * - There are no process directories: create a new process state (files to be persisted later)
 * - There is a process directory, but it's not completed: continue with it
 * - There is a process directory which is completed:
 *   - renewPeriodInDays has passed: create a new process state (file to be persisted later)
 *   - renewPeriodInDays has not passed: return null to signal that we should exit
 */
export function getOrCreateLatestProcessState(processFileHelper:ProcessFileHelper, context:TaskContext, command:Command<BaseTaskResult, BaseTaskSpec, BaseTask>, renewPeriodInDays:number, nowFn:() => Date) {
    const logger = context.logger;

    const latestProcessInformation = getLatestProcessInformation(processFileHelper);
    if (!latestProcessInformation) {
        logger.info("No existing process found, starting a new one.");
        return createProcessState(command, context, processFileHelper, nowFn);
    }

    if (!latestProcessInformation.processState.completionDate) {
        logger.info("Existing process is not completed, going to use it");
        return latestProcessInformation;

    }

    logger.info("Existing process is completed, checking if it's time to start a new one.");

    const daysSinceCompletion = (nowFn().getTime() - latestProcessInformation.processState.completionDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCompletion >= renewPeriodInDays) {
        logger.info(`Previous queue is completed, and renewPeriodInDays of ${renewPeriodInDays} has passed. Starting a new queue.`);
        return createProcessState(command, context, processFileHelper, nowFn);
    }

    logger.info(`Previous process is completed, but "renewPeriodInDays" of ${renewPeriodInDays} hasn't passed yet. It has been ${daysSinceCompletion} days.`);
    return null;
}

function getLatestProcessInformation(processFileHelper:ProcessFileHelper):LatestProcessInformation {
    const latestProcessStateDir = processFileHelper.getLatestProcessStateDirectory();
    if (!latestProcessStateDir) {
        return null;
    }

    const processState:ProcessState = processFileHelper.readProcessStateFile(latestProcessStateDir);
    if (!processState) {
        return null;
    }

    // convert some strings to date
    if (processState.startDate) {
        processState.startDate = new Date(processState.startDate);
    }
    if (processState.completionDate) {
        processState.completionDate = new Date(processState.completionDate);
    }

    return {latestProcessStateDir, processState};
}

function createProcessState(command:BaseCommand, context:TaskContext, processFileHelper:ProcessFileHelper, nowFn:() => Date):LatestProcessInformation {
    const logger = context.logger;

    const date = nowFn();

    const timestamp = formatTimeStamp(date);
    logger.info(`Starting a new process. Path of state file will be: ${timestamp}`)
    processFileHelper.createProcessStateDirectory(timestamp);

    let tasks:TaskSpec[] = command.createNewQueueItems(context);

    // tasks for criteria return lots of data and some return very little data.
    // let's shuffle to have a more even distribution of request durations.
    tasks = lodash.shuffle(tasks);

    const state:ProcessState = {
        startDate: date,
        completionDate: null,
        completionError: null,
        unresolved: {},
        resolved: {},
        errored: {},
        archived: {},
    };

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        state.unresolved[task.id] = task;
        logger.debug(`Created unresolved task: ${JSON.stringify(task)}`);
    }

    return {
        latestProcessStateDir: timestamp,
        processState: state,
    };
}

export async function startTaskQueue(logger:winston.Logger, taskQueue:TaskQueue<unknown, TaskSpec, TaskContext>) {
    logger.info("Starting the task queue");
    taskQueue.start();
    try {
        await taskQueue.finish();
    } catch (e) {
        logger.error(`Error while finishing the task queue: ${e}`);
        logger.error(e);
    }
    logger.info("Task queue finished");
}

export function checkFileCompleted(processState:ProcessState, nowFn:() => Date) {
    if (Object.keys(processState.unresolved).length === 0) {
        // no unresolved tasks, so the queue is completed.
        processState.completionDate = nowFn();

        // However, there might be some errored tasks.
        // TaskQueue itself is retrying those tasks, and it finishes if it gives up after N retries.
        // So, if there are still errored items, they are the ones that have failed after retries.
        // Let's mark that in the completionError.

        if (Object.keys(processState.errored).length > 0) {
            processState.completionError = "Errored tasks";
        }
    }
}

function saveProcessRunOutput(logger:winston.Logger, processFileHelper:ProcessFileHelper, processStateDir:string, processState:ProcessState, currentRunOutput:any[], nowFn:() => Date) {
    logger.info(`Writing process state under directory ${processStateDir}`);
    const processStateFilePath = processFileHelper.getProcessStateFilePath(processStateDir);

    logger.info(`Writing process state to file: ${processStateFilePath}`);
    sortProcessState(processState);
    writeFileSync(processStateFilePath, JSON.stringify(processState, null, 2));

    const now = nowFn();
    const timestamp = formatTimeStamp(now);

    const outputFileFullPath = processFileHelper.getProcessOutputFilePath(processStateDir, timestamp);
    logger.info(`Writing current run output to file: ${outputFileFullPath}`);
    const outputStream = createWriteStream(outputFileFullPath, {flags: 'a'});

    // we don't write as an array. just add new items as new json objects.
    //
    // the good thing is, we can use jq to filter the output.
    // jq has a slurp option:
    // -s               read (slurp) all inputs into an array; apply filter to it;
    //
    // so, open the file in append mode, and append each output as a new line.
    // this way, we add new outputs to the file incrementally.
    for (let i = 0; i < currentRunOutput.length; i++) {
        const output = currentRunOutput[i];
        const outputStr = JSON.stringify(output, null, 0);
        outputStream.write(outputStr + "\n");
    }
    outputStream.end();
}

export function sortProcessState(processState:ProcessState) {
    processState.unresolved = sortByKey(processState.unresolved);
    processState.resolved = sortByKey(processState.resolved);
    processState.errored = sortByKey(processState.errored);
    processState.archived = sortByKey(processState.archived);
}

const REQUIRED_OPTIONS_GROUP = "Required options";
type Args = GetBuiltOptionsType<typeof doAddArguments>;

function doAddArguments(y:Argv<any>) {
    return y
        .example(
            "--data-directory=/path/to/directory",
            "Store the state of the process and the output in /path/to/directory, so that subsequent executions of the same command can be resumed."
        )
        .example(
            "--renew-period-in-days=7",
            "If the process is complete (all search periods are processed), don't start a new search until 7 days has passed after the latest completion."
        )
        .example(
            "--concurrency=6 --interval-cap=4 --interval-in-ms=20000",
            "Start 6 concurrent tasks each time, and execute 4 tasks in every 20 seconds. (change these to avoid hitting GitHub secondary rate limits)"
        )
        .example(
            "--retry-count=3",
            "When a task fails, retry 3 times (in total, 4 times). If it still fails, process will create tasks that have narrower scopes. If the task's scope can be " +
            "narrowed down, then the task will be archived. If not, it will stay in the errored list. This narrowing down will also happen for any narrowed-down tasks " +
            "that fail (tried 4 times in total), until they cannot be narrowed down anymore. " +
            "For the commands that use a date range to search for, tasks for shorter search ranges will be created that in total wrap the " +
            "failing task's search range."
        )
        .example(
            "--per-task-timeout-in-ms=30000",
            "For each task, wait for 30 seconds before timing out. You change this to avoid spending too much GitHub action minutes. If the timeout" +
            "is too short, there will be too many errored items. However, the process will retry and create narrower scoped tasks for errored items, so, having a " +
            "very long timeout is not very useful."
        )
        .example(
            "--report-period-in-ms=5000",
            "Print the queue state to stdout every 5 seconds. This is useful to see how many tasks are in the queue, how many are completed, how many are errored, etc. "
        )
        .options({
            "command-file": {
                type: "string",
                desc: "Command file to load.",
                demandOption: true,
                group: REQUIRED_OPTIONS_GROUP,
            },
            "data-directory": {
                type: "string",
                desc: "Data directory to read and store the output.",
                demandOption: true,
                group: REQUIRED_OPTIONS_GROUP,
            },
            "github-token": {
                type: "string",
                desc: "GitHub API token. Token might need permissions based on your task.",
                demandOption: true,
                group: REQUIRED_OPTIONS_GROUP,
            },

            // optional stuff
            "renew-period-in-days": {
                type: "number",
                desc: "Number of days to wait until creating a new queue after the latest one is completed.",
                default: 7,
            },
            "concurrency": {
                type: "number",
                desc:
                    "Number of concurrent tasks to process the queue. " +
                    "As this search is IO bound and CPU bound, there can be many concurrent tasks (more than the number of cores). " +
                    "However, because of the rate limiting, there will be a lot of idle tasks. " +
                    "So, it is recommended to keep concurrency low.",
                default: 6,
            },
            "per-task-timeout-in-ms": {
                type: "number",
                desc:
                    "Timeout in milliseconds for each task in the queue." +
                    "Keeping the timeout too long will end up using too many GitHub actions minutes." +
                    "Keeping the timeout too short will result in too many errored items.",
                default: 30000,
            },
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
            "rate-limit-stop-percent": {
                type: "number",
                desc: "Under this rate limit remaining percent, stop the queue.",
                default: 10,
            },
            "interval-cap": {
                type: "number",
                desc: "Max number of tasks to execute in the given interval by interval-in-ms.",
                default: 4,
            },
            "interval-in-ms": {
                type: "number",
                desc: "Interval for the cap in milliseconds.",
                default: 20000,
            },
            "retry-count": {
                type: "number",
                desc: "Number of retries for each task before giving up of creating narrower scoped tasks.",
                default: 3,
            },

            // debug related stuff
            "record-http-calls": {
                type: "boolean",
                desc:
                    "Record HTTP calls to disk for debugging purposes. " +
                    "\"Nock back\" will be used in `record` mode where the new records will be created. " +
                    "The calls will be stored in the `./nock-records/` directory, relative to the command path.",
                default: false,
            },
            "log-level": {
                type: "string",
                desc: "Log level to use.",
                default: "info",
            },
            "max-run-time-in-minutes": {
                type: "number",
                desc: "When to stop the command gracefully. For example GitHub Actions has a 3 hour limit and " +
                    "when it cancels, nothing is saved. However, GitHub sometimes cancels before the limit to " +
                    "possibly make rooms for other systems/actions, so set it a bit lower than the limit.",
                default: 60, // default to 1 hour
            },
            "report-period-in-ms": {
                type: "number",
                desc: "Period in milliseconds to print the queue state to stdout (0 for disabled)",
                default: 5000,
            },
        });
}
