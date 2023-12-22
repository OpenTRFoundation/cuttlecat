import {v4 as uuidv4} from "uuid";
import {Command} from "../../graphql/command.js";

import {TaskContext} from "../../graphql/context.js";
import {Task} from "../../graphql/task.js";
import {TaskResult} from "../../graphql/taskResult.js";
import {TaskSpec} from "../../graphql/taskSpec.js";
import {formatDate, parseDate} from "../../utils.js";

/**
 * This example task searches for users in a given location, who signed up in a given period.
 *
 * The query at the end of this file is used to search for users.
 * Used variables:
 * {
 *   "searchString": "location:Istanbul created:2020-01-01..2020-01-31",
 *   "first": 100,
 *   "after": null
 * }
 *
 * There are more than 100 users in Istanbul who signed up in January 2020. Thus, the program will create a new task
 * for the next page of the search results.
 *
 * To execute this task, run:
 * > ts-node-esm src/index.ts --command-file=/path/to/this/file/basicUserSearch.ts --data-directory=/tmp/foo/basicUserSearch --github-token=`gh auth login`
 *
 * The result of the task will be saved in the /tmp/foo/basicUserSearch directory.
 */


const LOCATION = "Istanbul";
const EXCLUDE_USERS_SIGNED_UP_BEFORE = "2020-01-01";
const EXCLUDE_USERS_SIGNED_UP_AFTER = "2020-01-31";
const PAGE_SIZE = 100;

interface UserFragment {
    login:string;
    company:string | null;
    name:string | null;
}

export interface BasicUserSearchTaskResult extends TaskResult {
    search:{
        pageInfo:{
            startCursor:string | null;
            hasNextPage:boolean;
            endCursor:string | null;
        };
        nodes:UserFragment[];
    };
}

export interface BasicUserSearchTaskSpec extends TaskSpec {
    location:string;
    signedUpAfter:string;
    signedUpBefore:string;
    pageSize:number;
    startCursor:string | null;
}

export default class BasicUserSearchCommand implements Command<BasicUserSearchTaskResult, BasicUserSearchTaskSpec, BasicUserSearchTask> {

    createTask(_:TaskContext, spec:BasicUserSearchTaskSpec):BasicUserSearchTask {
        return new BasicUserSearchTask(spec);
    }

    createNewQueueItems(context:TaskContext):BasicUserSearchTaskSpec[] {
        const logger = context.logger;

        const startDate = parseDate(EXCLUDE_USERS_SIGNED_UP_BEFORE);
        const endDate = parseDate(EXCLUDE_USERS_SIGNED_UP_AFTER);

        logger.info(`Creating a new process state, startDate: ${formatDate(startDate)}, endDate: ${formatDate(endDate)}`);

        const newTaskSpecs:BasicUserSearchTaskSpec[] = [];

        const signedUpAfter = formatDate(startDate);
        const signedUpBefore = formatDate(endDate);

        const key = uuidv4();
        const newTaskSpec = {
            id: key,
            parentId: null,
            originatingTaskId: null,
            //
            location: LOCATION,
            signedUpAfter: signedUpAfter,
            signedUpBefore: signedUpBefore,
            //
            pageSize: PAGE_SIZE,
            startCursor: null,
        };
        newTaskSpecs.push(newTaskSpec);

        logger.info(`Created ${newTaskSpecs.length} new task specs.`);

        return newTaskSpecs;
    }
}

export class BasicUserSearchTask extends Task<BasicUserSearchTaskResult, BasicUserSearchTaskSpec> {
    protected getGraphqlQuery():string {
        return QUERY;
    }

    protected buildQueryParameters(context:TaskContext) {
        const spec = this.getSpec(context);

        const searchString =
            `location:${this.spec.location} ` +
            // both ends are inclusive
            `created:${this.spec.signedUpAfter}..${this.spec.signedUpBefore}`;
        return {
            "searchString": searchString,
            "first": spec.pageSize,
            "after": spec.startCursor,
        };
    }

    nextTask(context:TaskContext, result:BasicUserSearchTaskResult):BasicUserSearchTask | null {
        // return a new task if there is a next page
        if (result.search.pageInfo.hasNextPage) {
            context.logger.debug(`Next page available for task: ${this.getId(context)}`);
            const newTaskSpec = {
                id: uuidv4(),
                parentId: null,
                originatingTaskId: this.getId(context),
                //
                location: this.spec.location,
                signedUpAfter: this.spec.signedUpAfter,
                signedUpBefore: this.spec.signedUpBefore,
                //
                pageSize: this.spec.pageSize,
                //
                startCursor: result.search.pageInfo.endCursor,
            };
            return new BasicUserSearchTask(newTaskSpec);
        }
        return null;
    }

    saveOutput(context:TaskContext, output:BasicUserSearchTaskResult):void {
        const logger = context.logger;

        logger.debug(`Saving output of the task: ${this.getId(context)}`);

        let nodes = output.search.nodes;

        if (!nodes || nodes.length == 0) {
            logger.debug(`No nodes found for ${this.getId(context)}.`);
            nodes = [];
        }

        logger.debug(`Number of nodes found for ${this.getId(context)}: ${nodes.length}`);

        for (let i = 0; i < nodes.length; i++) {
            const userInfo = <UserFragment>nodes[i];
            // items in the array might be null, in case of partial responses
            if (userInfo) {
                context.currentRunOutput.push({
                    taskId: this.getId(context),
                    result: userInfo,
                });
            }
        }
    }


    narrowedDownTasks(_:TaskContext):BasicUserSearchTask[] | null {
        // this task doesn't create narrowed down tasks.
        // that's because this simple search will not time out.
        throw new Error("Not implemented.");
    }

}

export const QUERY = `
query BasicUserSearch($searchString: String!, $first: Int!, $after:String){
    rateLimit {
        cost
        limit
        nodeCount
        remaining
        resetAt
        used
    }
    search(type: USER, query:$searchString, first:$first, after:$after) {
        pageInfo {
            startCursor
            hasNextPage
            endCursor
        }
        userCount
        nodes {
            ... on User {
                ...UserFragment
            }
        }
    }
}
fragment UserFragment on User {
    login
    company
    name
}
`;
