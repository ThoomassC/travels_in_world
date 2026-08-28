import path from "node:path";
import process from "node:process";
import { formatReport } from "@/content/report";
import { validateContent } from "@/content/validate";
import {
  fromEnvironment,
  isArgumentError,
  optionValue,
  parseArguments,
  spellArgument,
} from "./arguments";

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
  const parsed = parseArguments(argv, {
    valued: [
      { name: "--content", expects: "un dossier" },
      { name: "--public", expects: "un dossier" },
    ],
  });

  if (isArgumentError(parsed)) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}\n`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const [positional, ...extra] = parsed.positionals;
  const optionContentDir = optionValue(parsed, "--content");

  /**
   * Two positional directories, or a positional *and* `--content`, are both the
   * same typo: two answers to one question. Keeping either of them silently is
   * how a run validates something other than what was asked.
   */
  if (extra.length > 0) {
    process.stderr.write(
      `Un seul dossier de contenu à la fois (déjà : ${positional}).\n\n${USAGE}\n`
    );
    return 2;
  }
  if (positional !== undefined && optionContentDir !== undefined) {
    /**
     * Named in the order they were typed: `--content a b` reported "(b et a)",
     * which reads as an accusation against the wrong one of the two.
     */
    const designations = parsed.typed
      .filter((argument) => argument.flag === undefined || argument.flag === "--content")
      .map(spellArgument)
      .join(" et ");
    process.stderr.write(
      `Le dossier de contenu est donné deux fois (${designations}).\n\n${USAGE}\n`
    );
    return 2;
  }

  const validation = validateContent({
    contentDir: path.resolve(
      optionContentDir ?? positional ?? fromEnvironment("TIW_CONTENT_DIR") ?? DEFAULT_CONTENT_DIR
    ),
    publicDir: path.resolve(
      optionValue(parsed, "--public") ?? fromEnvironment("TIW_PUBLIC_DIR") ?? DEFAULT_PUBLIC_DIR
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
