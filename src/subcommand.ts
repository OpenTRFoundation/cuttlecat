import {Arguments} from "./arguments";

export interface SubCommand {
    commandName:string,
    commandDescription:string,
    main:(args:Arguments) => Promise<void>,
}
