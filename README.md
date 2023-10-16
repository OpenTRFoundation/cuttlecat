# CuttleCat - Collect information from GitHub

TODO: Project description, purpose, etc.

## Building the project

```shell
# switch to the correct node version in .nvrmc
nvm use
# install dependencies
npm install
# build the project
npm run build
```

## Usage

```shell
PROCESS=<process name> \
OTHER_PARAMETERS=... \
npm run start
```

`PROCESS` can be one of the following:

- `FOCUS_PROJECT_SEARCH` - search for projects that match the criteria

### Process `FOCUS_PROJECT_SEARCH`

Supports the following environment variables:

| Name                              | Description                                                                                                       | Default value | Persisted |
|-----------------------------------|-------------------------------------------------------------------------------------------------------------------|---------------|-----------|
| `GITHUB_TOKEN`                    | GitHub API token. Token doesn't need any permissions.                                                             | N/A           | No        |
| `DATA_DIRECTORY`                  | Data directory to read and store the output.                                                                      | N/A           | No        |
| `RENEW_PERIOD_IN_DAYS`            | if previous queue is completed, create the next one after RENEW_PERIOD_IN_DAYS days                               | 7             | No        |
| `CONCURRENCY`                     | number of concurrent tasks                                                                                        | 6             | No        |
| `PER_TASK_TIMEOUT_IN_MS`          | timeout for each task                                                                                             | 30000         | No        |
| `RATE_LIMIT_STOP_PERCENT`         | if rate limit remaining is less than RATE_LIMIT_STOP_PERCENT * rate limit (typically 1000) / 100, stop the queue. | 10            | No        |
| `INTERVAL_CAP`                    | max number of tasks to execute in one interval                                                                    | 4             | No        |
| `INTERVAL_IN_MS`                  | interval for the cap in milliseconds                                                                              | 20000         | No        |
| `RETRY_COUNT`                     | number of retries for each task before giving up                                                                  | 3             | No        |
| `REPORT_PERIOD_IN_MS`             | period to print the queue state (0 for disabled)                                                                  | 5000          | No        |
|                                   |                                                                                                                   |               |           |
| `MIN_STARS`                       | minimum number of stars                                                                                           | 50            | Yes       |
| `MIN_FORKS`                       | minimum number of forks                                                                                           | 50            | Yes       |
| `MIN_SIZE_IN_KB`                  | minimum size in KB                                                                                                | 1000          | Yes       |
| `MAX_INACTIVITY_DAYS`             | maximum number of days since last commit; ignore projects that have been inactive for longer than this            | 90            | Yes       |
| `EXCLUDE_PROJECTS_CREATED_BEFORE` | exclude projects created before this date (format: YYYY-MM-DD)                                                    | 2008-01-01    | Yes       |
| `MIN_AGE_IN_DAYS`                 | minimum number of days since the project was created; ignore projects younger than this                           | 365           | Yes       |
| `SEARCH_PERIOD_IN_DAYS`           | Number of days to search for projects in one call                                                                 | 5             | Yes       |
| `PAGE_SIZE`                       | Max number of projects to return in one call                                                                      | 100           | Yes       |

The options marked as `Yes` in the `Persisted` column are persisted in the process state file. This means, when the
process is run again for the same process file again later, it will use the values from the file. This is to continue a
search process. Those values will only be used if there's a new process file created.

The options marked as `No` in the `Persisted` column will always be used from the environment variables.

The output will be written to the `./data/focus-project-search` directory.

To start the process with defaults:

```shell
# store the results in a temporary directory
mkdir -p /tmp/foo/bar

GITHUB_TOKEN="$(gh auth token)" \
DATA_DIRECTORY="/tmp/foo/bar" \
PROCESS="FOCUS_PROJECT_SEARCH" \
MIN_AGE_IN_DAYS=5700 \
npm run start
```

## Running tests

```shell
npm run test
```

## Testing GitHub Actions workflows locally

### Test release

```shell
  act --job=publish-on-npm \
  -s GITHUB_TOKEN="$(gh auth token)" \
  -s NPM_TOKEN="FAKE TOKEN" \
  --reuse=true \
  --use-gitignore=true \
  --remote-name=origin
```
