import {addErroredToUnresolved} from "./graphqlProcess";
import {GraphqlTaskSpec} from "./graphqlTask";
import {ErroredTask} from "../taskqueue";
import {expect} from "chai";

interface FakeTaskSpec extends GraphqlTaskSpec {
}

describe('graphqlProcess', () => {
    describe('#addErroredToUnresolved()', function () {
        it("should put errored items to unresolved, if the retry count is increased", async () => {
            const errored:{ [key:string]:ErroredTask<FakeTaskSpec> } = {
                "deadbeef": {
                    task: {
                        id: "deadbeef",
                        parentId: null,
                        originatingTaskId: null,
                    },
                    errors: [
                        // tried only once, no retries done
                        {
                            message: "error message",
                            date: new Date(),
                        }
                    ],
                    debug: "debug info",
                }
            };
            const unresolved:{ [key:string]:FakeTaskSpec } = {};
            addErroredToUnresolved(errored, unresolved, 1);

            expect(Object.keys(unresolved)).to.deep.equal(["deadbeef"]);
            expect(unresolved["deadbeef"]).to.deep.equal({
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
            });
        });
        it("should not put errored items to unresolved, if the retry count is not increased", async () => {
            const errored:{ [key:string]:ErroredTask<FakeTaskSpec> } = {
                "deadbeef": {
                    task: {
                        id: "deadbeef",
                        parentId: null,
                        originatingTaskId: null,
                    },
                    errors: [
                        {
                            message: "error message",
                            date: new Date(),
                        }
                    ],
                    debug: "debug info",
                }
            };
            const unresolved:{ [key:string]:FakeTaskSpec } = {};
            addErroredToUnresolved(errored, unresolved, 0);

            expect(Object.keys(unresolved)).to.deep.equal([]);
        });
    });
});
