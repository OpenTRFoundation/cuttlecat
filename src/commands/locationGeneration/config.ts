import yargs from "yargs/yargs";
import {commandDescription, commandName} from "./generate";

export interface Config {
    locationsMasterFile:string;
    locationsAdditionalFile:string;
    locationsExcludeFile:string;
    outputFile:string;
}

export function buildConfig():Config {
    return yargs(process.argv.slice(2))
        .usage(`Usage: $0 ${commandName} [options]`)
        .usage(`Run $0 --help for help on common options.`)
        .usage(commandDescription)
        .options({
            "locations-master-file": {
                type: "string",
                desc: "Path to the master locations file.",
                demandOption: true,
            },
            "locations-additional-file": {
                type: "string",
                desc: "Path to the additional locations file.",
                demandOption: true,
            },
            "locations-exclude-file": {
                type: "string",
                desc: "Path to the file that contains locations to exclude.",
                demandOption: true,
            },
            "output-file": {
                type: "string",
                desc: "Path to the output file.",
                demandOption: true,
            },
        })
        .wrap(null)
        .parseSync();
}
