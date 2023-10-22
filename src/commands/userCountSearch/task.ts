import {graphql} from "@octokit/graphql";
import {UserCountSearch, UserCountSearchQuery,} from "../../generated/queries";
import {FileOutput, TaskOptions} from "./types";
import {createLogger} from "../../log";
import {GraphqlTask} from "../graphqlTask";

const logger = createLogger("userCountSearch/task");

export class Task extends GraphqlTask<UserCountSearchQuery, TaskOptions> {
    private readonly currentRunOutput:FileOutput[];

    constructor(graphqlWithAuth:typeof graphql, rateLimitStopPercent:number, currentRunOutput:FileOutput[], options:TaskOptions) {
        super(graphqlWithAuth, rateLimitStopPercent, options);
        this.currentRunOutput = currentRunOutput;
    }

    protected buildQueryParameters() {
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

    shouldRecordAsError(error:any):boolean {
        // there can't be partial responses here, so, let's return true, so that the queue can retry this task
        return true;
    }

    protected getGraphqlQuery():string {
        return UserCountSearch.loc!.source.body;
    }
}
