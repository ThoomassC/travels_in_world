import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { isMap, isSeq, LineCounter, parseDocument } from "yaml";
import type { FieldPath, SourceLocation } from "./finding";

/**
 * The disk and the YAML, kept strictly outside the domain (see
 * `docs/adr/0001-domain-purity.md`). Nothing here judges a trip: it reads the
 * collection, and it answers the one question the error messages need that the
 * parsed value cannot — *which line* a field was written on.
 *
 * `yaml.parse` returns `any`; every value that leaves this module is typed
 * `unknown`, so the only way to use it downstream is to narrow it or to parse it
 * with `TripSchema`.
 */

export const TRIP_FILE_NAME = "trip.yaml";

/** Resolves a field path to the line it was written on, when it exists at all. */
export type Locate = (field: FieldPath) => SourceLocation | undefined;

export type YamlProblem = {
  readonly message: string;
  /** `yaml`'s own error code, e.g. `DUPLICATE_KEY` — it decides the advice. */
  readonly code: string;
  readonly location?: SourceLocation;
  /** Errors reported after this one, which are almost always its consequences. */
  readonly consequences: number;
};

export type TripFile = {
  /** The directory name under the content root — by convention, the trip slug. */
  readonly directory: string;
  /** Absolute path of the `trip.yaml` that was read, or was expected. */
  readonly absolutePath: string;
} & (
  | {
      readonly state: "parsed";
      readonly value: unknown;
      readonly locate: Locate;
      /**
       * The file exactly as it is on disk.
       *
       * Carried rather than re-read because `npm run geocode` (TIW-10) edits this
       * text at byte offsets and writes it back: reading the file a second time
       * would open a window in which the author saves an edit between the read
       * that produced the offsets and the read that produced the text — and the
       * offsets would then point into a different file.
       */
      readonly source: string;
      /** Paths of keys JavaScript reads as instructions — see {@link UNSAFE_KEYS}. */
      readonly unsafeKeys: readonly FieldPath[];
    }
  | {
      readonly state: "absent";
      /** A file whose name differs from `trip.yaml` only by case, if there is one. */
      readonly similarName?: string;
    }
  | {
      readonly state: "unreadable";
      readonly reason: string;
      /** Which of the two could not be opened — the message says so. */
      readonly scope: "directory" | "file";
    }
  | { readonly state: "broken-link" }
  | { readonly state: "malformed"; readonly problems: readonly YamlProblem[] }
);

export type TripCollection =
  | { readonly state: "missing-directory" }
  | { readonly state: "unreadable-directory"; readonly reason: string }
  | {
      readonly state: "read";
      readonly files: readonly TripFile[];
      /**
       * YAML files sitting directly in the content root. A trip is a *directory*,
       * so `content/trips/japon-2024.yaml` is content nobody will ever read —
       * reported rather than skipped, because a silently ignored trip is the
       * failure this whole script exists to prevent.
       */
      readonly strayFiles: readonly string[];
    };

