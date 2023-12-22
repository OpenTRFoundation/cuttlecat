/**
 * Task implementations must implement this interface for their task spec.
 */
export interface TaskSpec {
    id:string;
    parentId:string | null;
    originatingTaskId:string | null;
}

