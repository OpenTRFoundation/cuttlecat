/**
 * All task implementations should create its own TaskResult type and extend this interface.
 *
 * The rateLimit property is optional but recommended and should be used to return the rate limit information, so that
 * cuttlecat can abort the task queue if the rate limit is reached.
 *
 */
export interface TaskResult {
    rateLimit?:{
        limit:number;
        remaining:number;
    } | null;
}

