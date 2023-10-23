import {existsSync, readdirSync} from "fs";
import {join} from "path";

export default class FileSystem {
    private readonly dataDirectoryPath:string;
    private readonly processStateFilePrefix:string;
    private readonly processStateFileExtension:string;
    private readonly processOutputFilePrefix:string;
    private readonly processOutputFileExtension:string;

    constructor(dataDirectoryPath:string, processStateFilePrefix:string, processStateFileExtension:string, processOutputFilePrefix:string, processOutputFileExtension:string) {
        this.dataDirectoryPath = dataDirectoryPath;
        this.processStateFilePrefix = processStateFilePrefix;
        this.processStateFileExtension = processStateFileExtension;
        this.processOutputFilePrefix = processOutputFilePrefix;
        this.processOutputFileExtension = processOutputFileExtension;
    }

    getLatestProcessStateFile() {
        // read data directory and find the latest process state file

        if (!existsSync(this.dataDirectoryPath)) {
            throw new Error("Data directory does not exist: " + this.dataDirectoryPath);
        }

        let files = readdirSync(this.dataDirectoryPath);
        files = files.filter((file) => file.startsWith(this.processStateFilePrefix) && file.endsWith(this.processStateFileExtension));
        files.sort();
        if (files.length == 0) {
            return null;
        }
        return join(this.dataDirectoryPath, files[files.length - 1]);
    }

    getPathOfNewProcessStateFile(timestamp:string) {
        return join(this.dataDirectoryPath, this.processStateFilePrefix + timestamp + this.processStateFileExtension);
    }

    getNewProcessOutputFileName(timestamp:string) {
        return this.processOutputFilePrefix + timestamp + this.processOutputFileExtension;
    }

    getOutputFilePath(outputFileName:string) {
        return join(this.dataDirectoryPath, outputFileName);
    }
}

