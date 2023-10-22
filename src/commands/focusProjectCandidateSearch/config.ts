import yargs from "yargs/yargs";
import {commandDescription, commandName} from "./process";

export interface Config extends QueueConfig, ProcessConfig {
}

export interface ProcessConfig {
    githubToken:string;
    dataDirectory:string;
    renewPeriodInDays:number;
    concurrency:number;
    perTaskTimeoutInMs:number;
    rateLimitStopPercent:number;
    intervalCap:number;
    intervalInMs:number;
    retryCount:number;
    reportPeriodInMs:number;
}

export interface QueueConfig {
    minStars:number;
    minForks:number;
    minSizeInKb:number;
    maxInactivityDays:number;
    excludeRepositoriesCreatedBefore:string;
    minAgeInDays:number;
    searchPeriodInDays:number;
    pageSize:number;
}

export function buildConfig():Config {
    const notPersistedGroup = "Following options are not persisted in process file. " +
        "They will always be used from the environment variables.";

    const persistedGroup = "Following options are persisted in the process state file. " +
        "This means, when the process is run for the same process file again later, it will use the values from the file. " +
        "This is to continue an existing search process. " +
        "The values passed as arguments will be ignored in that case.";

    return yargs(process.argv.slice(2))
        .usage(`Usage: $0 ${commandName} [options]`)
        .usage(`Run $0 --help for help on common options.`)
        .usage(commandDescription)
        .options({
            // persisted
            "github-token": {
                type: "string",
                desc: "GitHub API token. Token doesn't need any permissions.",
                demandOption: true,
                group: notPersistedGroup,
            },
            "data-directory": {
                type: "string",
                desc: "Data directory to read and store the output.",
                demandOption: true,
                group: notPersistedGroup,
            },
            "renew-period-in-days": {
                type: "number",
                desc: "Number of days to wait until creating a new queue after the latest one is completed.",
                default: 7,
                group: notPersistedGroup,
            },
            "concurrency": {
                type: "number",
                desc:
                    "Number of concurrent tasks to process the queue. " +
                    "As this search is IO bound and CPU bound, there can be many concurrent tasks (more than the number of cores). " +
                    "However, because of the rate limiting, there will be a lot of idle tasks. " +
                    "So, it is recommended to keep concurrency low.",
                default: 6,
                group: notPersistedGroup,
            },
            "per-task-timeout-in-ms": {
                type: "number",
                desc:
                    "Timeout in milliseconds for each task in the queue." +
                    "Keeping the timeout too long will end up using too many GitHub actions minutes." +
                    "Keeping the timeout too short will result in too many errored items.",
                default: 30000,
                group: notPersistedGroup,
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
                group: notPersistedGroup,
            },
            "interval-cap": {
                type: "number",
                desc: "Max number of tasks to execute in the given interval by interval-in-ms.",
                default: 4,
                group: notPersistedGroup,
            },
            "interval-in-ms": {
                type: "number",
                desc: "Interval for the cap in milliseconds.",
                default: 20000,
                group: notPersistedGroup,
            },
            "retry-count": {
                type: "number",
                desc: "Number of retries for each task before giving up of creating narrower scoped tasks.",
                default: 3,
                group: notPersistedGroup,
            },
            "report-period-in-ms": {
                type: "number",
                desc: "Period in milliseconds to print the queue state to stdout (0 for disabled)",
                default: 5000,
                group: notPersistedGroup,
            },
            // persisted
            "min-stars": {
                type: "number",
                desc: "Minimum number of stars for a repositories to search for.",
                default: 50,
                group: persistedGroup,
            },
            "min-forks": {
                type: "number",
                desc: "Minimum number of forks for a repositories to search for.",
                default: 50,
                group: persistedGroup,
            },
            "min-size-in-kb": {
                type: "number",
                desc: "Minimum size of the repositories in KB to search for.",
                default: 1000,
                group: persistedGroup,
            },
            "max-inactivity-days": {
                type: "number",
                desc: "Maximum number of days since last commit; ignore repositories that have been inactive for longer than this",
                default: 90,
                group: persistedGroup,
            },
            "exclude-repositories-created-before": {
                type: "string",
                desc: "The earliest date of repository creation to search for the repositories (format: YYYY-MM-DD)",
                default: "2008-01-01",
                group: persistedGroup,
            },
            "min-age-in-days": {
                type: "number",
                desc: "Minimum number of days since the repository was created; ignore repositories younger than this",
                default: 365,
                group: persistedGroup,
            },
            "search-period-in-days": {
                type: "number",
                desc: "Length of the date range in days to search for repositories in one call",
                default: 5,
                group: persistedGroup,
            },
            "page-size": {
                type: "number",
                desc: "Maximum number of repositories to find in one call",
                default: 100,
                group: persistedGroup,
            },
        })
        .wrap(null)
        .parseSync();
}

export function extractProcessConfig(config:Config):ProcessConfig {
    return {
        githubToken: config.githubToken,
        dataDirectory: config.dataDirectory,
        renewPeriodInDays: config.renewPeriodInDays,
        concurrency: config.concurrency,
        perTaskTimeoutInMs: config.perTaskTimeoutInMs,
        rateLimitStopPercent: config.rateLimitStopPercent,
        intervalCap: config.intervalCap,
        intervalInMs: config.intervalInMs,
        retryCount: config.retryCount,
        reportPeriodInMs: config.reportPeriodInMs,
    }
}

export function extractNewQueueConfig(config:Config):QueueConfig {
    return {
        minStars: config.minStars,
        minForks: config.minForks,
        minSizeInKb: config.minSizeInKb,
        maxInactivityDays: config.maxInactivityDays,
        excludeRepositoriesCreatedBefore: config.excludeRepositoriesCreatedBefore,
        minAgeInDays: config.minAgeInDays,
        searchPeriodInDays: config.searchPeriodInDays,
        pageSize: config.pageSize,
    }
}
