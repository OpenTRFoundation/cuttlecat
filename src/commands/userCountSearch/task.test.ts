import {expect} from "chai";
import {UserCountSearch} from "../../generated/queries";
import {Task, TaskSpec} from "./task";
import * as log from "../../log";

// disable logging for tests
log.setLevel("error");

describe('userCountSearch Task', () => {
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
                originatingTaskId: null,
                minRepos: 5,
                minFollowers: 5,
                location: "Venus",
            };

            const task = new Task(fakeGraphql, 0, [], spec);
            const response = await task.execute(signal);

            expect(response).to.be.equal(output);
            expect(executedQuery).to.be.equal(UserCountSearch.loc!.source.body);
            expect(passedVariables).to.be.deep.equal({
                "searchString": "location:Venus repos:>=5 followers:>=5"
            });
        });
    });
});
