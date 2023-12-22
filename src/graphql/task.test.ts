import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import * as log from "../log.js";
import {TaskContext} from "./context.js";
import {FakeTask} from "./fake.test.js";

// disable logging for tests
log.setLevel("error");

chai.use(chaiAsPromised);

const logger = log.createLogger("test");

describe('graphqlTask', () => {
    describe('#execute()', function () {
        it('should return proper response', async () => {
            const signal = new AbortController().signal;
            const output:any = {
                "foo": "bar",
            };

            let executedQuery = "";
            let passedVariables = {};

            const fakeGraphql:any = {
                defaults: (_:any) => {
                    return (query:string, variables:object) => {
                        executedQuery = query;
                        passedVariables = variables;
                        return Promise.resolve(output);
                    }
                }
            };

            const context = new TaskContext(fakeGraphql, 0, logger, []);

            const task = new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            });
            const response = await task.execute(context, signal);

            expect(response).to.be.equal(output);
            expect(executedQuery).to.be.equal("THE QUERY");
            expect(passedVariables).to.be.deep.equal({
                "foo": "foo",
            });
        });
        it('should not swallow any errors', async () => {
            const signal = new AbortController().signal;

            const fakeGraphql:any = {
                defaults: (_args:any) => {
                    return (_query:string, _variables:object) => {
                        return Promise.reject("fail");
                    }
                }
            };

            const context = new TaskContext(fakeGraphql, 0, logger, []);

            const task = new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            });
            return expect(task.execute(context, signal)).to.eventually.be.rejectedWith(/fail/);
        });
        it('should handle aborts', function () {
            const abortController = new AbortController();
            const signal = abortController.signal;

            const fakeGraphql:any = {
                defaults: (_args:any) => {
                    return (_query:string, _variables:object) => {
                        return new Promise((_resolve, reject) => {
                            signal.addEventListener("abort", () => {
                                // never resolve.
                                // wait until rejection is called from the timeout below
                                reject("abort");
                            });
                        });
                    }
                }
            };

            const context = new TaskContext(fakeGraphql, 0, logger, []);

            setTimeout(() => {
                abortController.abort();
            }, 100);

            const task = new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            });
            return expect(task.execute(context, signal)).to.eventually.be.rejectedWith(/abort/);
        });
        it('should not start if signal is aborted', function () {
            const abortController = new AbortController();
            const signal = abortController.signal;
            abortController.abort();

            const context = new TaskContext(<any>null, 0, logger, []);

            const task = new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            });
            return expect(task.execute(context, signal)).to.eventually.be.rejectedWith(/This operation was aborted/);
        });
    });
    describe('#shouldAbort()', function () {
        it('should return true, when there is no primary rate limit info', function () {
            const context = new TaskContext(<any>null, 0, logger, []);
            const output:any = {};
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).shouldAbort(context, output)).to.be.true;
        });
        it('should return true, when primary rate limit info does not have remaining information', function () {
            const context = new TaskContext(<any>null, 0, logger, []);
            const output:any = {
                rateLimit: {
                    "foo": "bar",
                }
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).shouldAbort(context, output)).to.be.true;
        });
        it('should return true, when primary rate limit info does not have limit information', function () {
            const context = new TaskContext(<any>null, 0, logger, []);
            const output:any = {
                rateLimit: {
                    "remaining": 1,
                }
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).shouldAbort(context, output)).to.be.true;
        });
        it('should return true, when primary rate limit remaining is below config percent', function () {
            const context = new TaskContext(<any>null, 10, logger, []);
            const output:any = {
                rateLimit: {
                    "remaining": 9,
                    "limit": 100,
                }
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).shouldAbort(context, output)).to.be.true;
        });
        it('should return false, when primary rate limit remaining is above config percent', function () {
            const context = new TaskContext(<any>null, 10, logger, []);
            const output:any = {
                rateLimit: {
                    "remaining": 11,
                    "limit": 100,
                }
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).shouldAbort(context, output)).to.be.false;
        });
        it('should return false, when primary rate limit remaining is equal to config percent', function () {
            const context = new TaskContext(<any>null, 10, logger, []);
            const output:any = {
                rateLimit: {
                    "remaining": 10,
                    "limit": 100,
                }
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).shouldAbort(context, output)).to.be.false;
        });
    });
    describe('#shouldAbortAfterError()', function () {
        const context = new TaskContext(<any>null, 0, logger, []);
        it('should return true, when secondary rate limit reached', function () {
            const err = {
                headers: {
                    "retry-after": "60",
                }
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).shouldAbortAfterError(context, err)).to.be.true;
        });
        it('should return true, when secondary rate limit not reached', function () {
            const err = {
                headers: {
                    "foo": "bar",
                }
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).shouldAbortAfterError(context, err)).to.be.false;
        });
    });
    describe('#getErrorMessage()', function () {
        const context = new TaskContext(<any>null, 10, logger, []);

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
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).getErrorMessage(context, err)).to.be.equal("Error in task deadbeef: bar. Headers: {\"a\":\"b\"}. Error: foo.");
        });
        it('should return message, when non-http error happened', function () {
            const err = {
                message: "bar",
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).getErrorMessage(context, err)).to.be.equal("Error in task deadbeef: bar.");
        });
        it('should return error json, when there is no error message', function () {
            const err = {
                "foo": "bar",
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).getErrorMessage(context, err)).to.be.equal("Error in task deadbeef: {\"foo\":\"bar\"}");
        });
        it('should throw exception, when secondary rate limit reached', function () {
            const err = {
                "headers": {
                    "retry-after": "60",
                },
            };
            const fn = () => {
                new FakeTask({
                    id: "deadbeef",
                    fakeField: "foo",
                    originatingTaskId: null,
                    parentId: null,
                }).getErrorMessage(context, err);
            }
            expect(fn).to.throw(/Secondary rate limit error/);
        });
    });
    describe('#shouldRecordAsError()', function () {
        const context = new TaskContext(<any>null, 10, logger, []);
        it('should return true, when error is not a response error', function () {
            const err = {
                foo: {"a": "b"}
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).shouldRecordAsError(context, err)).to.be.true;
        });
        it('should return true, when error is a response error, but it is not a partial response', function () {
            const err = {
                foo: {"a": "b"},
                data: ["foo"]
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).shouldRecordAsError(context, err)).to.be.true;
        });
        it('should return false, when error is a partial response error', function () {
            const err = {
                foo: {"a": "b"},
                headers: [],
                data: ["foo"]
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).shouldRecordAsError(context, err)).to.be.false;
        });
    });
    describe('#extractOutputFromError()', function () {
        const context = new TaskContext(<any>null, 10, logger, []);
        it('should throw error, if error is not a partial response error', function () {
            const fn = () => {
                new FakeTask({
                    id: "deadbeef",
                    fakeField: "foo",
                    originatingTaskId: null,
                    parentId: null,
                }).extractOutputFromError(context, {});
            };
            expect(fn).to.throw(/Invalid error object/);
        });
        it('should return partial response, if error is a partial response error', function () {
            const err = {
                data: {"a": "b"}
            };
            expect(new FakeTask({
                id: "deadbeef",
                fakeField: "foo",
                originatingTaskId: null,
                parentId: null,
            }).extractOutputFromError(context, err)).to.be.equal(err.data);
        });
    });
});
