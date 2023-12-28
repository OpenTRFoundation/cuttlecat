#!/usr/bin/env node

import {getYargs} from "./arguments.js";
import {SubCommand} from "./subcommand.js";

import {CommandDefinition as ExecuteCommandDefinition} from "./subcommand/execute.js";
import {CommandDefinition as LatestQueueCompleteCommandDefinition} from "./subcommand/latestQueueComplete.js";
import {CommandDefinition as RequeueTasksCommandDefinition} from "./subcommand/requeueTasks.js";

function buildCommands() {
    // NOTE: keep sorted
    const commands:{ [key:string]:SubCommand } = {
        [ExecuteCommandDefinition.commandName]: ExecuteCommandDefinition,
        [LatestQueueCompleteCommandDefinition.commandName]: LatestQueueCompleteCommandDefinition,
        [RequeueTasksCommandDefinition.commandName]: RequeueTasksCommandDefinition,
    };

    return commands;
}

async function main() {
    const subCommands = buildCommands();

    let y = getYargs();

    for (const subCommand of Object.values(subCommands)) {
        y = y.command(
            subCommand.commandName,
            subCommand.commandDescription,
            (y_cmd) => {
                y_cmd = y_cmd
                    .usage(`Usage: $0 ${subCommand.commandName} [options]`)
                    .usage(`Run $0 --help for help on common options.`)
                    .usage(subCommand.commandDescription)
                subCommand.addArguments(y_cmd)
            });
    }

    const args = y.parseSync();

    const commandToRun = args._[0];

    await subCommands[commandToRun].main(args);
}

(async () => {
    await main();
})();
