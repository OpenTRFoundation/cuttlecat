import {setMaxListeners} from "events";
import PQueue from "p-queue";
import {createLogger} from "../log.js";

const logger = createLogger("taskqueue");

interface TaskOptions {
    readonly signal?:AbortSignal;
}

export interface TaskResult<ResultType, TaskSpec, Context> {
    task:Task<ResultType, TaskSpec, Context>;
    output:ResultType;
}

/**
 * A task is a unit of work that can be executed in the task queue.
 *
 * It is recommended to extend the BaseTask class instead of implementing this interface directly.
 *
 * @see BaseTask
 */
export interface Task<ResultType, TaskSpec, Context> {
    // TODO: convert to readonly field
    getId(context:Context):string;

    // TODO: convert to readonly field
    getSpec(context:Context):TaskSpec;

    // TODO: convert to field
    /**
     * Parent task is the task for a broader scope.
     * @param context
     * @param id
     */
    setParentId(context:Context, id:string):void;

    // TODO: convert to field
    /**
     * Originating task is the task that created this task.
     * It is different from the parent task, as the parent task is the task for a broader scope.
     * Instead, originating task can be something like the task that processed the previous page.
     * @param context
     * @param id
     */
    setOriginatingTaskId(context:Context, id:string):void;

    /**
     * The queue calls this function to create an executable function that can be added to the backing queue.
     */
    createExecutable(context:Context):(options:TaskOptions) => Promise<TaskResult<ResultType, TaskSpec, Context>>;

    /**
     * The task implementation can return a new task based on the result of the current task.
     *
     * For example, a task that works with API pagination might return a new task to process the next page.
     * @param context
     * @param result
     */
    nextTask(context:Context, result:ResultType):Task<ResultType, TaskSpec, Context> | null;

    /**
     * The task implementation can return a list of narrowed down tasks.
     *
     * Narrowed down tasks are tasks that are created from the original task, but with a narrower scope.
     *
     * When the return value is not null, the original task is archived and the narrowed down tasks are added to the queue.
     *
     * This is useful to reduce the scope of a task that is too ambitious and fails because of server side errors or timeouts.
     */
    narrowedDownTasks(context:Context):Task<ResultType, TaskSpec, Context>[] | null;

    /**
     * The task implementation needs to save the output.
     *
     * @param context
     * @param output
     */
    saveOutput(context:Context, output:ResultType):void;

    /**
     * When this is called, the task is completed without any errors and moved to the resolved list.
     * However, the task output might indicate that there's an issue and the processing should stop.
     *
     * For example, a task might denote that the rate limit is low and the processing should stop.
     * @param context
     * @param output
     */
    shouldAbort(context:Context, output:ResultType):boolean;

    /**
     * When this is called, the task is completed with an error and moved to the errored list.
     * However, the error might indicate that there's an issue and the processing should stop.
     *
     * For example, a task might denote that the failure happened because of rate limit and the processing should stop
     * as the next tasks will also have the same error.
     * @param context
     * @param error
     */
    shouldAbortAfterError(context:Context, error:any):boolean;

    /**
     * When this is called, the task is completed with an error. However, sometimes, errors are not really errors.
     * Based on the output of this function, the task might be moved to the resolved list instead of the errored list.
     *
     * For example, a task might fail because of a partial GraphQL response. In that case, there's still a response
     * that we can process.
     * @param context
     * @param error
     */
    shouldRecordAsError(context:Context, error:any):boolean;

    /**
     * When this is called, the task is completed with an error. However, sometimes, errors are not really errors.
     *
     * For example, a task might fail because of a partial GraphQL response. In that case, a task implementation
     * can extract the partial response and return it.
     *
     * @see shouldRecordAsError
     * @param context
     * @param error
     */
    extractOutputFromError(context:Context, error:any):ResultType;

