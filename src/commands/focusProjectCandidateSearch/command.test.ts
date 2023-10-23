import {formatDate, parseDate} from "../../utils";
import {expect} from "chai";
import {QueueConfig} from "./config";
import * as log from "../../log";
import {Command} from "./command";
import {TaskSpec} from "./task";

// disable logging for tests
log.setLevel("warn");


function fakeNow():Date {
    return parseDate("2023-01-31");
}

function getKeysSortedByCreatedAfter(unresolved:{ [key:string]:TaskSpec }) {
    return Object.keys(unresolved).sort((a, b) => {
        return unresolved[a].createdAfter.localeCompare(unresolved[b].createdAfter);
    });
}

describe('focusProjectCandidateSearch unit test', () => {
    describe('#createNewProcessState()', function () {
        it('should create new process state, 1 day range, 1 day interval', function () {
            const config:QueueConfig = {
                minStars: 1,
                minForks: 1,
                minSizeInKb: 1,
                maxInactivityDays: 1,
                excludeRepositoriesCreatedBefore: "2023-01-30",
                minAgeInDays: 1,    // 2023-01-30
                searchPeriodInDays: 1,
                pageSize: 1,
            };
            let command = new Command(<any>{}, config, <any>{});
            const state = command.createNewProcessState("foo.json", fakeNow);
            expect(state.errored).to.be.empty;
            expect(state.archived).to.be.empty;
            expect(state.resolved).to.be.empty;
            expect(state.completionDate).to.be.null;
            expect(state.completionError).to.be.null;
            expect(formatDate(state.startDate)).to.be.equal(formatDate(fakeNow()));
            expect(state.startingConfig).to.be.equal(config);
            expect(state.outputFileName).to.be.equal("foo.json");
            expect(state.unresolved).to.be.not.empty;
            expect(Object.keys(state.unresolved)).to.have.lengthOf(1);

            const task = state.unresolved[Object.keys(state.unresolved)[0]];
            // fixed
            expect(task.id).to.be.not.null;
            expect(task.parentId).to.be.null;
            expect(task.originatingTaskId).to.be.null;
            // depends on input
            expect(task.minStars).to.be.equal(config.minStars);
            expect(task.minForks).to.be.equal(config.minForks);
            expect(task.minSizeInKb).to.be.equal(config.minSizeInKb);
            expect(task.startCursor).to.be.null;
            expect(task.pageSize).to.be.equal(config.pageSize);
            // built from input
            expect(task.hasActivityAfter).to.be.equal("2023-01-30");
            expect(task.createdAfter).to.be.equal("2023-01-30");
            expect(task.createdBefore).to.be.equal("2023-01-30");
        });
        it('should create new process state, 2 day range, 2 day interval', function () {
            const config:QueueConfig = {
                minStars: 1,
                minForks: 1,
                minSizeInKb: 1,
                maxInactivityDays: 1,
                excludeRepositoriesCreatedBefore: "2023-01-29",
                minAgeInDays: 1,    // 2023-01-30
                searchPeriodInDays: 2,
                pageSize: 1,
            };
            let command = new Command(<any>{}, config, <any>{});
            const state = command.createNewProcessState("foo.json", fakeNow);
            expect(Object.keys(state.unresolved)).to.have.lengthOf(1);

            const task = state.unresolved[Object.keys(state.unresolved)[0]];
            expect(task.hasActivityAfter).to.be.equal("2023-01-30");
            expect(task.createdAfter).to.be.equal("2023-01-29");
            expect(task.createdBefore).to.be.equal("2023-01-30");
        });
        it('should create new process state, 2 day range, 1 day interval', function () {
            const config:QueueConfig = {
                minStars: 1,
                minForks: 1,
                minSizeInKb: 1,
                maxInactivityDays: 1,
                excludeRepositoriesCreatedBefore: "2023-01-29",
                minAgeInDays: 1,    // 2023-01-30
                searchPeriodInDays: 1,
                pageSize: 1,
            };
            let command = new Command(<any>{}, config, <any>{});
            const state = command.createNewProcessState("foo.json", fakeNow);
            expect(Object.keys(state.unresolved)).to.have.lengthOf(2);

            // sort by createdAfter to make it easier to test
            const keys = getKeysSortedByCreatedAfter(state.unresolved);

            // task 1
            expect(state.unresolved[keys[0]].hasActivityAfter).to.be.equal("2023-01-30");
            expect(state.unresolved[keys[0]].createdAfter).to.be.equal("2023-01-29");
            expect(state.unresolved[keys[0]].createdBefore).to.be.equal("2023-01-29");

            // task 2
            expect(state.unresolved[keys[1]].hasActivityAfter).to.be.equal("2023-01-30");
            expect(state.unresolved[keys[1]].createdAfter).to.be.equal("2023-01-30");
            expect(state.unresolved[keys[1]].createdBefore).to.be.equal("2023-01-30");
        });
        it('should create new process state, 30 day range, 5 day interval', function () {
            const config:QueueConfig = {
                minStars: 1,
                minForks: 1,
                minSizeInKb: 1,
                maxInactivityDays: 1,
                excludeRepositoriesCreatedBefore: "2023-01-01",
                minAgeInDays: 1,    // 2023-01-30
                searchPeriodInDays: 5,
                pageSize: 1,
            };
            let command = new Command(<any>{}, config, <any>{});
            const state = command.createNewProcessState("foo.json", fakeNow);
            expect(Object.keys(state.unresolved)).to.have.lengthOf(6);

            // sort by createdAfter to make it easier to test
            const keys = getKeysSortedByCreatedAfter(state.unresolved);

            // task 1
            expect(state.unresolved[keys[0]].hasActivityAfter).to.be.equal("2023-01-30");
            expect(state.unresolved[keys[0]].createdAfter).to.be.equal("2023-01-01");
            expect(state.unresolved[keys[0]].createdBefore).to.be.equal("2023-01-05");

            // task 5
            expect(state.unresolved[keys[5]].hasActivityAfter).to.be.equal("2023-01-30");
            expect(state.unresolved[keys[5]].createdAfter).to.be.equal("2023-01-26");
            expect(state.unresolved[keys[5]].createdBefore).to.be.equal("2023-01-30");
        });
        it('should create new process state, 10 day range, 7 day interval', function () {
            const config:QueueConfig = {
                minStars: 1,
                minForks: 1,
                minSizeInKb: 1,
                maxInactivityDays: 1,
                excludeRepositoriesCreatedBefore: "2023-01-21",
                minAgeInDays: 1,    // 2023-01-30
                searchPeriodInDays: 7,
                pageSize: 1,
            };
            let command = new Command(<any>{}, config, <any>{});
            const state = command.createNewProcessState("foo.json", fakeNow);
            expect(Object.keys(state.unresolved)).to.have.lengthOf(2);

            // sort by createdAfter to make it easier to test
            const keys = getKeysSortedByCreatedAfter(state.unresolved);

            // task 1
            expect(state.unresolved[keys[0]].hasActivityAfter).to.be.equal("2023-01-30");
            expect(state.unresolved[keys[0]].createdAfter).to.be.equal("2023-01-21");
            expect(state.unresolved[keys[0]].createdBefore).to.be.equal("2023-01-27");

            // task 2
            expect(state.unresolved[keys[1]].hasActivityAfter).to.be.equal("2023-01-30");
            expect(state.unresolved[keys[1]].createdAfter).to.be.equal("2023-01-28");
            expect(state.unresolved[keys[1]].createdBefore).to.be.equal("2023-02-03");
        });
    });
});