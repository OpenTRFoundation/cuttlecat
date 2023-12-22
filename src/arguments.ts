import yargs, {ArgumentsCamelCase, Argv} from "yargs";

type GetReturnType<Type> = Type extends (...args:never[]) => infer Return
    ? Return
    : never;
type ExtractOptionsType<YargsType> = YargsType extends Argv<infer Type> ? Type : never;

// with this, we can build a type that is the same as the type of the options
// that are returned by the yargs.options() call.
// this is useful, because this would provide compile time checking when using the options.
export type GetBuiltOptionsType<T> = ArgumentsCamelCase<ExtractOptionsType<GetReturnType<T>>>

export type Args = GetBuiltOptionsType<typeof addArguments>;

const REQUIRED_OPTIONS_GROUP = "Required options";

export function getYargs() {
    return yargs(process.argv.slice(2))
        .usage("Usage: $0 --command-file=<command file> [options]")
        .strictCommands()
        .wrap(null)
        .version(false);
}

export function addArguments(y:Argv<any>) {
    return y
        .example(
            "--data-directory=/path/to/directory",
            "Store the state of the process and the output in /path/to/directory, so that subsequent executions of the same command can be resumed."
        )
        .example(
            "--renew-period-in-days=7",
            "If the process is complete (all search periods are processed), don't start a new search until 7 days has passed after the latest completion."
        )
        .example(
            "--concurrency=6 --interval-cap=4 --interval-in-ms=20000",
            "Start 6 concurrent tasks each time, and execute 4 tasks in every 20 seconds. (change these to avoid hitting GitHub secondary rate limits)"
        )
        .example(
            "--retry-count=3",
            "When a task fails, retry 3 times (in total, 4 times). If it still fails, process will create tasks that have narrower scopes. If the task's scope can be " +
            "narrowed down, then the task will be archived. If not, it will stay in the errored list. This narrowing down will also happen for any narrowed-down tasks " +
            "that fail (tried 4 times in total), until they cannot be narrowed down anymore. " +
            "For the commands that use a date range to search for, tasks for shorter search ranges will be created that in total wrap the " +
            "failing task's search range."
        )
        .example(
            "--per-task-timeout-in-ms=30000",
            "For each task, wait for 30 seconds before timing out. You change this to avoid spending too much GitHub action minutes. If the timeout" +
            "is too short, there will be too many errored items. However, the process will retry and create narrower scoped tasks for errored items, so, having a " +
            "very long timeout is not very useful."
        )
        .example(
            "--report-period-in-ms=5000",
            "Print the queue state to stdout every 5 seconds. This is useful to see how many tasks are in the queue, how many are completed, how many are errored, etc. "
        )
        .options({
            "command-file": {
                type: "string",
                desc: "Command file to load.",
                demandOption: true,
                group: REQUIRED_OPTIONS_GROUP,
            },
            "data-directory": {
                type: "string",
                desc: "Data directory to read and store the output.",
                demandOption: true,
                group: REQUIRED_OPTIONS_GROUP,
            },
            "github-token": {
                type: "string",
                desc: "GitHub API token. Token might need permissions based on your task.",
                demandOption: true,
                group: REQUIRED_OPTIONS_GROUP,
            },

            // optional stuff
            "renew-period-in-days": {
                type: "number",
                desc: "Number of days to wait until creating a new queue after the latest one is completed.",
                default: 7,
            },
            "concurrency": {
                type: "number",
                desc:
                    "Number of concurrent tasks to process the queue. " +
                    "As this search is IO bound and CPU bound, there can be many concurrent tasks (more than the number of cores). " +
                    "However, because of the rate limiting, there will be a lot of idle tasks. " +
                    "So, it is recommended to keep concurrency low.",
                default: 6,
            },
            "per-task-timeout-in-ms": {
                type: "number",
                desc:
                    "Timeout in milliseconds for each task in the queue." +
                    "Keeping the timeout too long will end up using too many GitHub actions minutes." +
                    "Keeping the timeout too short will result in too many errored items.",
                default: 30000,
            },
            // About rate limits...
            // ref1: https://docs.github.com/en/free-pro-team@latest/rest/search/search?apiVersion=2022-11-28#search-users
            // ref2: https://docs.github.com/en/free-pro-team@latest/rest/search/search?apiVersion=2022-11-28#rate-limit
            // ref3: https://docs.github.com/en/rest/overview/resources-in-the-rest-api?apiVersion=2022-11-28#rate-limits-for-requests-from-personal-accounts
            // ref4: https://docs.github.com/en/rest/overview/resources-in-the-rest-api?apiVersion=2022-11-28#rate-limits-for-requests-from-github-actions
            // Numbers:
            // The REST API has a custom rate limit for searching. ... you can make up to 30 requests per minute
            // User access token requests are limited to 5,000 requests per hour ...
            // When using GITHUB_TOKEN, the rate limit is 1,000 requests per hour per repository.
            //
            // Bottleneck is search endpoint, which is limited to 30 requests per minute.
            // And the worst part is, that it's not reported by the RateLimit object in GraphQL response.
            // We only know when we reached the limit.
            // The queue will abort when primary (1000 requests per hour) or secondary (30 requests per minute) rate limit is reached.
            // So that we can retry later, instead of waiting and using the GitHub action minutes.
            //
            // Another note is that instead of using an interval of 60 seconds and a cap of 30, we should use shorter intervals and a lower cap.
            // Otherwise, what happens is that queue will execute 30 tasks in ~10 seconds, and then wait for 50 seconds.
            // That's a burst-y behavior, and we should avoid that.
            // A good number to start with is 10 seconds and 5 tasks.
            //
            // Finally, let's leave some gap for the secondary rate limit.
            // Instead of 10 seconds and 5 tasks, let's use 12 seconds and 4 tasks (means 20 reqs/sec).
            //
            // These numbers can be overridden by env vars.
            "rate-limit-stop-percent": {
                type: "number",
                desc: "Under this rate limit remaining percent, stop the queue.",
                default: 10,
            },
            "interval-cap": {
                type: "number",
                desc: "Max number of tasks to execute in the given interval by interval-in-ms.",
                default: 4,
            },
            "interval-in-ms": {
                type: "number",
                desc: "Interval for the cap in milliseconds.",
                default: 20000,
            },
            "retry-count": {
                type: "number",
                desc: "Number of retries for each task before giving up of creating narrower scoped tasks.",
                default: 3,
            },

            // debug related stuff
            "record-http-calls": {
                type: "boolean",
                desc:
                    "Record HTTP calls to disk for debugging purposes. " +
                    "\"Nock back\" will be used in `record` mode where the new records will be created. " +
                    "The calls will be stored in the `./nock-records/` directory, relative to the command path.",
                default: false,
            },
            "log-level": {
                type: "string",
                desc: "Log level to use.",
                default: "info",
            },
            "max-run-time-in-minutes": {
                type: "number",
                desc: "When to stop the command gracefully. For example GitHub Actions has a 3 hour limit and " +
                    "when it cancels, nothing is saved. However, GitHub sometimes cancels before the limit to " +
                    "possibly make rooms for other systems/actions, so set it a bit lower than the limit.",
                default: 60, // default to 1 hour
            },
            "report-period-in-ms": {
                type: "number",
                desc: "Period in milliseconds to print the queue state to stdout (0 for disabled)",
                default: 5000,
            },
        });
}
