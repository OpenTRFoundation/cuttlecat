import {graphql} from "@octokit/graphql";
import {FocusProjectCandidateSearchQuery} from "../../generated/queries";

import {TaskQueue} from "../../taskqueue";
import {FileOutput, ProcessState, TaskOptions} from "./types";
import {Task} from "./task";
import {createLogger} from "../../log";
import {QueueConfig} from "./config";
import {GraphqlProcess} from "../graphqlProcess";

const logger = createLogger("focusProjectCandidateSearch/process");


export class Process extends GraphqlProcess<QueueConfig, TaskOptions, FocusProjectCandidateSearchQuery> {
    private readonly graphqlFn:typeof graphql;
    private readonly currentRunOutput:FileOutput[];

    constructor(processState:ProcessState, taskQueue:TaskQueue<FocusProjectCandidateSearchQuery, TaskOptions>, graphqlFn:typeof graphql, currentRunOutput:FileOutput[], options:{
        retryCount:number;
        rateLimitStopPercent:number
    }) {
        super(processState, taskQueue, options);
        this.graphqlFn = graphqlFn;
        this.currentRunOutput = currentRunOutput;
    }

    protected createNewTask(taskSpec:TaskOptions):Task {
        return new Task(this.graphqlFn, this.options.rateLimitStopPercent, this.currentRunOutput, taskSpec);
    }
}