/** The `code` of a Node system error, without asserting anything about `unknown`. */
function errorCode(cause: unknown): string | undefined {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const { code } = cause;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/* --------------------------------------------------------------- positions -- */

/** A YAML node that knows where it came from. `range[0]` is its first byte. */
function offsetOf(node: unknown): number | undefined {
  if (typeof node !== "object" || node === null || !("range" in node)) {
    return undefined;
  }
  const { range } = node;
  if (!Array.isArray(range)) {
    return undefined;
  }
  const [start] = range;

  return typeof start === "number" ? start : undefined;
}

/** The scalar value of a key node, as the string a field path would use. */
function keyName(key: unknown): string | undefined {
  if (typeof key !== "object" || key === null || !("value" in key)) {
    return undefined;
  }
  const { value } = key;

  // `2024:` parses as the *number* 2024, while the field path carries the string
  // "2024". Comparing the rendered form is what makes the two meet.
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : undefined;
}

/**
 * The node that *names* a field: the key, never its value.
 *
 * Taking the value's position looks equivalent and is not. For any key whose
 * value is a block collection, the value starts on the *next* line — so a
 * forgotten plural (`photo:` for `photos:`) was reported one line below itself,
 * on a line where the word "photo" does not appear. A comment between the key
 * and its value moved it further still. Measured on both before this existed.
 */
function nodeAt(document: ReturnType<typeof parseDocument>, field: FieldPath): unknown {
  if (field.length === 0) {
    return undefined;
  }

  const last = field[field.length - 1];
  const parentPath = field.slice(0, -1);
  const parent: unknown =
    parentPath.length === 0 ? document.contents : document.getIn(parentPath, true);

  if (isMap(parent)) {
    for (const item of parent.items) {
      if (keyName(item.key) === String(last)) {
        return item.key;
      }
    }
    return undefined;
  }

  if (isSeq(parent) && typeof last === "number") {
    return parent.items[last];
  }

  return undefined;
}

/**
 * Where a field was written, or nothing at all.
 *
 * "Nothing at all" is a deliberate answer. The previous version walked the path
 * upwards until *something* resolved, which for an unresolvable path meant the
 * document itself: a numeric key `2024:` on line 45 was reported on line 4,
 * pointing at a healthy `slug:`. A position that is wrong is worse than no
 * position — the author reads the wrong line and stops trusting the tool.
 *
 * One step up is still allowed, and only one: `places[1].coordinates` has no node
 * when the key was never written, and the line of the `places[1]` entry is the
 * right place to look. That step is only taken into a container that is itself
 * inside the document, never up to the document.
 */
function locator(document: ReturnType<typeof parseDocument>, lineCounter: LineCounter): Locate {
  const positionOf = (node: unknown): SourceLocation | undefined => {
    const offset = offsetOf(node);
    if (offset === undefined) {
      return undefined;
    }
    const { line, col } = lineCounter.linePos(offset);

    return { line, column: col };
  };

  return (field) => {
    const exact = positionOf(nodeAt(document, field));
    if (exact !== undefined) {
      return exact;
    }

    return field.length >= 2 ? positionOf(nodeAt(document, field.slice(0, -1))) : undefined;
  };
}

/* ------------------------------------------------------------------ reading -- */

/**
 * Keys that JavaScript treats as instructions rather than data. Assigning
 * `__proto__` sets an object's prototype instead of creating an own property, so
 * `z.strictObject` never sees the key: measured, a `__proto__:` line made a trip
 * validate green while the value went on to the loader untouched. The check has
 * to run on the YAML document, which still has the key, and at every depth.
 */
const UNSAFE_KEYS = new Set(["__proto__"]);

function unsafeKeyPaths(document: ReturnType<typeof parseDocument>): readonly FieldPath[] {
  const found: FieldPath[] = [];

  const walk = (node: unknown, at: FieldPath): void => {
    if (isMap(node)) {
      for (const item of node.items) {
        const name = keyName(item.key);
        if (name === undefined) {
          continue;
        }
        if (UNSAFE_KEYS.has(name)) {
          found.push([...at, name]);
        }
        walk(item.value, [...at, name]);
      }
      return;
    }
    if (isSeq(node)) {
      node.items.forEach((item, index) => walk(item, [...at, index]));
    }
  };

  walk(document.contents, []);

  return found;
}

/**
 * The states a *single* YAML file can be in once it has been found — the three
 * that {@link TripFile} and {@link VisitedPlacesFile} share, and nothing else.
 *
 * Extracted with TIW-36 because two collections now read the same way and must
 * therefore report the same way: the choice of the first parser error, the
 * stripping of its repeated position, the `toJS()` that enforces `yaml`'s alias
 * budget, and the `ENOENT`-versus-`EACCES` distinction are each a measured
 * decision, and a second transcription of them is a second chance to lose one.
 *
 * What is deliberately **not** here is how a file is *located*: a trip is a
 * `trip.yaml` inside a directory whose name is the slug, the visited places are
 * one file with a fixed name. That is the whole difference between the two
 * readers below, which is exactly why it is the only thing they still each own.
 */
type YamlReading =
  | {
      readonly state: "parsed";
      readonly value: unknown;
      readonly locate: Locate;
      readonly source: string;
      readonly unsafeKeys: readonly FieldPath[];
    }
  | { readonly state: "unreadable"; readonly reason: string }
  | { readonly state: "malformed"; readonly problems: readonly YamlProblem[] }
  /**
   * `ENOENT`, and **only** `ENOENT`. The two callers read this differently — a
   * missing `trip.yaml` inside a trip folder is an unfinished trip, a missing
   * `places.yaml` is a journal with no dateless place, which is the ordinary
   * state — so the distinction is preserved here and decided there.
   */
  | { readonly state: "absent" };

function readYamlFile(absolutePath: string): YamlReading {
  let source: string;
  try {
    source = readFileSync(absolutePath, "utf8");
  } catch (cause) {
    // `existsSync` used to guard this and swallowed EACCES, which turned an
    // unreadable trip into "the file is absent — remove the folder". Following
    // that advice deletes a real trip.
    return errorCode(cause) === "ENOENT"
      ? { state: "absent" }
      : { state: "unreadable", reason: errorMessage(cause) };
  }

  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter });

  const [first, ...rest] = document.errors;
  if (first !== undefined) {
    return {
      state: "malformed",
      /**
       * The first error only. A parser that has lost its footing reports every
       * line after it: a single tab in the indentation produced ten findings,
       * nine of them consequences of the first. Same principle as dropping the
       * out-of-range steps when the trip's own range is inverted — a consequence
       * carries no information, and the count is kept so nothing is hidden.
       */
      problems: [
        {
          // The parser's message repeats the position the finding already
          // prints, and carries a multi-line source excerpt after it.
          message: (first.message.split("\n")[0] ?? first.message).replace(
            / at line \d+, column \d+:?$/,
            ""
          ),
          code: first.code,
          consequences: rest.length,
          ...(first.linePos === undefined
            ? {}
            : { location: { line: first.linePos[0].line, column: first.linePos[0].col } }),
        },
      ],
    };
  }

  let value: unknown;
  try {
    // `toJS()` is typed `any`; this is the assignment that stops it spreading.
    // It also *resolves* the document, which is where `yaml` enforces its alias
    // budget — so a file built to expand exponentially throws here rather than
    // eating the build, and it must come out as a finding, not a stack trace.
    value = document.toJS();
  } catch (cause) {
    return {
      state: "malformed",
      problems: [{ message: errorMessage(cause), code: "UNRESOLVABLE", consequences: 0 }],
    };
  }

  return {
    state: "parsed",
    value,
    source,
    locate: locator(document, lineCounter),
    unsafeKeys: unsafeKeyPaths(document),
  };
}

