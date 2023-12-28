import {readFileSync} from "fs";
import {Argv} from "yargs";
import {GetBuiltOptionsType} from "../arguments.js";
import {ProcessFileHelper} from "../processFileHelper.js";
import {SubCommand} from "../subcommand.js";

export const CommandDefinition:SubCommand = {
    commandName: "latest-queue-complete",
    commandDescription: "Checks if the latest queue is marked as complete and prints the result in the stdout.",

    addArguments: function (y:Argv):Argv {
        return doAddArguments(y);
    },

    main: async function (args:any) {
        await start(args as Args);
    }
}

export async function start(argv:Args) {
    const output = printIsLatestFileComplete(argv.dataDirectory);

    // do not use logger here, as the caller will use the process output
    console.log(output);
}

export function printIsLatestFileComplete(dataDirectory:string) {
    const processFileHelper = new ProcessFileHelper(dataDirectory);
    const latestProcessStateDirectory = processFileHelper.getLatestProcessStateDirectory();
    if (latestProcessStateDirectory == null) {
        return true;
    }

    const processStateFilePath = processFileHelper.getProcessStateFilePath(latestProcessStateDirectory);

    const processState = JSON.parse(readFileSync(processStateFilePath, "utf8"));

    return processState.completionDate != null;
}

type Args = GetBuiltOptionsType<typeof doAddArguments>;

function doAddArguments(y:Argv) {
    return y
        .example("NOTE:", "Examples below are not executable commands, they are just examples of how to use the command.")
        .example(
            "--data-directory=/path/to/data/directory",
            "Check if the latest state file in the given directory was complete. After you start another queue that produces " +
            "a state file, you can run this command to check if it is complete. This command writes true or false to stdout, which can be" +
            "used in a script to determine if the previous queue was done."
        )
        .options({
            "data-directory": {
                type: "string",
                desc: "Data directory to check the process files.",
                demandOption: true,
            },
        });
}
