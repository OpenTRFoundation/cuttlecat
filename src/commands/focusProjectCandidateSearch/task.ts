import {graphql} from "@octokit/graphql";
import {v4 as uuidv4} from "uuid";
import {
    FocusProjectCandidateSearch,
    FocusProjectCandidateSearchQuery,
    RepositorySummaryFragment
} from "../../generated/queries";
import {formatDate, parseDate, splitPeriodIntoHalves} from "../../utils";
import {createLogger} from "../../log";
import {GraphqlTask, GraphqlTaskSpec} from "../graphqlTask";
import {FileOutput} from "./process";

const logger = createLogger("focusProjectCandidateSearch/task");

export interface TaskSpec extends GraphqlTaskSpec {
    minStars:number;
    minForks:number;
    minSizeInKb:number;
    hasActivityAfter:string;
    createdAfter:string;
    createdBefore:string;
    pageSize:number;
    startCursor:string | null;
}

export class Task extends GraphqlTask<FocusProjectCandidateSearchQuery, TaskSpec> {
    private readonly currentRunOutput:FileOutput[];

    constructor(graphqlWithAuth:typeof graphql, rateLimitStopPercent:number, currentRunOutput:FileOutput[], options:TaskSpec) {
        super(graphqlWithAuth, rateLimitStopPercent, options);
        this.currentRunOutput = currentRunOutput;
    }

    protected buildQueryParameters() {
        const searchString =
            "is:public template:false archived:false " +
            `stars:>=${this.spec.minStars} ` +
            `forks:>=${this.spec.minForks} ` +
            `size:>=${this.spec.minSizeInKb} ` +
            `pushed:>=${this.spec.hasActivityAfter} ` +
            // both ends are inclusive
            `created:${this.spec.createdAfter}..${this.spec.createdBefore}`;

        return {
            "searchString": searchString,
            "first": this.spec.pageSize,
            "after": this.spec.startCursor,
        };
    }

    nextTask(output:FocusProjectCandidateSearchQuery):Task | null {
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
                    minStars: this.spec.minStars,
                    minForks: this.spec.minForks,
                    minSizeInKb: this.spec.minSizeInKb,
                    hasActivityAfter: this.spec.hasActivityAfter,
                    createdAfter: this.spec.createdAfter,
                    createdBefore: this.spec.createdBefore,
                    pageSize: this.spec.pageSize,
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
        if (this.spec.startCursor) {
            logger.debug(`Narrowed down tasks can't be created for task ${this.getId()} as it has a start cursor.`);
            logger.debug(`Creating narrowed down tasks for the originating task ${this.spec.originatingTaskId}`);
        }

        let newTasks:Task[] = [];
        const startDate = parseDate(this.spec.createdAfter);
        const endDate = parseDate(this.spec.createdBefore);

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
                        originatingTaskId: this.spec.originatingTaskId,
                        minStars: this.spec.minStars,
                        minForks: this.spec.minForks,
                        minSizeInKb: this.spec.minSizeInKb,
                        hasActivityAfter: this.spec.hasActivityAfter,
                        createdAfter: formatDate(halfPeriod.start),
                        createdBefore: formatDate(halfPeriod.end),
                        pageSize: this.spec.pageSize,
                        startCursor: null,
                    }
                )
            );
        }

        return newTasks;
    }

    saveOutput(output:FocusProjectCandidateSearchQuery):void {
        logger.debug(`Saving output of the task: ${this.getId()}`);

        let nodes = output.search.nodes;

        if (!nodes || nodes.length == 0) {
            logger.debug(`No nodes found for ${this.getId()}.`);
            nodes = [];
        }

        logger.debug(`Number of nodes found for ${this.getId()}: ${nodes.length}`);

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

    protected getGraphqlQuery():string {
        return FocusProjectCandidateSearch.loc!.source.body;
    }
}