/**
 * The name of the one file holding the places the journal has been to with no
 * journey attached (TIW-36).
 *
 * A single file rather than a directory per place, for the reason
 * `docs/lieux-visites.md` gives: its body **is** a trip's `places[]` block, so
 * promoting a place into a real trip is a move of contiguous lines that rewrites
 * neither the slug nor the coordinates.
 */
export const VISITED_PLACES_FILE_NAME = "places.yaml";

export type VisitedPlacesFile = {
  /** Absolute path of the file that was read, or was expected. */
  readonly absolutePath: string;
} & (
  | {
      readonly state: "parsed";
      readonly value: unknown;
      readonly locate: Locate;
      /** The file exactly as it is on disk — see the note on {@link TripFile}. */
      readonly source: string;
      readonly unsafeKeys: readonly FieldPath[];
    }
  /**
   * There is no such file, and that is **not** a fault: a journal holding no
   * dateless place is the ordinary case, and it was the whole state of this
   * repository before TIW-36. A near-miss on the name is carried anyway, for the
   * reason a miscased `Trip.yaml` is — "write this file" and "rename the one you
   * already wrote" are different instructions, and only one of them destroys
   * work.
   */
  | { readonly state: "absent"; readonly similarName?: string }
  | { readonly state: "unreadable"; readonly reason: string }
  | { readonly state: "malformed"; readonly problems: readonly YamlProblem[] }
);

/**
 * Reads the visited-places file at an absolute path, or says why it could not.
 *
 * **The path is given whole rather than composed from a content directory**, and
 * that is the seam the CLI needs: `--places <fichier>` and `TIW_PLACES_FILE` name
 * a file, not a folder. It also keeps this collection's root independent of the
 * trips' one — the trips directory refuses a loose `.yaml` at its own root,
 * because a trip is a directory, so a places file dropped in there would be
 * reported as content nobody reads.
 */
