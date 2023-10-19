import nock from "nock";
import {graphql} from "@octokit/graphql";
import {FileOutput, ProcessState, TaskOptions} from "./types";
import {FocusProjectCandidateSearchQuery} from "../../generated/queries";
import {Process} from "./process";
import {TaskQueue} from "../../taskqueue";
import fetch from "node-fetch";
import {join} from "path";
import assert from "assert";
import loadDynamicImports from "../../dynamic-imports";

const nockBack = nock.back;

nockBack.fixtures = join(__dirname, '/nock-fixtures');
nockBack.setMode('lockdown');

const task_2023_01_01_single_day = {
    id: "task_2023_01_01_single_day",
    parentId: null,
    originatingTaskId: null,
    minStars: 50,
    minForks: 50,
    minSizeInKb: 1000,
    hasActivityAfter: "2023-01-01",
    createdAfter: "2023-01-01",
    createdBefore: "2023-01-01",
    pageSize: 100,
    startCursor: null,
};

const task_2023_01_02_single_day = {
    id: "task_2023_01_02_single_day",
    parentId: null,
    originatingTaskId: null,
    minStars: 50,
    minForks: 50,
    minSizeInKb: 1000,
    hasActivityAfter: "2023-01-01",
    createdAfter: "2023-01-02",
    createdBefore: "2023-01-02",
    pageSize: 100,
    startCursor: null,
};

const task_2023_01_02_two_days = {
    id: "task_2023_01_02_two_days",
    parentId: null,
    originatingTaskId: null,
    minStars: 50,
    minForks: 50,
    minSizeInKb: 1000,
    hasActivityAfter: "2023-01-01",
    createdAfter: "2023-01-02",
    createdBefore: "2023-01-03",
    pageSize: 100,
    startCursor: null,
};

const testMatrix = [
    {
        // all good, 2 tasks, each return 1 repo
        unresolved: [task_2023_01_01_single_day, task_2023_01_02_single_day],
        fixture: "01-all-good-no-pagination.json",
        expectedOutput: [
            "search_1/repo_1",
            "search_2/repo_1",
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // all good, 2 tasks, each return 1 repo, 1 task has next page which returns 1 repo
        unresolved: [task_2023_01_01_single_day, task_2023_01_02_single_day],
        fixture: "02-all-good-with-pagination.json",
        expectedOutput: [
            "search_1/repo_1",
            "search_2/repo_1",
            "search_1_next_page/repo_1",
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 3,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 repo, and has a next page
        // task 2 returns 1 repo, and aborts due to primary rate limit
        // next page of task 1 is not processed and stored in unresolved
        unresolved: [task_2023_01_01_single_day, task_2023_01_02_single_day],
        fixture: "03-rate-limit-reached.json",
        expectedOutput: [
            "search_1/repo_1",
            "search_2/repo_1",
        ],
        expectedUnresolvedCount: 1,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 repo, and doesn't have a next page
        // task 2 errors for 3 times and then returns 1 repo
        unresolved: [task_2023_01_01_single_day, task_2023_01_02_single_day],
        fixture: "04-retry-works.json",
        expectedOutput: [
            "search_1/repo_1",
            "search_2/repo_1",
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 repo, and doesn't have a next page
        // task 2 errors for 4 times (1 initial try + 3 retries)
        unresolved: [task_2023_01_01_single_day, task_2023_01_02_single_day],
        fixture: "05-unknown-error-without-narrower-scope.json",
        expectedOutput: [
            "search_1/repo_1",
        ],
        expectedUnresolvedCount: 1,
        expectedResolvedCount: 1,
        expectedErroredCount: 1,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 repo, and doesn't have a next page
        // task 2 errors for 4 times (1 initial try + 3 retries)
        // 2 tasks narrower scope tasks are created for task 2
        // task 2 is archived
        unresolved: [task_2023_01_01_single_day, task_2023_01_02_two_days],
        fixture: "06-unknown-error-with-narrower-scopes.json",
        expectedOutput: [
            "search_1/repo_1",
            "search_3/repo_1",
            "search_4/repo_1",
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 3,
        expectedErroredCount: 0,
        expectedArchivedCount: 1,
    },
    {
        // task 1 returns 1 repo, and has a next page
        // task 2 hits secondary rate limit and won't return any results. it will abort the queue
        // next page of task 1 is not processed and stored in unresolved
        unresolved: [task_2023_01_01_single_day, task_2023_01_02_single_day],
        fixture: "07-secondary-rate-limit-reached.json",
        expectedOutput: [
            "search_1/repo_1",
        ],
        expectedUnresolvedCount: 2,
        expectedResolvedCount: 1,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // task 1 returns 1 repo
        // task 2 returns 2 repos, but one is null, due to IP limitations
        unresolved: [task_2023_01_01_single_day, task_2023_01_02_single_day],
        fixture: "08-partial-response.json",
        expectedOutput: [
            "search_1/repo_1",
            "search_2/repo_1",
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
];

describe('focusProjectCandidateSearch mock test', () => {
    testMatrix.forEach((test) => {
        it(test.fixture, async () => {
            await loadDynamicImports();

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

            // doesn't really matter, as we're not gonna create any new queues
            // and we're not gonna save the starting config
            const startingConfig = {
                MIN_STARS: 0,
                MIN_FORKS: 0,
                MIN_SIZE_IN_KB: 0,
                MAX_INACTIVITY_DAYS: 0,
                EXCLUDE_PROJECTS_CREATED_BEFORE: "",
                MIN_AGE_IN_DAYS: 0,
                SEARCH_PERIOD_IN_DAYS: 0,
                PAGE_SIZE: 0,
            };

            let unresolved:{ [key:string]:TaskOptions } = {};
            for (let i = 0; i < test.unresolved.length; i++) {
                unresolved[test.unresolved[i].id] = test.unresolved[i];
            }

            const processState:ProcessState = {
                startingConfig: startingConfig,
                unresolved: unresolved,
                resolved: {},
                errored: {},
                archived: {},
                startDate: new Date(),
                completionDate: null,
                completionError: null,
                outputFileName: "foo.json",
            };

            const taskStore = {
                unresolved: processState.unresolved,
                resolved: processState.resolved,
                errored: processState.errored,
                archived: processState.archived,
            };

            const taskQueue = new TaskQueue<FocusProjectCandidateSearchQuery, TaskOptions>(
                taskStore,
                {
                    concurrency: 4,
                    perTaskTimeout: 30000,
                    intervalCap: 10,
                    interval: 10000,
                    retryCount: 3,
                });

            const currentRunOutput:FileOutput[] = [];

            const options = {
                retryCount: 3,
                rateLimitStopPercent: 10,
            };

            const proc = new Process(processState, taskQueue, graphqlFn, currentRunOutput, options);

            proc.initialize();

            const {nockDone, context} = await nockBack(test.fixture);

            await proc.start();

            nockDone();

            // assertions
            assert.equal(currentRunOutput.length, test.expectedOutput.length);

            // get repo names from output
            const outputRepoNames = currentRunOutput.map((item) => {
                return item.result.nameWithOwner;
            });

            assert.deepEqual(outputRepoNames, test.expectedOutput);
        });
    });
});
