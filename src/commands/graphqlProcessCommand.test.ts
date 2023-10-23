import mockfs from "mock-fs";
import {GraphQLProcessCommand} from "./graphqlProcessCommand";
import {GraphqlProcess, GraphqlProcessState} from "./graphqlProcess";
import {TaskQueue} from "../taskqueue";
import {graphql} from "@octokit/graphql";
import FileSystem from "../fileSystem";
import {expect} from "chai";
import {formatDate, parseDate} from "../utils";
import * as log from "../log";

// disable logging for tests
log.setLevel("error");

class FakeCommand extends GraphQLProcessCommand<any, any, any> {
    private readonly fileSystem:FileSystem;

    constructor(fileSystem:FileSystem) {
        super(<any>null, <any>{renewPeriodInDays: 10}, <any>null);
        this.fileSystem = fileSystem;
    }

    createProcess(processState:GraphqlProcessState<any, any>, taskQueue:TaskQueue<any, any>, graphqlWithAuth:typeof graphql, currentRunOutput:any[]):GraphqlProcess<any, any, any> {
        throw new Error("Method not implemented.");
    }

    doCreateNewProcessState(outputFileName:string, nowFn:() => Date):GraphqlProcessState<any, any> {
        return <any>{
            archived: {},
            completionDate: null,
            completionError: null,
            errored: {},
            outputFileName: outputFileName,
            resolved: {},
            startDate: nowFn(),
            startingConfig: {},
            unresolved: {},
        }
    }

    getFileSystem(dataDirectory:string):FileSystem {
        return this.fileSystem;
    }

}

function fakeNow():Date {
    return parseDate("2023-01-31");
}

const fileSystem = new FileSystem("/tmp/foo/bar", "state-", ".json", "output-", ".json");

afterEach(() => {
    mockfs.restore();
});

describe('graphqlProcessCommand', () => {
    describe('#getOrCreateLatestProcessState()', function () {
        it("should create a new process state file, if there's none yet", async () => {
            mockfs({
                '/tmp/foo/bar': {},
            });

            const {stateFile, processState} = new FakeCommand(fileSystem)
                .getOrCreateLatestProcessState(fileSystem, fakeNow);

            expect(stateFile).to.be.equal("/tmp/foo/bar/state-2023-01-31-00-00-00.json");
            expect(processState).to.be.not.null;
            expect(formatDate(<Date>processState?.startDate)).to.be.equal("2023-01-31");
            expect(processState?.outputFileName).to.be.equal("output-2023-01-31-00-00-00.json");
        });
        it("should use the latest file, if it is not complete", async () => {
            mockfs({
                '/tmp/foo/bar/state-2023-01-01-00-00-00.json': JSON.stringify({
                    "completionDate": null,
                    "startDate": "2023-01-02T00:00:00.000Z",
                    "outputFileName": "foo-bar.json"
                }),
            });

            const {stateFile, processState} = new FakeCommand(fileSystem)
                .getOrCreateLatestProcessState(fileSystem, fakeNow);

            expect(stateFile).to.be.equal("/tmp/foo/bar/state-2023-01-01-00-00-00.json");
            expect(processState).to.be.not.null;
            expect(processState?.startDate).to.be.equal("2023-01-02T00:00:00.000Z");
            expect(processState?.outputFileName).to.be.equal("foo-bar.json");
        });
        it("should create a new process state file, if the latest file is complete, and renew date is passed", async () => {
            mockfs({
                '/tmp/foo/bar/state-2023-01-01-00-00-00.json': JSON.stringify({
                    "completionDate": "2023-01-20T00:00:00.000Z",
                    "startDate": "2023-01-02T00:00:00.000Z",
                }),
            });

            const {stateFile, processState} = new FakeCommand(fileSystem)
                .getOrCreateLatestProcessState(fileSystem, fakeNow);

            expect(stateFile).to.be.equal("/tmp/foo/bar/state-2023-01-31-00-00-00.json");
            expect(processState).to.be.not.null;
            expect(formatDate(<Date>processState?.startDate)).to.be.equal("2023-01-31");
            expect(processState?.outputFileName).to.be.equal("output-2023-01-31-00-00-00.json");
        });
        it("should not do anything if the latest file is complete and renew date is not passed", async () => {
            mockfs({
                '/tmp/foo/bar/state-2023-01-01-00-00-00.json': JSON.stringify({
                    "completionDate": "2023-01-22T00:00:00.000Z",
                }),
            });

            const {stateFile, processState} = new FakeCommand(fileSystem)
                .getOrCreateLatestProcessState(fileSystem, fakeNow);

            expect(stateFile).to.be.null;
            expect(processState).to.be.null;
        });
        it("should error if the data directory does not exist", async () => {
            mockfs({});

            expect(() => {
                new FakeCommand(fileSystem).getOrCreateLatestProcessState(fileSystem, fakeNow)
            }).to.throw(/Data directory does not exist/);
        });
    });
    describe('#checkFileCompleted()', function () {
        it("should mark the file as complete when it is", async () => {
            const processState = <GraphqlProcessState<any, any>>{
                unresolved: {},
                errored: {},
                completionDate: null,
                completionError: null,
            };
            new FakeCommand(fileSystem).checkFileCompleted(processState, fakeNow);

            expect(processState.completionDate).to.be.not.null;
            expect(processState.completionError).to.be.null;
        });
        it("should mark the file as complete when it is, but with errors", async () => {
            const processState = <GraphqlProcessState<any, any>>{
                unresolved: {},
                errored: <any>{"foo": "bar"},
                completionDate: null,
                completionError: null,
            };
            new FakeCommand(fileSystem).checkFileCompleted(processState, fakeNow);

            expect(processState.completionDate).to.be.not.null;
            expect(processState.completionError).to.be.not.null;
        });
        it("should not mark the file as complete when it is not", async () => {
            const processState = <GraphqlProcessState<any, any>>{
                unresolved: <any>{"foo": "bar"},
                errored: {},
                completionDate: null,
                completionError: null,
            };
            new FakeCommand(fileSystem).checkFileCompleted(processState, fakeNow);

            expect(processState.completionDate).to.be.null;
            expect(processState.completionError).to.be.null;
        });
    });
    // describe('#saveProcessRunOutput()', function () {
    //     it("should save the output as separate items in a JSON file", async () => {
    //         new FakeCommand(fileSystem).saveProcessRunOutput(fileSystem, stateFile, processState, currentRunOutput);
    //     });
    //     it("should append to the output", async () => {
    //         new FakeCommand(fileSystem).saveProcessRunOutput(fileSystem, stateFile, processState, currentRunOutput);
    //     });
    // });
});