export function readVisitedPlacesFile(absolutePath: string): VisitedPlacesFile {
  const wanted = path.basename(absolutePath);

  /**
   * **The directory is listed before the file is opened**, and the order is the
   * whole point rather than a style: `readFileSync` goes through the *filesystem*,
   * which on macOS answers `Places.yaml` to a request for `places.yaml` and on
   * the case-sensitive filesystem of the CI answers nothing. Reading first and
   * looking for a near-miss afterwards therefore gives two different verdicts on
   * two machines for the same tree — measured, on this very test: the case-only
   * mismatch was read happily on the workstation and would have 404'd online.
   * Comparing against the names `readdir` really reports is the one reading that
   * is the same everywhere. Same discipline as `readTripFile`, and the same
   * lesson `assetFindings` records for photo paths.
   */
  let entries: readonly string[];
  try {
    entries = readdirSync(path.dirname(absolutePath));
  } catch (cause) {
    // The directory is missing or closed. A missing one means no places file,
    // which is the ordinary state; anything else is a refusal the caller must
    // hear rather than read as "no places".
    return errorCode(cause) === "ENOENT"
      ? { absolutePath, state: "absent" }
      : { absolutePath, state: "unreadable", reason: errorMessage(cause) };
  }

  if (!entries.includes(wanted)) {
    const similarName = entries.find((name) => name.toLowerCase() === wanted.toLowerCase());

    return { absolutePath, state: "absent", ...(similarName === undefined ? {} : { similarName }) };
  }

  const reading = readYamlFile(absolutePath);

  return { absolutePath, ...reading };
}

function readTripFile(contentDir: string, directory: string): TripFile {
  const tripDirectory = path.join(contentDir, directory);
  const absolutePath = path.join(tripDirectory, TRIP_FILE_NAME);
  const identity = { directory, absolutePath };

  let entries: readonly string[];
  try {
    entries = readdirSync(tripDirectory).map((name) => name);
  } catch (cause) {
    return { ...identity, state: "unreadable", reason: errorMessage(cause), scope: "directory" };
  }

  /**
   * Compared to the real name on disk, not through `existsSync`: macOS answers
   * yes for `Trip.yaml`, and the same repository then fails on Linux in CI. The
   * near-miss is worth naming — it is the whole difference between "write this
   * file" and "rename it".
   */
  if (!entries.includes(TRIP_FILE_NAME)) {
    const similarName = entries.find((name) => name.toLowerCase() === TRIP_FILE_NAME);

    return { ...identity, state: "absent", ...(similarName === undefined ? {} : { similarName }) };
  }

  const reading = readYamlFile(absolutePath);

  /**
   * `absent` cannot be reached here — the name was just found in `readdir` — but
   * the union carries it, and mapping it to the trip's own `absent` is the honest
   * narrowing: a file that vanished between the two syscalls really is gone.
   * `scope: "file"` on `unreadable`, because the directory opened a moment ago.
   */
  return reading.state === "unreadable"
    ? { ...identity, state: "unreadable", reason: reading.reason, scope: "file" }
    : { ...identity, ...reading };
}

/** Alphabetical, so two runs report the same problems in the same order. */
function byName(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const YAML_EXTENSION = /\.ya?ml$/i;

/**
 * One trip per sub-directory. Three deliberate refusals to look away:
 *
 * - a directory without a `trip.yaml` is *not* skipped — an empty trip folder is
 *   a half-finished trip, and silence is the one answer that helps nobody;
 * - a symlink to a directory is followed, because `readdir` reports it as
 *   neither a file nor a directory and the trip behind it would simply vanish;
 * - a *broken* symlink is reported rather than dropped, which is what the second
 *   rule did to it until this was measured.
 *
 * Hidden entries are the one thing deliberately ignored: `.gitkeep` is required
 * to keep the empty folder in git, and on macOS `.DS_Store` or `.Spotlight-V100`
 * would otherwise each earn an absurd "this trip is unfinished".
 */
export function readTripCollection(contentDir: string): TripCollection {
  if (!existsSync(contentDir) || !statSync(contentDir).isDirectory()) {
    return { state: "missing-directory" };
  }

  // `Dirent<string>` explicitly: the bare return type of `readdirSync` resolves
  // to the Buffer overload, whose names are not strings.
  let entries: readonly Dirent<string>[];
  try {
    entries = readdirSync(contentDir, { withFileTypes: true });
  } catch (cause) {
    // Unprotected, this was the one path that printed a Node stack trace.
    return { state: "unreadable-directory", reason: errorMessage(cause) };
  }

  const directories: string[] = [];
  const brokenLinks: string[] = [];
  const strayFiles: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(contentDir, entry.name);

    if (entry.isSymbolicLink() && !existsSync(entryPath)) {
      brokenLinks.push(entry.name);
      continue;
    }
    // `statSync` follows the link, which is exactly the question being asked.
    if (entry.isDirectory() || (entry.isSymbolicLink() && statSync(entryPath).isDirectory())) {
      directories.push(entry.name);
    } else if (YAML_EXTENSION.test(entry.name)) {
      strayFiles.push(entry.name);
    }
  }

  const files: TripFile[] = directories
    .sort(byName)
    .map((directory) => readTripFile(contentDir, directory));

  for (const name of brokenLinks.sort(byName)) {
    files.push({
      directory: name,
      absolutePath: path.join(contentDir, name, TRIP_FILE_NAME),
      state: "broken-link",
    });
  }

  return { state: "read", files, strayFiles: strayFiles.sort(byName) };
}

