/**
 * TaskRunOutputItem is the output of a task run. cuttlecat stores the output of a task with the task id in the output collection.
 */
export interface TaskRunOutputItem {
    taskId:string;
    result:any;
}
