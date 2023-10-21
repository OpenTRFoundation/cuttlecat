import {ErroredTask} from "../../taskqueue";
import {RepositorySummaryFragment} from "../../generated/queries";
import {QueueConfig} from "./config";

export interface TaskOptions {
    id:string;
    parentId:string | null;
    originatingTaskId:string | null;
    minStars:number;
    minForks:number;
    minSizeInKb:number;
    hasActivityAfter:string;
    createdAfter:string;
    createdBefore:string;
    pageSize:number;
    startCursor:string | null;
}

export interface ProcessState {
    startingConfig:QueueConfig,
    unresolved:{ [key:string]:TaskOptions },
    resolved:{ [key:string]:TaskOptions },
    errored:{ [key:string]:ErroredTask<TaskOptions> },
    archived:{ [key:string]:ErroredTask<TaskOptions> },
    startDate:Date,
    completionDate:Date | null,
    completionError:string | null,
    outputFileName:string,
}

export interface FileOutput {
    taskId:string;  // to identify which task found this result
    result:RepositorySummaryFragment,
}
