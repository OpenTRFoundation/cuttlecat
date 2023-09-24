import loadDynamicImports from "./dynamic-imports";

async function initializeDynamicImports() {
    await loadDynamicImports();
}

async function focusProjectSearch() {
    await initializeDynamicImports();

    // (await import("./focusprojectsearch.js")).main()

}

async function main(){
    console.log("Starting application.");
    //TODO: some logic to choose focusProjectSearch()

    return await focusProjectSearch();
}

(async () => {
    await main();
})();
