import {ErroredTask} from "../../taskqueue";
import {RepositorySummaryFragment} from "../../generated/queries";

export interface QueueConfig {
    MIN_STARS:number;
    MIN_FORKS:number;
    MIN_SIZE_IN_KB:number;
    MAX_INACTIVITY_DAYS:number;
    EXCLUDE_PROJECTS_CREATED_BEFORE:string;
    MIN_AGE_IN_DAYS:number;
    SEARCH_PERIOD_IN_DAYS:number;
    PAGE_SIZE:number;
}

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
