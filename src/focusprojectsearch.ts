import {graphql} from "@octokit/graphql";
import {v4 as uuidv4} from 'uuid';
import {RepositorySearch, RepositorySearchQuery} from "./generated/queries";

import {BaseTask, TaskQueue, TaskResult} from "./tasks/taskqueue";

// TODO: add comments + docs

interface ProjectSearchTaskOptions {
    id:string;  // TODO: do we actually need this here?
    minStars:number;
    minForks:number;
    minSizeInKb:number;
    hasActivityAfter:string;
    createdAfter:string;
    createdBefore:string;
    pageSize:number;
    startCursor:string | null;
}

interface ProcessConfig {
    minStars:number,
    minForks:number,
    minSizeInKb:number,
    maxInactiveDays:number,
    excludeProjectsCreatedBefore:Date,
    minAgeInDays:number,
    searchPeriodInDays:number,
    pageSize:number,
}

interface ProcessState {
    startingConfig:ProcessConfig,
    unresolved:{ [key:string]:ProjectSearchTaskOptions },
    resolved:{ [key:string]:ProjectSearchTaskOptions },
    errored:{ [key:string]:ProjectSearchTaskOptions },
    startDate:Date,
    completionDate:Date | null,
    outputFilePath:string,
}

const processState = {
    startingConfig: {},
    unresolved: {},
    resolved: {},
    errored: {},
    completionDate: null,
    outputFilePath: "",
};

// store the output of current run as an array of objects
// these objects will be written to the output file at the end of the run
// TODO: how about, write to file as we go?
const currentRunOutput = [];

function buildProcessConfig() {

}

export function main() {
    let abortController = new AbortController();

    const taskQueue = new TaskQueue({
        concurrency: 2,
        perTaskTimeout: 10000,
        intervalCap: 2,
        interval: 1000,
        signal: abortController.signal
    });

    taskQueue.on('taskcomplete', (result:TaskResult<RepositorySearchQuery>) => {
        console.log("taskcomplete", result);
    });

    taskQueue.on('taskerror', (error) => {
        console.log("taskerror", error);
    });

    const graphqlWithAuth = graphql.defaults({
        headers: {
            Authorization: `bearer ${process.env.GITHUB_TOKEN}`,
        },
    });

    const task = new ProjectSearchTask(graphqlWithAuth, {
        id: uuidv4(),
        minStars: 100,
        minForks: 100,
        minSizeInKb: 1000,
        hasActivityAfter: "2023-06-01",
        createdAfter: "2018-01-01",
        createdBefore: "2018-01-10",
        pageSize: 100,
        startCursor: null,
    });

    taskQueue.add(task);

    taskQueue.start();
}

class ProjectSearchTask extends BaseTask<RepositorySearchQuery> {
    private readonly graphqlWithAuth:typeof graphql<RepositorySearchQuery>;
    private readonly options:ProjectSearchTaskOptions;

    constructor(graphqlWithAuth:typeof graphql, options:ProjectSearchTaskOptions) {
        super();
        this.graphqlWithAuth = graphqlWithAuth;
        this.options = options;
    }

    execute(signal:AbortSignal):Promise<RepositorySearchQuery> {
        // return Promise.resolve(undefined);
        let search_string = "is:public template:false archived:false " +
            `stars:>${this.options.minStars} ` +
            `forks:>${this.options.minForks} ` +
            `size:>${this.options.minSizeInKb} ` +
            `pushed:>${this.options.hasActivityAfter} ` +
            `created:${this.options.createdAfter}..${this.options.createdBefore}`

        // console.log(RepositorySearch.loc!.source.body);

        return this.graphqlWithAuth(
            RepositorySearch.loc!.source.body,
            {
                "searchString": search_string,
                "first": this.options.pageSize,
                "after": this.options.startCursor,
            }
        ).then((res:RepositorySearchQuery) => {
            return res;
        });
        // TODO: catch, finally
    }
}


