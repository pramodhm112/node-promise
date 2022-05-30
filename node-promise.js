let {
    graphql
} = require("@octokit/graphql");
const {
    Octokit
} = require("@octokit/core");
const {
    paginateRest,
    composePaginateRest,
} = require("@octokit/plugin-paginate-rest");
const _colors = require("colors");
const cliProgress = require('cli-progress');
const write = require("write");
const sortArray = require("sort-array");
const Json2csvParser = require("json2csv").Parser;
require("dotenv").config();
var totalGraphQlCalls, totalRepos;
totalGraphQlCalls = totalRepos = 0;

const hostname = process.env.GHES_HOSTNAME;
const token = process.env.GITHUB_TOKEN;
const enterpriseSlug = process.env.GHE_ENTERPRISE;
var graphqlDefaults;

if (process.env.GHE == "GHES") {
    graphqlDefaults = {
        baseUrl: `https://${hostname}/api`,
        headers: {
            authorization: `token ${token}`,
        },
    };
} else {
    graphqlDefaults = {
        headers: {
            authorization: `token ${token}`,
        },
    };
}
graphql = graphql.defaults(graphqlDefaults);

if (process.env.GIT_GHE != undefined) {
    if (process.env.GIT_GHE == "GHES") {
        GHES_HOSTNAME = process.env.GIT_GHES_HOSTNAME;
    } else if (process.env.GIT_GHE == "GHEC") {
        GHES_HOSTNAME = "github.com";
    }
    PASS = process.env.GIT_GITHUB_TOKEN;
} else {
    PASS = process.env.GITHUB_TOKEN;
    if (process.env.GHE == "GHES") {
        GHES_HOSTNAME = process.env.GHES_HOSTNAME;
    } else if (process.env.GHE == "GHEC") {
        GHES_HOSTNAME = "github.com";
    }
}

const outputPath = "alerts/";
var outputFile = []

var orgquery = {
    query: `query($enterpriseSlug: String!, $cursor: String) {
    enterprise(slug: $enterpriseSlug) {
      organizations(first:100, after: $cursor) {
        nodes {
          login
        }
        pageInfo{
          endCursor
          hasNextPage
        }
      }
    }
  }`,
    _queryname: 'orgquery',
    enterpriseSlug: `${enterpriseSlug}`
};

var repoquery = {
    query: `query($organizationSlug: String!, $cursor: String) {
        organization(login: $organizationSlug) {
            repositories(first: 100, after: $cursor) {
                totalCount
                nodes {
                    name
                    owner {
                        login
                    }
                    collaborators(first: 100, affiliation: ALL) {
                        totalCount
                        edges {
                            permission
                            node {
                                login
                                name
                            }
                        }
                        pageInfo {
                            endCursor
                            hasNextPage
                        }
                    }
                }
                pageInfo {
                    hasNextPage
                    endCursor
                }
            }
        }
    }`,
    _queryname: 'repoquery'
};

totalOrgsBar = 1
const orgsBar = new cliProgress.SingleBar({
    format: 'GraphQL Orgs Call Progress |' + _colors.cyan('{bar}') + '| {percentage}% || {value}/{total} Calls',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
});

console.log("Getting the List of Organisations...");
async function getOrgs() {
    try {
        orgsBar.start(totalOrgsBar, 0, {});
        var orgarraylogin = []
        hasNext = true
        while (hasNext) {
            var result = await graphql(orgquery);
            orgsBar.increment();
            var l = JSON.parse(JSON.stringify(result)).enterprise.organizations.nodes.length
            orgquery.cursor = result.enterprise.organizations.pageInfo.endCursor;
            var hasNext = JSON.parse(JSON.stringify(result)).enterprise.organizations.pageInfo.hasNextPage
            if (hasNext) {
                totalOrgsBar++
                orgsBar.setTotal(totalOrgsBar)
            }
            for (i = 0; i < l; i++) {
                orgarraylogin.push(JSON.parse(JSON.stringify(result)).enterprise.organizations.nodes[i].login)
            }
        }
        orgsBar.stop();
        console.log("\nCompleted: Getting the List of Organisations")
        return orgarraylogin
    } catch (error) {
        console.log("Request failed:", error.request);
    }
}

totalRepoBar = 1
const repoBar = new cliProgress.SingleBar({
    format: 'GraphQL Repo Call Progress |' + _colors.cyan('{bar}') + '| {percentage}% || {value}/{total} Calls',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
});

code_scanning_alerts_note = []
code_scanning_alerts = []



async function getRepos(org) {
    try {
        var repos = []
        repoquery.organizationSlug = org
        delete repoquery['cursor']
        hasNext = true
        while (hasNext) {
            var result = await graphql(repoquery);
            var l = JSON.parse(JSON.stringify(result)).organization.repositories.nodes.length
            repoquery.cursor = result.organization.repositories.pageInfo.endCursor;
            var hasNext = JSON.parse(JSON.stringify(result)).organization.repositories.pageInfo.hasNextPage
            for (j = 0; j < l; j++) {
                repos.push(result.organization.repositories.nodes[j])
            }

        }

        return (repos)

    } catch (error) {
        console.log("Request failed:", error.request);
    }
}

