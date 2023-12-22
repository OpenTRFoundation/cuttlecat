import {BaseTask} from "../queue/taskqueue.js";
import {TaskContext} from "./context.js";
import {TaskResult} from "./taskResult.js";
import {TaskSpec} from "./taskSpec.js";

/**
 * Base class for all GraphQL tasks.
 *
 * @param <R> The type of the task result.
 * @param <S> The type of the task spec.
 */
export abstract class Task<R extends TaskResult, S extends TaskSpec> extends BaseTask<R, S, TaskContext> {
    protected readonly spec:S;

    constructor(spec:S) {
        super();
        this.spec = spec;
    }

    /**
     * Returns the GraphQL query to be executed.
     * This is the query string, not the query object.
     *
     * This method is to be implemented by the task implementations.
     *
     * @param context
     * @protected
     */
    protected abstract getGraphqlQuery(context:TaskContext):string;

    /**
     * Returns the GraphQL query parameters to be used in the query.
     *
     * This method is to be implemented by the task implementations.
     *
     * @param context
     * @protected
     */
    protected abstract buildQueryParameters(context:TaskContext):any;

    getId(_:TaskContext):string {
        return this.spec.id;
    }

    getSpec(_:TaskContext):S {
        return this.spec;
    }

    setParentId(_:TaskContext, id:string | null):void {
        this.spec.parentId = id;
    }

    setOriginatingTaskId(context:TaskContext, id:string):void {
        this.spec.originatingTaskId = id;
    }

    async execute(context:TaskContext, signal?:AbortSignal):Promise<R> {
        const logger = context.logger;

        logger.debug(`Executing task: ${this.getId(context)}`);
        if (signal?.aborted) {
            // Should never reach here
            logger.error("Task is aborted, throwing exception!");
            signal.throwIfAborted();
        }

        const graphqlWithSignal = context.graphqlWithAuth.defaults({
            // use the same signal for the graphql calls as well (HTTP requests)
            request: {
                signal: signal,
            }
        });

        try {
            return await graphqlWithSignal(
                this.getGraphqlQuery(context),
                this.buildQueryParameters(context)
            );
        } catch (e) {
            // do not swallow any errors here, as the task queue needs to receive them to re-queue tasks or abort the queue.
            logger.info(`Error while executing task ${this.getId(context)}: ${(<any>e)?.message}`);
            throw e;
        }
    }

    shouldAbort(context:TaskContext, output:R):boolean {
        const logger = context.logger;

        const taskId = this.getId(context);

        logger.debug(`Rate limit information after task the execution of ${taskId}: ${JSON.stringify(output.rateLimit)}`);

        let remainingCallPermissions = output.rateLimit?.remaining;
        const callLimit = output.rateLimit?.limit;

        if (remainingCallPermissions == null || callLimit == null) {
            logger.warn(`Rate limit information is not available after executing ${taskId}.`);
            return true;
        }

        remainingCallPermissions = remainingCallPermissions ? remainingCallPermissions : 0;

        if (callLimit && (remainingCallPermissions < (callLimit * context.rateLimitStopPercent / 100))) {
            logger.warn(`Rate limit reached after executing ${taskId}.`);
            logger.warn(`Remaining call permissions: ${remainingCallPermissions}, call limit: ${callLimit}, stop percent: ${context.rateLimitStopPercent}`);
            return true;
        }

        return false;
    }

    shouldAbortAfterError(context:TaskContext, error:any):boolean {
        const logger = context.logger;

        // `e instanceof GraphqlResponseError` doesn't work
        // so, need to do this hack
        if ((<any>error).headers) {
            // first check if this is a secondary rate limit error
            // if so, we should abort the queue
            if (error.headers['retry-after']) {
                logger.warn(`Secondary rate limit error in task ${this.getId(context)}. 'retry-after'=${error.headers['retry-after']}. Aborting the queue.`);
                return true;
            }
        }
        return false;
    }

    getErrorMessage(context:TaskContext, error:any):string {
        // `error instanceof GraphqlResponseError` doesn't work
        // so, need to do some hacks
        if (error.headers) {
            // First check if this is a secondary rate limit error
            // In this case, we should've already aborted earlier.
            if (error.headers['retry-after']) {
                throw new Error("Secondary rate limit error. This should have been aborted earlier.");
            }

            // throw a new and enriched error with the information from the response
            let message = `Error in task ${this.getId(context)}: ${error.message}.`;

            message += ` Headers: ${JSON.stringify(error.headers)}.`;

            if (error.errors) {
                error.errors.forEach((e:any) => {
                    message += ` Error: ${e.message}.`;
                });
            }

            if (error.data) {
                message += ` Data: ${JSON.stringify(error.data)}.`;
            }

            return message;
        }

        if (error.message) {
            return `Error in task ${this.getId(context)}: ${error.message}.`;
        }
        return `Error in task ${this.getId(context)}: ${JSON.stringify(error)}`;
    }

    shouldRecordAsError(_:TaskContext, error:any):boolean {
        // if `headers` are missing, then we don't have an actual response
        // if data is missing, then we don't have a partial response.
        // see https://github.com/octokit/graphql.js/blob/9c0643d34f36ed558e55193438d7aa8b031ca43d/README.md#partial-responses
        return !error.headers || !error.data;
    }

    extractOutputFromError(_:TaskContext, error:any):R {
        if (error.data) {
            return <R>error.data;
        }
        // this should never happen as `shouldRecordAsError` should've returned true in that case already
        throw new Error("Invalid error object. Can't extract output from error.");
    }

    getDebugInstructions(context:TaskContext):string {
        const instructions = {
            "query": this.getGraphqlQuery(context),
            "variables": this.buildQueryParameters(context),
        };

        return JSON.stringify(instructions, null, 2);
    }

}
