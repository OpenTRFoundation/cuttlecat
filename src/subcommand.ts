import {Argv} from "yargs";

export type SubCommand = {
    readonly commandName:string,
    readonly commandDescription:string,
    addArguments:(y:Argv) => Argv,
    readonly main:(args:any) => Promise<void>,
}
