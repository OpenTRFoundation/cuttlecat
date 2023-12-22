import {existsSync, mkdirSync, readdirSync, readFileSync} from "fs";
import {join} from "path";

export const ProcessStateFilePrefix = "state";
export const ProcessStateFileExtension = ".json";
export const ProcessOutputFilePrefix = "output-";
export const ProcessOutputFileExtension = ".json";

 export class ProcessFileHelper {
    private readonly dataDirectoryPath:string;

    constructor(dataDirectoryPath:string) {
        this.dataDirectoryPath = dataDirectoryPath;
    }

    getLatestProcessStateDirectory():string | null {
        // read the data directory and iterate over all directories in it
        // find the latest process state directory (which is the one with the highest timestamp)
        const processStateDirectories = this.getProcessStateDirectories();
        if (processStateDirectories.length == 0) {
            return null;
        }
        return processStateDirectories[processStateDirectories.length - 1];
    }

    getProcessStateDirectories():string[] {
        if (!existsSync(this.dataDirectoryPath)) {
            throw new Error("Data directory does not exist: " + this.dataDirectoryPath);
        }

        const filesAndDirs = readdirSync(this.dataDirectoryPath, {withFileTypes: true});
        const dirs = filesAndDirs.filter((fileOrDir) => fileOrDir.isDirectory());

        const dirPaths = dirs.map((directory) => directory.name);
        dirPaths.sort();

        return dirPaths;
    }

    createProcessStateDirectory(timestamp:string):void {
        const processStateDirectoryPath = join(this.dataDirectoryPath, timestamp);
        if (existsSync(processStateDirectoryPath)) {
            throw new Error("Process state directory already exists: " + processStateDirectoryPath);
        }

        mkdirSync(processStateDirectoryPath, {recursive: true});
    }

    getProcessStateFilePath(timestamp:string) {
        const processStateDirectoryPath = join(this.dataDirectoryPath, timestamp);
        if (!existsSync(processStateDirectoryPath)) {
            throw new Error("Process state directory does not exist: " + processStateDirectoryPath);
        }

        return join(this.dataDirectoryPath, timestamp, ProcessStateFilePrefix + ProcessStateFileExtension);
    }

    readProcessStateFile(timestamp:string):any {
        const processStateFilePath = this.getProcessStateFilePath(timestamp);

        if (!existsSync(processStateFilePath)) {
            return null;
        }

        // read and parse the file
        return JSON.parse(readFileSync(processStateFilePath, "utf8"));
    }

    getProcessOutputFilePath(processStateDir:string, currentRunEndTimestamp:string) {
        const processStateDirectoryPath = join(this.dataDirectoryPath, processStateDir);
        if (!existsSync(processStateDirectoryPath)) {
            throw new Error("Process state directory does not exist: " + processStateDirectoryPath);
        }

        return join(this.dataDirectoryPath, processStateDir, ProcessOutputFilePrefix + currentRunEndTimestamp + ProcessOutputFileExtension);
    }

    getProcessOutputFiles(timestamp:string) {
        const processStateDirectoryPath = join(this.dataDirectoryPath, timestamp);
        if (!existsSync(processStateDirectoryPath)) {
            throw new Error("Process state directory does not exist: " + processStateDirectoryPath);
        }

        let files = readdirSync(processStateDirectoryPath);
        files = files.filter((file) => file.startsWith(ProcessOutputFilePrefix) && file.endsWith(ProcessOutputFileExtension));
        files.sort();

        return files;
    }

}

