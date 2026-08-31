import path from "node:path";
import process from "node:process";
import { indexTripPhotos } from "@/content/index-photos";
import type { IndexPhotosEvent, IndexPhotosOutcome } from "@/content/index-photos";
import { formatEvent, formatOutcome } from "@/content/index-photos-report";
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
 * `npm run index-photos <slug>` — the command that means a photo's dimensions are
 * never typed by hand, and a 4 MB original never reaches the repository.
 *
 * A thin transport layer: arguments, a stream, an exit code. Every judgement is in
 * `src/content/index-photos.ts` and every sentence in
 * `src/content/index-photos-report.ts`, both of which are tested without a process
 * — the same split as `scripts/geocode.ts`, and the reason that command's suite
 * can cover every failure branch offline.
 *
 * **No prompt, and that is the interesting difference from `geocode`.** Every
 * decision here has an answer that can be computed: the dimensions are in the
 * file, the placeholder is a function of its pixels, the rungs are a function of
 * its width. `geocode` needs a human because "Kyoto" is two places 8 000 km apart
 * and no heuristic may choose; nothing here is ambiguous. So there is no `--pick`,
 * no `readline`, and no standard-input path — which also means this command is
 * fully exercised by the suite without a pseudo-terminal.
 *
 * **Streams.** All output goes to stdout, including the failures: a run is a
 * transcript, and splitting a transcript across two streams makes it unreadable in
 * the order it happened. Only what happens *before* the transcript starts goes to
 * stderr — a usage error. Same choice, and the same trade-off, as
 * `scripts/geocode.ts`: `2>/dev/null` hides nothing here.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const DEFAULT_CONTENT_DIR = path.join(REPO_ROOT, "content", "trips");
const DEFAULT_PUBLIC_DIR = path.join(REPO_ROOT, "public");

const USAGE = `Usage : npm run index-photos -- <slug> [options]

Le « -- » n'est pas décoratif : sans lui, npm garde les options pour lui. Un
« --content=... » disparaît sans un mot — et les photos du vrai content/trips
seraient alors indexées — et « --help » affiche l'aide de npm, en anglais. Sans
option, le « -- » est inutile.

Mesure chaque photo déclarée dans photos[], écrit sa largeur, sa hauteur et sa
vignette de préchargement dans content/trips/<slug>/trip.yaml, et produit les
versions AVIF que la page demandera. Le fichier est modifié au plus juste : les
commentaires, l'ordre des clés, l'indentation et les lignes vides sont conservés.

La commande ne fait rien deux fois : une photo déjà à jour n'est pas réécrite, et
un voyage entièrement indexé sort en 0 sans toucher au fichier. Une photo
remplacée sur le disque, en revanche, est remesurée — c'est pour ça que tout est
mesuré à chaque passage plutôt que déduit du fichier.

Une image au-delà de 3000 px ou de 1,5 Mo est REDIMENSIONNÉE SUR LE DISQUE, et un
avertissement le dit en nommant le fichier et ses dimensions avant et après.
C'est la seule commande de ce dépôt qui réécrit un fichier que tu as déposé :
garde tes originaux pleine taille ailleurs que dans public/.

Arguments
  <slug>                Le voyage à indexer — le nom de son dossier, ou le slug
                        déclaré dans son trip.yaml.

Options
  --content <dossier>   Dossier des voyages. Par défaut : content/trips
  --public <dossier>    Dossier public, contre lequel les « src » sont résolus.
                        Par défaut : public
  -h, --help            Affiche cette aide. Avec le « -- », donc :
                        « npm run index-photos -- --help ».

Variables d'environnement
  TIW_CONTENT_DIR       Dossier des voyages, si --content ne le donne pas.
  TIW_PUBLIC_DIR        Dossier public, si --public ne le donne pas.

Codes de sortie
  0   tout est indexé, ou tout l'était déjà
  1   au moins une photo n'a pas pu être indexée, ou le fichier a changé sur le
      disque pendant la commande ; dans tous les cas le fichier reste cohérent
  2   erreur d'usage

Exemple
  npm run new-trip japon-2024
  npm run index-photos japon-2024
  npm run index-photos -- japon-2024 --content /tmp/bac/trips --public /tmp/bac/public`;

