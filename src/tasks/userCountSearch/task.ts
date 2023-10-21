import {graphql} from "@octokit/graphql";
import {BaseTask} from "../../taskqueue";
import {UserCountSearch, UserCountSearchQuery,} from "../../generated/queries";
import {FileOutput, TaskOptions} from "./types";
import {createLogger} from "../../log";

const logger = createLogger("userCountSearch/task");

export class Task extends BaseTask<UserCountSearchQuery, TaskOptions> {
    private readonly graphqlWithAuth:typeof graphql<UserCountSearchQuery>;
    private readonly rateLimitStopPercent:number;
    private readonly currentRunOutput:FileOutput[];
    private readonly options:TaskOptions;


    constructor(graphqlWithAuth:typeof graphql, rateLimitStopPercent:number, currentRunOutput:FileOutput[], options:TaskOptions) {
        super();
        this.graphqlWithAuth = graphqlWithAuth;
        this.rateLimitStopPercent = rateLimitStopPercent;
        this.currentRunOutput = currentRunOutput;
        this.options = options;
    }

    getId():string {
        return this.options.id;
    }

    setParentId(id:string):void {
        this.options.parentId = id;
    }

    setOriginatingTaskId(id:string):void {
        this.options.originatingTaskId = id;
    }

    async execute(signal:AbortSignal):Promise<UserCountSearchQuery> {
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
                UserCountSearch.loc!.source.body,
                this.buildQueryParameters()
            );
        } catch (e) {
            // do not swallow any errors here, as the task queue needs to receive them to re-queue tasks or abort the queue.
            logger.info(`Error while executing task ${this.getId()}: ${(<any>e)?.message}`);
            throw e;
        }
    }

    private buildQueryParameters() {
        const searchString =
            `location:${this.options.location} ` +
            `repos:>=${this.options.minRepos} ` +
            `followers:>=${this.options.minFollowers}`;

        return {
            "searchString": searchString,
        };
    }

    nextTask(output:UserCountSearchQuery):Task | null {
        return null;
    }

    narrowedDownTasks():Task[] | null {
        return null;
    }

    getSpec():TaskOptions {
        return this.options;
    }

    saveOutput(output:UserCountSearchQuery):void {
        logger.debug(`Saving output of the task: ${this.getId()}`);

        this.currentRunOutput.push({
            taskId: this.getId(),
            result: {
                location: this.options.location,
                userCount: output.search.userCount,
            },
        });
    }

    shouldAbort(output:UserCountSearchQuery):boolean {
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
        // there can't be partial responses here, so, let's return true, so that the queue can retry this task
        return true;
    }

    extractOutputFromError(error:any):UserCountSearchQuery {
        // this should never happen as `shouldRecordAsError` should've returned true in that case already
        throw new Error("Invalid error object. Can't extract output from error.");
    }

    getDebugInstructions():string {
        const instructions = {
            "query": UserCountSearch.loc!.source.body,
            "variables": this.buildQueryParameters(),
        };

        return JSON.stringify(instructions, null, 2);
    }
}
