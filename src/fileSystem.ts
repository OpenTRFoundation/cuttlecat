import {readdirSync} from "fs";
import {join} from "path";
import {nowTimestamp} from "./utils";

export default class FileSystem {
    private readonly workingDirectoryPath:string;
    private readonly dataDirectoryPath:string;
    private readonly processStateFilePrefix:string;
    private readonly processStateFileExtension:string;
    private readonly processOutputFilePrefix:string;
    private readonly processOutputFileExtension:string;

    constructor(workingDirectoryPath:string, dataDirectoryPath:string, processStateFilePrefix:string, processStateFileExtension:string, processOutputFilePrefix:string, processOutputFileExtension:string) {
        this.workingDirectoryPath = workingDirectoryPath;
        this.dataDirectoryPath = dataDirectoryPath;
        this.processStateFilePrefix = processStateFilePrefix;
        this.processStateFileExtension = processStateFileExtension;
        this.processOutputFilePrefix = processOutputFilePrefix;
        this.processOutputFileExtension = processOutputFileExtension;
    }

    getDataDirectoryAbsolutePath() {
        return join(this.workingDirectoryPath, this.dataDirectoryPath);
    }

    getLatestProcessStateFile() {
        // read data directory and find the latest process state file
        // process state files start with "process-state-" and end with ".json"
        let dataDirAbs = this.getDataDirectoryAbsolutePath();
        let files = readdirSync(dataDirAbs);
        files = files.filter((file) => file.startsWith(this.processStateFilePrefix) && file.endsWith(this.processStateFileExtension));
        files.sort();
        if (files.length == 0) {
            return null;
        }
        return join(dataDirAbs, files[files.length - 1]);
    }

    getPathOfNewProcessStateFile() {
        let dataDirAbs = this.getDataDirectoryAbsolutePath();
        const timestamp = nowTimestamp();
        return join(dataDirAbs, this.processStateFilePrefix + timestamp + this.processStateFileExtension);
    }

    getNewProcessOutputFileName() {
        const timestamp = nowTimestamp();
        return this.processOutputFilePrefix + timestamp + this.processOutputFileExtension;
    }

    getOutputFilePath(outputFileName:string) {
        return join(this.getDataDirectoryAbsolutePath(), outputFileName);
    }
}

