import {buildArguments} from "./arguments";
import loadDynamicImports from "./dynamic-imports";
import nock from "nock";
import {join} from "path";
import {nowTimestamp} from "./utils";
import * as log from "./log";

import {cwd} from 'process';
import {SubCommand} from "./subcommand";

function buildCommands() {
    const commands:{ [key:string]:SubCommand } = {};

    function registerCommand(commandDefinition:SubCommand) {
        if (!commandDefinition) {
            throw new Error(`CommandDefinition is null`);
        }
        commands[commandDefinition.commandName] = commandDefinition;
    }

    registerCommand(require("./commands/focusProjectCandidateSearch/command.js").CommandDefinition);
    registerCommand(require("./commands/focusProjectCandidateSearch/printLatestFileComplete.js").CommandDefinition);
    registerCommand(require("./commands/locationGeneration/command.js").CommandDefinition);
    registerCommand(require("./commands/userCountSearch/command.js").CommandDefinition);

    return commands;
}


async function main() {
    await loadDynamicImports();

    const subCommands = buildCommands();
    const args = buildArguments(subCommands);

    log.setLevel(args.logLevel);

    let logger = log.createLogger("index");

    const startTime = new Date();
    logger.info("Starting application. " + new Date().toString());

    // To get rid of following warning, which is irrelevant:
    // (node:46005) MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 abort listeners added to [AbortSignal]. Use events.setMaxListeners() to increase limit
    process.setMaxListeners(0);

    let doNockDone;
    if (args.recordHttpCalls) {
        logger.info("Recording HTTP calls to disk for debugging purposes.");
        const nockBack = nock.back;

        let fixturesDirectory = join(cwd(), "nock-records");
        logger.info(`Using fixtures directory: ${fixturesDirectory}`);
        nockBack.fixtures = fixturesDirectory;
        nockBack.setMode('record');

        const {nockDone} = await nockBack(`${args.command}_${nowTimestamp()}.json`);
        doNockDone = nockDone;
    }

    await subCommands[args.command].main(args);

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
