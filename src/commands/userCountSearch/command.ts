import {buildConfig, Config, extractNewQueueConfig, extractProcessConfig, QueueConfig} from "./config";
import {ProcessState, TaskOptions} from "./types";
import {LocationsOutput} from "../locationGeneration/generate";
import {readFileSync} from "fs";
import {v4 as uuidv4} from "uuid";
import {shuffle} from "lodash";
import {TaskQueue} from "../../taskqueue";
import {UserCountSearchQuery} from "../../generated/queries";
import {Arguments} from "../../arguments";
import {graphql} from "@octokit/graphql";
import {Process} from "./process";
import {GraphQLProcessCommand, ProcessConfig} from "../graphqlProcessCommand";
import {createLogger} from "../../log";
import {GraphqlProcess, GraphqlProcessState} from "../graphqlProcess";
import FileSystem from "../../fileSystem";

const logger = createLogger("userCountSearch/command");

// TODO: create an interface for these constants
export const commandName = "user-count-search";
export const commandDescription = "Search for user counts for given search criteria.";

export async function main(mainConfig:Arguments) {
    const config:Config = buildConfig();
    const processConfig = extractProcessConfig(config);
    const newQueueConfig = extractNewQueueConfig(config);

    await new Command(processConfig, newQueueConfig, mainConfig).start();
}

export class Command extends GraphQLProcessCommand<QueueConfig, TaskOptions, UserCountSearchQuery> {
    private readonly newQueueConfig:QueueConfig;

    constructor(processConfig:ProcessConfig, newQueueConfig:QueueConfig, mainArgs:Arguments) {
        super(commandName, processConfig, mainArgs);
        this.newQueueConfig = newQueueConfig;
    }

    createNewProcessState(outputFileName:string, nowFn:() => Date):ProcessState {
        // read JSON file and create an entry for each location
        const locationsOutput:LocationsOutput = JSON.parse(readFileSync(this.newQueueConfig.locationJsonFile, "utf8"));
        const locations:string[] = [];
        for (let key in locationsOutput) {
            locations.push(...locationsOutput[key].alternatives);
        }

        logger.info(`Creating a new process state, MIN_REPOS: ${this.newQueueConfig.minRepositories}, MIN_FOLLOWERS: ${this.newQueueConfig.minFollowers}, number of locations: ${locations.length}`);

        let newTasks:TaskOptions[] = [];

        for (let i = 0; i < locations.length; i++) {
            let key = uuidv4();
            newTasks.push({
                id: key,
                parentId: null,
                originatingTaskId: null,
                location: locations[i],
                minRepos: this.newQueueConfig.minRepositories,
                minFollowers: this.newQueueConfig.minFollowers,
            });
        }

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

    createProcess(processState:GraphqlProcessState<QueueConfig, TaskOptions>, taskQueue:TaskQueue<UserCountSearchQuery, TaskOptions>, graphqlWithAuth:typeof graphql, currentRunOutput:any[]):GraphqlProcess<QueueConfig, TaskOptions, UserCountSearchQuery> {
        return new Process(
            processState, taskQueue, graphqlWithAuth, currentRunOutput, {
                retryCount: this.processConfig.retryCount,
                rateLimitStopPercent: this.processConfig.rateLimitStopPercent,
            }
        );
    }

    getFileSystem(dataDirectory:string) {
        return new FileSystem(
            dataDirectory,
            "process-state-",
            ".json",
            "process-output-",
            ".json",
        );
    }
}
