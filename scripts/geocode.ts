import path from "node:path";
import process from "node:process";
import { geocodeTrip } from "@/content/geocode";
import type { GeocodeEvent, GeocodeOutcome } from "@/content/geocode";
import { formatEvent, formatOutcome } from "@/content/geocode-report";
import { createGeocodingClient } from "@/content/geocoding";
import { chooserFor, httpFetch, write } from "./geocode-prompt";
import {
  fromEnvironment,
  isArgumentError,
  optionValue,
  optionValues,
  parseArguments,
  swallowedOption,
  tooManyPositionals,
} from "./arguments";
import type { SwallowableOption } from "./arguments";

/**
 * `npm run geocode <slug>` — the command that means a latitude is never typed by
 * hand again.
 *
 * A thin transport layer: arguments, a stream, a prompt, an exit code. Every
 * judgement is in `src/content/geocode.ts` and every sentence in
 * `src/content/geocode-report.ts`, both of which are tested without a process and
 * without a socket.
 *
 * **The three ways an ambiguity gets answered**, in the order they are tried:
 *
 * 1. `--pick <n>`, repeatable — the nth `--pick` answers the nth ambiguity. This
 *    is the non-interactive path, and it exists because a command that can only
 *    be driven by a human at a terminal cannot be tested end to end. It only
 *    reaches this script through `npm run geocode -- <slug> --pick <n>`; see the
 *    table in `scripts/arguments.ts` for what npm does with the other spellings.
 * 2. standard input, when it is not a terminal — one number per line, same order.
 *    `printf '1\\n2\\n' | npm run geocode japon-2024` is the scripted form, and
 *    it waits for the producer rather than racing it (see `answersFromStdin`).
 * 3. otherwise, a prompt on the terminal. This is the default, and it is the one
 *    Thomas uses.
 *
 * **Streams.** All output goes to stdout, including the failures: a run of this
 * command is a transcript of a conversation, and splitting a conversation across
 * two streams makes it unreadable in the order it happened. Only what happens
 * *before* the conversation starts goes to stderr — a usage error, and standard
 * input being unreadable.
 *
 * That is deliberately **not** what `scripts/new-trip.ts` does, which puts every
 * refusal on stderr; the divergence is argued at the top of that file. It means
 * `2>/dev/null` hides a `new-trip` failure and hides nothing here, which is the
 * price of keeping this transcript in one piece.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const DEFAULT_CONTENT_DIR = path.join(REPO_ROOT, "content", "trips");

const USAGE = `Usage : npm run geocode -- <slug> [options]

Le « -- » n'est pas décoratif : sans lui, npm garde les options pour lui. Un
« --pick 1 » arrive alors comme un second voyage nommé « 1 », un « --pick=1 » ou
un « --content=... » disparaît sans un mot, et « --help » affiche l'aide de npm,
en anglais. Sans option, le « -- » est inutile.

Résout les coordonnées de chaque ville du voyage qui n'en a pas, et les écrit
dans content/trips/<slug>/trip.yaml. Le fichier est modifié au plus juste : les
commentaires, l'ordre des clés, l'indentation et les lignes vides sont conservés.

Le service (geocoding-api.open-meteo.com) ne demande aucune clé d'API : il n'y a
aucun secret à configurer.

Une ville homonyme n'est jamais tranchée d'office — « Kyoto » désigne une ville
au Japon et un village en Tanzanie, à 8 000 km. Les candidats sont listés avec
leur pays, leur région et leur population, et la commande demande un numéro. Le
pays renvoyé est ensuite comparé au « countryCode » du fichier : en cas de
divergence, rien n'est écrit.

Arguments
  <slug>                Le voyage à géocoder — le nom de son dossier, ou le slug
                        déclaré dans son trip.yaml.

Options
  --content <dossier>   Dossier des voyages. Par défaut : content/trips
  --pick <n>            Répond à une ambiguïté sans rien demander (1 = premier
                        candidat de la liste). Répétable : le nième --pick répond
                        à la nième ambiguïté. Sans --pick et sans terminal, les
                        numéros sont lus sur l'entrée standard, un par ligne.
  -h, --help            Affiche cette aide. Avec le « -- », donc :
                        « npm run geocode -- --help ».

Variables d'environnement
  TIW_CONTENT_DIR       Dossier des voyages, si --content ne le donne pas.
  TIW_GEOCODING_URL     Autre point d'entrée du service (utilisé par les tests,
                        qui ne sortent jamais de la machine).

Codes de sortie
  0   tout est résolu, ou tout l'était déjà
  1   au moins une ville n'a pas pu être résolue, le fichier a changé sur le
      disque pendant la commande, ou l'entrée standard n'a pas pu être lue ;
      dans tous les cas le fichier reste cohérent
  2   erreur d'usage

Exemple
  npm run new-trip japon-2024
  npm run geocode japon-2024
  npm run geocode -- japon-2024 --pick 1
  printf '1\\n2\\n' | npm run geocode japon-2024`;

/**
 * The two options npm eats, and the shape of the value each one leaves behind as
 * a stray positional. Ordered: a bare number is a `--pick`, anything with a path
 * separator in it is a `--content`.
 */
