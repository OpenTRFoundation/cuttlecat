import {Task, TaskSpec} from "./task";
import {graphql} from "@octokit/graphql";
import {FocusProjectCandidateSearch} from "../../generated/queries";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";

import * as log from "../../log";

// disable logging for tests
log.setLevel("error");

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
});
