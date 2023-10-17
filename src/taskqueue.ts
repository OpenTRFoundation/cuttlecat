import {PQueue} from "./dynamic-imports";
import {setMaxListeners} from "events";

interface TaskOptions {
    readonly signal?:AbortSignal;
}

export interface TaskResult<ResultType, TaskSpec> {
    task:Task<ResultType, TaskSpec>;
    output:ResultType;
}

interface Task<ResultType, TaskSpec> {
    getId():string;

    /**
     * Parent task is the task for a broader scope.
     * @param id
     */
    setParentId(id:string):void;

    /**
     * Originating task is the task that created this task.
     * It is different than the parent task, as the parent task is the task for a broader scope.
     * Instead, originating task can be something like the task that processed the previous page.
     * @param id
     */
    setOriginatingTaskId(id:string):void;

    createExecutable():(options:TaskOptions) => Promise<TaskResult<ResultType, TaskSpec>>;

    execute(signal:AbortSignal):Promise<ResultType>;

    nextTask(result:ResultType):Task<ResultType, TaskSpec> | null;

    getSpec():TaskSpec;

    saveOutput(output:ResultType):void;

    shouldAbort(output:ResultType):boolean;

    shouldAbortAfterError(error:any):boolean;

    getErrorMessage(error:any):string;

    getDebugInstructions():string;

    narrowedDownTasks():Task<ResultType, TaskSpec>[] | null;

    shouldRecordAsError(error:any):boolean;

    extractOutputFromError(error:any):ResultType;
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

interface TaskStore<TaskSpec> {
    unresolved:{ [key:string]:TaskSpec },
    resolved:{ [key:string]:TaskSpec },
    errored:{ [key:string]:ErroredTask<TaskSpec> },
    archived:{ [key:string]:ErroredTask<TaskSpec> },
}

export abstract class BaseTask<ResultType, TaskSpec> implements Task<ResultType, TaskSpec> {
    createExecutable():(options:TaskOptions) => Promise<TaskResult<ResultType, TaskSpec>> {
        return async (options:TaskOptions) => {
            return this
                .execute(options?.signal)
                .then((result) => {
                    return {
                        task: this,
                        output: result,
                    };
                }).catch((e) => {
                    // log and escalate the error
                    console.log(`Task ${this.getId()} errored: `, e.message);
                    throw e;
                });
        };
    }

    abstract getId():string;

    abstract setParentId(id:string):void;

    abstract setOriginatingTaskId(id:string):void;

    abstract execute(signal?:AbortSignal):Promise<ResultType>;

    abstract nextTask(result:ResultType):BaseTask<ResultType, TaskSpec> | null;

    abstract getSpec():TaskSpec;

    abstract saveOutput(output:ResultType):void;

    abstract shouldAbort(output:ResultType):boolean;

    abstract shouldAbortAfterError(error:any):boolean;

    abstract getErrorMessage(error:any):string;

    abstract getDebugInstructions():string;

    abstract narrowedDownTasks():Task<ResultType, TaskSpec>[] | null;

    abstract shouldRecordAsError(error:any):boolean;

    abstract extractOutputFromError(error:any):ResultType;
}

export interface TaskQueueOptions {
    readonly concurrency:number;
    readonly perTaskTimeout:number;
    readonly intervalCap:number;
    readonly interval:number;
    readonly retryCount:number;
}


export class TaskQueue<ResultType, TaskSpec> {
    private readonly backingQueue:typeof PQueue;
    private readonly taskStore:TaskStore<TaskSpec>;
    private readonly abortController:AbortController = new AbortController();
    private readonly retryCount:number = 0;

    constructor(store:TaskStore<TaskSpec>, options:TaskQueueOptions) {
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

        // To get rid of following warning, which is irrelevant:
        // (node:46005) MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 abort listeners added to [AbortSignal]. Use events.setMaxListeners() to increase limit
        setMaxListeners(0, this.abortController.signal)
    }

