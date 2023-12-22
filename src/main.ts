import {createWriteStream, writeFileSync} from "fs";
import path from "node:path";
import {join} from "path";

import {graphql} from "@octokit/graphql";
import lodash from "lodash";
import nock from "nock";
import fetch from "node-fetch";
import winston from "winston";

import {addArguments, GetBuiltOptionsType, getYargs} from "./arguments.js";
import {Command} from "./graphql/command.js";
import {TaskContext} from "./graphql/context.js";
import {Task} from "./graphql/task.js";
import {TaskResult} from "./graphql/taskResult.js";
import {TaskRunOutputItem} from "./graphql/taskRunOutputItem.js";
import {TaskSpec} from "./graphql/taskSpec.js";
import * as log from "./log.js";
import {ProcessFileHelper} from "./processFileHelper.js";
import {ErroredTask, ResolvedTask, TaskQueue} from "./queue/taskqueue.js";
import {formatTimeStamp, now as getNow, nowTimestamp} from "./utils.js";

type BaseResultType = any;
type BaseTaskSpec = TaskSpec;
type BaseTaskResult = TaskResult;
type BaseTask = Task<BaseResultType, BaseTaskSpec>;
type BaseCommand = Command<BaseTaskResult, BaseTaskSpec, BaseTask>;

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

export async function main() {

    const y = addArguments(getYargs());

    const argv:GetBuiltOptionsType<typeof addArguments> = y.parseSync();

    log.setLevel(argv.logLevel);

    const logger = log.createLogger("index");

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
            if (queueState.size == 0) {
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
