import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {TaskContext} from "../../graphql/context.js";

import * as log from "../../log.js";
import {BasicUserSearchTask, BasicUserSearchTaskSpec, QUERY} from "./basicUserSearch.js";

const logger = log.createLogger("basicUserSearch/test");

// disable logging for tests
log.setLevel("error");

chai.use(chaiAsPromised);

describe('basicUserSearch Task', () => {
    describe('#execute()', function () {
        it('should return proper response', async () => {
            const signal = new AbortController().signal;
            const output:any = {
                "foo": "bar",
            };

            let executedQuery = "";
            let passedVariables = {};

            const fakeGraphql:any = {
                defaults: () => {
                    return (query:string, variables:object) => {
                        executedQuery = query;
                        passedVariables = variables;
                        return Promise.resolve(output);
                    }
                }
            };

            const spec:BasicUserSearchTaskSpec = {
                id: "deadbeef",
                parentId: null,
                originatingTaskId: "beefdead",
                //
                location: "Earth",
                signedUpAfter: "2023-01-01",
                signedUpBefore: "2023-01-01",
                //
                pageSize: 5,
                startCursor: "start",
            };

            const context = new TaskContext(fakeGraphql, 10, logger, []);
            const task = new BasicUserSearchTask(spec);
            const response = await task.execute(context, signal);

            expect(response).to.be.equal(output);
            expect(executedQuery).to.be.equal(QUERY);
            expect(passedVariables).to.be.deep.equal({
                "after": "start",
                "first": 5,
                "searchString": "location:Earth created:2023-01-01..2023-01-01",
            });
        });
        describe('#nextTask()', function () {
            it('should a task, if next page exists', function () {
                const spec:BasicUserSearchTaskSpec = {
                    id: "deadbeef",
                    parentId: null,
                    originatingTaskId: null,
                    //
                    location: "Earth",
                    signedUpAfter: "2023-01-01",
                    signedUpBefore: "2023-01-02",
                    //
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

                const context = new TaskContext(<any>null, 10, logger, []);
                const nextTask = new BasicUserSearchTask(spec).nextTask(context, output) as BasicUserSearchTask;
                expect(nextTask).to.be.not.null;

                // fixed
                expect(nextTask.getSpec(context).parentId).to.be.null;
                expect(nextTask.getSpec(context).location).to.be.equal("Earth");
                expect(nextTask.getSpec(context).signedUpAfter).to.be.equal("2023-01-01");
                expect(nextTask.getSpec(context).signedUpBefore).to.be.equal("2023-01-02");
                expect(nextTask.getSpec(context).pageSize).to.be.equal(5);

                // changed
                expect(nextTask.getSpec(context).originatingTaskId).to.be.equal("deadbeef");
                expect(nextTask.getSpec(context).startCursor).to.be.equal("end");
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

                const context = new TaskContext(<any>null, 10, logger, []);
                const nextTask = new BasicUserSearchTask(spec).nextTask(context, output) as BasicUserSearchTask;
                expect(nextTask).to.be.null;
            });
        });
    });
});