    add(task:Task<ResultType, TaskSpec>):void {
        this.taskStore.unresolved[task.getId()] = task.getSpec();
        (async () => {
            let output:ResultType = <ResultType>null;

            try {
                if (this.abortController.signal.aborted) {
                    console.log(`Task queue is aborted, hence not adding new task ${task.getId()} to the backing queue.`);
                    return;
                }
                let taskResult = await this.backingQueue.add(task.createExecutable(), {signal: this.abortController.signal});
                console.log(`Task ${task.getId()} done`);
                output = taskResult.output;
            } catch (e) {
                // in case of an abort, we don't want to add the task to the errored list
                if (e instanceof Error && e.constructor.name === 'AbortError') {
                    console.log("Task aborted: ", task.getId());
                    return;
                }

                // before marking the task as aborted, let's ask the task if it wants to abort
                if (task.shouldAbortAfterError(e)) {
                    console.log("Task identified that processing should stop after error, aborting queue. Task id: ", task.getId());
                    this.abortController.abort();
                    this.backingQueue.clear();
                    return;
                }

                // sometimes, errors are not really errors
                // such as, the case with partial GraphQL responses.
                // in other cases though, errors are real errors
                if (task.shouldRecordAsError(e)) {
                    // at this stage, we have a proper error
                    // let's ask the task for an error message, so that we can store it along with the task
                    const errorMessage = task.getErrorMessage(e);

                    console.log("Task errored: ", task.getId(), errorMessage);
                    if (!this.taskStore.errored[task.getId()]) {
                        this.taskStore.errored[task.getId()] = {
                            task: task.getSpec(),
                            debug: task.getDebugInstructions(),
                            errors: [{message: errorMessage, date: new Date()}],
                        }
                    } else {
                        this.taskStore.errored[task.getId()].errors.push(
                            {message: errorMessage, date: new Date()}
                        );
                    }
                    delete this.taskStore.unresolved[task.getId()];

                    const taskErrorCount = this.taskStore.errored[task.getId()].errors.length;
                    if (taskErrorCount < this.retryCount + 1) {
                        console.log(`Task ${task.getId()} errored, retrying. Error count: ${taskErrorCount}, max retry count: ${this.retryCount}`);
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

                        console.log(`Task ${task.getId()} errored for ${taskErrorCount} times which is more than the retry count: ${this.retryCount}.`);
                        console.log("Going to check if it can create narrowed down tasks.");

                        const narrowedDownTasks = task.narrowedDownTasks();
                        if (narrowedDownTasks && narrowedDownTasks.length > 0) {
                            console.log(`Task ${task.getId()} returned ${narrowedDownTasks.length} narrowed down tasks, adding them to the queue and archiving the original task.`);
                            for (let narrowedDownTask of narrowedDownTasks) {
                                narrowedDownTask.setParentId(task.getId());
                                this.add(narrowedDownTask);
                            }
                            // remove the original task from errored list and add it to archived
                            // it has been already removed from the unresolved list
                            this.taskStore.archived[task.getId()] = this.taskStore.errored[task.getId()];
                            delete this.taskStore.errored[task.getId()];
                        } else {
                            console.log(`Task ${task.getId()} did not return any narrowed down tasks, keeping it in the errored list.`);
                        }
                    }
                } else {
                    console.log("Task errored, but it is not a real error, continuing. Task id: ", task.getId());
                    output = task.extractOutputFromError(e);
                }
            }

            if (output) {
                // we got the output. it can be the result of a task that completed successfully, or a task that errored
                // and returned a result from an errored response.
                // in both cases, we want to process the output.

                // remove from unresolved, add to resolved
                this.taskStore.resolved[task.getId()] = task.getSpec();
                delete this.taskStore.unresolved[task.getId()];

                // if this task was previously errored, remove it from the errored list
                if (this.taskStore.errored[task.getId()]) {
                    delete this.taskStore.errored[task.getId()];
                }

                // task should store its own output somewhere
                task.saveOutput(output);

                // if the task identifies that there's an issue and the processing should stop (like rate limits),
                // we should abort the queue
                if (task.shouldAbort(output)) {
                    console.log(`Task ${task.getId()} identified that processing should stop, aborting queue.`);
                    this.abortController.abort();
                    this.backingQueue.clear();
                    return;
                }

                let nextTask = task.nextTask(output);
                if (nextTask) {
                    console.log(`Found next task ${nextTask.getId()} for task ${task.getId()}, adding to queue.`);
                    nextTask.setOriginatingTaskId(task.getId());
                    this.add(nextTask);
                }
            }
        })();
    }

    start() {
        return this.backingQueue.start();
    }

    async finish() {
        // There might be new items added to the queue while we're waiting for it to finish
        // e.g. when the last item in the queue is popped, and it creates a new item, the queue will be idle before
        // the new item is added and we will return. Thus, we need to check if the store's unresolved list is empty.
        while (true) {
            await this.backingQueue.onIdle();
            console.log("Task queue is idle, checking if there are any unresolved tasks.");
            if (Object.keys(this.taskStore.unresolved).length === 0) {
                break;
            }
            if (this.abortController.signal.aborted) {
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
}
