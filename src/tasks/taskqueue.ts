import {PQueue} from "../dynamic-imports";
import {EventEmitter} from 'eventemitter3';

interface TaskOptions {
    readonly signal?:AbortSignal;
}

export interface TaskResult<ResultType> {
    task:Task<ResultType>;
    success:boolean;
    output:ResultType;
    error:any;
}

interface Task<ResultType> {
    getId():string;

    createExecutable():(options:TaskOptions) => Promise<TaskResult<ResultType>>;

    execute(signal:AbortSignal):Promise<ResultType>;
}

export abstract class BaseTask<ResultType> implements Task<ResultType> {
    createExecutable():(options:TaskOptions) => Promise<TaskResult<ResultType>> {
        return async (options:TaskOptions) => {
            return this.execute(options?.signal).then((result) => {
                // TODO: handle errors
                return {
                    task: this,
                    success: true,
                    output: result,
                    error: null
                };
            });
        };
    }

    abstract getId():string;
    abstract execute(signal?:AbortSignal):Promise<ResultType>;
}

export interface TaskQueueOptions {
    readonly concurrency:number;
    readonly perTaskTimeout:number;
    readonly intervalCap:number;
    readonly interval:number;
    readonly signal:AbortSignal;
}


export class TaskQueue<ResultType> extends EventEmitter<'taskcomplete' | 'taskerror'> {
    private readonly backingQueue:typeof PQueue;
    private readonly signal:AbortSignal;

    constructor(options:TaskQueueOptions) {
        super();
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
        this.signal = options.signal;

        // TODO: is this gonna be needed after using `await taskQueue.add(task)` to handle the task results??
        this.backingQueue.on('completed', (result) => {
            this.emit('taskcomplete', result);
        });

        // TODO: is this gonna be needed after using `await taskQueue.add(task)` to handle the task results??
        // TODO: when is this sent? Can we know which task?
        this.backingQueue.on('error', (error) => {
            this.emit('taskerror', error);
        });
    }

    add(task:Task<ResultType>) {
        return this.backingQueue.add(task.createExecutable(), {signal: this.signal});
    }

    start() {
        return this.backingQueue.start();
    }

    async finish(){
        return this.backingQueue.onIdle();
    }

}
