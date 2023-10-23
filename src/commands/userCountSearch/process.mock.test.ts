import nock from "nock";
import {graphql} from "@octokit/graphql";
import {FileOutput, Process, ProcessState} from "./process";
import {TaskQueue} from "../../taskqueue";
import fetch from "node-fetch";
import {join} from "path";
import assert from "assert";
import loadDynamicImports from "../../dynamic-imports";
import {QueueConfig} from "./config";
import {TaskSpec} from "./task";
import {UserCountSearchQuery} from "../../generated/queries";
import initializeNockBack from "../../test/initializeNockBack";

import * as log from "../../log";

// disable logging for tests
log.setLevel("error");

const nockBack = nock.back;
initializeNockBack();

const task_turkey:TaskSpec = {
    id: "task_turkey",
    parentId: null,
    originatingTaskId: null,
    minRepos: 50,
    minFollowers: 50,
    location: "Turkey",
};

const task_adana:TaskSpec = {
    id: "task_adana",
    parentId: null,
    originatingTaskId: null,
    minRepos: 50,
    minFollowers: 50,
    location: "Adana",
};

const task_foo:TaskSpec = {
    id: "task_foo",
    parentId: null,
    originatingTaskId: null,
    minRepos: 50,
    minFollowers: 50,
    location: "Foo",
};


const testMatrix = [
    {
        // all good, 2 tasks
        unresolved: [task_turkey, task_adana],
        fixture: "userCountSearch/01-all-good.json",
        expectedOutput: [
            {"Turkey": 100},
            {"Adana": 1},
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // 2 tasks, 1st aborts due to primary rate limit
        unresolved: [task_turkey, task_adana],
        fixture: "userCountSearch/02-rate-limit-reached.json",
        expectedOutput: [
            {"Turkey": 100},
        ],
        expectedUnresolvedCount: 1,
        expectedResolvedCount: 1,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // 2 tasks, 2nd errors for 3 times and then succeeds
        unresolved: [task_turkey, task_adana],
        fixture: "userCountSearch/03-retry-works.json",
        expectedOutput: [
            {"Turkey": 100},
            {"Adana": 1},
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 2,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
    {
        // 2 tasks, 2nd errors for 4 times (1 initial try + 3 retries)
        unresolved: [task_turkey, task_adana],
        fixture: "userCountSearch/04-unknown-error.json",
        expectedOutput: [
            {"Turkey": 100},
        ],
        expectedUnresolvedCount: 0,
        expectedResolvedCount: 1,
        expectedErroredCount: 1,
        expectedArchivedCount: 0,
    },
    {
        // 3 tasks, 2nd aborts due to secondary rate limit, it will abort the queue
        unresolved: [task_turkey, task_foo, task_adana],
        fixture: "userCountSearch/05-secondary-rate-limit-reached.json",
        expectedOutput: [
            {"Turkey": 100},
        ],
        expectedUnresolvedCount: 2,
        expectedResolvedCount: 1,
        expectedErroredCount: 0,
        expectedArchivedCount: 0,
    },
];

describe('userCountSearch mock test', () => {
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
            const startingConfig:QueueConfig = {
                minRepositories: 0,
                minFollowers: 0,
                locationJsonFile: "location.json.does.not.exist",
            };

            let unresolved:{ [key:string]:TaskSpec } = {};
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

            const taskQueue = new TaskQueue<UserCountSearchQuery, TaskSpec>(
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
            context.assertScopesFinished();

            // assertions
            assert.equal(currentRunOutput.length, test.expectedOutput.length);

            // get repo names from output
            const outputRepoNames = currentRunOutput.map((item) => {
                const location = item.result.location;
                const ret:any = {};
                ret[location] = item.result.userCount
                return ret;
            });

            assert.deepEqual(outputRepoNames, test.expectedOutput);
        });
    });
});
