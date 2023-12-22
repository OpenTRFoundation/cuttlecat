import {TaskContext} from "./context.js";
import {Task} from "./task.js";
import {TaskResult} from "./taskResult.js";
import {TaskSpec} from "./taskSpec.js";

/**
 * A command is a set of tasks that are created and queued for execution.
 *
 * This is the contract you need to implement when you want to use cuttlecat to search for something on GitHub.
 */
export interface Command<R extends TaskResult, S extends TaskSpec, T extends Task<R, S>> {

    /**
     * When the queue is empty (ie. creating a new queue, instead of resuming an existing one), this method is called to
     * create the initial set of tasks.
     *
     * @param context
     */
    createNewQueueItems(context:TaskContext):S[];

    /**
     * Create a task implementation for the given spec.
     * The spec could be a new one just created by createNewQueueItems, or it could be one that was persisted and is now
     * being resumed.
     *
     * @param context
     * @param spec
     */
    createTask(context:TaskContext, spec:S):T;
}
