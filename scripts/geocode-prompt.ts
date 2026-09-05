import process from "node:process";
import { createInterface } from "node:readline/promises";
import { text as readAll } from "node:stream/consumers";
import { isatty } from "node:tty";
import { interpretAnswer } from "@/content/geocode";
import type { Chooser } from "@/content/geocode";
import { formatPrompt } from "@/content/geocode-report";
import type { HttpFetch } from "@/content/geocoding";

/**
 * The terminal half of the two geocoding commands, and nothing else: the socket,
 * the prompt, the `--pick` list, standard input, and the stream they all write
 * to.
 *
 * **Extracted by TIW-36, when a second command needed exactly this and none of
 * `scripts/geocode.ts`'s slug handling.** Every subtlety below was measured once
 * and must not be re-derived: `isatty(0)` rather than `process.stdin.isTTY`
 * (reading that property instantiates the stream and switches fd 0 to
 * non-blocking, which breaks the very branch it selects), the stream read rather
 * than `readFileSync(0)` (a slow producer answered `EAGAIN`), one `readline` for
 * the whole run (closing one pauses `process.stdin`), and Ctrl+D read as an
 * abandonment rather than as a crash. Two copies of that is two chances to lose
 * one of them.
 *
 * What is deliberately *not* here: the usage text, the argument tables and the
 * exit codes. Those differ between the two commands — one takes a slug, the
 * other takes no positional at all — and that difference is the reason there are
 * two commands.
 */

/**
 * The real `fetch`, wrapped rather than passed by reference: the wrapper pins the
 * two arguments this repository uses and keeps `fetch` bound to its global.
 */
export const httpFetch: HttpFetch = (url, init) => fetch(url, init);

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

export type ChooserSetup =
  | { readonly state: "ready"; readonly chooser: ClosableChooser }
  | { readonly state: "unreadable"; readonly reason: string };

/**
 * `isatty(0)` rather than `process.stdin.isTTY`: reading that property
 * *instantiates* the stream, which switches fd 0 to non-blocking as a side
 * effect. A question about the shape of a file descriptor must not change how it
 * can be read — that side effect is exactly what broke the branch it selects.
 */
export async function chooserFor(picks: readonly string[]): Promise<ChooserSetup> {
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

/**
 * All output on one stream, including the failures: a run is the transcript of a
 * conversation, and splitting a conversation across two streams makes it
 * unreadable in the order it happened.
 */
export function write(lines: readonly string[]): void {
  if (lines.length > 0) {
    process.stdout.write(`${lines.join("\n")}\n`);
  }
}