const SWALLOWABLE: readonly SwallowableOption[] = [
  { name: "--pick", valueLooksLike: /^\d+$/ },
  { name: "--content", valueLooksLike: /[/\\~.]/ },
];

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArguments(argv, {
    valued: [
      { name: "--content", expects: "un dossier" },
      { name: "--pick", expects: "un numéro de candidat", repeatable: true },
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
    process.stderr.write(`Il manque le slug du voyage à géocoder.\n\n${USAGE}\n`);
    return 2;
  }
  const stray = extra[0];
  if (stray !== undefined) {
    process.stderr.write(
      `${tooManyPositionals({
        script: "geocode",
        first: slug,
        stray,
        swallowed: swallowedOption(parsed, stray, SWALLOWABLE),
      })}\n\n${USAGE}\n`
    );
    return 2;
  }

  const setup = await chooserFor(optionValues(parsed, "--pick"));
  if (setup.state === "unreadable") {
    process.stderr.write(
      `L'entrée standard n'a pas pu être lue : ${setup.reason}\n` +
        `Rien n'a été géocodé et le voyage n'a pas été touché. ` +
        `Réponds avec --pick : « npm run geocode -- ${slug} --pick <n> ».\n`
    );
    return 1;
  }

  const endpoint = fromEnvironment("TIW_GEOCODING_URL");
  const chooser = setup.chooser;
  let reported = 0;

  // Annotated rather than left to inference: an implicitly-typed `let` is an
  // evolving `any`, and this repository does not use `any`.
  let outcome: GeocodeOutcome;
  try {
    outcome = await geocodeTrip({
      contentDir: path.resolve(
        optionValue(parsed, "--content") ??
          fromEnvironment("TIW_CONTENT_DIR") ??
          DEFAULT_CONTENT_DIR
      ),
      repoRoot: REPO_ROOT,
      slug,
      search: createGeocodingClient({
        fetch: httpFetch,
        ...(endpoint === undefined ? {} : { endpoint }),
      }),
      choose: chooser.choose,
      onEvent: (event: GeocodeEvent) => {
        reported += 1;
        write(formatEvent(event));
      },
    });
  } finally {
    // Closed whatever happened: an open `readline` keeps the process alive, and
    // a command that has printed its verdict and does not exit is indistinguishable
    // from one that hung.
    chooser.close();
  }

  // The blank line separates the transcript from the verdict — and is not
  // printed when there was no transcript, which is the idempotent run.
  write(reported === 0 ? formatOutcome(outcome, slug) : ["", ...formatOutcome(outcome, slug)]);

  if (outcome.state === "done") {
    return outcome.failed === 0 ? 0 : 1;
  }

  return 1;
}

/**
 * The last guard: nothing this command does is worth a stack trace on Thomas's
 * terminal. Every expected failure is already a value; this catches the
 * unexpected one, still says something he can act on, and above all still says
 * whether the file was touched.
 */
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (cause) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(
    `Le géocodage s'est interrompu sur une erreur inattendue : ${detail}\n` +
      `Le voyage n'a pas été réécrit — relance la commande.\n`
  );
  process.exitCode = 1;
}
