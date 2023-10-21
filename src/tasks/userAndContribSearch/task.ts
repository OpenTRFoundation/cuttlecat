import {graphql} from "@octokit/graphql";
import {v4 as uuidv4} from "uuid";
import {BaseTask} from "../../taskqueue";
import {UserAndContribSearch, UserAndContribSearchQuery, UserSearchResultFragment,} from "../../generated/queries";
import {FileOutput, TaskOptions} from "./types";
import {formatDate, parseDate, splitPeriodIntoHalves} from "../../utils";
import {createLogger} from "../../log";

const logger = createLogger("userAndContribSearch/task");

// TODO: lots of duplication
// TODO: create a base GraphQL task class
// TODO: make it generic with
// TODO: - page info
// TODO: - nodes
// TODO: ...

export class Task extends BaseTask<UserAndContribSearchQuery, TaskOptions> {
    private readonly graphqlWithAuth:typeof graphql<UserAndContribSearchQuery>;
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

    async execute(signal:AbortSignal):Promise<UserAndContribSearchQuery> {
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
                UserAndContribSearch.loc!.source.body,
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
            `followers:>=${this.options.minFollowers} ` +
            // both ends are inclusive
            `created:${this.options.signedUpAfter}..${this.options.signedUpBefore}`;

        return {
            "searchString": searchString,
            "first": this.options.pageSize,
            "after": this.options.startCursor,
            "contribFrom": this.options.contribSearchStart,
            "contribTo": this.options.contribSearchEnd,
        };
    }

    nextTask(output:UserAndContribSearchQuery):Task | null {
        if (output.search.pageInfo.hasNextPage) {
            logger.debug(`Next page available for task: ${this.getId()}`);
            return new Task(
                this.graphqlWithAuth,
                this.rateLimitStopPercent,
                this.currentRunOutput,
                {
                    id: uuidv4(),
                    parentId: null,
                    originatingTaskId: this.getId(),

                    location: this.options.location,
                    minRepos: this.options.minRepos,
                    minFollowers: this.options.minFollowers,
                    signedUpAfter: this.options.signedUpAfter,
                    signedUpBefore: this.options.signedUpBefore,

                    pageSize: this.options.pageSize,
                    startCursor: <string>output.search.pageInfo.endCursor,

                    contribSearchStart: this.options.contribSearchStart,
                    contribSearchEnd: this.options.contribSearchEnd,
                }
            );
        }

        return null;
    }

    narrowedDownTasks():Task[] | null {
        // User search can't narrow down the scopes of the tasks that start from a cursor.
        // That's because:
        // - The cursor is bound to the date range previously used.
        // In that case, add narrowed down tasks for the originating task. That's the task that caused the creation of
        // this task with a start cursor.
        // However, this means, some date ranges will be searched twice and there will be duplicate output.
        // It is fine though! We can filter the output later.
        if (this.options.startCursor) {
            logger.debug(`Narrowed down tasks can't be created for task ${this.getId()} as it has a start cursor.`);
            logger.debug(`Creating narrowed down tasks for the originating task ${this.options.originatingTaskId}`);
        }

        let newTasks:Task[] = [];
        const startDate = parseDate(this.options.signedUpAfter);
        const endDate = parseDate(this.options.signedUpBefore);

        const halfPeriods = splitPeriodIntoHalves(startDate, endDate);
        if (halfPeriods.length < 1) {
            logger.debug(`Narrowed down tasks can't be created for task ${this.getId()}. as it can't be split into half periods.`);
            return null;
        }

        for (let i = 0; i < halfPeriods.length; i++) {
            const halfPeriod = halfPeriods[i];
            newTasks.push(
                new Task(
                    this.graphqlWithAuth,
                    this.rateLimitStopPercent,
                    this.currentRunOutput,
                    {
                        id: uuidv4(),
                        parentId: this.getId(),
                        originatingTaskId: this.options.originatingTaskId,

                        location: this.options.location,
                        minRepos: this.options.minRepos,
                        minFollowers: this.options.minFollowers,
                        signedUpAfter: formatDate(halfPeriod.start),
                        signedUpBefore: formatDate(halfPeriod.end),

                        pageSize: this.options.pageSize,
                        startCursor: null,

                        contribSearchStart: this.options.contribSearchStart,
                        contribSearchEnd: this.options.contribSearchEnd,
                    }
                )
            );
        }

        return newTasks;
    }

    getSpec():TaskOptions {
        return this.options;
    }

    saveOutput(output:UserAndContribSearchQuery):void {
        logger.debug(`Saving output of the task: ${this.getId()}`);

        let nodes = output.search.nodes;

        if (!nodes || nodes.length == 0) {
            logger.debug(`No nodes found for ${this.getId()}.`);
            nodes = [];
        }

        logger.debug(`Number of nodes found for ${this.getId()}: ${nodes.length}`);

        for (let i = 0; i < nodes.length; i++) {
            const userSearchResult = <UserSearchResultFragment>nodes[i];
            // items in the array might be null, in case of partial responses
            if (userSearchResult) {
                this.currentRunOutput.push({
                    taskId: this.getId(),
                    result: userSearchResult,
                });
            }
        }
    }

    shouldAbort(output:UserAndContribSearchQuery):boolean {
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

    extractOutputFromError(error:any):UserAndContribSearchQuery {
        if (error.data) {
            return <UserAndContribSearchQuery>error.data;
        }
        // this should never happen as `shouldRecordAsError` should've returned true in that case already
        throw new Error("Invalid error object. Can't extract output from error.");
    }

    getDebugInstructions():string {
        const instructions = {
            "query": UserAndContribSearch.loc!.source.body,
            "variables": this.buildQueryParameters(),
        };

        return JSON.stringify(instructions, null, 2);
    }
}
