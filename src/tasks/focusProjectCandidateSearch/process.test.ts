import {createNewProcessState} from "./process";
import {QueueConfig, TaskOptions} from "./types";
import {formatDate, parseDate} from "../../utils";
import {expect} from "chai";

function fakeNow():Date {
    return parseDate("2023-01-31");
}

function getKeysSortedByCreatedAfter(unresolved:{ [key:string]:TaskOptions }) {
    return Object.keys(unresolved).sort((a, b) => {
        return unresolved[a].createdAfter.localeCompare(unresolved[b].createdAfter);
    });
}

describe('focusProjectCandidateSearch unit test', () => {
    describe('#createNewProcessState()', function () {
        it('should create new process state, 1 day range, 1 day interval', function () {
            const config:QueueConfig = {
                MIN_STARS: 1,
                MIN_FORKS: 1,
                MIN_SIZE_IN_KB: 1,
                MAX_INACTIVITY_DAYS: 1,
                EXCLUDE_PROJECTS_CREATED_BEFORE: "2023-01-30",
                MIN_AGE_IN_DAYS: 1,    // 2023-01-30
                SEARCH_PERIOD_IN_DAYS: 1,
                PAGE_SIZE: 1,
            };
            const state = createNewProcessState(config, "foo.json", fakeNow);
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
            expect(task.minStars).to.be.equal(config.MIN_STARS);
            expect(task.minForks).to.be.equal(config.MIN_FORKS);
            expect(task.minSizeInKb).to.be.equal(config.MIN_SIZE_IN_KB);
            expect(task.startCursor).to.be.null;
            expect(task.pageSize).to.be.equal(config.PAGE_SIZE);
            // built from input
            expect(task.hasActivityAfter).to.be.equal("2023-01-30");
            expect(task.createdAfter).to.be.equal("2023-01-30");
            expect(task.createdBefore).to.be.equal("2023-01-30");
        });
        it('should create new process state, 2 day range, 2 day interval', function () {
            const config:QueueConfig = {
                MIN_STARS: 1,
                MIN_FORKS: 1,
                MIN_SIZE_IN_KB: 1,
                MAX_INACTIVITY_DAYS: 1,
                EXCLUDE_PROJECTS_CREATED_BEFORE: "2023-01-29",
                MIN_AGE_IN_DAYS: 1,    // 2023-01-30
                SEARCH_PERIOD_IN_DAYS: 2,
                PAGE_SIZE: 1,
            };
            const state = createNewProcessState(config, "foo.json", fakeNow);
            expect(Object.keys(state.unresolved)).to.have.lengthOf(1);

            const task = state.unresolved[Object.keys(state.unresolved)[0]];
            expect(task.hasActivityAfter).to.be.equal("2023-01-30");
            expect(task.createdAfter).to.be.equal("2023-01-29");
            expect(task.createdBefore).to.be.equal("2023-01-30");
        });
        it('should create new process state, 2 day range, 1 day interval', function () {
            const config:QueueConfig = {
                MIN_STARS: 1,
                MIN_FORKS: 1,
                MIN_SIZE_IN_KB: 1,
                MAX_INACTIVITY_DAYS: 1,
                EXCLUDE_PROJECTS_CREATED_BEFORE: "2023-01-29",
                MIN_AGE_IN_DAYS: 1,    // 2023-01-30
                SEARCH_PERIOD_IN_DAYS: 1,
                PAGE_SIZE: 1,
            };
            const state = createNewProcessState(config, "foo.json", fakeNow);
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
                MIN_STARS: 1,
                MIN_FORKS: 1,
                MIN_SIZE_IN_KB: 1,
                MAX_INACTIVITY_DAYS: 1,
                EXCLUDE_PROJECTS_CREATED_BEFORE: "2023-01-01",
                MIN_AGE_IN_DAYS: 1,    // 2023-01-30
                SEARCH_PERIOD_IN_DAYS: 5,
                PAGE_SIZE: 1,
            };
            const state = createNewProcessState(config, "foo.json", fakeNow);
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
                MIN_STARS: 1,
                MIN_FORKS: 1,
                MIN_SIZE_IN_KB: 1,
                MAX_INACTIVITY_DAYS: 1,
                EXCLUDE_PROJECTS_CREATED_BEFORE: "2023-01-21",
                MIN_AGE_IN_DAYS: 1,    // 2023-01-30
                SEARCH_PERIOD_IN_DAYS: 7,
                PAGE_SIZE: 1,
            };
            const state = createNewProcessState(config, "foo.json", fakeNow);
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
