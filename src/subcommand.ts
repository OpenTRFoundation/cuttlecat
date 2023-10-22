import {Arguments} from "./arguments";

export type SubCommand = {
    readonly commandName:string,
    readonly commandDescription:string,
    readonly main:(args:Arguments) => Promise<void>,
}
