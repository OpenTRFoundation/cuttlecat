import {graphql} from "@octokit/graphql";
import {Logger} from "winston";
import {TaskRunOutputItem} from "./taskRunOutputItem.js";

/**
 * This class is used to pass context to the commands.
 *
 * It is possible to extend the context by setting the `raw` property in your command.
 */
export class TaskContext {
    /**
     * The graphql function with authentication.
     */
    readonly graphqlWithAuth:typeof graphql;

    /**
     * The rate limit stop percent.
     */
    readonly rateLimitStopPercent:number;

    /**
     * The logger.
     */
    readonly logger:Logger;

    /**
     * The output of the current run stored as an array of objects.
     * These objects will be written to the output file at the end of the run as a "slurp" JSON file, where
     * each line is a JSON object.
     */
    readonly currentRunOutput:TaskRunOutputItem[];

    /**
     * The raw context that commands can use to have the data of their choice passed to the tasks.
     */
    raw:any;

    constructor(graphqlWithAuth:typeof graphql, rateLimitStopPercent:number, logger:Logger, currentRunOutput:TaskRunOutputItem[]) {
        this.graphqlWithAuth = graphqlWithAuth;
        this.rateLimitStopPercent = rateLimitStopPercent;
        this.logger = logger;
        this.currentRunOutput = currentRunOutput;
    }
}
