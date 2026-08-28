import process from "node:process";
import { quoted, runCommand } from "@/content/finding";

/**
 * Argument parsing shared by the content commands (`validate:content`, `geocode`,
 * `new-trip`).
 *
 * It exists because the *interesting* part of parsing these arguments is not the
 * loop, it is a handful of refusals that were each measured on the real command
 * and each cost something the first time:
 *
 * - `--content=` and `--content ""` resolve to the working directory, and
 *   `validate:content` then walked `.git`, `node_modules` and `src`, reporting
 *   every folder as an unfinished trip;
 * - `--content a --content b` silently kept one of the two;
 * - `--content=x` and `--content x` are both spellings people type, and accepting
 *   only one is a paper cut on a command run by hand;
 * - `npm run … -- ""` passes one empty argument, which is not a positional.
 *
 * Writing that three times is how two of the three end up with only two of the
 * four. The per-command *meaning* of the arguments stays in each script, which is
 * where it belongs.
 */

/** An option that takes a value, and the noun its error message uses. */
export type ValuedOption = {
  readonly name: string;
  /** Completes "L'option --content attend …" — e.g. `"un dossier"`. */
  readonly expects: string;
  /** When true, the option may be given several times, and order is kept. */
  readonly repeatable?: boolean;
};

export type ArgumentSpec = { readonly valued: readonly ValuedOption[] };

/** One argument as it was typed; a positional carries no `flag`. */
export type TypedArgument = { readonly flag?: string; readonly value: string };

export type ParsedArguments = {
  readonly positionals: readonly string[];
  /** Values per option name, in the order they were given. */
  readonly options: ReadonlyMap<string, readonly string[]>;
  /**
   * Every value-bearing argument in the order it was typed. `positionals` and
   * `options` each lose that order, so a message naming one of each — "the
   * content directory is given twice" — could only guess, and guessed wrong.
   */
  readonly typed: readonly TypedArgument[];
  readonly help: boolean;
};

export type ArgumentError = { readonly error: string };

export function isArgumentError(parsed: ParsedArguments | ArgumentError): parsed is ArgumentError {
  return "error" in parsed;
}

export function parseArguments(
  argv: readonly string[],
  spec: ArgumentSpec
): ParsedArguments | ArgumentError {
  const positionals: string[] = [];
  const options = new Map<string, string[]>();
  const typed: TypedArgument[] = [];
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";

    // `npm run … -- ""` passes one empty argument. Treating it as a positional
    // would silently point the run at the working directory.
    if (argument === "") {
      continue;
    }

    if (argument === "-h" || argument === "--help") {
      help = true;
      continue;
    }

    const equals = argument.startsWith("--") ? argument.indexOf("=") : -1;
    const [flag, inlineValue] =
      equals === -1
        ? [argument, undefined]
        : [argument.slice(0, equals), argument.slice(equals + 1)];

    const option = spec.valued.find((candidate) => candidate.name === flag);
    if (option !== undefined) {
      const value = inlineValue ?? argv[index + 1];
      /**
       * The empty string is refused rather than accepted, and so is a value that
       * looks like the next option: `--content --public x` would otherwise
       * consume `--public` as a directory name.
       */
      if (value === undefined || value === "" || value.startsWith("-")) {
        return { error: `L'option ${flag} attend ${option.expects}.` };
      }
      if (inlineValue === undefined) {
        index += 1;
      }
      const already = options.get(flag);
      if (already === undefined) {
        options.set(flag, [value]);
        typed.push({ flag, value });
        continue;
      }
      if (option.repeatable !== true) {
        return { error: `L'option ${flag} est donnée deux fois (déjà : ${already[0]}).` };
      }
      already.push(value);
      typed.push({ flag, value });
      continue;
    }

    if (argument.startsWith("-")) {
      return { error: `Option inconnue : ${argument}` };
    }

    positionals.push(argument);
    typed.push({ value: argument });
  }

  return { positionals, options, typed, help };
}

