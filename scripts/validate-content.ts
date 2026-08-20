import path from "node:path";
import process from "node:process";
import { formatReport } from "@/content/report";
import { validateContent } from "@/content/validate";

/**
 * `npm run validate:content` — the build's gate on hand-written content.
 *
 * A thin transport layer, on purpose: it reads arguments, calls
 * `validateContent`, prints what `formatReport` gives it and chooses an exit
 * code. Every judgement and every sentence lives in `src/content/**`, where it is
 * tested without spawning a process.
 *
 * Run through `node --import ./scripts/runtime/register-typescript.mts` (see that
 * file), so this stays TypeScript that `npm run typecheck` and `npm run lint`
 * cover like the rest of the repository.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const DEFAULT_CONTENT_DIR = path.join(REPO_ROOT, "content", "trips");
const DEFAULT_PUBLIC_DIR = path.join(REPO_ROOT, "public");

const USAGE = `Usage : npm run validate:content -- [dossier] [options]

Valide chaque voyage de content/trips/ : structure du fichier, cohérence de
l'itinéraire, présence des photos sur le disque. Rapporte tous les problèmes,
fichier par fichier, et sort en 1 s'il en reste un.

Arguments
  [dossier]             Dossier des voyages, un sous-dossier par voyage.
                        Par défaut : content/trips

Options
  --content <dossier>   Le même dossier, sous forme d'option.
  --public <dossier>    Racine à laquelle les chemins de photos (« /photos/... »)
                        se résolvent. Par défaut : public
  -h, --help            Affiche cette aide.

Variables d'environnement
  TIW_CONTENT_DIR       Dossier des voyages, si aucun argument ne le donne.
  TIW_PUBLIC_DIR        Racine des photos, si --public ne la donne pas.
                        Un argument explicite l'emporte sur l'environnement.

Exemple
  npm run validate:content -- tests/fixtures/content/valid-trip/trips \\
    --public tests/fixtures/content/valid-trip/public`;

type Arguments = {
  readonly contentDir?: string;
  readonly publicDir?: string;
  readonly help: boolean;
};

type ArgumentError = { readonly error: string };

function parseArguments(argv: readonly string[]): Arguments | ArgumentError {
  let contentDir: string | undefined;
  let publicDir: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";

    // `npm run validate:content -- ""` passes one empty argument. Resolving it
    // would silently point the run at the working directory.
    if (argument === "") {
      continue;
    }

    if (argument === "-h" || argument === "--help") {
      help = true;
      continue;
    }

    // `--content=x` and `--content x` are both spellings people type; accepting
    // only one of them is a paper cut on a command run by hand.
    const [flag, inlineValue] =
      argument.startsWith("--") && argument.includes("=")
        ? [argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1)]
        : [argument, undefined];

    if (flag === "--content" || flag === "--public") {
      const value = inlineValue ?? argv[index + 1];
      /**
       * The empty string is refused, not accepted: `--content=` resolved to the
       * working directory, and the script then walked the whole repository —
       * `.git`, `node_modules`, `src` — reporting each folder as an unfinished
       * trip. It covers `--content ""` too, which is the same mistake typed
       * differently.
       */
      if (value === undefined || value === "" || value.startsWith("-")) {
        return { error: `L'option ${flag} attend un dossier.` };
      }
      if (inlineValue === undefined) {
        index += 1;
      }
      const already = flag === "--content" ? contentDir : publicDir;
      // Two positional arguments were already refused; silently keeping the last
      // of two options was the same mistake going unnoticed.
      if (already !== undefined) {
        return { error: `L'option ${flag} est donnée deux fois (déjà : ${already}).` };
      }
      if (flag === "--content") {
        contentDir = value;
      } else {
        publicDir = value;
      }
      continue;
    }

    if (argument.startsWith("-")) {
      return { error: `Option inconnue : ${argument}` };
    }

    if (contentDir !== undefined) {
      return { error: `Un seul dossier de contenu à la fois (déjà : ${contentDir}).` };
    }
    contentDir = argument;
  }

  return { contentDir, publicDir, help };
}

/** An environment variable, ignoring the empty string an unset variable becomes. */
function fromEnvironment(name: string): string | undefined {
  const value = process.env[name];

  return value === undefined || value.trim() === "" ? undefined : value;
}

/**
 * Colour only for a human at a terminal. CI captures this output into a log
 * file, where escape sequences turn an error message into noise; `NO_COLOR` is
 * the cross-tool convention for asking even a terminal to stay plain.
 *
 * Not named `useColor`: `react-hooks/rules-of-hooks` reads a `use` prefix as a
 * hook and refuses the call — measured, and a fair complaint.
 */
function wantsColor(stream: { readonly isTTY?: boolean | undefined }): boolean {
  return stream.isTTY === true && fromEnvironment("NO_COLOR") === undefined;
}

function main(argv: readonly string[]): number {
  const parsed = parseArguments(argv);

  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}\n`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const validation = validateContent({
    contentDir: path.resolve(
      parsed.contentDir ?? fromEnvironment("TIW_CONTENT_DIR") ?? DEFAULT_CONTENT_DIR
    ),
    publicDir: path.resolve(
      parsed.publicDir ?? fromEnvironment("TIW_PUBLIC_DIR") ?? DEFAULT_PUBLIC_DIR
    ),
    repoRoot: REPO_ROOT,
  });

  const failed = validation.findings.length > 0;
  const stream = failed ? process.stderr : process.stdout;
  stream.write(`${formatReport(validation, { color: wantsColor(stream) })}\n`);

  return failed ? 1 : 0;
}

/**
 * `exitCode` rather than `exit()`: the latter can truncate a write to a pipe that
 * has not flushed, which would lose the very message this script exists to
 * print.
 */
process.exitCode = main(process.argv.slice(2));