    /**
     * When this is called, the task is completed with an error. In both the real errors and not-really-errors cases,
     * this function is called to get the error message.
     *
     * For example, a task implementation can return the error message of a partial response, or it can return the error
     * message of a real error.
     *
     * @see shouldAbortAfterError
     * @see shouldRecordAsError
     * @param context
     * @param error
     */
    getErrorMessage(context:Context, error:any):string;

    /**
     * Task implementations can return a debug message that can be used to manually run the task.
     */
    getDebugInstructions(context:Context):string;
}

export interface TaskError {
    readonly message:string;
    readonly date:Date;
}

export interface ErroredTask<TaskSpec> {
    readonly task:TaskSpec;
    readonly errors:[TaskError];
    // We should store the debug info, so that we can run the task again with the same input manually
    readonly debug:string;
}

export interface ResolvedTask<TaskSpec> {
    readonly task:TaskSpec;
    // this is an error that happened during the task, but it is not critical
    readonly nonCriticalError?:TaskError;
    // We should store the debug info, so that we can run the task again with the same input manually.
    // Only the debug info of the resolved tasks that have nonCriticalError will be stored.
    readonly debug?:string;
}

export interface TaskStore<TaskSpec> {
    unresolved:{ [key:string]:TaskSpec },
    resolved:{ [key:string]:ResolvedTask<TaskSpec> },
    errored:{ [key:string]:ErroredTask<TaskSpec> },
    archived:{ [key:string]:ErroredTask<TaskSpec> },
}

export abstract class BaseTask<ResultType, TaskSpec, Context> implements Task<ResultType, TaskSpec, Context> {
    abstract execute(context:Context, signal?:AbortSignal):Promise<ResultType>;

    createExecutable(context:Context):(options:TaskOptions) => Promise<TaskResult<ResultType, TaskSpec, Context>> {
        return async (options:TaskOptions) => {
            return this
                .execute(context, options.signal)
                .then((result) => {
                    return {
                        task: this,
                        output: result,
                    };
                }).catch((e) => {
                    // log and escalate the error
                    logger.debug(`Task ${this.getId(context)} errored: ${e.message}`);
                    throw e;
                });
        };
    }

    abstract getId(context:Context):string;

    abstract getSpec(context:Context):TaskSpec;

    abstract setParentId(context:Context, id:string):void;

    abstract setOriginatingTaskId(context:Context, id:string):void;

    abstract nextTask(context:Context, result:ResultType):BaseTask<ResultType, TaskSpec, Context> | null;

    abstract saveOutput(context:Context, output:ResultType):void;

    abstract shouldAbort(context:Context, output:ResultType):boolean;

    abstract shouldAbortAfterError(context:Context, error:any):boolean;

    abstract getErrorMessage(context:Context, error:any):string;

    abstract getDebugInstructions(context:Context):string;

    abstract narrowedDownTasks(context:Context):Task<ResultType, TaskSpec, Context>[] | null;

    abstract shouldRecordAsError(context:Context, error:any):boolean;

    abstract extractOutputFromError(context:Context, error:any):ResultType;
}

export interface TaskQueueOptions {
    readonly concurrency:number;
    readonly perTaskTimeout:number;
    readonly intervalCap:number;
    readonly interval:number;
    readonly retryCount:number;
}


export class TaskQueue<ResultType, TaskSpec, Context> {
    private readonly backingQueue:PQueue;
    private readonly taskStore:TaskStore<TaskSpec>;
    private readonly abortController:AbortController = new AbortController();
    private readonly retryCount:number = 0;
    private readonly context:Context;

    constructor(store:TaskStore<TaskSpec>, options:TaskQueueOptions, context:Context) {
        this.taskStore = store;
        this.retryCount = options.retryCount;
        this.backingQueue = new PQueue({
            //
            // args to propagate to p-queue
            concurrency: options.concurrency,
            timeout: options.perTaskTimeout,
            intervalCap: options.intervalCap,
            interval: options.interval,
            //
            // hard-coded args
            autoStart: false,
            throwOnTimeout: true,
            carryoverConcurrencyCount: false,
            //
            // not used
            // queueClass
        });

        this.context = context;

        // To get rid of following warning, which is irrelevant:
        // (node:46005) MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 abort listeners added to [AbortSignal]. Use events.setMaxListeners() to increase limit
        setMaxListeners(0, this.abortController.signal)
    }

