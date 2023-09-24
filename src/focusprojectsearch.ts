import {graphql} from "@octokit/graphql";
import {RepositorySearch, RepositorySearchQuery} from "./generated/queries";

import {BaseTask, TaskQueue, TaskResult} from "./tasks/taskqueue";

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
        min_stars: 100,
        min_forks: 100,
        min_size_in_kb: 1000,
        has_activity_after: "2023-06-01",
        created_after: "2018-01-01",
        created_before: "2018-01-10",
    });

    taskQueue.add(task);

    taskQueue.start();
}

interface ProjectSearchTaskOptions {
    min_stars:number;
    min_forks:number;
    min_size_in_kb:number;
    has_activity_after:string;
    created_after:string;
    created_before:string;
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
            `stars:>${this.options.min_stars} ` +
            `forks:>${this.options.min_forks} ` +
            `size:>${this.options.min_size_in_kb} ` +
            `pushed:>${this.options.has_activity_after} ` +
            ` created:${this.options.created_after}..${this.options.created_before}`

        // console.log(RepositorySearch.loc!.source.body);

        return this.graphqlWithAuth(
            RepositorySearch.loc!.source.body,
            {
                "searchString": search_string,
                "first": 10,
                "after": null,
            }
        ).then((res:RepositorySearchQuery) => {
            return res;
        });
        // TODO: catch, finally
    }

}
