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

## Running the project

```shell
node dist/index.js
```

## Usage

```shell
Usage: index.js --command=<command> [options] [--help]

Options:
  --version            Show version number  [boolean]
  --command            Command to run  [string] [required] [choices: "focus-project-candidate-search", "focus-project-candidate-search-complete", "generate-locations", "user-count-search"]
  --record-http-calls  Record HTTP calls to disk for debugging purposes. "Nock back" will be used in `record` mode where the new records will be created. The calls will be stored in the `./nock-records/${command}_${timestamp}` directory.  [boolean] [default: false]
  --log-level          Log level to use.  [string] [default: "info"]
```

## Command `focus-project-candidate-search`

```shell
Usage: index.js focus-project-candidate-search [options]
Run index.js --help for help on common options.
Search for repositories that can be used to identify focus organizations and projects.

Following options are not persisted in process file. They will always be used from the environment variables.
  --github-token             GitHub API token. Token doesn't need any permissions.  [string] [required]
  --data-directory           Data directory to read and store the output.  [string] [required]
  --renew-period-in-days     Number of days to wait until creating a new queue after the latest one is completed.  [number] [default: 7]
  --concurrency              Number of concurrent tasks to process the queue. As this search is IO bound and CPU bound, there can be many concurrent tasks (more than the number of cores). However, because of the rate limiting, there will be a lot of idle tasks. So, it is recommended to keep concurrency low.  [number] [default: 6]
  --per-task-timeout-in-ms   Timeout in milliseconds for each task in the queue.Keeping the timeout too long will end up using too many GitHub actions minutes.Keeping the timeout too short will result in too many errored items.  [number] [default: 30000]
  --rate-limit-stop-percent  Under this rate limit remaining percent, stop the queue.  [number] [default: 10]
  --interval-cap             Max number of tasks to execute in the given interval by interval-in-ms.  [number] [default: 4]
  --interval-in-ms           Interval for the cap in milliseconds.  [number] [default: 20000]
  --retry-count              Number of retries for each task before giving up of creating narrower scoped tasks.  [number] [default: 3]
  --report-period-in-ms      Period in milliseconds to print the queue state to stdout (0 for disabled)  [number] [default: 5000]

Following options are persisted in the process state file. This means, when the process is run for the same process file again later, it will use the values from the file. This is to continue an existing search process. The values passed as arguments will be ignored in that case.
  --min-stars                            Minimum number of stars for a repositories to search for.  [number] [default: 50]
  --min-forks                            Minimum number of forks for a repositories to search for.  [number] [default: 50]
  --min-size-in-kb                       Minimum size of the repositories in KB to search for.  [number] [default: 1000]
  --max-inactivity-days                  Maximum number of days since last commit; ignore repositories that have been inactive for longer than this  [number] [default: 90]
  --exclude-repositories-created-before  The earliest date of repository creation to search for the repositories (format: YYYY-MM-DD)  [string] [default: "2008-01-01"]
  --min-age-in-days                      Minimum number of days since the repository was created; ignore repositories younger than this  [number] [default: 365]
  --search-period-in-days                Length of the date range in days to search for repositories in one call  [number] [default: 5]
  --page-size                            Maximum number of repositories to find in one call  [number] [default: 100]

Options:
  --help     Show help  [boolean]
  --version  Show version number  [boolean]

```

To start the command with defaults but with a short search date range:

```shell
# store the results in a temporary directory
rm -rf /tmp/foo/bar
mkdir -p /tmp/foo/bar

node dist/index.js \
    --command="focus-project-candidate-search" \
    --github-token="$(gh auth token)" \
    --data-directory="/tmp/foo/bar" \
    --min-age-in-days="5700" \
    --log-level="debug"
```

To start the process with recording:

```shell
# store the results in a temporary directory
rm -rf /tmp/foo/bar
mkdir -p /tmp/foo/bar

node dist/index.js \
    --command="focus-project-candidate-search" \
    --github-token="$(gh auth token)" \
    --data-directory="/tmp/foo/bar" \
    --min-age-in-days="5700" \
    --log-level="debug" \
    --record-http-calls="true"
```

### Command `focus-project-candidate-search-complete`

```shell
Usage: index.js focus-project-candidate-search-complete [options]
Run index.js --help for help on common options.
Checks if the latest focus project candidate search is complete and prints the result in the stdout.

Options:
  --help            Show help  [boolean]
  --version         Show version number  [boolean]
  --data-directory  Data directory to check the focus project candidate search files.  [string] [required]
```

You will want to use `--log-level="error"` to see the output and only the output.

```shell
node dist/index.js \
    --command="focus-project-candidate-search-complete" \
    --data-directory="/tmp/foo/bar" \
    --log-level="debug"
```

### Command `generate-locations`

