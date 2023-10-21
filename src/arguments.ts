import yargs from "yargs/yargs";
import {SubCommand} from "./subcommand";

export interface Arguments {
    command:string,
    recordHttpCalls:boolean,
    logLevel:string,
}

export function buildArguments(subCommands:{ [key:string]:SubCommand }):Arguments {
    return yargs(process.argv.slice(2))
        .usage("Usage: $0 --command=<command> [options] [--help]")
        .options({
            "command": {
                type: "string",
                desc: "Command to run",
                choices: Object.keys(subCommands),
                demandOption: true,
                global: true,
            },
            "record-http-calls": {
                type: "boolean",
                desc:
                    "Record HTTP calls to disk for debugging purposes. " +
                    "\"Nock back\" will be used in `record` mode where the new records will be created. " +
                    "The calls will be stored in the `./nock-records/${command}_${timestamp}` directory.",
                default: false,
                global: true,
            },
            "log-level": {
                type: "string",
                desc: "Log level to use.",
                default: "info",
                global: true,
            },
        })
        .help(false)        // hide default help in main command
        .wrap(null)
        .parseSync();
}
