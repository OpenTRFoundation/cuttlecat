import {type EventEmitter} from "eventemitter3";

interface TaskOptions {
    readonly signal?:AbortSignal;
}

interface TimeoutOptions {
    timeout?:number;
    throwOnTimeout?:boolean;
}

interface QueueAddOptions extends TaskOptions, TimeoutOptions {
    readonly priority?:number;
}

type Task<TaskResultType> =
    ((options:TaskOptions) => PromiseLike<TaskResultType>)
    | ((options:TaskOptions) => TaskResultType);

export interface Options extends TimeoutOptions {
    readonly concurrency?:number;
    readonly autoStart?:boolean;
    readonly queueClass?:new () => any;
    readonly intervalCap?:number;
    readonly interval?:number;
    readonly carryoverConcurrencyCount?:boolean;
}

type EventName = 'active' | 'idle' | 'empty' | 'add' | 'next' | 'completed' | 'error';

interface PQueue_t<EnqueueOptionsType extends QueueAddOptions = QueueAddOptions> extends EventEmitter<EventName> {
    new(options?:Options):PQueue_t;

    add<TaskResultType>(function_:Task<TaskResultType>):Promise<TaskResultType> | void;

    add<TaskResultType>(function_:Task<TaskResultType>, options?:Partial<EnqueueOptionsType>):Promise<TaskResultType | void>;

    start():PQueue_t<EnqueueOptionsType>;
}

let PQueue:PQueue_t;

export default async function loadDynamicImports() {
    // `p-queue` switched to pure ESM modules from CommonJS.
    // This means, we can't `import` it regularly.
    // We can make this application an ESM module, but this time `graphql-tag` won't work,
    // as it uses Typescript `namespace`s, which can't be used by ESM modules.
    // See TODO: add link to the issue created
    if (!PQueue) {
        PQueue = <PQueue_t>(<unknown>(await import('p-queue')).default);
    }
}

// export {PQueue, delay};
export {PQueue};