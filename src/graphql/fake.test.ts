import {parseDate} from "../utils.js";
import {Command} from "./command.js";
import {TaskContext} from "./context.js";
import {Task} from "./task.js";
import {TaskResult} from "./taskResult.js";
import {TaskSpec} from "./taskSpec.js";

export interface FakeResult extends TaskResult {
}

export interface FakeTaskSpec extends TaskSpec {
    fakeField:string
}

export class FakeTask extends Task<FakeResult, FakeTaskSpec> {
    constructor(spec:FakeTaskSpec) {
        super(spec);
    }

    protected getGraphqlQuery():string {
        return "THE QUERY";
    }

    protected buildQueryParameters():any {
        return {
            foo: this.spec.fakeField
        }
    }

    nextTask(_context:TaskContext, _result:FakeResult):null {
        return null;
    }

    saveOutput(_context:TaskContext, _result:FakeResult):void {
    }

    narrowedDownTasks(_:TaskContext):null {
        return null;
    }
}

export class FakeCommand implements Command<FakeResult, FakeTaskSpec, FakeTask> {
    createNewQueueItems(_:TaskContext):FakeTaskSpec[] {
        return [];
    }

    createTask(_:TaskContext, spec:FakeTaskSpec):FakeTask {
        return new FakeTask(spec);
    }
}

export function fakeNow():Date {
    return parseDate("2023-01-31");
}
