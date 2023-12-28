import {readFileSync, writeFileSync} from "fs";
import {v4 as uuidv4} from "uuid";
import winston from "winston";
import {Argv} from "yargs";
import {GetBuiltOptionsType} from "../arguments.js";
import * as log from "../log.js";
import {ProcessFileHelper} from "../processFileHelper.js";
import {SubCommand} from "../subcommand.js";
import {ProcessState} from "./execute.js";

export const CommandDefinition:SubCommand = {
    commandName: "requeue-tasks",
    commandDescription: "Manually requeue tasks for trying them again.",

    addArguments: function (y:Argv):Argv {
        return doAddArguments(y);
    },

    main: async function (args:any) {
        await start(args as Args);
    }
}

export async function start(argv:Args) {
    const logger = log.createLogger("execute");

    const processFileHelper = new ProcessFileHelper(argv.dataDirectory);
    const processStateFilePath = processFileHelper.getProcessStateFilePath(argv.timestamp);

    const processState:ProcessState = JSON.parse(readFileSync(processStateFilePath, "utf8"));

    let found = false;
    switch (argv.requeueType) {
        case "errored":
            found = requeueErrored(processState, logger);
            break;
        case "non-critical-errored":
            found = requeueNonCriticalErrored(processState, logger);
            break;
    }

    if (!found) {
        logger.info(`No tasks found to requeue.`);
        return;
    }

    // NOTE: results in the output is not removed
    // In general, the system that processes the output should be aware of any duplicate results

    processState.completionDate = null;
    processState.completionError = null;
    writeFileSync(processStateFilePath, JSON.stringify(processState, null, 2));
}

function requeueErrored(processState:ProcessState, logger:winston.Logger) {
    let found = false;
    for (const key in processState.errored) {
        const erroredTask = processState.errored[key];

        const newTaskSpec = structuredClone(erroredTask.task);

        const newTaskKey = uuidv4();

        newTaskSpec.id = newTaskKey;
        newTaskSpec.originatingTaskId = erroredTask.task.id;

        processState.unresolved[newTaskKey] = newTaskSpec;

        logger.info(`Requeued task ${newTaskKey} from errored task ${erroredTask.task.id}`);

        found = true;

        // do not delete the existing errored task
    }
    return found;
}

function requeueNonCriticalErrored(processState:ProcessState, logger:winston.Logger) {
    let found = false;
    for (const key in processState.resolved) {
        const resolvedTask = processState.resolved[key];

        if (resolvedTask.nonCriticalError) {
            const newTaskSpec = structuredClone(resolvedTask.task);

            newTaskSpec.id = uuidv4();
            newTaskSpec.originatingTaskId = resolvedTask.task.id;

            processState.unresolved[newTaskSpec.id] = newTaskSpec;
            // do not delete the existing resolved task

            logger.info(`Requeued task ${newTaskSpec.id} from resolved task with nonCriticalError ${resolvedTask.task.id}`);

            found = true;
        }
    }
    return found;
}

type Args = GetBuiltOptionsType<typeof doAddArguments>;

function doAddArguments(y:Argv) {
    return y
        .options({
            "requeue-type": {
                choices: ["errored", "non-critical-errored"] as const,
                desc: "Type of tasks to requeue. 'errored' will requeue all errored tasks. 'non-critical-errored' will requeue tasks that are not in the `errored` bucket, but resolved with non-critical errors.",
                demandOption: true,
            },
            "data-directory": {
                type: "string",
                desc: "Data directory to for the task states and outputs.",
                demandOption: true,
            },
            "timestamp": {
                type: "string",
                desc: "Directory name under data-directory.",
                demandOption: true,
            },
        });
}
