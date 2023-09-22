import {graphql} from "@octokit/graphql";
import {WhoAmIQuery, WhoAmI} from "./generated/queries";

async function foo(){
    const graphqlWithAuth = graphql.defaults({
        headers: {
            Authorization: `bearer ${process.env.GITHUB_TOKEN}`,
        },
    });

    const res:WhoAmIQuery = await graphqlWithAuth(WhoAmI.loc!.source.body);

    return res;
}

foo().then(r => console.log(r));
