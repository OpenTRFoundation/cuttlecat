import {Task, TaskSpec} from "./task";
import {graphql} from "@octokit/graphql";
import {FocusProjectCandidateSearch} from "../../generated/queries";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";

chai.use(chaiAsPromised);

describe('focusProjectCandidateSearch Task', () => {
    describe('#execute()', function () {
        it('should return proper response', async () => {
            const signal = new AbortController().signal;
            const output:any = {
                "foo": "bar",
            };

            let executedQuery = "";
            let passedVariables = {};

            const fakeGraphql:any = {
                defaults: (args:any) => {
                    return (query:string, variables:object) => {
                        executedQuery = query;
                        passedVariables = variables;
                        return Promise.resolve(output);
                    }
                }
            };

            const spec:TaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: "beefdead",
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-01",
                pageSize: 5,
                startCursor: "start",
            };

            const task = new Task(fakeGraphql, 0, [], spec);
            const response = await task.execute(signal);

            expect(response).to.be.equal(output);
            expect(executedQuery).to.be.equal(FocusProjectCandidateSearch.loc!.source.body);
            expect(passedVariables).to.be.deep.equal({
                "searchString": "is:public template:false archived:false stars:>=5 forks:>=5 size:>=5 pushed:>=2023-01-01 created:2023-01-01..2023-01-01",
                "first": 5,
                "after": "start",
            });
        });
        it('should not swallow any errors', async () => {
            const signal = new AbortController().signal;

            const fakeGraphql:any = {
                defaults: (args:any) => {
                    return (query:string, variables:object) => {
                        return Promise.reject("fail");
                    }
                }
            };

            const task = new Task(fakeGraphql, 0, [], <any>{});
            return expect(task.execute(signal)).to.eventually.be.rejectedWith(/fail/);
        });
        it('should handle aborts', function () {
            const abortController = new AbortController();
            const signal = abortController.signal;

            const fakeGraphql:any = {
                defaults: (args:any) => {
                    return (query:string, variables:object) => {
                        return new Promise((resolve, reject) => {
                            signal.addEventListener("abort", () => {
                                // never resolve.
                                // wait until rejection is called from the timeout below
                                reject("abort");
                            });
                        });
                    }
                }
            };

            setTimeout(() => {
                abortController.abort();
            }, 100);

            const task = new Task(fakeGraphql, 0, [], <any>{});
            return expect(task.execute(signal)).to.eventually.be.rejectedWith(/abort/);
        });
        it('should not start if signal is aborted', function () {
            const abortController = new AbortController();
            const signal = abortController.signal;
            abortController.abort();

            const task = new Task(graphql, 0, [], <any>{});
            return expect(task.execute(signal)).to.eventually.be.rejectedWith(/This operation was aborted/);
        });
    });
    describe('#nextTask()', function () {
        it('should a task, if next page exists', function () {
            const spec:TaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-01",
                pageSize: 5,
                startCursor: null,
            };

            const output:any = {
                search: {
                    pageInfo: {
                        hasNextPage: true,
                        endCursor: "end",
                    }
                }
            };

            // @ts-ignore
            let nextTask:Task = new Task(graphql, 0, [], spec).nextTask(output);
            expect(nextTask).to.be.not.null;

            // fixed
            expect(nextTask.getSpec().parentId).to.be.null;
            expect(nextTask.getSpec().minStars).to.be.equal(5);
            expect(nextTask.getSpec().minForks).to.be.equal(5);
            expect(nextTask.getSpec().minSizeInKb).to.be.equal(5);
            expect(nextTask.getSpec().hasActivityAfter).to.be.equal("2023-01-01");
            expect(nextTask.getSpec().createdAfter).to.be.equal("2023-01-01");
            expect(nextTask.getSpec().createdBefore).to.be.equal("2023-01-01");
            expect(nextTask.getSpec().pageSize).to.be.equal(5);

            // changed
            expect(nextTask.getSpec().originatingTaskId).to.be.equal("deadbeef");
            expect(nextTask.getSpec().startCursor).to.be.equal("end");
        });
        it('should not return anything, if next page does not exist', function () {
            const spec:any = {};

            const output:any = {
                search: {
                    pageInfo: {
                        hasNextPage: false,
                        endCursor: null,
                    }
                }
            };

            // @ts-ignore
            let nextTask:Task = new Task(graphql, 0, [], spec).nextTask(output);
            expect(nextTask).to.be.null;
        });
    });
    describe('#narrowedDownTasks()', function () {
        it('should return tasks, when interval is even', function () {
            const spec:TaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-10",
                pageSize: 5,
                startCursor: null,
            };
            // @ts-ignore
            let tasks:Task[] = new Task(graphql, 0, [], spec).narrowedDownTasks();
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(2);

            // fixed
            expect(tasks[0].getSpec().originatingTaskId).to.be.null;
            expect(tasks[0].getSpec().minStars).to.be.equal(5);
            expect(tasks[0].getSpec().minForks).to.be.equal(5);
            expect(tasks[0].getSpec().minSizeInKb).to.be.equal(5);
            expect(tasks[0].getSpec().hasActivityAfter).to.be.equal("2023-01-01");
            expect(tasks[0].getSpec().pageSize).to.be.equal(5);
            expect(tasks[0].getSpec().startCursor).to.be.null;
            // changed
            expect(tasks[0].getSpec().parentId).to.be.equal("deadbeef");
            expect(tasks[0].getSpec().createdAfter).to.be.equal("2023-01-01");
            expect(tasks[0].getSpec().createdBefore).to.be.equal("2023-01-05");

            // fixed
            expect(tasks[1].getSpec().originatingTaskId).to.be.null;
            expect(tasks[1].getSpec().minStars).to.be.equal(5);
            expect(tasks[1].getSpec().minForks).to.be.equal(5);
            expect(tasks[1].getSpec().minSizeInKb).to.be.equal(5);
            expect(tasks[1].getSpec().hasActivityAfter).to.be.equal("2023-01-01");
            expect(tasks[1].getSpec().pageSize).to.be.equal(5);
            expect(tasks[1].getSpec().startCursor).to.be.null;
            // changed
            expect(tasks[1].getSpec().parentId).to.be.equal("deadbeef");
            expect(tasks[1].getSpec().createdAfter).to.be.equal("2023-01-06");
            expect(tasks[1].getSpec().createdBefore).to.be.equal("2023-01-10");
        });
        it('should return tasks, when interval is odd', function () {
            const spec:TaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-11",
                pageSize: 5,
                startCursor: null,
            };
            // @ts-ignore
            let tasks:Task[] = new Task(graphql, 0, [], spec).narrowedDownTasks();
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(2);

            expect(tasks[0].getSpec().parentId).to.be.equal("deadbeef");
            expect(tasks[0].getSpec().createdAfter).to.be.equal("2023-01-01");
            expect(tasks[0].getSpec().createdBefore).to.be.equal("2023-01-06");

            expect(tasks[1].getSpec().parentId).to.be.equal("deadbeef");
            expect(tasks[1].getSpec().createdAfter).to.be.equal("2023-01-07");
            expect(tasks[1].getSpec().createdBefore).to.be.equal("2023-01-11");
        });
        it('should return tasks, for a task with start cursor', function () {
            const spec:TaskSpec = {
                id: "deadbeef",
                parentId: "parent",
                originatingTaskId: "beefdead",
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-02",
                pageSize: 5,
                startCursor: "start",
            };
            // @ts-ignore
            let tasks:Task[] = new Task(graphql, 0, [], spec).narrowedDownTasks();
            expect(tasks).to.be.not.empty;
            expect(tasks).to.have.lengthOf(2);

            expect(tasks[0].getSpec().originatingTaskId).to.be.equal("beefdead");
            expect(tasks[0].getSpec().startCursor).to.be.null;
            expect(tasks[0].getSpec().parentId).to.be.equal("deadbeef");
            expect(tasks[0].getSpec().createdAfter).to.be.equal("2023-01-01");
            expect(tasks[0].getSpec().createdBefore).to.be.equal("2023-01-01");

            expect(tasks[1].getSpec().originatingTaskId).to.be.equal("beefdead");
            expect(tasks[1].getSpec().startCursor).to.be.null;
            expect(tasks[1].getSpec().parentId).to.be.equal("deadbeef");
            expect(tasks[1].getSpec().createdAfter).to.be.equal("2023-01-02");
            expect(tasks[1].getSpec().createdBefore).to.be.equal("2023-01-02");
        });
        it('should not return anything, for a task with a single day period', function () {
            const spec:TaskSpec = {
                id: "deadbeef",
                parentId: "parent",
                originatingTaskId: "beefdead",
                minStars: 5,
                minForks: 5,
                minSizeInKb: 5,
                hasActivityAfter: "2023-01-01",
                createdAfter: "2023-01-01",
                createdBefore: "2023-01-01",
                pageSize: 5,
                startCursor: "start",
            };
            // @ts-ignore
            let tasks:Task[] = new Task(graphql, 0, [], spec).narrowedDownTasks();
            expect(tasks).to.be.null;
        });
    });
    describe('#shouldAbort()', function () {
        it('should return true, when there is no primary rate limit info', function () {
            const output:any = {};
            expect(new Task(graphql, 0, [], <any>{}).shouldAbort(output)).to.be.true;
        });
        it('should return true, when primary rate limit info does not have remaining information', function () {
            const output:any = {
                rateLimit: {
                    "foo": "bar",
                }
            };
            expect(new Task(graphql, 0, [], <any>{}).shouldAbort(output)).to.be.true;
        });
        it('should return true, when primary rate limit info does not have limit information', function () {
            const output:any = {
                rateLimit: {
                    "remaining": 1,
                }
            };
            expect(new Task(graphql, 0, [], <any>{}).shouldAbort(output)).to.be.true;
        });
        it('should return true, when primary rate limit remaining is below config percent', function () {
            const output:any = {
                rateLimit: {
                    "remaining": 9,
                    "limit": 100,
                }
            };
            expect(new Task(graphql, 10, [], <any>{}).shouldAbort(output)).to.be.true;
        });
        it('should return false, when primary rate limit remaining is above config percent', function () {
            const output:any = {
                rateLimit: {
                    "remaining": 11,
                    "limit": 100,
                }
            };
            expect(new Task(graphql, 10, [], <any>{}).shouldAbort(output)).to.be.false;
        });
        it('should return false, when primary rate limit remaining is equal to config percent', function () {
            const output:any = {
                rateLimit: {
                    "remaining": 10,
                    "limit": 100,
                }
            };
            expect(new Task(graphql, 10, [], <any>{}).shouldAbort(output)).to.be.false;
        });
    });
    describe('#shouldAbortAfterError()', function () {
        it('should return true, when secondary rate limit reached', function () {
            const err = {
                headers: {
                    "retry-after": "60",
                }
            };
            expect(new Task(graphql, 0, [], <any>{}).shouldAbortAfterError(err)).to.be.true;
        });
        it('should return true, when secondary rate limit not reached', function () {
            const err = {
                headers: {
                    "foo": "bar",
                }
            };
            expect(new Task(graphql, 0, [], <any>{}).shouldAbortAfterError(err)).to.be.false;
        });
    });
    describe('#getErrorMessage()', function () {
        it('should return message, when http error happened', function () {
            const err = {
                headers: {
                    "a": "b",
                },
                errors: [
                    {
                        "message": "foo",
                    }
                ],
                message: "bar",
            };
            expect(new Task(graphql, 0, [], <any>{id: "deadbeef"}).getErrorMessage(err)).to.be.equal("Error in task deadbeef: bar. Headers: {\"a\":\"b\"}. Error: foo.");
        });
        it('should return message, when non-http error happened', function () {
            const err = {
                message: "bar",
            };
            expect(new Task(graphql, 0, [], <any>{id: "deadbeef"}).getErrorMessage(err)).to.be.equal("Error in task deadbeef: bar.");
        });
        it('should return error json, when there is no error message', function () {
            const err = {
                "foo": "bar",
            };
            expect(new Task(graphql, 0, [], <any>{id: "deadbeef"}).getErrorMessage(err)).to.be.equal("Error in task deadbeef: {\"foo\":\"bar\"}");
        });
        it('should throw exception, when secondary rate limit reached', function () {
            const err = {
                "headers": {
                    "retry-after": "60",
                },
            };
            let fn = () => {
                new Task(graphql, 0, [], <any>{}).getErrorMessage(err);
            };
            expect(fn).to.throw(/Secondary rate limit error/);
        });
    });
    describe('#shouldRecordAsError()', function () {
        it('should return true, when error is not a response error', function () {
            const err = {
                foo: {"a": "b"}
            };
            expect(new Task(graphql, 0, [], <any>{}).shouldRecordAsError(err)).to.be.true;
        });
        it('should return true, when error is a response error, but it is not a partial response', function () {
            const err = {
                foo: {"a": "b"},
                data: ["foo"]
            };
            expect(new Task(graphql, 0, [], <any>{}).shouldRecordAsError(err)).to.be.true;
        });
        it('should return false, when error is a partial response error', function () {
            const err = {
                foo: {"a": "b"},
                headers: [],
                data: ["foo"]
            };
            expect(new Task(graphql, 0, [], <any>{}).shouldRecordAsError(err)).to.be.false;
        });
    });
    describe('#extractOutputFromError()', function () {
        it('should throw error, if error is not a partial reponse error', function () {
            let fn = () => {
                new Task(graphql, 0, [], <any>{}).extractOutputFromError({});
            };
            expect(fn).to.throw(/Invalid error object/);
        });
        it('should return partial response, if error is a partial reponse error', function () {
            const err = {
                data: {"a": "b"}
            };
            expect(new Task(graphql, 0, [], <any>{}).extractOutputFromError(err)).to.be.equal(err.data);
        });
    });
});
