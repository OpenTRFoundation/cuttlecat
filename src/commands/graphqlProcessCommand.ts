import {graphql} from "@octokit/graphql";
import {createWriteStream, readFileSync, writeFileSync} from 'fs'

import {TaskQueue} from "../taskqueue";
import {now as getNow} from "../utils";
import FileSystem from "../fileSystem";
import fetch from "node-fetch";
import {createLogger} from "../log";
import {Arguments} from "../arguments";
import {GraphqlProcess, GraphqlProcessState} from "./graphqlProcess";
import {GraphqlTaskResult, GraphqlTaskSpec} from "./graphqlTask";
import {shuffle} from "lodash";

const logger = createLogger("graphqlProcessCommand");

export interface ProcessConfig {
    githubToken:string;
    dataDirectory:string;
    renewPeriodInDays:number;
    concurrency:number;
    perTaskTimeoutInMs:number;
    rateLimitStopPercent:number;
    intervalCap:number;
    intervalInMs:number;
    retryCount:number;
    reportPeriodInMs:number;
}

export abstract class GraphQLProcessCommand<QueueConfig, TaskSpec extends GraphqlTaskSpec, ResultType extends GraphqlTaskResult> {
    protected readonly commandName:string;
    protected readonly processConfig:ProcessConfig;
    protected readonly mainArgs:Arguments;

    constructor(commandName:string, processConfig:ProcessConfig, mainArgs:Arguments) {
        this.commandName = commandName;
        this.processConfig = processConfig;
        this.mainArgs = mainArgs;
    }

    async start() {
        logger.info(`Starting ${this.commandName}...`);

        // store the output of current run as an array of objects
        // these objects will be written to the output file at the end of the run
        const currentRunOutput:any[] = [];

        // TODO: make a field
        const fileSystem = this.getFileSystem(this.processConfig.dataDirectory);

        logger.info(`Read process config:` + JSON.stringify(this.processConfig, (key, value) => {
            if (key == "githubToken") {
                // print only the first 3 characters of the token, if it's available
                if (value && value.length > 3) {
                    return value.substring(0, 3) + "...[REDACTED]";
                }
                return value;
            }
            return value;
        }));

        let processState:GraphqlProcessState<QueueConfig, TaskSpec>;

        let stateFile = fileSystem.getLatestProcessStateFile();
        if (stateFile == null) {
            stateFile = fileSystem.getPathOfNewProcessStateFile();
            logger.info(`There are no process state files, starting a new process. Path of state file will be: ${stateFile}`);
            processState = this.createNewProcessState(fileSystem.getNewProcessOutputFileName(), getNow);
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
            if (daysSinceCompletion < this.processConfig.renewPeriodInDays) {
                logger.info(`Previous process is completed, but RENEW_PERIOD_IN_DAYS of ${this.processConfig.renewPeriodInDays} hasn't passed yet. It has been ${daysSinceCompletion} days. Exiting.`);
                return;
            }
            logger.info("Previous queue is completed, and RENEW_PERIOD_IN_DAYS has passed. Starting a new queue.");
            stateFile = fileSystem.getPathOfNewProcessStateFile();
            processState = this.createNewProcessState(fileSystem.getNewProcessOutputFileName(), getNow);
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

        const taskQueue = new TaskQueue<ResultType, TaskSpec>(
            taskStore,
            {
                concurrency: this.processConfig.concurrency,
                perTaskTimeout: this.processConfig.perTaskTimeoutInMs,
                intervalCap: this.processConfig.intervalCap,
                interval: this.processConfig.intervalInMs,
                retryCount: this.processConfig.retryCount,
            });

        let graphqlWithAuth = graphql.defaults({
            headers: {
                Authorization: `bearer ${this.processConfig.githubToken}`,
            },
            request: {
                fetch: fetch,
            }
        });

        if (this.mainArgs.recordHttpCalls) {
            graphqlWithAuth = graphqlWithAuth.defaults({
                headers: {
                    // nock doesn't really support gzip, so we need to disable it
                    "accept-encoding": 'identity'
                }
            });
        }

        const process = this.createProcess(processState, taskQueue, graphqlWithAuth, currentRunOutput);

        process.initialize();

        // Print the queue state periodically
        // noinspection ES6MissingAwait
        (async () => {
            if (this.processConfig.reportPeriodInMs == 0) {
                return;
            }
            while (true) {
                this.reportTaskQueue(taskQueue, processState);
                await new Promise(r => setTimeout(r, this.processConfig.reportPeriodInMs));

                // There are some cases here:
                // queue size is 0, but there are unresolved tasks --> hit the rate limit, should stop reporting
                // queue size is 0, there are no unresolved tasks --> queue is completed, should stop reporting
                let queueState = taskQueue.getState();
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
        this.reportTaskQueue(taskQueue, processState);

        // Write to both of the files when queue is aborted too, so we can pick up from where we left off.
        this.saveProcessRunOutput(fileSystem, stateFile, processState, currentRunOutput);
    }

    saveProcessRunOutput(fileSystem:FileSystem, stateFile:string, processState:GraphqlProcessState<QueueConfig, TaskSpec>, currentRunOutput:any[]) {
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

    reportTaskQueue(taskQueue:TaskQueue<ResultType, TaskSpec>, processState:GraphqlProcessState<QueueConfig, TaskSpec>) {
        let queueState = taskQueue.getState();
        logger.info(`---- Task queue state: ${JSON.stringify(queueState)}`);
        logger.info(`---- Task store      : unresolved: ${Object.keys(processState.unresolved).length}, resolved: ${Object.keys(processState.resolved).length}, errored: ${Object.keys(processState.errored).length}, archived: ${Object.keys(processState.archived).length}`);
    }

    createNewProcessState(outputFileName:string, nowFn:() => Date):GraphqlProcessState<QueueConfig, TaskSpec> {
        let state = this.doCreateNewProcessState(outputFileName, nowFn);

        let tasks:TaskSpec[] = Object.values(state.unresolved);

        // tasks for criteria return lots of data and some return very little data.
        // let's shuffle to have a more even distribution of request durations.
        tasks = shuffle(tasks);

        state.unresolved = {};

        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            state.unresolved[task.id] = task;
            logger.debug(`Created unresolved task: ${JSON.stringify(task)}`);
        }

        return state;
    }

    abstract getFileSystem(dataDirectory:string):FileSystem;

    abstract doCreateNewProcessState(outputFileName:string, nowFn:() => Date):GraphqlProcessState<QueueConfig, TaskSpec>;

    abstract createProcess(processState:GraphqlProcessState<QueueConfig, TaskSpec>, taskQueue:TaskQueue<ResultType, TaskSpec>, graphqlWithAuth:typeof graphql, currentRunOutput:any[]):GraphqlProcess<QueueConfig, TaskSpec, ResultType>;
}
