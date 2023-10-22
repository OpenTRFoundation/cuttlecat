import {BaseTask} from "../taskqueue";
import {graphql} from "@octokit/graphql";

import {createLogger} from "../log";

const logger = createLogger("graphQLtask");

export interface GraphqlTaskSpec {
    id:string;
    parentId:string | null;
    originatingTaskId:string | null;
}

export interface GraphqlTaskResult {
    rateLimit?:{
        limit:number;
        remaining:number;
    } | null;
}

// TODO: change the order of methods here, super class and subclasses

export abstract class GraphqlTask<ResultType extends GraphqlTaskResult, TaskSpec extends GraphqlTaskSpec> extends BaseTask<ResultType, TaskSpec> {
    protected readonly graphqlWithAuth:typeof graphql<ResultType>;
    protected readonly rateLimitStopPercent:number;
    protected readonly options:TaskSpec;

    protected constructor(graphqlWithAuth:typeof graphql, rateLimitStopPercent:number, options:TaskSpec) {
        super();
        this.graphqlWithAuth = graphqlWithAuth;
        this.rateLimitStopPercent = rateLimitStopPercent;
        this.options = options;
    }

    getId():string {
        return this.options.id;
    }

    getSpec():TaskSpec {
        return this.options;
    }

    setParentId(id:string):void {
        this.options.parentId = id;
    }

    setOriginatingTaskId(id:string):void {
        this.options.originatingTaskId = id;
    }

    async execute(signal:AbortSignal):Promise<ResultType> {
        logger.debug(`Executing task: ${this.getId()}`);
        if (signal.aborted) {
            // Should never reach here
            logger.error("Task is aborted, throwing exception!");
            signal.throwIfAborted();
        }

        const graphqlWithSignal = this.graphqlWithAuth.defaults({
            // use the same signal for the graphql calls as well (HTTP requests)
            request: {
                signal: signal,
            }
        });

        try {
            return await graphqlWithSignal(
                this.getGraphqlQuery(),
                this.buildQueryParameters()
            );
        } catch (e) {
            // do not swallow any errors here, as the task queue needs to receive them to re-queue tasks or abort the queue.
            logger.info(`Error while executing task ${this.getId()}: ${(<any>e)?.message}`);
            throw e;
        }
    }

    shouldAbort(output:ResultType):boolean {
        const taskId = this.getId();

        logger.debug(`Rate limit information after task the execution of ${taskId}: ${JSON.stringify(output.rateLimit)}`);

        let remainingCallPermissions = output.rateLimit?.remaining;
        let callLimit = output.rateLimit?.limit;

        if (remainingCallPermissions == null || callLimit == null) {
            logger.warn(`Rate limit information is not available after executing ${taskId}.`);
            return true;
        }

        remainingCallPermissions = remainingCallPermissions ? remainingCallPermissions : 0;

        if (callLimit && (remainingCallPermissions < (callLimit * this.rateLimitStopPercent / 100))) {
            logger.warn(`Rate limit reached after executing ${taskId}.`);
            logger.warn(`Remaining call permissions: ${remainingCallPermissions}, call limit: ${callLimit}, stop percent: ${this.rateLimitStopPercent}`);
            return true;
        }

        return false;
    }

    shouldAbortAfterError(error:any):boolean {
        // `e instanceof GraphqlResponseError` doesn't work
        // so, need to do this hack
        if ((<any>error).headers) {
            // first check if this is a secondary rate limit error
            // if so, we should abort the queue
            if (error.headers['retry-after']) {
                logger.warn(`Secondary rate limit error in task ${this.getId()}. 'retry-after'=${error.headers['retry-after']}. Aborting the queue.`);
                return true;
            }
        }
        return false;
    }

    getErrorMessage(error:any):string {
        // `error instanceof GraphqlResponseError` doesn't work
        // so, need to do some hacks
        if (error.headers) {
            // First check if this is a secondary rate limit error
            // In this case, we should've already aborted earlier.
            if (error.headers['retry-after']) {
                throw new Error("Secondary rate limit error. This should have been aborted earlier.");
            }

            // throw a new and enriched error with the information from the response
            let message = `Error in task ${this.getId()}: ${error.message}.`;

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
            return `Error in task ${this.getId()}: ${error.message}.`;
        }
        return `Error in task ${this.getId()}: ${JSON.stringify(error)}`;
    }

    shouldRecordAsError(error:any):boolean {
        // if `headers` are missing, then we don't have an actual response
        // if data is missing, then we don't have a partial response.
        // see https://github.com/octokit/graphql.js/blob/9c0643d34f36ed558e55193438d7aa8b031ca43d/README.md#partial-responses
        return !error.headers || !error.data;
    }

    extractOutputFromError(error:any):ResultType {
        if (error.data) {
            return <ResultType>error.data;
        }
        // this should never happen as `shouldRecordAsError` should've returned true in that case already
        throw new Error("Invalid error object. Can't extract output from error.");
    }

    getDebugInstructions():string {
        const instructions = {
            "query": this.getGraphqlQuery(),
            "variables": this.buildQueryParameters(),
        };

        return JSON.stringify(instructions, null, 2);
    }

    protected abstract getGraphqlQuery():string;

    protected abstract buildQueryParameters():any;

}
