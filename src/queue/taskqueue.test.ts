import assert from "assert";
import seedrandom from "seedrandom";
import * as log from "../log.js";
import {getRandomInt} from "../utils.js";
import {BaseTask, TaskQueue, TaskStore} from "./taskqueue.js";

const logger = log.createLogger("taskQueue/test");

// disable logging for tests
log.setLevel("error");

class AbortError extends Error {
    constructor(message:string) {
        super(message);
        this.name = "AbortError";
    }
}

interface StubTaskSpec {
    id:string,
    delay:number,
}

interface StubContext {

}

class StubTask extends BaseTask<string, StubTaskSpec, StubContext> {

    readonly spec:StubTaskSpec;
    aborted:boolean = false;
    resolved:boolean = false;

    constructor(spec:StubTaskSpec) {
        super();
        this.spec = spec;
    }

    getId():string {
        return this.spec.id;
    }

    getSpec():StubTaskSpec {
        return this.spec;
    }

    execute(_:StubContext, signal:AbortSignal | undefined):Promise<string> {
        logger.debug(`execute: ${this.spec.id}`);
        return new Promise<string>((resolve, reject) => {
            signal?.addEventListener("abort", () => {
                if (this.resolved) {
                    return;
                }
                if (this.aborted) {
                    logger.error(`aborting: ${this.spec.id} - already aborted!`);
                    throw new Error(`aborting: ${this.spec.id} - already aborted!`);
                }
                logger.debug(`aborting: ${this.spec.id}`);
                this.aborted = true;
                reject(new AbortError("Aborted!"));
            });

            setTimeout(() => {
                if (this.aborted) {
                    return;
                }
                if (this.resolved) {
                    logger.error(`resolving: ${this.spec.id} - already resolved!`);
                    throw new Error(`resolving: ${this.spec.id} - already resolved!`);
                }
                this.resolved = true;
                resolve(this.spec.id);
            }, this.spec.delay);
        });
    }

    shouldAbortAfterError(_error:any):boolean {
        logger.debug(`shouldAbortAfterError: ${this.spec.id}`);
        return false;
    }

    shouldRecordAsError(_error:any):boolean {
        logger.debug(`shouldRecordAsError: ${this.spec.id}`);
        return true;
    }

    getErrorMessage(error:any):string {
        logger.debug(`getErrorMessage: ${this.spec.id}`);
        return error.toString();
    }

    extractOutputFromError(_error:any):string {
        logger.debug(`extractOutputFromError: ${this.spec.id}`);
        throw new Error("extractOutputFromError: Method not implemented.");
    }

    getDebugInstructions():string {
        logger.debug(`getDebugInstructions: ${this.spec.id}`);
        return `Debug instructions for ${this.spec.id}`;
    }

    narrowedDownTasks():StubTask[] | null {
        logger.debug(`narrowedDownTasks: ${this.spec.id}`);
        return null;
    }

    nextTask(_result:string):StubTask | null {
        logger.debug(`nextTask: ${this.spec.id}`);
        return null;
    }

    saveOutput(_output:string):void {
        logger.debug(`saveOutput: ${this.spec.id}`);
        // do nothing
    }

    setOriginatingTaskId(_id:string):void {
        logger.debug(`setOriginatingTaskId: ${this.spec.id}`);
        throw new Error("setOriginatingTaskId: Method not implemented.");
    }

    setParentId(_id:string):void {
        logger.debug(`setParentId: ${this.spec.id}`);
        throw new Error("setParentId: Method not implemented.");
    }

    shouldAbort(_output:string):boolean {
        logger.debug(`shouldAbort: ${this.spec.id}`);
        return false;
    }
}


