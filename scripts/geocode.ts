import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { text as readAll } from "node:stream/consumers";
import { isatty } from "node:tty";
import { geocodeTrip, interpretAnswer } from "@/content/geocode";
import type { GeocodeOutcome } from "@/content/geocode";
import type { Chooser, GeocodeEvent } from "@/content/geocode";
import { formatEvent, formatOutcome, formatPrompt } from "@/content/geocode-report";
import { createGeocodingClient } from "@/content/geocoding";
import type { HttpFetch } from "@/content/geocoding";
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

/**
 * The real `fetch`, wrapped rather than passed by reference: the wrapper pins the
 * two arguments this repository uses and keeps `fetch` bound to its global.
 */
const httpFetch: HttpFetch = (url, init) => fetch(url, init);

/**
 * Answers taken from `--pick`, or from standard input, in order.
 *
 * No re-asking here, by definition: there is nobody to ask. An unusable answer is
 * a failure for that city, whose file stays untouched.
 */
function scriptedChooser(answers: readonly string[], source: string): Chooser {
  let next = 0;

  return async (ambiguity) => {
    const answer = answers[next];
    next += 1;

    if (answer === undefined) {
      return { state: "unanswered", reason: `aucun ${source} pour cette ville` };
    }
    const reading = interpretAnswer(answer, ambiguity.candidates.length);

    if (reading.state === "picked") {
      return { state: "picked", rank: reading.rank };
    }

    return {
      state: "unanswered",
      reason:
        reading.state === "abandon"
          ? "abandon demandé"
          : `${source} illisible ou hors liste : ${answer.trim()}`,
    };
  };
}

/** How many times a mistyped answer is forgiven before the city is given up on. */
const MAX_ATTEMPTS = 5;

type ClosableChooser = { readonly choose: Chooser; readonly close: () => void };

/**
 * The default: a question on the terminal, re-asked until the answer is a number
 * in range or the author gives up. Re-asking rather than failing on a typo is the
 * whole reason this is the default path — a fat-fingered `12` must not throw away
 * the request that was already spent on a free service.
 *
 * **One `readline` interface for the whole run**, created on the first question
 * and closed once at the end. Creating one per question also works and was the
 * first version, but closing a `readline` pauses `process.stdin`, so the second
 * question re-attaches to a stream that has already been paused and resumed — a
 * subtlety with no upside next to closing it once, in the caller's `finally`.
 */
function interactiveChooser(): ClosableChooser {
  let readline: ReturnType<typeof createInterface> | undefined;

  return {
    close: () => readline?.close(),
    choose: async (ambiguity) => {
      readline ??= createInterface({ input: process.stdin, output: process.stdout });

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        let answer: string;
        try {
          answer = await readline.question(
            formatPrompt(ambiguity.place, ambiguity.candidates.length)
          );
        } catch {
          /**
           * Ctrl+D and Ctrl+C reject this promise (`AbortError: Aborted with
           * Ctrl+D`). Measured through a real pseudo-terminal: unhandled, it
           * printed a ten-line Node stack trace over the candidate list and left
           * the exit code saying nothing at all. Interrupting a prompt is a normal
           * way to change one's mind, so it is an abandonment, not a crash.
           */
          return { state: "unanswered", reason: "entrée interrompue" };
        }

        const reading = interpretAnswer(answer, ambiguity.candidates.length);
        if (reading.state === "picked") {
          return { state: "picked", rank: reading.rank };
        }
        if (reading.state === "abandon") {
          return { state: "unanswered", reason: "abandon demandé" };
        }
        process.stdout.write(
          `  Un numéro entre 1 et ${ambiguity.candidates.length}, ou « q » pour abandonner.\n`
        );
      }

      return {
        state: "unanswered",
        reason: `aucun numéro valide après ${MAX_ATTEMPTS} essais`,
      };
    },
  };
}

/**
 * Standard input, read to end of file. Only reached when stdin is not a terminal,
 * so it is a pipe or a file: there is no prompt to interleave with, and reading it
 * up front keeps the answers in the same shape as `--pick`.
 *
 * **Read as a stream, not with `readFileSync(0)`** — and that is not a style
 * preference, it was a lost answer. `readFileSync(0)` only works while the bytes
 * happen to be in the pipe already, which made
 * `printf '1\\n' | npm run geocode …` pass and
 * `( sleep 1; echo 1 ) | npm run geocode …` fail: the fd is non-blocking as soon
 * as `process.stdin` exists, so the synchronous read throws `EAGAIN` instead of
 * waiting. Measured, isolated from this repository:
 *
 *     ( sleep 1; echo 1 ) | node -e 'void process.stdin.isTTY; readFileSync(0)'
 *     → EAGAIN
 *
 * A stream waits for `readable` and cannot see `EAGAIN` at all, so the answer no
 * longer depends on how fast the producer is.
 *
 * A real failure is returned, never swallowed: the previous `catch {}` turned
 * `EAGAIN` into "no answer given", which reported a perfectly good choice as an
 * unanswered ambiguity and spent an HTTP request for nothing.
 */
type StandardInput =
  | { readonly state: "read"; readonly answers: readonly string[] }
  | { readonly state: "unreadable"; readonly reason: string };

async function answersFromStdin(): Promise<StandardInput> {
  try {
    const raw = await readAll(process.stdin);

    return {
      state: "read",
      answers: raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    };
  } catch (cause) {
    return {
      state: "unreadable",
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

type ChooserSetup =
  | { readonly state: "ready"; readonly chooser: ClosableChooser }
  | { readonly state: "unreadable"; readonly reason: string };

/**
 * `isatty(0)` rather than `process.stdin.isTTY`: reading that property
 * *instantiates* the stream, which switches fd 0 to non-blocking as a side
 * effect. A question about the shape of a file descriptor must not change how it
 * can be read — that side effect is exactly what broke the branch it selects.
 */
async function chooserFor(picks: readonly string[]): Promise<ChooserSetup> {
  if (picks.length > 0) {
    return {
      state: "ready",
      chooser: { choose: scriptedChooser(picks, "--pick"), close: () => undefined },
    };
  }
  if (isatty(0)) {
    return { state: "ready", chooser: interactiveChooser() };
  }

  const piped = await answersFromStdin();
  if (piped.state === "unreadable") {
    return piped;
  }

  return {
    state: "ready",
    chooser: {
      choose: scriptedChooser(piped.answers, "numéro sur l'entrée standard"),
      close: () => undefined,
    },
  };
}

function write(lines: readonly string[]): void {
  if (lines.length > 0) {
    process.stdout.write(`${lines.join("\n")}\n`);
  }
}

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
