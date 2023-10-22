import {readFileSync} from "fs";
import {Arguments} from "../../arguments";
import yargs from "yargs/yargs";
import {getFileSystem} from "./command";

export const commandName = "focus-project-candidate-search-complete";
export const commandDescription = "Checks if the latest focus project candidate search is complete and prints the result in the stdout.";

export async function main(mainConfig:Arguments) {
    const config = yargs(process.argv.slice(2))
        .usage(`Usage: $0 ${commandName} [options]`)
        .usage(`Run $0 --help for help on common options.`)
        .usage(commandDescription)
        .options({
            "data-directory": {
                type: "string",
                desc: "Data directory to check the focus project candidate search files.",
                demandOption: true,
            },
        })
        .wrap(null)
        .parseSync();

    await printIsLatestFileComplete(config.dataDirectory);
}

export async function printIsLatestFileComplete(dataDirectory:string) {
    const fileSystem = getFileSystem(dataDirectory);
    const latestProcessStateFile = fileSystem.getLatestProcessStateFile();
    if (latestProcessStateFile == null) {
        // do not use logger here, as the caller will use the process output
        console.log("true");
        return;
    }

    const processState = JSON.parse(readFileSync(latestProcessStateFile, "utf8"));

    // do not use logger here, as the caller will use the process output
    console.log(processState.completionDate != null);
}
