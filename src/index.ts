import {cleanEnv, str} from 'envalid'
import loadDynamicImports from "./dynamic-imports";

async function initializeDynamicImports() {
    await loadDynamicImports();
}

async function focusProjectSearch() {
    await initializeDynamicImports();

    await (await import("./focusprojectsearch.js")).main()

}

function buildConfigFromEnvVars() {
    return cleanEnv(process.env, {
        PROCESS: str({
            desc: "Process to run. One of these: [FOCUS_PROJECT_SEARCH]",
        }),
    });
}

async function main() {
    const startTime  = new Date();
    console.log("Starting application.", new Date());

    // To get rid of following warning, which is irrelevant:
    // (node:46005) MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 abort listeners added to [AbortSignal]. Use events.setMaxListeners() to increase limit
    process.setMaxListeners(0);

    const config = buildConfigFromEnvVars();

    switch (config.PROCESS) {
        case "FOCUS_PROJECT_SEARCH":
            await focusProjectSearch();
            break;
        default:
            throw new Error(`Unknown process: ${config.PROCESS}`);
    }

    console.log("Application finished.", new Date());
    console.log("Application took", (new Date().getTime() - startTime.getTime()) / 1000, "seconds");
}

(async () => {
    await main();
})();
