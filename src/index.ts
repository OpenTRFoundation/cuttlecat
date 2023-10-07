import loadDynamicImports from "./dynamic-imports";

async function initializeDynamicImports() {
    await loadDynamicImports();
}

async function focusProjectSearch() {
    await initializeDynamicImports();

    await (await import("./focusprojectsearch.js")).main()

}

async function main(){
    console.log("Starting application.");
    //TODO: some logic to choose focusProjectSearch()

    // TODO: (node:46005) MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 abort listeners added to [AbortSignal]. Use events.setMaxListeners() to increase limit
    process.setMaxListeners(0);

    return await focusProjectSearch();
}

(async () => {
    await main();
})();
