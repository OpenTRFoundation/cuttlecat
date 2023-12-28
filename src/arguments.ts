import yargs, {ArgumentsCamelCase, Argv} from "yargs";

type GetReturnType<Type> = Type extends (...args:never[]) => infer Return
    ? Return
    : never;
type ExtractOptionsType<YargsType> = YargsType extends Argv<infer Type> ? Type : never;

// with this, we can build a type that is the same as the type of the options
// that are returned by the yargs.options() call.
// this is useful, because this would provide compile time checking when using the options.
export type GetBuiltOptionsType<T> = ArgumentsCamelCase<ExtractOptionsType<GetReturnType<T>>>

export function getYargs() {
    return yargs(process.argv.slice(2))
        .usage("Usage: $0 <command> [options]")
        .strictCommands()
        .demandCommand(1, 1, "You need to specify a command.", "You can only specify one command.")
        .wrap(null);
}
