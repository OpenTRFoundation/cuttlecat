import {ErroredTask, TaskQueue} from "../taskqueue";
import {createLogger} from "../log";
import {GraphqlTask, GraphqlTaskResult, GraphqlTaskSpec} from "./graphqlTask";

const logger = createLogger("graphqlProcess");

export interface GraphqlProcessState<QueueConfig, TaskSpec extends GraphqlTaskSpec> {
    startingConfig:QueueConfig,
    unresolved:{ [key:string]:TaskSpec },
    resolved:{ [key:string]:TaskSpec },
    errored:{ [key:string]:ErroredTask<TaskSpec> },
    archived:{ [key:string]:ErroredTask<TaskSpec> },
    startDate:Date,
    completionDate:Date | null,
    completionError:string | null,
    outputFileName:string,
}

export abstract class GraphqlProcess<QueueConfig, TaskSpec extends GraphqlTaskSpec, ResultType extends GraphqlTaskResult> {
    protected readonly processState:GraphqlProcessState<QueueConfig, TaskSpec>;
    protected readonly taskQueue:TaskQueue<ResultType, TaskSpec>;
    protected readonly options:{
        retryCount:number,
        rateLimitStopPercent:number,
    };

    constructor(processState:GraphqlProcessState<QueueConfig, TaskSpec>, taskQueue:TaskQueue<ResultType, TaskSpec>, options:{
        retryCount:number;
        rateLimitStopPercent:number
    }) {
        this.processState = processState;
        this.taskQueue = taskQueue;
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
            const task = this.createNewTask(this.processState.unresolved[key]);
            //const task = new Task(this.graphqlFn, this.options.rateLimitStopPercent, this.currentRunOutput, this.processState.unresolved[key]);
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

    protected abstract createNewTask(taskSpec:TaskSpec):GraphqlTask<ResultType, TaskSpec>;
}
