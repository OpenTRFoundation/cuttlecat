import {graphql} from "@octokit/graphql";
import {RepositorySearchQuery, RepositorySearch, RepositorySummaryFragment} from "./generated/queries";

async function foo() {
    const graphqlWithAuth = graphql.defaults({
        headers: {
            Authorization: `bearer ${process.env.GITHUB_TOKEN}`,
        },
    });

    const min_stars = 100;
    const min_forks = 100;
    const min_size_in_kb = 1000;
    const has_activity_after = "2023-06-01";
    const created_after = "2018-01-01";
    const created_before = "2020-01-01";


    let search_string = "is:public template:false archived:false " +
        `stars:>${min_stars} ` +
        `forks:>${min_forks} ` +
        `size:>${min_size_in_kb} ` +
        `pushed:>${has_activity_after} ` +
        ` created:${created_after}..${created_before}`

    console.log(RepositorySearch.loc!.source.body);

    const res:RepositorySearchQuery = await graphqlWithAuth(
        RepositorySearch.loc!.source.body,
        {
            "searchString": search_string,
            "first": 10,
            "after": null,
        }
    );

    return res;
}

foo().then(function (res) {
    console.log(res.rateLimit?.remaining);
    console.log(res.search.pageInfo.endCursor);
    for (let node of res.search.nodes!) {
        let repo = <RepositorySummaryFragment>node;
        console.log(repo.nameWithOwner);
        console.log(repo.pullRequests.totalCount);
    }

});