/* ------------------------------------------- the `--` npm eats ---------------- */

/**
 * `npm run <script> --pick 1` never reaches the script with `--pick`.
 *
 * npm consumes anything that looks like one of its own config flags before the
 * script sees argv, and forwards only what is left. Measured on npm 11, for
 * `npm run geocode japon-2024 …`:
 *
 *   typed                | forwarded            | what the author gets
 *   ---------------------|----------------------|---------------------------------
 *   `--pick 1`           | `japon-2024 1`       | "a second trip named 1"
 *   `--pick=1`           | `japon-2024`         | nothing at all, silently
 *   `--content=/tmp/bac` | `japon-2024`         | the *real* content/trips, silently
 *   `--help`             | (npm never runs it)  | npm's own help, in English
 *   `-- --pick 1`        | `japon-2024 --pick 1`| what was meant
 *
 * The `=` rows are undetectable from inside the script: the argument is simply
 * not there. The first row, however, has a signature — a bare positional that
 * looks like the *value* of an option nobody passed — and the two helpers below
 * turn that signature into a sentence naming the cause.
 *
 * `validate:content` documented `npm run validate:content -- …` from the start;
 * `geocode` and `new-trip` were written without it. Keeping this in one place is
 * what stops the third command from repeating it.
 */

/** An option npm is known to eat, and the shape of the value it leaves behind. */
export type SwallowableOption = {
  readonly name: string;
  /** Matched against the stray positional: `/^\d+$/` for a candidate number. */
  readonly valueLooksLike: RegExp;
};

/**
 * The option npm probably ate, or `undefined` when nothing points at one.
 *
 * An option that *was* given disqualifies itself: someone who typed the `--`
 * correctly and then named two trips deserves the plain refusal, not a guess.
 */
export function swallowedOption(
  parsed: ParsedArguments,
  stray: string,
  candidates: readonly SwallowableOption[]
): SwallowableOption | undefined {
  return candidates.find(
    (candidate) =>
      candidate.valueLooksLike.test(stray) && optionValues(parsed, candidate.name).length === 0
  );
}

/**
 * The refusal for a second positional — and, when the stray argument carries the
 * signature above, the reason it is there and the line to type instead.
 *
 * The command name is passed in rather than derived from `process.argv[1]`: the
 * script is run through a `node --import` wrapper, so `argv[1]` is a path inside
 * `scripts/`, which is not what anyone typed.
 */
export function tooManyPositionals(refusal: {
  readonly script: string;
  readonly first: string;
  readonly stray: string;
  readonly swallowed?: SwallowableOption | undefined;
}): string {
  const { script, first, stray, swallowed } = refusal;
  const plain = `Un seul voyage à la fois (déjà : ${first}) — le second argument est ${quoted(stray)}.`;

  if (swallowed === undefined) {
    return plain;
  }

  const meant = `${swallowed.name} ${stray}`;

  return (
    `${plain}\n` +
    `Si tu voulais ${quoted(meant)}, npm l'a avalé : ` +
    `${runCommand(`npm run ${script} -- ${first} ${meant}`, "écris")}.`
  );
}

/** An argument as its author would recognise it: `--content a`, or plain `b`. */
export function spellArgument(argument: TypedArgument): string {
  return argument.flag === undefined ? argument.value : `${argument.flag} ${argument.value}`;
}

/** The single value of an option, or `undefined` when it was not given. */
export function optionValue(parsed: ParsedArguments, name: string): string | undefined {
  return parsed.options.get(name)?.[0];
}

/** Every value of a repeatable option, in the order they were given. */
export function optionValues(parsed: ParsedArguments, name: string): readonly string[] {
  return parsed.options.get(name) ?? [];
}

/** An environment variable, ignoring the empty string an unset variable becomes. */
export function fromEnvironment(name: string): string | undefined {
  const value = process.env[name];

  return value === undefined || value.trim() === "" ? undefined : value;
}
