import {QueueConfig} from "./config";
import {GraphqlProcessState} from "../graphqlProcess";
import {GraphqlTaskSpec} from "../graphqlTask";

// TODO: empty this file, and move all the types to the right places

// TODO: rename TaskOptions to TaskSpec
export interface TaskOptions extends GraphqlTaskSpec {
    location:string;
    minRepos:number;
    minFollowers:number;
}

export interface ProcessState extends GraphqlProcessState<QueueConfig, TaskOptions> {
}

export interface FileOutput {
    taskId:string;  // to identify which task found this result
    result:{
        location:string;
        userCount:number;
    },
}