async function getRepoDetails() {
    try {
        metrics_data = []
        var orgarraylogin = await getOrgs()
        //var orgarraylogin = ['upl-ltd']
        const octokit = new Octokit({
            auth: token
        });

        for (var i = 0; i < orgarraylogin.length; i++) {
            console.log("\nGetting the List of Repositories for " + orgarraylogin[i])
            var repos = await getRepos(orgarraylogin[i])
            
            increment = 30
            count = 0
            console.log(Math.ceil(repos.length/increment))

            for (var k = 0; k < Math.ceil(repos.length/increment); k++) {
                let repoPath = []
                for (var j = 0; j < increment; j++) {
                    repoPath[j] = repos[count].owner.login + "/" + repos[count].name
                    if(k == Math.ceil(repos.length/increment)-1 && j == repos.length%increment-1){
                        break
                    }
                    count++
                }
                
                repoData = await Promise.all(repoPath.map((full_name) => {
                    const promise = octokit.request("GET /repos/{owner}/{repo}", {
                        owner: full_name.split("/")[0],
                        repo: full_name.split("/")[1]
                    });
                    return promise;
                }));

                repoCollaborators = await Promise.all(repoPath.map((full_name) => {
                    const promise = octokit.request("GET /repos/{owner}/{repo}/collaborators", {
                        owner: full_name.split("/")[0],
                        repo: full_name.split("/")[1]
                    });
                    return promise;
                }));

                

                for (var j = 0; j < repoData.length; j++) {

                    advanced_security_status = repoData[j].data.security_and_analysis.advanced_security.status
                    secret_scanning_status = repoData[j].data.security_and_analysis.secret_scanning.status
                    push_protection_status = repoData[j].data.security_and_analysis.secret_scanning_push_protection.status
                
                    repoAdmin = repoCollaborators[j].data

                    //console.log(repoAdmin)
                    var repoAdminName = ''

                    for (var z = 0; z < repoAdmin.length; z++) {
                        //console.log(repoAdmin[z].permissions.admin)
                        if ( repoAdmin[z].permissions.admin == true ) {
                            //repoAdminName += repoAdmin[z].login
                            if(repoAdminName == ''){
                                repoAdminName += repoAdmin[z].login
                            }else{
                                repoAdminName += ', ' + repoAdmin[z].login
                            }
                            // repoAdminName = repoAdminName.concat(repoAdmin[z].login, ",")
                            //console.log(repoAdminName)
                        }
                    }

                    metrics_data.push({
                        "repo": repoData[j].data.name,
                        "org": repoData[j].data.owner.login,
                        "advanced_security_status": advanced_security_status,
                        "secret_scanning_status": secret_scanning_status,
                        "push_protection_status": push_protection_status,
                        "repoAdmin": repoAdminName

                    })

                }

            }

        }
        return metrics_data

    } catch (error) {
        console.log("Request failed:", error);
    }
}


async function start() {
    try {
        var orgarraylogin = await getOrgs()

        const MyOctokit = Octokit.plugin(paginateRest);
        const octokit = new MyOctokit({
            auth: token
        });

        for (var i = 0; i < orgarraylogin.length; i++) {
            var orgname = orgarraylogin[i]
            console.log(`\nGetting the List of Security Overview for ${orgname}`)

            const security_alerts = await octokit.paginate("GET /orgs/{orgname}/code-scanning/alerts", {
                orgname: orgname,
                per_page: 100,
            }, response => {
                return response.data
            });

            if (security_alerts.length == 0) {
                console.log(`No Security Alerts for ${orgname}`)
                continue
            } else {
                console.log(`Security Alerts for ${orgname}`)

                for (var j = 0; j < security_alerts.length; j++) {
                    // console.log(security_alerts[j])
                    severity = security_alerts[j].rule.severity
                    security_severity_level = security_alerts[j].rule.security_severity_level

                    console.log(severity + " " + security_severity_level)
                }
            }
        }
    } catch (error) {
        console.log("Request failed:", error.request);
    }
}

//getRepoDetails()

start()

async function main() {
    try {
        let security_data = await getRepoDetails()

        console.log(security_data)

        var fields = ['org', 'repo', 'advanced_security_status', 'secret_scanning_status', "push_protection_status", "repoAdmin"]
        var json2csvParser = new Json2csvParser({
            fields,
            delimiter: ",",
        });

        var security_data_report = json2csvParser.parse(security_data)
        outputFile.push("security_data_report");
        write.sync(outputPath + outputFile[outputFile.length - 1] + ".csv", security_data_report, { newline: true });

    }
    catch (error) {
        console.log("Request failed:", error.request);
    }
}

main()

