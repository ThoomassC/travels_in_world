import path from "node:path";
import process from "node:process";
import { geocodePlaces } from "@/content/geocode";
import type { GeocodeEvent, PlacesGeocodeOutcome } from "@/content/geocode";
import { formatEvent, formatPlacesOutcome } from "@/content/geocode-report";
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
 * `npm run geocode:places` — the same promise as `npm run geocode`, for the file
 * that holds the places with no journey attached (TIW-36).
 *
 * **A second command and not a second mode of the first**, and the argument is
 * the positional. `npm run geocode <slug>` requires a slug and refuses without
 * one; this file has no slug to give, because there is one of it. Folding the two
 * would have meant a command whose only required argument is required half the
 * time — and a `--places` flag whose presence silently changes what the
 * positional means.
 *
 * Everything past the arguments is shared: `geocodePlaces` is the very engine
 * `geocodeTrip` runs on, so the four refusals are the same code — never
 * `results[0]`, the country cross-check against what the file declares, the
 * domain's last word on a coordinate, and nothing written unless something was
 * resolved. The prompt, the `--pick` handling and the standard-input reading are
 * shared too, in `./geocode-prompt.ts`.
 *
 * Streams follow `scripts/geocode.ts` exactly, for its reason: a run is the
 * transcript of a conversation, so everything goes to stdout, and only what
 * happens *before* the conversation starts goes to stderr.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const DEFAULT_PLACES_FILE = path.join(REPO_ROOT, "content", "places.yaml");

const USAGE = `Usage : npm run geocode:places -- [options]

Le « -- » n'est pas décoratif : sans lui, npm garde les options pour lui. Un
« --pick 1 » arrive alors comme un lieu nommé « 1 », un « --pick=1 » ou un
« --places=... » disparaît sans un mot, et « --help » affiche l'aide de npm, en
anglais. Sans option, le « -- » est inutile.

Résout les coordonnées de chaque lieu visité qui n'en a pas, et les écrit dans
content/places.yaml. Un lieu visité est un endroit où le carnet est allé sans
qu'un récit ne le raconte : ni date, ni étape, ni page. Le fichier est modifié au
plus juste : les commentaires, l'ordre des clés, l'indentation et les lignes
vides sont conservés.

Le service (geocoding-api.open-meteo.com) ne demande aucune clé d'API : il n'y a
aucun secret à configurer.

Une ville homonyme n'est jamais tranchée d'office — « Valence » désigne une ville
en Espagne et une ville en France, à 700 km. Les candidats sont listés avec leur
pays, leur région et leur population, et la commande demande un numéro. Le pays
renvoyé est ensuite comparé au « countryCode » du fichier : en cas de divergence,
rien n'est écrit pour ce lieu.

Options
  --places <fichier>    Fichier des lieux visités. Par défaut : content/places.yaml
  --pick <n>            Répond à une ambiguïté sans rien demander (1 = premier
                        candidat de la liste). Répétable : le nième --pick répond
                        à la nième ambiguïté. Sans --pick et sans terminal, les
                        numéros sont lus sur l'entrée standard, un par ligne.
  -h, --help            Affiche cette aide. Avec le « -- », donc :
                        « npm run geocode:places -- --help ».

Variables d'environnement
  TIW_PLACES_FILE       Fichier des lieux visités, si --places ne le donne pas.
  TIW_GEOCODING_URL     Autre point d'entrée du service (utilisé par les tests,
                        qui ne sortent jamais de la machine).

Codes de sortie
  0   tout est résolu, ou tout l'était déjà
  1   au moins un lieu n'a pas pu être résolu, le fichier a changé sur le disque
      pendant la commande, ou l'entrée standard n'a pas pu être lue ; dans tous
      les cas le fichier reste cohérent
  2   erreur d'usage

Exemple
  npm run geocode:places
  npm run geocode:places -- --pick 1 --pick 2
  printf '1\\n2\\n' | npm run geocode:places`;

/**
 * The one option npm eats here, and the shape of the value it leaves behind as a
 * stray positional. `--places` takes a path, `--pick` a bare number — the same
 * ordering `scripts/geocode.ts` uses, minus the slug it has and this has not.
 */
const SWALLOWABLE: readonly SwallowableOption[] = [
  { name: "--pick", valueLooksLike: /^\d+$/ },
  { name: "--places", valueLooksLike: /[/\\~.]/ },
];

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArguments(argv, {
    valued: [
      { name: "--places", expects: "un fichier" },
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

  /**
   * **This command takes no positional at all**, and saying so is the whole
   * difference from `npm run geocode`: a bare `1` on the line is a `--pick` npm
   * swallowed, and a path is a `--places` it swallowed. Both are told apart by
   * `swallowedOption`, so the message names the option the author meant instead
   * of complaining about an argument they never typed.
   */
  const [stray] = parsed.positionals;
  if (stray !== undefined) {
    process.stderr.write(
      `${tooManyPositionals({
        script: "geocode:places",
        first: "content/places.yaml",
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
        `Rien n'a été géocodé et le fichier n'a pas été touché. ` +
        `Réponds avec --pick : « npm run geocode:places -- --pick <n> ».\n`
    );
    return 1;
  }

  const endpoint = fromEnvironment("TIW_GEOCODING_URL");
  const chooser = setup.chooser;
  let reported = 0;

  // Annotated rather than left to inference: an implicitly-typed `let` is an
  // evolving `any`, and this repository does not use `any`.
  let outcome: PlacesGeocodeOutcome;
  try {
    outcome = await geocodePlaces({
      placesFile: path.resolve(
        optionValue(parsed, "--places") ?? fromEnvironment("TIW_PLACES_FILE") ?? DEFAULT_PLACES_FILE
      ),
      repoRoot: REPO_ROOT,
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
    // Closed whatever happened: an open `readline` keeps the process alive, and a
    // command that has printed its verdict and does not exit is indistinguishable
    // from one that hung.
    chooser.close();
  }

  // The blank line separates the transcript from the verdict — and is not printed
  // when there was no transcript, which is the idempotent run.
  write(reported === 0 ? formatPlacesOutcome(outcome) : ["", ...formatPlacesOutcome(outcome)]);

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
      `Le fichier des lieux n'a pas été réécrit — relance la commande.\n`
  );
  process.exitCode = 1;
}