    add(task:Task<ResultType, TaskSpec, Context>):void {
        this.taskStore.unresolved[task.getId(this.context)] = task.getSpec(this.context);
        (async () => {
            let output:ResultType = <ResultType>null;
            let nonCriticalErrorMessage:string | null = null;

            try {
                if (this.abortController.signal.aborted) {
                    logger.debug(`Task queue is aborted, hence not adding new task ${task.getId(this.context)} to the backing queue.`);
                    return;
                }

                const taskResult = await this.backingQueue.add(task.createExecutable(this.context), {signal: this.abortController.signal}) as TaskResult<ResultType, TaskSpec, Context>;
                logger.debug(`Task ${task.getId(this.context)} done`);
                output = taskResult.output;
            } catch (e) {
                try {
                    // in case of an abort, we don't want to add the task to the errored list
                    if (e instanceof Error && e.constructor.name === 'AbortError') {
                        logger.debug(`Task aborted: ${task.getId(this.context)}`);
                        return;
                    }

                    // before marking the task as aborted, let's ask the task if it wants to abort
                    if (task.shouldAbortAfterError(this.context, e)) {
                        logger.debug(`Task identified that processing should stop after error, aborting queue. Task id: ${task.getId(this.context)}`);
                        this.abort();
                        return;
                    }

                    // sometimes, errors are not really errors
                    // such as, the case with partial GraphQL responses.
                    // in other cases though, errors are real errors
                    if (task.shouldRecordAsError(this.context, e)) {
                        // at this stage, we have a proper error
                        // let's ask the task for an error message, so that we can store it along with the task
                        const errorMessage = task.getErrorMessage(this.context, e);

                        logger.debug(`Task ${task.getId(this.context)} errored: ${errorMessage}`);
                        if (!this.taskStore.errored[task.getId(this.context)]) {
                            this.taskStore.errored[task.getId(this.context)] = {
                                task: task.getSpec(this.context),
                                debug: task.getDebugInstructions(this.context),
                                errors: [{message: errorMessage, date: new Date()}],
                            }
                        } else {
                            this.taskStore.errored[task.getId(this.context)].errors.push(
                                {message: errorMessage, date: new Date()}
                            );
                        }
                        delete this.taskStore.unresolved[task.getId(this.context)];

                        const taskErrorCount = this.taskStore.errored[task.getId(this.context)].errors.length;
                        if (taskErrorCount < this.retryCount + 1) {
                            logger.debug(`Task ${task.getId(this.context)} errored, retrying. Error count: ${taskErrorCount}, max retry count: ${this.retryCount}`);
                            this.add(task);
                        } else {
                            // Before giving up on tasks that errored N times, ask them to create narrowed done subtasks.
                            // If they won't, give up on them.
                            //
                            // The purpose here is that a task might be too ambitious (e.g. tries to get a big chunk of data for a long period of time)
                            // and it might fail because of server side errors or timeouts.
                            // If the task reduces its ambition, it might be able to get the data in smaller chunks.
                            //
                            // If task returns new tasks, add them to the queue.
                            // The original task should be archived in that case.
                            // The new tasks need to have a relation to the archived original task for traceability.

                            logger.debug(`Task ${task.getId(this.context)} errored for ${taskErrorCount} times which is more than the retry count: ${this.retryCount}.`);
                            logger.debug("Going to check if it can create narrowed down tasks.");

                            const narrowedDownTasks = task.narrowedDownTasks(this.context);
                            if (narrowedDownTasks && narrowedDownTasks.length > 0) {
                                logger.debug(`Task ${task.getId(this.context)} returned ${narrowedDownTasks.length} narrowed down tasks, adding them to the queue and archiving the original task.`);
                                for (const narrowedDownTask of narrowedDownTasks) {
                                    narrowedDownTask.setParentId(this.context, task.getId(this.context));
                                    this.add(narrowedDownTask);
                                }
                                // remove the original task from errored list and add it to archived
                                // it has been already removed from the unresolved list
                                this.taskStore.archived[task.getId(this.context)] = this.taskStore.errored[task.getId(this.context)];
                                delete this.taskStore.errored[task.getId(this.context)];
                            } else {
                                logger.debug(`Task ${task.getId(this.context)} did not return any narrowed down tasks, keeping it in the errored list.`);
                            }
                        }
                    } else {
                        logger.debug("Task errored, but it is not a real error, continuing. Task id: ", task.getId(this.context));
                        output = task.extractOutputFromError(this.context, e);
                        nonCriticalErrorMessage = task.getErrorMessage(this.context, e);
                    }
                } catch (e) {
                    logger.error(`Error while handling error of task ${task.getId(this.context)}: ${e}`);
                    logger.error(e);
                }
            }

            if (output) {
                try {
                    // we got the output. it can be the result of a task that completed successfully, or a task that errored
                    // and returned a result from an errored response.
                    // in both cases, we want to process the output.

                    // remove from unresolved, add to resolved
                    if (!nonCriticalErrorMessage) {
                        this.taskStore.resolved[task.getId(this.context)] = {
                            task: task.getSpec(this.context),
                        };
                    } else {
                        this.taskStore.resolved[task.getId(this.context)] = {
                            task: task.getSpec(this.context),
                            debug: task.getDebugInstructions(this.context),
                            nonCriticalError: {
                                message: <string>nonCriticalErrorMessage,
                                date: new Date(),
                            },
                        };
                    }
                    delete this.taskStore.unresolved[task.getId(this.context)];

                    // if this task was previously errored, remove it from the errored list
                    if (this.taskStore.errored[task.getId(this.context)]) {
                        delete this.taskStore.errored[task.getId(this.context)];
                    }

                    // task should store its own output somewhere
                    task.saveOutput(this.context, output);

                    const nextTask = task.nextTask(this.context, output);
                    if (nextTask) {
                        logger.debug(`Found next task ${nextTask.getId(this.context)} for task ${task.getId(this.context)}, adding to queue.`);
                        nextTask.setOriginatingTaskId(this.context, task.getId(this.context));
                        this.add(nextTask);
                    }

                    // if the task identifies that there's an issue and the processing should stop (like rate limits),
                    // we should abort the queue
                    if (task.shouldAbort(this.context, output)) {
                        logger.debug(`Task ${task.getId(this.context)} identified that processing should stop, aborting queue.`);
                        this.abort();
                        return;
                    }
                } catch (e) {
                    logger.error(`Error while saving output of task ${task.getId(this.context)}: ${e}`);
                    logger.error(e);
                }
            }
        })();
    }

    start() {
        this.backingQueue.start();
    }

    async finish() {
        // There might be new items added to the queue while we're waiting for it to finish
        // e.g. when the last item in the queue is popped, and it creates a new item, the queue will be idle before
        // the new item is added and we will return. Thus, we need to check if the store's unresolved list is empty.
        // eslint-disable-next-line no-constant-condition
        while (true) {
            await this.backingQueue.onIdle();
            let done = false;
            // give some time to the queue to add new items
            setTimeout(() => {
                logger.debug("Task queue is idle, checking if there are any unresolved tasks.");
                logger.debug(`Unresolved task count: ${Object.keys(this.taskStore.unresolved).length}`);
                if (Object.keys(this.taskStore.unresolved).length === 0) {
                    done = true;
                }
                if (this.abortController.signal.aborted) {
                    done = true;
                }
            }, 1000);
            if(done){
                break;
            }
        }
    }

    getState() {
        return {
            "size": this.backingQueue.size,
            "pending": this.backingQueue.pending,
            "paused": this.backingQueue.isPaused,

        }
    }

    abort() {
        this.abortController.abort();
        this.backingQueue.clear();
    }

    isAborted() {
        return this.abortController.signal.aborted;
    }
}
