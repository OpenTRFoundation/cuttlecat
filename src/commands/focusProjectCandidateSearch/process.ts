import {graphql} from "@octokit/graphql";
import {FocusProjectCandidateSearchQuery, RepositorySummaryFragment} from "../../generated/queries";

import {TaskQueue} from "../../taskqueue";
import {Task, TaskSpec} from "./task";
import {createLogger} from "../../log";
import {QueueConfig} from "./config";
import {GraphqlProcess, GraphqlProcessState} from "../graphqlProcess";

const logger = createLogger("focusProjectCandidateSearch/process");


export interface ProcessState extends GraphqlProcessState<QueueConfig, TaskSpec> {
}

export interface FileOutput {
    taskId:string;  // to identify which task found this result
    result:RepositorySummaryFragment,
}

export class Process extends GraphqlProcess<QueueConfig, TaskSpec, FocusProjectCandidateSearchQuery> {
    private readonly graphqlFn:typeof graphql;
    private readonly currentRunOutput:FileOutput[];

    constructor(processState:ProcessState, taskQueue:TaskQueue<FocusProjectCandidateSearchQuery, TaskSpec>, graphqlFn:typeof graphql, currentRunOutput:FileOutput[], options:{
        retryCount:number;
        rateLimitStopPercent:number
    }) {
        super(processState, taskQueue, options);
        this.graphqlFn = graphqlFn;
        this.currentRunOutput = currentRunOutput;
    }

    protected createNewTask(taskSpec:TaskSpec):Task {
        return new Task(this.graphqlFn, this.options.rateLimitStopPercent, this.currentRunOutput, taskSpec);
    }
}
