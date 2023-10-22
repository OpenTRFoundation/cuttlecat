import {GraphQLProcessCommand, ProcessConfig} from "../graphqlProcessCommand";
import {buildConfig, Config, extractNewQueueConfig, extractProcessConfig, QueueConfig} from "./config";
import {ProcessState, TaskOptions} from "./types";
import {FocusProjectCandidateSearchQuery} from "../../generated/queries";
import {Arguments} from "../../arguments";
import {Process} from "./process";
import {createLogger} from "../../log";
import {addDays, daysInPeriod, formatDate, parseDate, subtractDays} from "../../utils";
import {v4 as uuidv4} from "uuid";
import {shuffle} from "lodash";
import {TaskQueue} from "../../taskqueue";
import {graphql} from "@octokit/graphql";
import FileSystem from "../../fileSystem";

const logger = createLogger("focusProjectCandidateSearch/command");

export const commandName = "focus-project-candidate-search";
export const commandDescription = "Search for repositories that can be used to identify focus organizations and projects.";

export async function main(mainConfig:Arguments) {
    const config:Config = buildConfig();
    const processConfig = extractProcessConfig(config);
    const newQueueConfig = extractNewQueueConfig(config);

    await new Command(processConfig, newQueueConfig, mainConfig).start();
}


export class Command extends GraphQLProcessCommand<QueueConfig, TaskOptions, FocusProjectCandidateSearchQuery> {
    private readonly newQueueConfig:QueueConfig;

    constructor(processConfig:ProcessConfig, newQueueConfig:QueueConfig, mainArgs:Arguments) {
        super(commandName, processConfig, mainArgs);
        this.newQueueConfig = newQueueConfig;
    }

    createNewProcessState(outputFileName:string, nowFn:() => Date):ProcessState {
        let startDate = parseDate(this.newQueueConfig.excludeRepositoriesCreatedBefore);
        let endDate = subtractDays(nowFn(), this.newQueueConfig.minAgeInDays);

        // GitHub search API is inclusive for the start date and the end date.
        //
        // Example call with a 2-day period:
        //
        // curl -G \
        //   -H "Accept: application/vnd.github+json" \
        //   -H "X-GitHub-Api-Version: 2022-11-28" \
        //   --data-urlencode 'q=stars:>50 forks:>10 is:public pushed:>2023-06-19 size:>1000 template:false archived:false created:2010-01-12..2010-01-13' \
        //   "https://api.github.com/search/repositories" | jq '.items[] | "\(.created_at)   \(.full_name)"'
        // Results:
        // "2010-01-12T09:37:53Z   futuretap/InAppSettingsKit"
        // "2010-01-13T05:52:38Z   vasi/pixz"
        //
        // Example call with a 1-day period:
        //
        // curl -G \
        //   -H "Accept: application/vnd.github+json" \
        //   -H "X-GitHub-Api-Version: 2022-11-28" \
        //   --data-urlencode 'q=stars:>50 forks:>10 is:public pushed:>2023-06-19 size:>1000 template:false archived:false created:2010-01-13..2010-01-13' \
        //   "https://api.github.com/search/repositories" | jq '.items[] | "\(.created_at)   \(.full_name)"'
        // Results:
        // "2010-01-13T05:52:38Z   vasi/pixz"
        //
        // So, to prevent any duplicates, we need to make sure that the intervals are exclusive.
        // Like these:
        // - 2023-01-01 - 2023-01-05
        // - 2023-01-06 - 2023-01-10

        let interval = daysInPeriod(startDate, endDate, this.newQueueConfig.searchPeriodInDays);
        let hasActivityAfter = formatDate(subtractDays(nowFn(), this.newQueueConfig.maxInactivityDays))

        logger.info(`Creating a new process state, startDate: ${formatDate(startDate)}, endDate: ${formatDate(endDate)}, hasActivityAfter: ${hasActivityAfter}`);

        let newTasks:TaskOptions[] = [];

        for (let i = 0; i < interval.length; i++) {
            let createdAfter = formatDate(interval[i]);
            let createdBefore = formatDate(addDays(interval[i], this.newQueueConfig.searchPeriodInDays - 1));
            let key = uuidv4();
            newTasks.push({
                id: key,
                parentId: null,
                originatingTaskId: null,
                minStars: this.newQueueConfig.minStars,
                minForks: this.newQueueConfig.minForks,
                minSizeInKb: this.newQueueConfig.minSizeInKb,
                hasActivityAfter: hasActivityAfter,
                createdAfter: createdAfter,
                createdBefore: createdBefore,
                pageSize: this.newQueueConfig.pageSize,
                startCursor: null,
            });
        }

        // TODO: do this shuffling in parent class
        // tasks for some date ranges return lots of data and some return very little data.
        // let's shuffle to have a more even distribution of request durations.
        newTasks = shuffle(newTasks);

        let unresolved:{ [key:string]:TaskOptions } = {};
        for (let i = 0; i < newTasks.length; i++) {
            const task = newTasks[i];
            unresolved[task.id] = task;
            logger.debug(`Created unresolved task: ${JSON.stringify(task)}`);
        }

        return {
            startingConfig: this.newQueueConfig,
            unresolved: unresolved,
            resolved: {},
            errored: {},
            archived: {},
            startDate: nowFn(),
            completionDate: null,
            completionError: null,
            outputFileName: outputFileName,
        }
    }

    createProcess(processState:ProcessState, taskQueue:TaskQueue<FocusProjectCandidateSearchQuery, TaskOptions>, graphqlWithAuth:typeof graphql, currentRunOutput:any[]):Process {
        return new Process(
            processState, taskQueue, graphqlWithAuth, currentRunOutput, {
                retryCount: this.processConfig.retryCount,
                rateLimitStopPercent: this.processConfig.rateLimitStopPercent,
            }
        );
    }

    getFileSystem(dataDirectory:string) {
        return getFileSystem(dataDirectory);
    }
}

export function getFileSystem(dataDirectory:string) {
    return new FileSystem(
        dataDirectory,
        "process-state-",
        ".json",
        "process-output-",
        ".json",
    );
}
