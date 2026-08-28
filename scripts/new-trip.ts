import path from "node:path";
import process from "node:process";
import { createTrip } from "@/content/scaffold";
import { quoted, runCommand } from "@/content/finding";
import {
  fromEnvironment,
  isArgumentError,
  optionValue,
  parseArguments,
  swallowedOption,
  tooManyPositionals,
} from "./arguments";
import type { SwallowableOption } from "./arguments";

/**
 * `npm run new-trip <slug>` — the first thirty seconds of a new trip.
 *
 * A thin transport layer, like `validate-content.ts`: it reads arguments, calls
 * `createTrip`, prints and picks an exit code. The skeleton itself and every
 * refusal live in `src/content/scaffold.ts`, where they are tested without
 * spawning a process.
 *
 * **Streams: every refusal on stderr, the success on stdout** — and that is
 * knowingly different from `scripts/geocode.ts`, which puts its failures on
 * stdout too. The two commands are not the same shape of output. A `geocode` run
 * is a transcript: a dozen interleaved lines where the order *is* the meaning, so
 * splitting it across two streams destroys it. A `new-trip` run is one verdict —
 * a file was created, or it was not — and that verdict belongs on the stream
 * built for it, so that `npm run new-trip … > /dev/null` still shows a refusal
 * and a script can test the outcome with a redirection rather than a grep.
 *
 * The visible consequence, accepted rather than discovered: `2>/dev/null` hides a
 * `new-trip` failure and hides nothing of a `geocode` one. Aligning the two would
 * mean either breaking the transcript or pushing a one-line verdict onto the
 * stream nobody reads, and neither is an improvement.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const DEFAULT_CONTENT_DIR = path.join(REPO_ROOT, "content", "trips");

const USAGE = `Usage : npm run new-trip -- <slug> [options]

Le « -- » n'est pas décoratif : sans lui, npm garde les options pour lui. Un
« --content /tmp/bac » arrive alors comme un second voyage nommé « /tmp/bac », et
un « --content=/tmp/bac » disparaît sans un mot — le voyage est créé dans le vrai
content/trips du dépôt. Sans option, le « -- » est inutile.

Crée content/trips/<slug>/trip.yaml : un squelette commenté, prêt à remplir, et
volontairement incomplet — les villes n'ont pas de coordonnées. C'est
« npm run geocode <slug> » qui les écrit, et « npm run validate:content » qui le
rappelle en attendant.

Refuse d'écraser un voyage existant.

Arguments
  <slug>                Le slug du voyage : minuscules, chiffres et traits
                        d'union (« japon-2024 »). C'est le nom du dossier et
                        l'URL de la page.

Options
  --content <dossier>   Dossier des voyages. Par défaut : content/trips
  -h, --help            Affiche cette aide. Avec le « -- », donc :
                        « npm run new-trip -- --help ».

Variables d'environnement
  TIW_CONTENT_DIR       Dossier des voyages, si --content ne le donne pas. C'est
                        la façon sûre de viser un autre dossier : npm ne l'avale
                        pas.

Exemple
  npm run new-trip japon-2024
  npm run new-trip -- japon-2024 --content /tmp/bac-a-sable
  npm run geocode japon-2024
  npm run validate:content`;

const SLUG_RULE = "minuscules, chiffres et traits d'union, sans accent ni espace";

/**
 * The one option npm eats here, and the shape of the value it leaves behind as a
 * stray positional: a directory, so anything carrying a path separator. A slug is
 * lowercase letters, digits and hyphens, so the two shapes never overlap.
 */
const SWALLOWABLE: readonly SwallowableOption[] = [
  { name: "--content", valueLooksLike: /[/\\~.]/ },
];

/**
 * The day the trip is dated, read from the machine's **local** calendar.
 *
 * `toISOString()` would be UTC, which in Auckland or Santiago is the wrong day
 * for most of the day — and the date this writes is the one an author reads as
 * "today". No `Date` arithmetic is involved, only the three civil fields, which
 * is the same discipline `src/domain/geo.ts` documents.
 */
function today(now: Date): string {
  const year = now.getFullYear().toString().padStart(4, "0");
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function main(argv: readonly string[]): number {
  const parsed = parseArguments(argv, {
    valued: [{ name: "--content", expects: "un dossier" }],
  });

  if (isArgumentError(parsed)) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}\n`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const [slug, ...extra] = parsed.positionals;

  if (slug === undefined) {
    process.stderr.write(`Il manque le slug du voyage.\n\n${USAGE}\n`);
    return 2;
  }
  const stray = extra[0];
  if (stray !== undefined) {
    process.stderr.write(
      `${tooManyPositionals({
        script: "new-trip",
        first: slug,
        stray,
        swallowed: swallowedOption(parsed, stray, SWALLOWABLE),
      })}\n\n${USAGE}\n`
    );
    return 2;
  }

  const contentDir = path.resolve(
    optionValue(parsed, "--content") ?? fromEnvironment("TIW_CONTENT_DIR") ?? DEFAULT_CONTENT_DIR
  );

  const outcome = createTrip({
    contentDir,
    repoRoot: REPO_ROOT,
    slug,
    today: today(new Date()),
  });

  switch (outcome.state) {
    case "invalid-slug":
      process.stderr.write(
        `${quoted(outcome.slug)} n'est pas un slug valide : ${SLUG_RULE}.\n` +
          `Par exemple : japon-2024, perou-2023.\n`
      );
      return 2;

    case "exists":
      process.stderr.write(
        `${outcome.file} existe déjà : ce voyage n'a pas été touché.\n` +
          `Choisis un autre slug, ou modifie le fichier à la main.\n`
      );
      return 1;

    case "failed":
      process.stderr.write(`${outcome.file} n'a pas pu être créé : ${outcome.reason}\n`);
      return 1;

    case "created":
      process.stdout.write(
        `${outcome.file} créé.\n\n` +
          `Remplis les noms de villes et leur code pays, puis :\n` +
          `  1. ${runCommand(`npm run geocode ${outcome.slug}`)} — écrit les coordonnées\n` +
          `  2. ${runCommand("npm run validate:content")} — vérifie le reste\n`
      );
      return 0;
  }
}

/**
 * `exitCode` rather than `exit()`: the latter can truncate a write to a pipe that
 * has not flushed, which would lose the very message this script exists to print.
 */
process.exitCode = main(process.argv.slice(2));