describe('TaskQueue', function () {
    describe('#abort()', function () {
        this.timeout(60_000);    // this might take a while

        const seed = "hello";
        logger.info(`Seed: ${seed}`);

        const randomGenerator = seedrandom(seed.toString());

        type TestCase = {
            concurrency:number,
            retryCount:number,
            interval:number,
            intervalCap:number,
            perTaskTimeout:number,
            //
            abortAfter:number,
            taskCount:number,
            taskResolutionMaxDelay:number,
        }

        const testCases:TestCase[] = [];
        for (let i = 0; i < 20; i++) {
            testCases.push({
                concurrency: getRandomInt(2, 100, randomGenerator),
                // not testing retries here....
                retryCount: 0,
                interval: getRandomInt(1, 1000, randomGenerator),
                intervalCap: getRandomInt(10, 100, randomGenerator),
                perTaskTimeout: getRandomInt(1, 200, randomGenerator),
                //
                abortAfter: getRandomInt(1, 2000, randomGenerator),
                taskCount: getRandomInt(1, 1000, randomGenerator),
                taskResolutionMaxDelay: getRandomInt(1, 200, randomGenerator),
            });
        }

        for (const testCaseIndex in testCases) {
            it('aborting should not drop any tasks! - case:' + testCaseIndex, async function () {
                const testCase = testCases[testCaseIndex];

                const taskStore:TaskStore<StubTaskSpec> = {
                    unresolved: {},
                    resolved: {},
                    errored: {},
                    archived: {},
                }

                const context:StubContext = {};

                const taskQueue = new TaskQueue<string, StubTaskSpec, StubContext>(taskStore, {
                    concurrency: testCase.concurrency,
                    retryCount: testCase.retryCount,
                    interval: testCase.interval,
                    intervalCap: testCase.intervalCap,
                    perTaskTimeout: testCase.perTaskTimeout,
                }, context);

                const createdTasks:StubTask[] = [];
                for (let i = 0; i < testCase.taskCount; i++) {
                    const spec:StubTaskSpec = {
                        id: `task-${testCaseIndex}-${i}`,
                        delay: getRandomInt(0, testCase.taskResolutionMaxDelay),
                    };
                    const task = new StubTask(spec);
                    createdTasks.push(task);
                    taskQueue.add(task);
                }

                let calledAbort = false;
                setTimeout(() => {
                    logger.debug("aborting!");
                    taskQueue.abort();
                    calledAbort = true;
                }, testCase.abortAfter);

                taskQueue.start();

                await taskQueue.finish();

                // handle the case that the queue was done before the abort was called
                assert(!calledAbort || taskQueue.isAborted(), "Abort signal was not aborted!");

                const taskCountInTaskStore = Object.keys(taskStore.unresolved).length + Object.keys(taskStore.resolved).length + Object.keys(taskStore.errored).length + Object.keys(taskStore.archived).length;
                assert.equal(taskCountInTaskStore, createdTasks.length, `Expected ${createdTasks.length} tasks in task store, but found ${taskCountInTaskStore}!`);

                const abortedTasks = createdTasks.filter(task => task.aborted);
                // aborted tasks should be put back in unresolved list
                if (!(abortedTasks.length <= Object.keys(taskStore.unresolved).length)) {
                    const message = `Expected at least ${Object.keys(taskStore.unresolved).length} aborted tasks, but found ${abortedTasks.length}!`;
                    logger.error(message);

                    logger.error(`Test case: ${JSON.stringify(testCase, null, 2)}`);

                    logger.error(`Added ${testCase.taskCount} tasks to the queue.`);

                    logger.info("Task store: " + JSON.stringify(taskStore, null, 2));
                    logger.info("Tasks: " + JSON.stringify(createdTasks, null, 2));

                    logger.error(`Aborted tasks: ${abortedTasks.length}`);

                    logger.error(`Tasks in task store: ${taskCountInTaskStore}`);
                    logger.error(`Unresolved tasks: ${Object.keys(taskStore.unresolved).length}`);
                    logger.error(`Resolved tasks: ${Object.keys(taskStore.resolved).length}`);
                    logger.error(`Errored tasks: ${Object.keys(taskStore.errored).length}`);
                    logger.error(`Archived tasks: ${Object.keys(taskStore.archived).length}`);

                    assert.fail(message);
                }
            });
        }
    });
});
