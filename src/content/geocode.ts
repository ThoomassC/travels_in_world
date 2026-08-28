import { Buffer } from "node:buffer";
import {
  chmodSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { CoordinatesSchema, CountryCodeSchema } from "@/domain/geo";
import type { Coordinates } from "@/domain/geo";
import { displayPath, readTripCollection, stringAt, valueAt } from "./collection";
import type { TripFile } from "./collection";
import type { GeocodingCandidate, GeocodingClient, SearchFailure } from "./geocoding";
import { formatCoordinate, writeCoordinates } from "./yaml-edit";
import type { CoordinateEdit } from "./yaml-edit";

/**
 * `npm run geocode <slug>`, minus the terminal.
 *
 * The whole point of TIW-10 is that a coordinate is never typed by hand, so the
 * only thing that matters here is being *right*: this module would rather write
 * nothing than write a plausible wrong place. Four refusals implement that, and
 * each one is a mistake that has actually shipped in projects like this:
 *
 * - it never takes `results[0]` — "Kyoto" is a city in Japan **and** a village in
 *   Tanzania, 8 000 km apart, and the service ranks them in that order;
 * - it compares the country the service returns against the one the content
 *   declares, and fails on a divergence — the guard that catches a wrong human
 *   choice;
 * - it refuses coordinates the domain refuses, which is where (0, 0) dies;
 * - it writes the file only when something was actually resolved, so a failed run
 *   leaves the trip exactly as it was.
 *
 * `search` and `choose` are parameters: no socket and no terminal is reachable
 * from here, which is what lets the suite cover all of the above offline.
 */

export type PlaceRef = {
  /** Index into `places[]`, so a message can print `places[1]`. */
  readonly index: number;
  readonly name: string;
  /**
   * The country code **as written in the file**, valid or not, so a message can
   * quote what the author typed. Whether it is usable is decided where it is
   * used, not here.
   */
  readonly countryCode: string | undefined;
};

export type Ambiguity = {
  readonly place: PlaceRef;
  readonly candidates: readonly GeocodingCandidate[];
};

/**
 * How an ambiguity is answered. `rank` is 1-based, because it is the number the
 * author reads in the list and types back.
 */
export type Choice =
  | { readonly state: "picked"; readonly rank: number }
  | { readonly state: "unanswered"; readonly reason: string };

export type Chooser = (ambiguity: Ambiguity) => Promise<Choice>;

/** Why one city was left alone. Every branch has its own sentence to print. */
export type UnresolvedReason =
  | { readonly state: "no-name" }
  | { readonly state: "no-country-code"; readonly declared: string }
  | { readonly state: "no-match" }
  | { readonly state: "no-choice"; readonly reason: string; readonly count: number }
  | {
      readonly state: "country-mismatch";
      readonly declared: string;
      readonly returned: string;
      readonly candidate: GeocodingCandidate;
    }
  | {
      readonly state: "rejected-coordinates";
      readonly candidate: GeocodingCandidate;
      readonly reason: string;
    }
  | { readonly state: "service"; readonly failure: SearchFailure }
  | { readonly state: "unsupported-yaml"; readonly reason: string };

export type GeocodeEvent =
  /** One per city that needs resolving, before its request goes out. */
  | { readonly kind: "searching"; readonly place: PlaceRef }
  /** Emitted before `choose` is called, so the candidates are on screen first. */
  | {
      readonly kind: "ambiguous";
      readonly place: PlaceRef;
      readonly candidates: readonly GeocodingCandidate[];
    }
  | {
      readonly kind: "resolved";
      readonly place: PlaceRef;
      readonly candidate: GeocodingCandidate;
      readonly coordinates: Coordinates;
    }
  | { readonly kind: "unresolved"; readonly place: PlaceRef; readonly reason: UnresolvedReason };

export type GeocodeOutcome =
  | { readonly state: "content-dir-missing"; readonly contentDir: string }
  | {
      readonly state: "content-dir-unreadable";
      readonly contentDir: string;
      readonly reason: string;
    }
  | {
      readonly state: "trip-not-found";
      readonly slug: string;
      readonly contentDir: string;
      readonly available: readonly string[];
    }
  | {
      readonly state: "trip-unreadable";
      readonly file: string;
      readonly reason: string;
      /**
       * A file in the trip's folder whose name differs from `trip.yaml` only by
       * case. `readTripCollection` looks for one precisely so this refusal can
       * tell "write this file" apart from "rename the one you already wrote" —
       * an author who reads "introuvable" next to his own `Trip.yaml` writes a
       * second file instead of renaming the first.
       */
      readonly similarName?: string;
    }
  | { readonly state: "trip-malformed"; readonly file: string; readonly reason: string }
  | { readonly state: "no-places"; readonly file: string }
  | {
      readonly state: "done";
      readonly file: string;
      readonly placeCount: number;
      /** Cities that needed a coordinate when the run started. */
      readonly pending: number;
      readonly resolved: number;
      readonly failed: number;
      readonly written: boolean;
      /**
       * Where the bytes actually went, when `trip.yaml` is a symlink resolving
       * **outside** the content directory — absent otherwise, which is the
       * ordinary case.
       *
       * Following the link is deliberate (a trip kept in a notes folder or a
       * synced drive is a legitimate setup, and `writeAtomically` documents why
       * the swap happens around the real file). Naming only the link is not: git
       * versions a symlink like any other entry, `git clone` recreates it with
       * its target, and a run then reported `content/trips/evil/trip.yaml —
       * fichier réécrit` while writing to a file outside the repository. The
       * author had no way to know. Transparency rather than refusal, so the
       * legitimate setup keeps working and the surprising one is said out loud.
       */
      readonly writtenTo?: string;
    }
  | {
      readonly state: "write-failed";
      readonly file: string;
      readonly reason: string;
      readonly resolved: number;
    }
  /**
   * The file was modified on disk while the run was waiting at the prompt, so
   * nothing was written: the author's save wins over the coordinates this run
   * had found. `resolved` says how much work has to be redone, which is the
   * whole cost of the refusal.
   */
  | {
      readonly state: "file-changed";
      readonly file: string;
      readonly resolved: number;
    }
  /**
   * The file is not valid UTF-8, so the text this run computed its edit from is
   * **not** the file: `readFileSync(…, "utf8")` replaced every undecodable byte
   * with U+FFFD, and writing that text back would overwrite the author's own
   * bytes with replacement characters.
   *
   * Measured on a `trip.yaml` saved in latin-1 (`title: Café`, byte 0xE9): the
   * anti-clobber guard decoded both sides the same destructive way, so it could
   * not structurally see the difference, and the rename went through — exit 0,
   * "fichier réécrit", and `validate:content` stayed green because U+FFFD is a
   * perfectly valid string. The title was gone without a word.
   *
   * Nothing is written. `resolved` says how much work has to be redone once the
   * file is converted, exactly as `file-changed` does.
   */
  | {
      readonly state: "file-not-utf8";
      readonly file: string;
      readonly resolved: number;
    };

export type GeocodeRequest = {
  readonly contentDir: string;
  readonly repoRoot: string;
  readonly slug: string;
  readonly search: GeocodingClient;
  readonly choose: Chooser;
  readonly onEvent?: (event: GeocodeEvent) => void;
};

/**
 * What a typed answer means. Pure, and separate from the terminal, because the
 * *policy* is worth testing and `readline` is not: `2.5`, `1e1`, `0` and an empty
 * line all have to be a question re-asked rather than a coordinate written.
 *
 * `Number.parseInt` is not enough on its own — it reads `1x` as 1 and `1e1` as 1
 * — so the whole string has to be digits.
 */
export type AnswerReading =
  | { readonly state: "picked"; readonly rank: number }
  /** The author gave up on this city; nothing is written for it. */
  | { readonly state: "abandon" }
  /** Not an answer. Interactively this asks again; from `--pick` it is a failure. */
  | { readonly state: "retry" };

export function interpretAnswer(answer: string, count: number): AnswerReading {
  const trimmed = answer.trim();

  if (trimmed === "q" || trimmed === "Q") {
    return { state: "abandon" };
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    return { state: "retry" };
  }
  const rank = Number.parseInt(trimmed, 10);

  return rank >= 1 && rank <= count ? { state: "picked", rank } : { state: "retry" };
}

/* ------------------------------------------------------ what needs resolving -- */

/**
 * Whether a place still needs a coordinate.
 *
 * The three cases are one case to the author, and `validate:content` already
 * points all three at this command: the key is absent, the numbers are not
 * numbers, or they are (0, 0) — the signature of a geocoding that already failed
 * once. `CoordinatesSchema` is the arbiter, so this cannot drift from what the
 * pages accept.
 */
function needsCoordinates(document: unknown, index: number): boolean {
  return !CoordinatesSchema.safeParse(valueAt(document, ["places", index, "coordinates"])).success;
}

function placeRef(document: unknown, index: number): PlaceRef {
  return {
    index,
    name: stringAt(document, ["places", index, "name"]) ?? "",
    countryCode: stringAt(document, ["places", index, "countryCode"]),
  };
}

/* ------------------------------------------------------------ finding the trip -- */

type ParsedTrip = Extract<TripFile, { state: "parsed" }>;

type Selection =
  | { readonly state: "found"; readonly trip: TripFile }
  | { readonly state: "not-found"; readonly available: readonly string[] };

/**
 * The trip a slug names. The directory wins over the declared slug, because the
 * directory is what the author typed and what `content/README.md` calls the
 * convention; the declared slug is the honest fallback for a folder that was
 * renamed. Ambiguity between two files is impossible to resolve here and is
 * `validate:content`'s finding, so the first match in alphabetical order is
 * taken and the run reports the file it actually touched.
 */
function selectTrip(files: readonly TripFile[], slug: string): Selection {
  const byDirectory = files.find((file) => file.directory === slug);
  if (byDirectory !== undefined) {
    return { state: "found", trip: byDirectory };
  }

  const byDeclaredSlug = files.find(
    (file) => file.state === "parsed" && stringAt(file.value, ["slug"]) === slug
  );
  if (byDeclaredSlug !== undefined) {
    return { state: "found", trip: byDeclaredSlug };
  }

  return { state: "not-found", available: files.map((file) => file.directory) };
}

/* ------------------------------------------------------------ resolving a city -- */

type Resolution =
  | {
      readonly state: "resolved";
      readonly candidate: GeocodingCandidate;
      readonly coordinates: Coordinates;
    }
  | { readonly state: "unresolved"; readonly reason: UnresolvedReason };

async function resolvePlace(
  place: PlaceRef,
  request: GeocodeRequest,
  emit: (event: GeocodeEvent) => void
): Promise<Resolution> {
  if (place.name === "") {
    return { state: "unresolved", reason: { state: "no-name" } };
  }

  /**
   * The country cross-check is not optional, so a place that cannot be
   * cross-checked is not resolved. Writing coordinates that no declaration can
   * contradict is precisely the situation criterion 3 exists to prevent — and a
   * `countryCode` of `japon` is exactly the file where a wrong pick would then go
   * unnoticed.
   */
  const declaredCountry = place.countryCode;
  if (declaredCountry === undefined || !CountryCodeSchema.safeParse(declaredCountry).success) {
    return {
      state: "unresolved",
      reason: { state: "no-country-code", declared: declaredCountry ?? "" },
    };
  }

  emit({ kind: "searching", place });
  const found = await request.search(place.name);

  if (found.state !== "candidates" && found.state !== "no-match") {
    return { state: "unresolved", reason: { state: "service", failure: found } };
  }
  if (found.state === "no-match") {
    return { state: "unresolved", reason: { state: "no-match" } };
  }

  const { candidates } = found;
  let chosen = candidates[0];

  /**
   * More than one match is never resolved silently. `candidates[0]` is the
   * service's *relevance* ranking, which put a Tanzanian village of no recorded
   * population second behind Kyōto — and would have put it first for any name
   * where the homonym is the better-known one.
   */
  if (candidates.length > 1) {
    emit({ kind: "ambiguous", place, candidates });
    const choice = await request.choose({ place, candidates });

    if (choice.state === "unanswered") {
      return {
        state: "unresolved",
        reason: { state: "no-choice", reason: choice.reason, count: candidates.length },
      };
    }
    chosen = candidates[choice.rank - 1];
    if (chosen === undefined) {
      return {
        state: "unresolved",
        reason: {
          state: "no-choice",
          reason: `le numéro ${choice.rank} n'est pas dans la liste`,
          count: candidates.length,
        },
      };
    }
  }

  if (chosen === undefined) {
    return { state: "unresolved", reason: { state: "no-match" } };
  }

  /**
   * The cross-check, and the reason this command can be trusted with a file:
   * every other guard here catches a machine being wrong, this one catches a
   * human picking the wrong line out of a list.
   *
   * Compared case-insensitively, because the case is the provider's spelling and
   * not a fact about the country: the same service answers `JP` on one endpoint
   * and `jp` on another, and refusing the second would turn a working run into a
   * "le contenu déclare JP" refusal the author cannot act on. `declaredCountry`
   * is already upper-case — `CountryCodeSchema` demands it — so only the
   * response is folded; the reason keeps the raw spelling, since a message that
   * paraphrases what the service said is a message that cannot be trusted.
   */
  if (chosen.country_code.trim().toUpperCase() !== declaredCountry) {
    return {
      state: "unresolved",
      reason: {
        state: "country-mismatch",
        declared: declaredCountry,
        returned: chosen.country_code,
        candidate: chosen,
      },
    };
  }

  /**
   * The domain has the last word on what a coordinate is — including (0, 0),
   * which it refuses by name. Parsing here rather than trusting the response is
   * what makes criterion 4 impossible to bypass by picking a candidate.
   *
   * Parsed **as it will be written**, not as it arrived. The file holds seven
   * decimals, so `latitude: 1e-8, longitude: -1e-8` is a pair the domain accepts
   * and (0, 0) once written: the command used to write it, exit 0, after which
   * `validate:content` refused the file and told the author to run the very
   * command that had produced it. Rounding first also makes the transcript
   * honest — the numbers it prints are the numbers the file gets.
   */
  const parsed = CoordinatesSchema.safeParse({
    lat: Number(formatCoordinate(chosen.latitude)),
    lon: Number(formatCoordinate(chosen.longitude)),
  });
  if (!parsed.success) {
    return {
      state: "unresolved",
      reason: {
        state: "rejected-coordinates",
        candidate: chosen,
        reason: parsed.error.issues[0]?.message ?? "coordonnées refusées",
      },
    };
  }

  return { state: "resolved", candidate: chosen, coordinates: parsed.data };
}

/* ------------------------------------------------------------------ the writing -- */

/**
 * The two fixed parts of a temporary name; the variable part is the pid.
 *
 * Exported so the suite can build the name this module really writes and ask
 * **git** whether it ignores it, rather than asserting that a pattern happens to
 * appear in `.gitignore`.
 */
export const TEMPORARY_MARKER = ".geocode-";
export const TEMPORARY_SUFFIX = ".tmp";

/**
 * The shape of the temporary file an interrupted write can leave behind, as a
 * gitignore pattern. Built from the same two constants as the name itself, so the
 * entry in `.gitignore` cannot drift away from what this module actually writes —
 * and the suite asserts the repository carries the entry.
 *
 * A run killed between `writeFileSync` and `renameSync` leaves one of these next
 * to the trip. It is dead weight, not damage — nothing reads it, and the next run
 * overwrites it — but an untracked file appearing inside `content/trips/` after a
 * Ctrl+C is exactly the kind of debris that makes an author distrust the command
 * that put it there.
 */
export const TEMPORARY_FILE_GLOB = `*${TEMPORARY_MARKER}*${TEMPORARY_SUFFIX}`;

type WriteResult =
  /** `target` is the real file the bytes went to, symlinks resolved. */
  | { readonly state: "written"; readonly target: string }
  /** The bytes on disk are no longer the ones the edit was computed from. */
  | { readonly state: "changed-underfoot" }
  /**
   * The bytes on disk differ from `expected` and yet decode to it: `expected` is
   * a lossy decoding of this very file, not a copy of it. See `file-not-utf8`.
   */
  | { readonly state: "not-utf8" }
  | { readonly state: "failed"; readonly reason: string };

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Best-effort cleanup: a failure to tidy up must not mask the real failure. */
function discard(temporary: string): void {
  try {
    rmSync(temporary, { force: true });
  } catch {
    // Nothing useful to say: the caller is already returning a failure, and a
    // stray temporary is covered by TEMPORARY_FILE_GLOB.
  }
}

/**
 * Written to a sibling file and renamed over the target.
 *
 * `rename` within a directory is atomic on every filesystem this runs on, so an
 * interrupted run leaves either the old file or the new one — never a truncated
 * trip. A plain `writeFileSync` is one line shorter and can lose the file, which
 * is not a trade this command gets to make.
 *
 * A naive `rename` over the target loses three things the author would notice,
 * so all three are handled here rather than patched later:
 *
 * - **the symlink.** `trip.yaml` may be a link into a notes folder or a synced
 *   drive; renaming over the *link* replaces it with a regular file and silently
 *   detaches the trip from the file being edited. So the link is resolved first
 *   and the swap happens around the real file.
 * - **the mode.** A fresh temporary is created at `0o666 & ~umask`, so a trip
 *   kept at `0o600` would come back world-readable. The mode is copied over
 *   before the rename, not after: after is a window where the file is readable.
 * - **a save made in the meantime.** `expected` is the text the edit offsets were
 *   computed against, and it was read *before* the first request — the prompt then
 *   blocks on a human for as long as he likes. Comparing the bytes here, one
 *   syscall before the rename, is the only place the comparison means anything: a
 *   fingerprint taken at read time answers a question about the past.
 *
 * The window between that comparison and the rename is a few microseconds of
 * kernel work with no I/O in it. Closing it entirely needs an advisory lock the
 * author's editor would have to take too, which is not on offer; narrowing it to
 * this is.
 *
 * That last comparison is on **bytes**, and that is not a detail. It used to
 * decode the file with `"utf8"` — the same decoding `expected` had already been
 * through — so on a file that is not valid UTF-8 both sides carried the same
 * U+FFFD and the guard could not, structurally, see anything wrong. The rename
 * then wrote replacement characters over the author's own bytes. Comparing
 * buffers separates the two questions the guard has to answer: *did the file
 * change* (the decoded texts differ) and *was our copy of it lossy* (the decoded
 * texts match but the bytes do not).
 */
function writeAtomically(absolutePath: string, expected: string, text: string): WriteResult {
  let target: string;
  try {
    target = realpathSync(absolutePath);
  } catch (cause) {
    return { state: "failed", reason: errorMessage(cause) };
  }

  // Sibling of the *real* file, because `rename` is only atomic within one
  // filesystem and a symlink can cross one.
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}${TEMPORARY_MARKER}${process.pid}${TEMPORARY_SUFFIX}`
  );

  try {
    writeFileSync(temporary, text, "utf8");
    chmodSync(temporary, statSync(target).mode & 0o7777);

    const raw = readFileSync(target);

    if (!raw.equals(Buffer.from(expected, "utf8"))) {
      discard(temporary);

      return raw.toString("utf8") === expected
        ? { state: "not-utf8" }
        : { state: "changed-underfoot" };
    }

    renameSync(temporary, target);

    return { state: "written", target };
  } catch (cause) {
    discard(temporary);

    return { state: "failed", reason: errorMessage(cause) };
  }
}

/**
 * Whether `file` is under `directory`, both symlinks resolved.
 *
 * `directory` is resolved too because it very often is a link itself — on macOS
 * `os.tmpdir()` is `/var/folders/…`, a symlink to `/private/var/folders/…`, so
 * comparing a resolved file against an unresolved root answers "outside" for
 * every trip in the test suite.
 */
function isInsideDirectory(directory: string, file: string): boolean {
  let root = directory;
  try {
    root = realpathSync(directory);
  } catch {
    // Unresolvable: compare against the path as given rather than give up. The
    // answer only decides whether one extra line is printed.
  }
  const relative = path.relative(root, file);

  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/* ------------------------------------------------------- the writable subset -- */

/** One place dropped from the write, with the refusal that names *it*. */
type Refusal = { readonly placeIndex: number; readonly reason: string };

type Subset =
  | {
      readonly state: "writable";
      readonly edits: readonly CoordinateEdit[];
      readonly text: string;
      readonly refused: readonly Refusal[];
    }
  /** A refusal about the document itself: no subset of the edits would fare better. */
  | {
      readonly state: "unusable";
      readonly reason: string;
      readonly blocked: readonly CoordinateEdit[];
      readonly refused: readonly Refusal[];
    };

/**
 * The largest subset of `edits` that can actually be written, and the places
 * dropped on the way.
 *
 * `writeCoordinates` is all-or-nothing by design — it computes every splice
 * before applying any of them — and the caller used to take its refusal as a
 * verdict on the whole run. Measured on a trip whose third city was written
 * `coordinates: { latitude: …, longitude: … }`: three requests spent, three
 * correct resolutions thrown away, and **each** city given a failure line
 * quoting the third one's problem. Criterion 5 says the run treats the other
 * cities all the same; that only held for network failures.
 *
 * So the refused place is removed and the rest is retried. The loop terminates
 * because every iteration either returns or drops one edit — `placeIndex` is
 * required to name an edit that is actually in the set, and a refusal that names
 * none is treated as a document-level one rather than retried forever.
 */
function writableSubset(source: string, edits: readonly CoordinateEdit[]): Subset {
  const refused: Refusal[] = [];
  let remaining: readonly CoordinateEdit[] = edits;

  for (;;) {
    const result = writeCoordinates(source, remaining);

    if (result.state === "edited") {
      return { state: "writable", edits: remaining, text: result.text, refused };
    }

    const { placeIndex } = result;
    if (placeIndex === undefined) {
      return { state: "unusable", reason: result.reason, blocked: remaining, refused };
    }

    const shorter = remaining.filter((edit) => edit.placeIndex !== placeIndex);
    if (shorter.length === remaining.length) {
      // The refusal names a place this call never asked about: retrying would
      // hand `writeCoordinates` the same set and loop forever.
      return { state: "unusable", reason: result.reason, blocked: remaining, refused };
    }

    refused.push({ placeIndex, reason: result.reason });
    remaining = shorter;
  }
}

/* -------------------------------------------------------------------- the run -- */

export async function geocodeTrip(request: GeocodeRequest): Promise<GeocodeOutcome> {
  const emit = request.onEvent ?? (() => undefined);
  const collection = readTripCollection(request.contentDir);
  const contentDir = displayPath(request.repoRoot, request.contentDir);

  if (collection.state === "missing-directory") {
    return { state: "content-dir-missing", contentDir };
  }
  if (collection.state === "unreadable-directory") {
    return { state: "content-dir-unreadable", contentDir, reason: collection.reason };
  }

  const selection = selectTrip(collection.files, request.slug);
  if (selection.state === "not-found") {
    return {
      state: "trip-not-found",
      slug: request.slug,
      contentDir,
      available: selection.available,
    };
  }

  const trip = selection.trip;
  const file = displayPath(request.repoRoot, trip.absolutePath);

  if (trip.state === "absent" || trip.state === "broken-link") {
    return {
      state: "trip-unreadable",
      file,
      reason: "le fichier du voyage est introuvable",
      ...(trip.state === "absent" && trip.similarName !== undefined
        ? { similarName: trip.similarName }
        : {}),
    };
  }
  if (trip.state === "unreadable") {
    return { state: "trip-unreadable", file, reason: trip.reason };
  }
  if (trip.state === "malformed") {
    return {
      state: "trip-malformed",
      file,
      reason: trip.problems[0]?.message ?? "le fichier YAML ne se relit pas",
    };
  }

  return resolveParsedTrip(trip, file, request, emit);
}

async function resolveParsedTrip(
  trip: ParsedTrip,
  file: string,
  request: GeocodeRequest,
  emit: (event: GeocodeEvent) => void
): Promise<GeocodeOutcome> {
  const places = valueAt(trip.value, ["places"]);
  if (!Array.isArray(places) || places.length === 0) {
    return { state: "no-places", file };
  }

  const pending = places
    .map((_place, index) => index)
    .filter((index) => needsCoordinates(trip.value, index));

  if (pending.length === 0) {
    return {
      state: "done",
      file,
      placeCount: places.length,
      pending: 0,
      resolved: 0,
      failed: 0,
      written: false,
    };
  }

  const edits: CoordinateEdit[] = [];
  let failed = 0;

  /**
   * Strictly sequential — one request at a time, one request per city, no retry.
   *
   * Constraint D of TIW-10 asks for frugality with a free service that needs no
   * account, and there is nothing to gain here anyway: a trip has a handful of
   * cities, and the interactive prompt has to be answered one city at a time or
   * the questions overlap on the terminal. The usual retry-with-backoff is
   * deliberately absent for the same reason: the run is a few seconds of a human
   * being's attention, and "relance la commande" is both cheaper and clearer than
   * a silent second request.
   */
  for (const index of pending) {
    const place = placeRef(trip.value, index);
    const resolution = await resolvePlace(place, request, emit);

    if (resolution.state === "unresolved") {
      failed += 1;
      emit({ kind: "unresolved", place, reason: resolution.reason });
      continue;
    }

    emit({
      kind: "resolved",
      place,
      candidate: resolution.candidate,
      coordinates: resolution.coordinates,
    });
    edits.push({
      placeIndex: index,
      lat: resolution.coordinates.lat,
      lon: resolution.coordinates.lon,
    });
  }

  const summary = {
    file,
    placeCount: places.length,
    pending: pending.length,
  } as const;

  /**
   * Nothing resolved, nothing written. This is what makes a failed run harmless:
   * the file keeps its bytes *and* its timestamp, so a retry is free and a git
   * status stays clean.
   */
  if (edits.length === 0) {
    return { state: "done", ...summary, resolved: 0, failed, written: false };
  }

  const subset = writableSubset(trip.source, edits);
  const refusals: readonly Refusal[] =
    subset.state === "unusable"
      ? [
          ...subset.refused,
          ...subset.blocked.map((edit) => ({
            placeIndex: edit.placeIndex,
            reason: subset.reason,
          })),
        ]
      : subset.refused;

  /**
   * One line per refused place, carrying **its own** reason. The previous version
   * printed the same sentence under every city, which is how "places[0] « Tokyo »
   * : les coordonnées de places[2] portent « latitude »" got shown to an author.
   */
  for (const { placeIndex, reason } of refusals) {
    emit({
      kind: "unresolved",
      place: placeRef(trip.value, placeIndex),
      reason: { state: "unsupported-yaml", reason },
    });
  }

  if (subset.state !== "writable" || subset.edits.length === 0) {
    return {
      state: "done",
      ...summary,
      resolved: 0,
      failed: failed + refusals.length,
      written: false,
    };
  }

  /**
   * `trip.source` is the text the splices were computed against, so it is both
   * what has to be on disk for the offsets to still mean anything and what tells
   * whether the author saved over it while the prompt was waiting.
   */
  const resolved = subset.edits.length;
  const written = writeAtomically(trip.absolutePath, trip.source, subset.text);

  if (written.state === "changed-underfoot") {
    return { state: "file-changed", file, resolved };
  }
  if (written.state === "not-utf8") {
    return { state: "file-not-utf8", file, resolved };
  }
  if (written.state === "failed") {
    return { state: "write-failed", file, reason: written.reason, resolved };
  }

  const outside = !isInsideDirectory(request.contentDir, written.target);

  return {
    state: "done",
    ...summary,
    resolved,
    failed: failed + refusals.length,
    written: true,
    ...(outside ? { writtenTo: displayPath(request.repoRoot, written.target) } : {}),
  };
}