```shell
Usage: index.js generate-locations [options]
Run index.js --help for help on common options.
Generate a JSON file with location information that is to be used in various searches and processes.

Options:
  --help                       Show help  [boolean]
  --version                    Show version number  [boolean]
  --locations-master-file      Path to the master locations file.  [string] [required]
  --locations-additional-file  Path to the additional locations file.  [string] [required]
  --locations-exclude-file     Path to the file that contains locations to exclude.  [string] [required]
  --output-file                Path to the output file.  [string] [required]
```

Example call with test data:
```shell
node dist/index.js \
    --command="generate-locations" \
    --locations-master-file="./src/tasks/locationGeneration/test-data/locations-master.json" \
    --locations-additional-file="./src/tasks/locationGeneration/test-data/locations-additional.json" \
    --locations-exclude-file="./src/tasks/locationGeneration/test-data/locations-exclude.json" \
    --output-file="./src/tasks/locationGeneration/test-data/locations.json"
```

### Command `user-count-search`

```shell
Usage: index.js user-count-search [options]
Run index.js --help for help on common options.
Search for user counts for given search criteria.

Following options are not persisted in process file. They will always be used from the environment variables.
  --github-token             GitHub API token. Token doesn't need any permissions.  [string] [required]
  --data-directory           Data directory to read and store the output.  [string] [required]
  --renew-period-in-days     Number of days to wait until creating a new queue after the latest one is completed.  [number] [default: 7]
  --concurrency              Number of concurrent tasks to process the queue. As this search is IO bound and CPU bound, there can be many concurrent tasks (more than the number of cores). However, because of the rate limiting, there will be a lot of idle tasks. So, it is recommended to keep concurrency low.  [number] [default: 6]
  --per-task-timeout-in-ms   Timeout in milliseconds for each task in the queue.Keeping the timeout too long will end up using too many GitHub actions minutes.Keeping the timeout too short will result in too many errored items.  [number] [default: 30000]
  --rate-limit-stop-percent  Under this rate limit remaining percent, stop the queue.  [number] [default: 10]
  --interval-cap             Max number of tasks to execute in the given interval by interval-in-ms.  [number] [default: 4]
  --interval-in-ms           Interval for the cap in milliseconds.  [number] [default: 20000]
  --retry-count              Number of retries for each task before giving up of creating narrower scoped tasks.  [number] [default: 3]
  --report-period-in-ms      Period in milliseconds to print the queue state to stdout (0 for disabled)  [number] [default: 5000]

Following options are persisted in the process state file. This means, when the process is run for the same process file again later, it will use the values from the file. This is to continue an existing search process. The values passed as arguments will be ignored in that case.
  --location-json-file  Path of the location file. Contents of this file will be used to pass location information in the search query.  [string] [required]
  --min-repositories    Minimum number of repositories that the users should have.  [number] [default: 0]
  --min-followers       Minimum number of followers that the users should have  [number] [default: 0]

Options:
  --help     Show help  [boolean]
  --version  Show version number  [boolean]
```

```shell
# store the results in a temporary directory
rm -rf /tmp/foo/bar
mkdir -p /tmp/foo/bar

# create a location file under that dir
cat > /tmp/foo/bar/location.json <<EOF
{
  "Adana": {
    "text": "Adana",
    "parent": "Turkey",
    "alternatives": [
      "Adana"
    ]
  }
}
EOF

node dist/index.js \
    --command="user-count-search" \
    --github-token="$(gh auth token)" \
    --data-directory="/tmp/foo/bar" \
    --location-json-file="/tmp/foo/bar/location.json" \
    --min-repositories="100"
```

## Running tests

```shell
npm run test
```

## Testing GitHub Actions workflows locally

### Test publish release

```shell
  act --job=publish-release-on-npm \
  -s GITHUB_TOKEN="$(gh auth token)" \
  -s NPM_TOKEN="FAKE TOKEN" \
  --reuse=true \
  --use-gitignore=true \
  --remote-name=origin
```

### Test publish snapshot

```shell
  act --job=publish-snapshot-on-npm \
  -s GITHUB_TOKEN="$(gh auth token)" \
  -s NPM_TOKEN="FAKE TOKEN" \
  --reuse=true \
  --use-gitignore=true \
  --remote-name=origin
```

### Test HTTP call recording

```shell
  act --job=record-sample-http-calls-focus-project \
  -s GITHUB_TOKEN="$(gh auth token)" \
  --reuse=true \
  -s ACTIONS_RUNNER_DEBUG="true" \
  --use-gitignore=true \
  --remote-name=origin
```

### Downloading HTTP call recording

Run the workflow.

Then download the output, such as:

```shell
gh run view 6565769484 --job=17835015583 --log > foo.txt
```

Then manually copy paste some cases to the test fixtures.
