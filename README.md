TODO:
- requeue command (need to convert current to `execute` command)
- release tooling
- CI

# cuttlecat - Collect information from GitHub

cuttlecat is a tool to collect information from GitHub. It is designed to be used in GitHub Actions, but can be used in any environment.

Features:
- [x] Feed your own search query and processing logic
- [x] Fully extensible (contract based)
- [x] Resumable search (store the state of the process and resume later)
- [x] Rate limit aware (stop the process when the rate limit is low)
- [x] Stops the process if data is already fresh enough
- [x] Retry failed tasks
- [x] Narrow down the scope of failed tasks (e.g. if a search for a date range fails, create tasks for shorter date ranges)
- [x] Concurrent tasks (to avoid hitting GitHub secondary rate limits)
- [x] Timeout for each task (to avoid spending too much GitHub action minutes)
- [x] Max process run time (to avoid GitHub action cancellation of tasks that run too long)
- [x] Report progress to stdout
- [x] Record HTTP calls to disk for debugging purposes

## How it works

cuttlecat is a task runner. It takes a command file and a data directory as input. The command file contains the search query and the processing logic. The data directory is where the state of the process and the output will be stored. The process can be resumed later by using the same data directory.

This design allows the process to be fully extensible. You can write your own command file to search for anything you want and process the results in any way you want.

## Running cuttlecat

```shell
node dist/index.js --command-file=<your command file> --data-directory=<data directory> --github-token=<github token>
```

### Usage

<!---
node dist/index.js --help
--->
```shell
Usage: index.js --command-file=<your command file> [options]

Required options
  --command-file    Command file to load.  [string] [required]
  --data-directory  Data directory to read and store the output.  [string] [required]
  --github-token    GitHub API token. Token might need permissions based on your task.  [string] [required]

Options:
  --help                     Show help  [boolean]
  --renew-period-in-days     Number of days to wait until creating a new queue after the latest one is completed.  [number] [default: 7]
  --concurrency              Number of concurrent tasks to process the queue. As this search is IO bound and CPU bound, there can be many concurrent tasks (more than the number of cores). However, because of the rate limiting, there will be a lot of idle tasks. So, it is recommended to keep concurrency low.  [number] [default: 6]
  --per-task-timeout-in-ms   Timeout in milliseconds for each task in the queue.Keeping the timeout too long will end up using too many GitHub actions minutes.Keeping the timeout too short will result in too many errored items.  [number] [default: 30000]
  --rate-limit-stop-percent  Under this rate limit remaining percent, stop the queue.  [number] [default: 10]
  --interval-cap             Max number of tasks to execute in the given interval by interval-in-ms.  [number] [default: 4]
  --interval-in-ms           Interval for the cap in milliseconds.  [number] [default: 20000]
  --retry-count              Number of retries for each task before giving up of creating narrower scoped tasks.  [number] [default: 3]
  --record-http-calls        Record HTTP calls to disk for debugging purposes. "Nock back" will be used in `record` mode where the new records will be created. The calls will be stored in the `./nock-records/` directory, relative to the command path.  [boolean] [default: false]
  --log-level                Log level to use.  [string] [default: "info"]
  --max-run-time-in-minutes  When to stop the command gracefully. For example GitHub Actions has a 3 hour limit and when it cancels, nothing is saved. However, GitHub sometimes cancels before the limit to possibly make rooms for other systems/actions, so set it a bit lower than the limit.  [number] [default: 60]
  --report-period-in-ms      Period in milliseconds to print the queue state to stdout (0 for disabled)  [number] [default: 5000]

Examples:
  --data-directory=/path/to/directory                      Store the state of the process and the output in /path/to/directory, so that subsequent executions of the same command can be resumed.
  --renew-period-in-days=7                                 If the process is complete (all search periods are processed), don't start a new search until 7 days has passed after the latest completion.
  --concurrency=6 --interval-cap=4 --interval-in-ms=20000  Start 6 concurrent tasks each time, and execute 4 tasks in every 20 seconds. (change these to avoid hitting GitHub secondary rate limits)
  --retry-count=3                                          When a task fails, retry 3 times (in total, 4 times). If it still fails, process will create tasks that have narrower scopes. If the task's scope can be narrowed down, then the task will be archived. If not, it will stay in the errored list. This narrowing down will also happen for any narrowed-down tasks that fail (tried 4 times in total), until they cannot be narrowed down anymore. For the commands that use a date range to search for, tasks for shorter search ranges will be created that in total wrap the failing task's search range.
  --per-task-timeout-in-ms=30000                           For each task, wait for 30 seconds before timing out. You change this to avoid spending too much GitHub action minutes. If the timeoutis too short, there will be too many errored items. However, the process will retry and create narrower scoped tasks for errored items, so, having a very long timeout is not very useful.
  --report-period-in-ms=5000                               Print the queue state to stdout every 5 seconds. This is useful to see how many tasks are in the queue, how many are completed, how many are errored, etc.
```

### Running the sample command

To run the sample command:
```shell
rm -rf /tmp/foo/bar
mkdir -p /tmp/foo/bar

node dist/index.js --command-file="./test/test_tasks/basicUserSearch.js" \
    --data-directory="/tmp/foo/bar" \
    --github-token="$(gh auth token)"
```

The sample task will search for users who have location set to "Istanbul" and signed up in January 2020.
The output will be stored in `/tmp/foo/bar` directory.

See [`src/test/test_tasks/basicUserSearch.ts`](src/test/test_tasks/basicUserSearch.ts) for the implementation of the sample command.

## Implement your own search command

To implement your own search command, you need to create a command file. The command file is a JavaScript file that exports a class that implements the [`Command` interface](src/graphql/command.ts).

When you are implementing your own command, you will need to return some objects. These objects will be of types that you also need to implement. These types are:
- [`Task`](src/graphql/task.ts): A task is a search query and the processing logic. The processing logic is a function that takes the search result, extracts the output, decides if there's an error, etc. The search result is a list of items returned by the search query. The search query is a GraphQL query that is executed by the GitHub GraphQL API.
- [`TaskSpec`](src/graphql/taskSpec.ts): This is the input to create a task. This is serialized and stored in the data directory. When the process is resumed, this is deserialized and used to create the task.
- [`TaskResult`](src/graphql/taskResult.ts): This is the output of a task. This is serialized and stored in the data directory.

For an example command, please see [`src/test/test_tasks/basicUserSearch.ts`](src/test/test_tasks/basicUserSearch.ts).

TODO: links to more complicated commands.

## Using cuttlecat as a library

Instead of creating a command file and feeding it to cuttlecat, you can use cuttlecat as a library. This is useful if you want to build your own tooling on top of cuttlecat.

TODO: example

## Building cuttlecat from source

```shell
# switch to the correct node version in .nvrmc
nvm use
# install dependencies
npm install
# build the project
npm run build
```

## Running the tests

```shell
npm run test
```

## Creating a new release

```shell
# update the version in package.json to something like "0.0.6"
npm install
git add .
git commit -m "Release 0.0.6"
git tag -a "0.0.6" -m "Release 0.0.6"
git push --follow-tags

# create a new release on GitHub
gh release create

# update the version in package.json to something like "0.0.7-dev"
npm install
git add .
git commit -m "Start 0.0.7-dev"
git push
```
