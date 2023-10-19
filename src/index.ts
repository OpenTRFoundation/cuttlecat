import {bool, cleanEnv, str} from 'envalid'
import loadDynamicImports from "./dynamic-imports";
import nock from "nock";
import {join} from "path";
import {nowTimestamp} from "./utils";
import * as log from "./log";

import {cwd} from 'process';

async function initializeDynamicImports() {
    await loadDynamicImports();
}

async function focusProjectCandidateSearch() {
    await initializeDynamicImports();

    await (await import("./tasks/focusProjectCandidateSearch/process.js")).main();
}

async function printIsLatestFileComplete() {
    await initializeDynamicImports();

    (await import("./tasks/focusProjectCandidateSearch/process.js")).printIsLatestFileComplete();
}

function buildConfigFromEnvVars() {
    return cleanEnv(process.env, {
        PROCESS: str({
            desc: "Process to run. One of these: [FOCUS_PROJECT_CANDIDATE_SEARCH]",
        }),
        RECORD_HTTP_CALLS: bool({
            desc: "Record HTTP calls to disk for debugging purposes.",
            default: false,
        }),
        LOG_LEVEL: str({
            desc: "Enable debug logging.",
            default: "info",
        }),
    });
}

async function main() {
    const config = buildConfigFromEnvVars();
    log.setLevel(config.LOG_LEVEL);

    let logger = log.createLogger("index");

    const startTime = new Date();
    logger.info("Starting application. " + new Date().toString());

    // To get rid of following warning, which is irrelevant:
    // (node:46005) MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 abort listeners added to [AbortSignal]. Use events.setMaxListeners() to increase limit
    process.setMaxListeners(0);

    let doNockDone;
    if (config.RECORD_HTTP_CALLS) {
        logger.info("Recording HTTP calls to disk for debugging purposes.");
        const nockBack = nock.back;

        let fixturesDirectory = join(cwd(), "nock-records");
        logger.info(`Using fixtures directory: ${fixturesDirectory}`);
        nockBack.fixtures = fixturesDirectory;
        nockBack.setMode('record');

        const {nockDone} = await nockBack(`${config.PROCESS}_${nowTimestamp()}.json`);
        doNockDone = nockDone;
    }

    switch (config.PROCESS) {
        case "FOCUS_PROJECT_CANDIDATE_SEARCH":
            await focusProjectCandidateSearch();
            break;
        case "FOCUS_PROJECT_CANDIDATE_SEARCH_LATEST_FILE_COMPLETE":
            await printIsLatestFileComplete();
            break;
        default:
            throw new Error(`Unknown process: ${config.PROCESS}`);
    }

    if (doNockDone) {
        logger.info("Waiting for nock to finish recording HTTP calls to disk.");
        doNockDone();
    }

    logger.info("Application finished. " + new Date().toString());
    logger.info(`Application took ${(new Date().getTime() - startTime.getTime()) / 1000} seconds`);
}

(async () => {
    await main();
})();
