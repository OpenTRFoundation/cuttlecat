import {graphql} from "@octokit/graphql";
import {expect} from "chai";
import mockfs, {restore as mockfsRestore} from "mock-fs";

import {TaskContext} from "../graphql/context.js";
import {FakeCommand, fakeNow, FakeResult, FakeTaskSpec} from "../graphql/fake.test.js";
import * as log from "../log.js";
import {ProcessFileHelper} from "../processFileHelper.js";
import {ErroredTask, TaskQueue} from "../queue/taskqueue.js";
import {formatDate} from "../utils.js";
import {
    addErroredToUnresolved,
    checkFileCompleted,
    getOrCreateLatestProcessState,
    initializeQueue,
    ProcessState
} from "./execute.js";

const logger = log.createLogger("index/test");

const context = new TaskContext(graphql, 0, logger, []);

describe('main', () => {
    describe('#addErroredToUnresolved()', function () {
        it("should put errored items to unresolved, if the retry count is increased", async () => {
            const errored:{ [key:string]:ErroredTask<FakeTaskSpec> } = {
                "deadbeef": {
                    task: {
                        id: "deadbeef",
                        parentId: null,
                        originatingTaskId: null,
                        fakeField: "fake value",
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
            addErroredToUnresolved(logger, errored, unresolved, 1);

            expect(Object.keys(unresolved)).to.deep.equal(["deadbeef"]);
            expect(unresolved["deadbeef"]).to.deep.equal({
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                fakeField: "fake value",
            });
        });
        it("should not put errored items to unresolved, if the retry count is not increased", async () => {
            const errored:{ [key:string]:ErroredTask<FakeTaskSpec> } = {
                "deadbeef": {
                    task: {
                        id: "deadbeef",
                        parentId: null,
                        originatingTaskId: null,
                        fakeField: "fake value",
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
            addErroredToUnresolved(logger, errored, unresolved, 0);

            expect(Object.keys(unresolved)).to.deep.equal([]);
        });
    });
    describe('#initializeQueue()', function () {
        it("should create tasks for unresolved and add them to the queue", async () => {
            const unresolved:{ [key:string]:FakeTaskSpec } = {
                "deadbeef": {
                    id: "deadbeef",
                    parentId: null,
                    originatingTaskId: null,
                    fakeField: "fake value",
                }
            };
            const command = new FakeCommand();

            const taskStore = {
                unresolved: unresolved,
                resolved: {},
                errored: {},
                archived: {},
            };
            const taskQueueOptions = {
                concurrency: 1,
                perTaskTimeout: 1,
                intervalCap: 1,
                interval: 1,
                retryCount: 1,
            };

            const taskQueue = new TaskQueue<FakeResult, FakeTaskSpec, TaskContext>(taskStore, taskQueueOptions, context);
            initializeQueue(taskQueue, unresolved, context, command);

            expect(Object.keys(unresolved)).to.deep.equal(["deadbeef"]);
            expect(unresolved["deadbeef"]).to.deep.equal({
                id: "deadbeef",
                parentId: null,
                originatingTaskId: null,
                fakeField: "fake value",
            });
        });
    });
    describe('#getOrCreateLatestProcessState()', function () {
        const processFileHelper = new ProcessFileHelper("/tmp/foo/bar");
        const command = new FakeCommand();

        afterEach(() => {
            mockfsRestore();
        });

        it("should create a new process state file, if there's none yet", async () => {
            mockfs({
                '/tmp/foo/bar': {},
            });

            const latestProcessInformation = getOrCreateLatestProcessState(processFileHelper, context, command, 10, fakeNow);

            expect(latestProcessInformation).to.be.not.null;

            expect(latestProcessInformation?.latestProcessStateDir).to.be.equal("2023-01-31-00-00-00");
            expect(latestProcessInformation?.processState).to.be.not.null;
            expect(formatDate(<Date>latestProcessInformation?.processState.startDate)).to.be.equal("2023-01-31");
        });
        it("should use the latest file, if it is not complete", async () => {
            mockfs({
                '/tmp/foo/bar/2023-01-01-00-00-00/state.json': JSON.stringify({
                    "completionDate": null,
                    "startDate": "2023-01-02T00:00:00.000Z",
                }),
            });

            const latestProcessInformation = getOrCreateLatestProcessState(processFileHelper, context, command, 10, fakeNow);
            expect(latestProcessInformation).to.be.not.null;

            expect(latestProcessInformation?.latestProcessStateDir).to.be.equal("2023-01-01-00-00-00");
            expect(latestProcessInformation?.processState).to.be.not.null;
            expect(formatDate(<Date>latestProcessInformation?.processState.startDate)).to.be.equal("2023-01-02");
        });
        it("should create a new process state file, if the latest file is complete, and renew date is passed", async () => {
            mockfs({
                '/tmp/foo/bar/2023-01-01-00-00-00/state.json': JSON.stringify({
                    "completionDate": "2023-01-20T00:00:00.000Z",
                    "startDate": "2023-01-02T00:00:00.000Z",
                }),
            });

            const latestProcessInformation = getOrCreateLatestProcessState(processFileHelper, context, command, 10, fakeNow);
            expect(latestProcessInformation).to.be.not.null;

            expect(latestProcessInformation?.latestProcessStateDir).to.be.equal("2023-01-31-00-00-00");
            expect(latestProcessInformation?.processState).to.be.not.null;
            expect(formatDate(<Date>latestProcessInformation?.processState?.startDate)).to.be.equal("2023-01-31");
        });
        it("should not do anything if the latest file is complete and renew date is not passed", async () => {
            mockfs({
                '/tmp/foo/bar/2023-01-01-00-00-00/state.json': JSON.stringify({
                    "completionDate": "2023-01-22T00:00:00.000Z",
                }),
            });

            const latestProcessInformation = getOrCreateLatestProcessState(processFileHelper, context, command, 10, fakeNow);
            expect(latestProcessInformation).to.be.null;
        });
        it("should error if the data directory does not exist", async () => {
            mockfs({});

            expect(() => {
                getOrCreateLatestProcessState(processFileHelper, context, command, 10, fakeNow);
            }).to.throw(/Data directory does not exist/);
        });
    });
    describe('#checkFileCompleted()', function () {
        it("should mark the file as complete when it is", async () => {
            const processState:ProcessState = {
                unresolved: {},
                errored: {},
                resolved: {},
                archived: {},
                startDate: new Date(),
                completionDate: null,
                completionError: null,
            };
            checkFileCompleted(processState, fakeNow);

            expect(processState.completionDate).to.be.not.null;
            expect(processState.completionError).to.be.null;
        });
        it("should mark the file as complete when it is, but with errors", async () => {
            const processState:ProcessState = {
                unresolved: {},
                errored: <any>{"foo": "bar"},
                resolved: {},
                archived: {},
                startDate: new Date(),
                completionDate: null,
                completionError: null,
            };
            checkFileCompleted(processState, fakeNow);

            expect(processState.completionDate).to.be.not.null;
            expect(processState.completionError).to.be.not.null;
        });
        it("should not mark the file as complete when it is not", async () => {
            const processState:ProcessState = {
                unresolved: <any>{"foo": "bar"},
                errored: {},
                resolved: {},
                archived: {},
                startDate: new Date(),
                completionDate: null,
                completionError: null,
            };
            checkFileCompleted(processState, fakeNow);

            expect(processState.completionDate).to.be.null;
            expect(processState.completionError).to.be.null;
        });
    });
    describe('#saveProcessRunOutput()', function () {
        // TODO: implement (use mockfs) perhaps?
        //     it("should save the output as separate items in a JSON file", async () => {
        //         new FakeCommand(processFileHelper).saveProcessRunOutput(processFileHelper, stateFile, processState, currentRunOutput);
        //     });
        //     it("should append to the output", async () => {
        //         new FakeCommand(processFileHelper).saveProcessRunOutput(processFileHelper, stateFile, processState, currentRunOutput);
        //     });
    });
});
