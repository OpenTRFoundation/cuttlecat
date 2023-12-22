import assert from "assert";
import {dirname, join} from "path";
import {fileURLToPath} from 'url';

import {graphql} from "@octokit/graphql";
import nock from "nock";
import fetch from "node-fetch";

import {TaskContext} from "../../graphql/context.js";
import * as log from "../../log.js";
import {addErroredToUnresolved, initializeQueue, ProcessState, startTaskQueue} from "../../main.js";
import {TaskQueue, TaskStore} from "../../queue/taskqueue.js";
import BasicUserSearchCommand, {BasicUserSearchTaskResult, BasicUserSearchTaskSpec} from "./basicUserSearch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const logger = log.createLogger("basicUserSearch/mockTest");

// disable logging for tests
log.setLevel("error");

nock.back.fixtures = join(__dirname, '/fixtures');
nock.back.setMode('lockdown');

const task_2023_01_01_single_day_signup_interval:BasicUserSearchTaskSpec = {
    id: "task_2023_01_01_single_day_signup_interval",
    parentId: null,
    originatingTaskId: null,
    //
    location: "Foo",
    //
    signedUpAfter: "2023-01-01",
    signedUpBefore: "2023-01-01",
    //
    pageSize: 100,
    startCursor: null,
};

type TestOutput = { [key:string]:{ [key:string]:any } };

interface TestMatrixItem {
    unresolved:BasicUserSearchTaskSpec[],
    fixture:string,
    // map<username:map<repoName:commitCount>> --> only check commit counts
    expectedOutput:TestOutput,
    expectedUnresolvedCount:number,
    expectedResolvedCount:number,
    expectedErroredCount:number,
    expectedArchivedCount:number,
    expectedNonCriticalErrors?:(RegExp | undefined)[],
}

const testMatrix:TestMatrixItem[] = [
    {
        // all good, 1 task, returns 1 user
        unresolved: [task_2023_01_01_single_day_signup_interval],
        fixture: "basicUserSearch/01-all-good-no-pagination.json",
        expectedOutput: {
            "user_1": {
                "login": "user_1",
                "company": "company_1",
                "name": "name_1"
            },
        },
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 1,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // all good, 1 task, returns 1 user and has next page which returns 1 user
        unresolved: [task_2023_01_01_single_day_signup_interval],
        fixture: "basicUserSearch/02-all-good-with-pagination.json",
        expectedOutput: {
            "user_1": {
                "login": "user_1",
                "company": "company_1",
                "name": "name_1"
            },
            "user_2": {
                "login": "user_2",
                "company": "company_2",
                "name": "name_2"
            },
        },
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 user and contrib, and has a next page
        // but aborts due to primary rate limit
        // next page is not processed and stored in unresolved
        unresolved: [task_2023_01_01_single_day_signup_interval],
        fixture: "basicUserSearch/03-rate-limit-reached.json",
        expectedOutput: {
            "user_1": {
                "login": "user_1",
                "company": "company_1",
                "name": "name_1"
            },
        },
        expectedUnresolvedCount: 1,
        expectedResolvedCount: 1,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task errors for 3 times and then returns 1 user
        unresolved: [task_2023_01_01_single_day_signup_interval],
        fixture: "basicUserSearch/04-retry-works.json",
        expectedOutput: {
            "user_1": {
                "login": "user_1",
                "company": "company_1",
                "name": "name_1"
            },
        },
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 1,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task hits secondary rate limit and won't return any results. it will abort the queue
        unresolved: [task_2023_01_01_single_day_signup_interval],
        fixture: "basicUserSearch/05-secondary-rate-limit-reached.json",
        expectedOutput: {},
        expectedUnresolvedCount: 1,
        expectedResolvedCount: 0,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
];

describe('basicUserSearch mock test', async () => {
    testMatrix.forEach((test) => {
        it(test.fixture, async () => {
            const signal = new AbortController().signal;

            const graphqlFn = graphql.defaults({
                headers: {
                    "authorization": `bearer 000000000000000000000000000`,
                    // nock doesn't really support gzip, so we need to disable it
                    "accept-encoding": 'identity'
                },
                request: {
                    signal: signal,
                    fetch: fetch,
                }
            });

            const unresolved:{ [key:string]:BasicUserSearchTaskSpec } = {};
            for (let i = 0; i < test.unresolved.length; i++) {
                unresolved[test.unresolved[i].id] = test.unresolved[i];
            }

            const resolved = {};
            const errored = {};
            const archived = {};

            const processState:ProcessState = {
                unresolved: unresolved,
                resolved: resolved,
                errored: errored,
                archived: archived,
                startDate: new Date(),
                completionDate: null,
                completionError: null,
            };

            const taskStore:TaskStore<BasicUserSearchTaskSpec> = {
                unresolved: unresolved,
                resolved: resolved,
                errored: errored,
                archived: archived,
            };

            const context = new TaskContext(graphqlFn, 10, logger, []);

            const taskQueue = new TaskQueue<BasicUserSearchTaskResult, BasicUserSearchTaskSpec, TaskContext>(
                taskStore,
                {
                    concurrency: 4,
                    perTaskTimeout: 30000,
                    intervalCap: 10,
                    interval: 10000,
                    retryCount: 3,
                }, context);

            const options = {
                retryCount: 3,
                rateLimitStopPercent: 10,
            };

            const command = new BasicUserSearchCommand();

            addErroredToUnresolved(logger, errored, unresolved, options.retryCount);
            initializeQueue(taskQueue, unresolved, context, command);

            const nockBackResult = await nock.back(test.fixture);
            const nockDone = nockBackResult.nockDone;
            const nockContext = nockBackResult.context;

            await startTaskQueue(logger, taskQueue);

            nockDone();
            nockContext.assertScopesFinished();

            const retrievedOutput:TestOutput = {};
            context.currentRunOutput.forEach((item) => {
                const userName = item.result.login;
                retrievedOutput[userName] = {
                    login: item.result.login,
                    company: item.result.company,
                    name: item.result.name,
                };
            });

            assert.deepEqual(retrievedOutput, test.expectedOutput);

            assert.equal(Object.keys(processState.unresolved).length, test.expectedUnresolvedCount, "Unresolved count doesn't match");
            assert.equal(Object.keys(processState.resolved).length, test.expectedResolvedCount, "Resolved count doesn't match");
            assert.equal(Object.keys(processState.errored).length, test.expectedErroredCount, "Errored count doesn't match");
            assert.equal(Object.keys(processState.archived).length, test.expectedArchivedCount, "Archived count doesn't match");

            if (test.expectedNonCriticalErrors) {
                // collect non-critical errors
                const nonCriticalErrors = Object.values(processState.resolved).map((item) => {
                    return item.nonCriticalError?.message;
                });

                assert.equal(nonCriticalErrors.length, test.expectedNonCriticalErrors.length);

                for (let i = 0; i < nonCriticalErrors.length; i++) {
                    if (nonCriticalErrors[i] === undefined) {
                        assert.strictEqual(nonCriticalErrors[i], test.expectedNonCriticalErrors[i]);
                    } else {
                        assert.match(<string>nonCriticalErrors[i], <RegExp>test.expectedNonCriticalErrors[i]);
                    }
                }
            }
        });
    });
});
