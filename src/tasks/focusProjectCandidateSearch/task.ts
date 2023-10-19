import {graphql} from "@octokit/graphql";
import {v4 as uuidv4} from "uuid";
import {BaseTask} from "../../taskqueue";
import {FocusProjectCandidateSearch, FocusProjectCandidateSearchQuery, RepositorySummaryFragment} from "../../generated/queries";
import {FileOutput, TaskOptions} from "./types";
import {formatDate, parseDate, splitPeriodIntoHalves} from "../../utils";

export class Task extends BaseTask<FocusProjectCandidateSearchQuery, TaskOptions> {
    private readonly graphqlWithAuth:typeof graphql<FocusProjectCandidateSearchQuery>;
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

    async execute(signal:AbortSignal):Promise<FocusProjectCandidateSearchQuery> {
        console.log("Executing task: ", this.getId());
        if (signal.aborted) {
            // Should never reach here
            console.log("Task is aborted, throwing exception!");
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
                FocusProjectCandidateSearch.loc!.source.body,
                this.buildQueryParameters()
            );
        } catch (e) {
            // do not swallow any errors here, as the task queue needs to receive them to re-queue tasks or abort the queue.
            console.log(`Error while executing task ${this.getId()}: `, (<any>e)?.message);
            throw e;
        }
    }

    private buildQueryParameters() {
        const searchString =
            "is:public template:false archived:false " +
            `stars:>${this.options.minStars} ` +
            `forks:>${this.options.minForks} ` +
            `size:>${this.options.minSizeInKb} ` +
            `pushed:>${this.options.hasActivityAfter} ` +
            // both ends are inclusive
            `created:${this.options.createdAfter}..${this.options.createdBefore}`;

        return {
            "searchString": searchString,
            "first": this.options.pageSize,
            "after": this.options.startCursor,
        };
    }

    nextTask(output:FocusProjectCandidateSearchQuery):Task | null {
        if (output.search.pageInfo.hasNextPage) {
            console.log(`Next page available for task: ${this.getId()}`);
            return new Task(
                this.graphqlWithAuth,
                this.rateLimitStopPercent,
                this.currentRunOutput,
                {
                    id: uuidv4(),
                    parentId: null,
                    originatingTaskId: this.getId(),
                    minStars: this.options.minStars,
                    minForks: this.options.minForks,
                    minSizeInKb: this.options.minSizeInKb,
                    hasActivityAfter: this.options.hasActivityAfter,
                    createdAfter: this.options.createdAfter,
                    createdBefore: this.options.createdBefore,
                    pageSize: this.options.pageSize,
                    startCursor: <string>output.search.pageInfo.endCursor,
                }
            );
        }

        return null;
    }

    narrowedDownTasks():Task[] | null {
        // Project search can't narrow down the scopes of the tasks that start from a cursor.
        // That's because:
        // - The cursor is bound to the date range previously used.
        // In that case, add narrowed down tasks for the originating task. That's the task that caused the creation of
        // this task with a start cursor.
        // However, this means, some date ranges will be searched twice and there will be duplicate output.
        // It is fine though! We can filter the output later.
        if (this.options.startCursor) {
            console.log(`Narrowed down tasks can't be created for task ${this.getId()} as it has a start cursor.`);
            console.log(`Creating narrowed down tasks for the originating task ${this.options.originatingTaskId}`);
        }

        let newTasks:Task[] = [];
        const startDate = parseDate(this.options.createdAfter);
        const endDate = parseDate(this.options.createdBefore);

        const halfPeriods = splitPeriodIntoHalves(startDate, endDate);
        if (halfPeriods.length < 1) {
            console.log(`Narrowed down tasks can't be created for task ${this.getId()}. as it can't be split into half periods.`);
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
                        minStars: this.options.minStars,
                        minForks: this.options.minForks,
                        minSizeInKb: this.options.minSizeInKb,
                        hasActivityAfter: this.options.hasActivityAfter,
                        createdAfter: formatDate(halfPeriod.start),
                        createdBefore: formatDate(halfPeriod.end),
                        pageSize: this.options.pageSize,
                        startCursor: null,
                    }
                )
            );
        }

        return newTasks;
    }

    getSpec():TaskOptions {
        return this.options;
    }

    saveOutput(output:FocusProjectCandidateSearchQuery):void {
        console.log(`Saving output of the task: ${this.getId()}`);

        let nodes = output.search.nodes;

        if (!nodes || nodes.length == 0) {
            console.log(`No nodes found for ${this.getId()}.`);
            nodes = [];
        }

        console.log(`Number of nodes found for ${this.getId()}: ${nodes.length}`);

        for (let i = 0; i < nodes.length; i++) {
            const repoSummary = <RepositorySummaryFragment>nodes[i];
            // items in the array might be null, in case of partial responses
            if (repoSummary) {
                this.currentRunOutput.push({
                    taskId: this.getId(),
                    result: repoSummary,
                });
            }
        }
    }

    shouldAbort(output:FocusProjectCandidateSearchQuery):boolean {
        const taskId = this.getId();

        console.log(`Rate limit information after task the execution of ${taskId}: ${JSON.stringify(output.rateLimit)}`);

        let remainingCallPermissions = output.rateLimit?.remaining;
        let callLimit = output.rateLimit?.limit;

        if (remainingCallPermissions == null || callLimit == null) {
            console.log(`Rate limit information is not available after executing ${taskId}.`);
            return true;
        }

        remainingCallPermissions = remainingCallPermissions ? remainingCallPermissions : 0;

        if (callLimit && (remainingCallPermissions < (callLimit * this.rateLimitStopPercent / 100))) {
            console.log(`Rate limit reached after executing ${taskId}.`);
            console.log(`Remaining call permissions: ${remainingCallPermissions}, call limit: ${callLimit}, stop percent: ${this.rateLimitStopPercent}`);
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
                console.log(`Secondary rate limit error in task ${this.getId()}. 'retry-after'=${error.headers['retry-after']}. Aborting the queue.`);
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

    extractOutputFromError(error:any):FocusProjectCandidateSearchQuery {
        if (error.data) {
            return <FocusProjectCandidateSearchQuery>error.data;
        }
        // this should never happen as `shouldRecordAsError` should've returned true in that case already
        throw new Error("Invalid error object. Can't extract output from error.");
    }

    getDebugInstructions():string {
        const instructions = {
            "query": FocusProjectCandidateSearch.loc!.source.body,
            "variables": this.buildQueryParameters(),
        };

        return JSON.stringify(instructions, null, 2);
    }
}
