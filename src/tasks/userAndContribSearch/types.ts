import {ErroredTask} from "../../taskqueue";
import {UserSearchResultFragment} from "../../generated/queries";

export interface QueueConfig {
    // user search query
    LOCATIONS:string;
    MIN_REPOS:number;
    MIN_FOLLOWERS:number;

    // user search navigation
    USER_SEARCH_PERIOD_IN_DAYS:number;
    USER_SEARCH_PAGE_SIZE:number;
    EXCLUDE_USERS_SIGNED_UP_BEFORE:string;
    MIN_SIGNED_UP_DAYS:string;

    // contribution search
    CONTRIB_SEARCH_PERIOD_IN_DAYS:number;
    MIN_CONTRIB_AGE:number;
    MAX_CONTRIB_AGE:number;
}

export interface TaskOptions {
    id:string;
    parentId:string | null;
    originatingTaskId:string | null;

    location:string;
    minRepos:number;
    minFollowers:number;
    signedUpAfter:string;
    signedUpBefore:string;

    pageSize:number;
    startCursor:string | null;

    contribSearchStart:string;
    contribSearchEnd:string;
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
    result:UserSearchResultFragment,
}
