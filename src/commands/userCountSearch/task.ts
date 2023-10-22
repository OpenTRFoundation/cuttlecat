import {graphql} from "@octokit/graphql";
import {UserCountSearch, UserCountSearchQuery,} from "../../generated/queries";
import {createLogger} from "../../log";
import {GraphqlTask, GraphqlTaskSpec} from "../graphqlTask";
import {FileOutput} from "./process";

const logger = createLogger("userCountSearch/task");

// TODO: add docs here and in the other files
// TODO: also add docs in other commands

export interface TaskSpec extends GraphqlTaskSpec {
    location:string;
    minRepos:number;
    minFollowers:number;
}

export class Task extends GraphqlTask<UserCountSearchQuery, TaskSpec> {
    private readonly currentRunOutput:FileOutput[];

    constructor(graphqlWithAuth:typeof graphql, rateLimitStopPercent:number, currentRunOutput:FileOutput[], spec:TaskSpec) {
        super(graphqlWithAuth, rateLimitStopPercent, spec);
        this.currentRunOutput = currentRunOutput;
    }

    protected buildQueryParameters() {
        const searchString =
            `location:${this.spec.location} ` +
            `repos:>=${this.spec.minRepos} ` +
            `followers:>=${this.spec.minFollowers}`;

        return {
            "searchString": searchString,
        };
    }

    saveOutput(output:UserCountSearchQuery):void {
        logger.debug(`Saving output of the task: ${this.getId()}`);

        this.currentRunOutput.push({
            taskId: this.getId(),
            result: {
                location: this.spec.location,
                userCount: output.search.userCount,
            },
        });
    }

    shouldRecordAsError(error:any):boolean {
        // there can't be partial responses here, so, let's return true, so that the queue can retry this task
        return true;
    }

    nextTask(output:UserCountSearchQuery):Task | null {
        return null;
    }

    narrowedDownTasks():Task[] | null {
        return null;
    }

    protected getGraphqlQuery():string {
        return UserCountSearch.loc!.source.body;
    }
}
