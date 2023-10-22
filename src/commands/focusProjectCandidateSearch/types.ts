import {RepositorySummaryFragment} from "../../generated/queries";
import {QueueConfig} from "./config";
import {GraphqlProcessState} from "../graphqlProcess";
import {GraphqlTaskSpec} from "../graphqlTask";

// TODO: rename TaskOptions to TaskSpec
export interface TaskOptions extends GraphqlTaskSpec {
    minStars:number;
    minForks:number;
    minSizeInKb:number;
    hasActivityAfter:string;
    createdAfter:string;
    createdBefore:string;
    pageSize:number;
    startCursor:string | null;
}

export interface ProcessState extends GraphqlProcessState<QueueConfig, TaskOptions> {
}

export interface FileOutput {
    taskId:string;  // to identify which task found this result
    result:RepositorySummaryFragment,
}