/* ------------------------------------------------------------ reading values -- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The value the author actually wrote at a path, or `undefined`.
 *
 * The messages need this: a rejected document cannot be read through the parsed
 * type, and "the city « Kyoto » has no coordinates" is only possible by reading
 * the name back out of the rejected document. It never throws, whatever shape
 * the YAML turned out to be.
 */
export function valueAt(root: unknown, field: FieldPath): unknown {
  let current: unknown = root;

  for (const segment of field) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[segment];
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

/** The value at a path when it is a non-blank string, and nothing otherwise. */
export function stringAt(root: unknown, field: FieldPath): string | undefined {
  const value = valueAt(root, field);

  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Directory listings, kept for the duration of one run. A local cache passed by
 * the caller, never module state: two validations in the same process (the test
 * suite does exactly that) must not be able to see each other's disk.
 */
export type DirectoryCache = Map<string, readonly string[] | undefined>;

export function createDirectoryCache(): DirectoryCache {
  return new Map();
}

function namesIn(directory: string, cache: DirectoryCache): readonly string[] | undefined {
  const cached = cache.get(directory);
  if (cached !== undefined || cache.has(directory)) {
    return cached;
  }

  let names: readonly string[] | undefined;
  try {
    names = readdirSync(directory);
  } catch {
    names = undefined;
  }
  cache.set(directory, names);

  return names;
}

export type FileLookup =
  | { readonly state: "found" }
  | { readonly state: "missing" }
  /** The name exists on disk, spelled with a different case. */
  | { readonly state: "case-mismatch"; readonly onDisk: string };

/**
 * Whether a path exists as a file, comparing **every** segment to the real name
 * on disk.
 *
 * `existsSync` would be one line, and it answers on the case-insensitive
 * filesystem it happens to be running on: `/photos/Tokyo.JPG` for a file named
 * `tokyo.jpg` passes on macOS and 404s on the Linux CDN. The whole point of this
 * check is to catch that before it ships, so the comparison has to be exact —
 * for the directories on the way as much as for the file itself.
 *
 * A near-miss is reported as such rather than as "no such file": telling someone
 * to add a file that is already there, under one letter of difference, is how a
 * correct diagnosis still wastes an afternoon.
 */
export function lookupFile(
  root: string,
  segments: readonly string[],
  cache: DirectoryCache
): FileLookup {
  let current = root;

  for (const [index, segment] of segments.entries()) {
    const names = namesIn(current, cache);
    if (names === undefined) {
      return { state: "missing" };
    }
    if (!names.includes(segment)) {
      const onDisk = names.find((name) => name.toLowerCase() === segment.toLowerCase());

      return onDisk === undefined ? { state: "missing" } : { state: "case-mismatch", onDisk };
    }
    current = path.join(current, segment);

    if (index === segments.length - 1) {
      try {
        return statSync(current).isFile() ? { state: "found" } : { state: "missing" };
      } catch {
        return { state: "missing" };
      }
    }
  }

  return { state: "missing" };
}

/**
 * A path as it should appear in a message: relative to the repository root and
 * POSIX-separated, so it can be pasted into an editor or a shell. Anything
 * outside the repository keeps its absolute form rather than growing a run of
 * `../`, which no one can read.
 */
export function displayPath(repoRoot: string, absolutePath: string): string {
  const relative = path.relative(repoRoot, absolutePath);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return absolutePath.split(path.sep).join("/");
  }

  return relative.split(path.sep).join("/");
}
