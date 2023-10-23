import chai, {expect} from "chai";
import {GraphqlTask, GraphqlTaskSpec} from "./graphqlTask";
import {graphql} from "@octokit/graphql";
import chaiAsPromised from "chai-as-promised";
import * as log from "../log";

// disable logging for tests
log.setLevel("error");

chai.use(chaiAsPromised);

interface FakeResult {
}

interface FakeTaskSpec extends GraphqlTaskSpec {
    fakeField:string
}

class FakeTask extends GraphqlTask<FakeResult, FakeTaskSpec> {
    constructor(fakeGraphql:typeof graphql = graphql, rateLimitStopPercent:number = 0, id:string = "deadbeef", field:string = "foo") {
        super(fakeGraphql, rateLimitStopPercent, <any>{id: id, fakeField: field});
    }

    protected getGraphqlQuery():string {
        return "THE QUERY";
    }

    protected buildQueryParameters():any {
        return {
            foo: this.spec.fakeField
        }
    }

    nextTask(result:FakeResult):null {
        return null;
    }

    saveOutput(output:FakeResult):void {
    }

    narrowedDownTasks():null {
        return null;
    }
}

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
                defaults: (args:any) => {
                    return (query:string, variables:object) => {
                        executedQuery = query;
                        passedVariables = variables;
                        return Promise.resolve(output);
                    }
                }
            };

            const task = new FakeTask(fakeGraphql, 0, "deadbeef", "foo");
            const response = await task.execute(signal);

            expect(response).to.be.equal(output);
            expect(executedQuery).to.be.equal("THE QUERY");
            expect(passedVariables).to.be.deep.equal({
                "foo": "foo",
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

            const task = new FakeTask(fakeGraphql);
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

            const task = new FakeTask(fakeGraphql);
            return expect(task.execute(signal)).to.eventually.be.rejectedWith(/abort/);
        });
        it('should not start if signal is aborted', function () {
            const abortController = new AbortController();
            const signal = abortController.signal;
            abortController.abort();

            const task = new FakeTask();
            return expect(task.execute(signal)).to.eventually.be.rejectedWith(/This operation was aborted/);
        });
    });
    describe('#shouldAbort()', function () {
        it('should return true, when there is no primary rate limit info', function () {
            const output:any = {};
            expect(new FakeTask().shouldAbort(output)).to.be.true;
        });
        it('should return true, when primary rate limit info does not have remaining information', function () {
            const output:any = {
                rateLimit: {
                    "foo": "bar",
                }
            };
            expect(new FakeTask().shouldAbort(output)).to.be.true;
        });
        it('should return true, when primary rate limit info does not have limit information', function () {
            const output:any = {
                rateLimit: {
                    "remaining": 1,
                }
            };
            expect(new FakeTask().shouldAbort(output)).to.be.true;
        });
        it('should return true, when primary rate limit remaining is below config percent', function () {
            const output:any = {
                rateLimit: {
                    "remaining": 9,
                    "limit": 100,
                }
            };
            expect(new FakeTask(graphql, 10).shouldAbort(output)).to.be.true;
        });
        it('should return false, when primary rate limit remaining is above config percent', function () {
            const output:any = {
                rateLimit: {
                    "remaining": 11,
                    "limit": 100,
                }
            };
            expect(new FakeTask(graphql, 10).shouldAbort(output)).to.be.false;
        });
        it('should return false, when primary rate limit remaining is equal to config percent', function () {
            const output:any = {
                rateLimit: {
                    "remaining": 10,
                    "limit": 100,
                }
            };
            expect(new FakeTask(graphql, 10).shouldAbort(output)).to.be.false;
        });
    });
    describe('#shouldAbortAfterError()', function () {
        it('should return true, when secondary rate limit reached', function () {
            const err = {
                headers: {
                    "retry-after": "60",
                }
            };
            expect(new FakeTask().shouldAbortAfterError(err)).to.be.true;
        });
        it('should return true, when secondary rate limit not reached', function () {
            const err = {
                headers: {
                    "foo": "bar",
                }
            };
            expect(new FakeTask().shouldAbortAfterError(err)).to.be.false;
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
            expect(new FakeTask(graphql, 0, "deadbeef").getErrorMessage(err)).to.be.equal("Error in task deadbeef: bar. Headers: {\"a\":\"b\"}. Error: foo.");
        });
        it('should return message, when non-http error happened', function () {
            const err = {
                message: "bar",
            };
            expect(new FakeTask(graphql, 0, "deadbeef").getErrorMessage(err)).to.be.equal("Error in task deadbeef: bar.");
        });
        it('should return error json, when there is no error message', function () {
            const err = {
                "foo": "bar",
            };
            expect(new FakeTask(graphql, 0, "deadbeef").getErrorMessage(err)).to.be.equal("Error in task deadbeef: {\"foo\":\"bar\"}");
        });
        it('should throw exception, when secondary rate limit reached', function () {
            const err = {
                "headers": {
                    "retry-after": "60",
                },
            };
            let fn = () => {
                expect(new FakeTask(graphql, 0, "deadbeef").getErrorMessage(err));
            };
            expect(fn).to.throw(/Secondary rate limit error/);
        });
    });
    describe('#shouldRecordAsError()', function () {
        it('should return true, when error is not a response error', function () {
            const err = {
                foo: {"a": "b"}
            };
            expect(new FakeTask().shouldRecordAsError(err)).to.be.true;
        });
        it('should return true, when error is a response error, but it is not a partial response', function () {
            const err = {
                foo: {"a": "b"},
                data: ["foo"]
            };
            expect(new FakeTask().shouldRecordAsError(err)).to.be.true;
        });
        it('should return false, when error is a partial response error', function () {
            const err = {
                foo: {"a": "b"},
                headers: [],
                data: ["foo"]
            };
            expect(new FakeTask().shouldRecordAsError(err)).to.be.false;
        });
    });
    describe('#extractOutputFromError()', function () {
        it('should throw error, if error is not a partial reponse error', function () {
            let fn = () => {
                new FakeTask().extractOutputFromError({});
            };
            expect(fn).to.throw(/Invalid error object/);
        });
        it('should return partial response, if error is a partial reponse error', function () {
            const err = {
                data: {"a": "b"}
            };
            expect(new FakeTask().extractOutputFromError(err)).to.be.equal(err.data);
        });
    });
});