/**
 * The options npm eats, and the shape of the value each leaves behind as a stray
 * positional.
 *
 * Both take a directory, so both are recognised by a path separator — and the
 * order decides which one a bare `/tmp/bac` is attributed to. `--content` first,
 * because it is the one an author passes on its own; `--public` is almost always
 * given beside it, in which case `swallowedOption` disqualifies `--content` and
 * this row is reached.
 */
const SWALLOWABLE: readonly SwallowableOption[] = [
  { name: "--content", valueLooksLike: /[/\\~.]/ },
  { name: "--public", valueLooksLike: /[/\\~.]/ },
];

function write(lines: readonly string[]): void {
  if (lines.length > 0) {
    process.stdout.write(`${lines.join("\n")}\n`);
  }
}

async function main(argv: readonly string[]): Promise<number> {
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

  const [slug, ...extra] = parsed.positionals;

  if (slug === undefined) {
    process.stderr.write(`Il manque le slug du voyage à indexer.\n\n${USAGE}\n`);
    return 2;
  }
  const stray = extra[0];
  if (stray !== undefined) {
    process.stderr.write(
      `${tooManyPositionals({
        script: "index-photos",
        first: slug,
        stray,
        swallowed: swallowedOption(parsed, stray, SWALLOWABLE),
      })}\n\n${USAGE}\n`
    );
    return 2;
  }

  let reported = 0;

  // Annotated rather than left to inference: an implicitly-typed `let` is an
  // evolving `any`, and this repository does not use `any`.
  const outcome: IndexPhotosOutcome = await indexTripPhotos({
    contentDir: path.resolve(
      optionValue(parsed, "--content") ?? fromEnvironment("TIW_CONTENT_DIR") ?? DEFAULT_CONTENT_DIR
    ),
    publicDir: path.resolve(
      optionValue(parsed, "--public") ?? fromEnvironment("TIW_PUBLIC_DIR") ?? DEFAULT_PUBLIC_DIR
    ),
    repoRoot: REPO_ROOT,
    slug,
    onEvent: (event: IndexPhotosEvent) => {
      reported += 1;
      write(formatEvent(event));
    },
  });

  // The blank line separates the transcript from the verdict — and is not printed
  // when there was no transcript, which is the idempotent run.
  write(reported === 0 ? formatOutcome(outcome, slug) : ["", ...formatOutcome(outcome, slug)]);

  /**
   * `no-photos` exits 0 on purpose: `photos` is optional in the content model, so
   * a trip without any is not a fault and must not fail a script that chains this
   * command over several trips.
   */
  if (outcome.state === "done") {
    return outcome.failed === 0 ? 0 : 1;
  }
  if (outcome.state === "no-photos") {
    return 0;
  }

  return 1;
}

/**
 * The last guard: nothing this command does is worth a stack trace on Thomas's
 * terminal. Every expected failure is already a value; this catches the unexpected
 * one, still says something he can act on, and above all still says whether
 * anything was written.
 *
 * "The images may have been written" is the honest wording here and the one place
 * this differs from `geocode`'s equivalent: derivatives and a resized original are
 * written *during* the run, before the trip file at the end, so an unexpected
 * throw genuinely can leave correct new files on disk. Saying "nothing was
 * touched" would be false.
 */
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (cause) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(
    `L'indexation s'est interrompue sur une erreur inattendue : ${detail}\n` +
      `Le trip.yaml n'a pas été réécrit ; des versions AVIF ont peut-être été ` +
      `produites, elles restent valables — relance la commande.\n`
  );
  process.exitCode = 1;
}
