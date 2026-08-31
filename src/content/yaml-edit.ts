import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { Pair, YAMLMap } from "yaml";
import { CoordinatesSchema } from "@/domain/geo";
import { valueAt } from "./collection";
import { quoted, quotedList } from "./finding";

/**
 * Writing two numbers into a hand-written YAML file without touching anything
 * else.
 *
 * **Why this is not `Document.setIn()` plus `Document.toString()`.** That is the
 * obvious implementation, it is two lines, and it was measured before this module
 * existed. `toString()` re-serialises the *whole* document from the AST, and two
 * of its normalisations are exactly what constraint A of TIW-10 forbids:
 *
 * - a file indented with four spaces comes back indented with two — every line
 *   of it rewritten to add one key;
 * - `countryCode: JP   # aligné` comes back as `countryCode: JP # aligné`,
 *   because a comment's column is not something the AST keeps.
 *
 * (A third, smaller one: a trailing document comment gains a blank line above
 * it.) None of the three loses information a parser would notice, and all three
 * turn a two-number edit into a diff across the file — which is how an author
 * stops trusting a tool and goes back to copying latitudes by hand.
 *
 * So the `Document` is used for what only it can do — telling us the *kind* and
 * the *byte range* of every node — and the edit is applied to the source text at
 * the offsets it reports. Everything outside those offsets is byte-identical by
 * construction, which is a stronger promise than any round-trip can make.
 *
 * **The seam TIW-17 widened, rather than copied.** `npm run index-photos` writes
 * `width`, `height` and `blurDataUrl` under `photos[i]`, which is the same
 * problem at another path with other keys — and copying this module would have
 * meant re-living both corruption bugs documented below, in a second place.
 *
 * What the two writers share is {@link editSequenceEntries}: find the entry in a
 * top-level sequence, collect its splices, apply them from the end of the file
 * backwards, re-parse, and read the values back **at the index they were asked
 * for**. What they do not share is the shape of what they write, and that is the
 * real difference between them rather than a parameter:
 *
 * - {@link writeCoordinates} creates a **nested mapping** under a key that may
 *   not exist yet — four shapes to handle (key absent, block, flow, empty);
 * - {@link writePhotoFields} writes **scalars directly on the entry** — three
 *   shapes (key absent, key with a value, key left empty), and it refuses a
 *   mapping or a list where a number belongs.
 *
 * The two corruption bugs are shape bugs, so each writer meets them in its own
 * form. Both are documented at the branch that pays for them, in both writers.
 */

export type CoordinateEdit = {
  /** Index into `places[]`, as `TripSchema` and the findings number them. */
  readonly placeIndex: number;
  readonly lat: number;
  readonly lon: number;
};

export type YamlEditResult =
  /** The new file text. Identical to the input when `edits` is empty. */
  | { readonly state: "edited"; readonly text: string }
  /**
   * A shape this edit will not guess at. Reported rather than forced: a wrong
   * guess writes invalid YAML into the file it was asked to repair.
   *
   * `reason` never repeats the `places[N]` its caller already prints, and every
   * third-party fragment inside it — a key name, a slice of the source — is
   * neutralised **here**. A caller that stops escaping must not be able to turn
   * a hostile key name back into a live escape sequence.
   *
   * `entryIndex` is present whenever the refusal is about **one** entry of the
   * sequence, which is what lets the caller drop that entry and write the rest:
   * one city in an unhandled shape used to throw away every coordinate the run
   * had resolved. It is absent for a refusal about the document as a whole, where
   * no subset would fare better.
   *
   * Named for the entry and not for the place, because both writers report
   * through it — `places[i]` for the coordinates, `photos[i]` for the photo
   * fields. Each caller translates it back into its own vocabulary.
   */
  | {
      readonly state: "unsupported";
      readonly reason: string;
      readonly entryIndex?: number;
    };

/**
 * A byte range of the source, and the text that replaces it.
 *
 * `rank` breaks a tie between two splices at the **same** offset, in document
 * order: rank 0 is the text that must end up first in the file, rank 1 next.
 *
 * It exists because a tie is reachable and silently produces garbage. Measured on
 * a photo whose last key was left empty:
 *
 *     width: # à mesurer
 *     height:
 *
 * `height:`'s null value and the end of the photo's own block are the same offset,
 * so filling `height` and appending `blurDataUrl` both splice there. Splices are
 * applied from the end of the file backwards, and at one offset the *last* applied
 * ends up leftmost — so without a tie-break the appended key landed **between**
 * `height:` and its value:
 *
 *     height:
 *     blurDataUrl: data:…
 *      1067
 *
 * which is `All mapping items must start at the same column`. Hence sorting on
 * `rank` descending as well: the higher rank is applied first and ends up on the
 * right, which is document order.
 */
type Splice = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly rank?: number;
};

/**
 * How many decimals the file ever holds. About a centimetre at the equator — far
 * beyond what a map of the world can draw, and beyond the five the service
 * returns. Named because two guards have to agree on it: this formatter, and the
 * check in {@link writeCoordinates} that the *rounded* pair is still a place.
 */
const COORDINATE_DECIMALS = 7;

/**
 * A coordinate as a plain decimal, never in exponent notation.
 *
 * `String(1e-7)` is `"1e-7"`. YAML reads it as a number and a human reading a
 * diff does not, so it is expanded. Trailing zeros are trimmed, so `-33.5` stays
 * `-33.5`.
 */
export function formatCoordinate(value: number): string {
  const fixed = value.toFixed(COORDINATE_DECIMALS);
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;

  // `(-0).toFixed(7)` is "-0.0000000", which trims to "-0".
  return trimmed === "-0" ? "0" : trimmed;
}

/**
 * The line ending the file already uses, taken from its first one.
 *
 * A file saved by an editor on Windows is `\r\n` throughout, and inserting three
 * `\n` lines into it makes every tool downstream see a mixed file — which is a
 * diff on every line, by another door than the one this module closes.
 */
function detectNewline(source: string): string {
  const first = source.indexOf("\n");

  return first > 0 && source[first - 1] === "\r" ? "\r\n" : "\n";
}

/**
 * Where the line holding `offset` ends: `contentEnd` before any `\r`, `next` past
 * the break. Two indices because the text of the line and the start of the next
 * one are not the same place on a `\r\n` file.
 */
function lineEndFrom(source: string, offset: number): { contentEnd: number; next: number } {
  const breakIndex = source.indexOf("\n", offset);
  if (breakIndex === -1) {
    return { contentEnd: source.length, next: source.length };
  }
  const contentEnd =
    breakIndex > 0 && source[breakIndex - 1] === "\r" ? breakIndex - 1 : breakIndex;

  return { contentEnd, next: breakIndex + 1 };
}

/** The column a node starts at, counted from the start of its line. */
function columnOf(source: string, offset: number): number {
  return offset - (source.lastIndexOf("\n", offset - 1) + 1);
}

/** The indentation string a sibling of the node at `offset` must carry. */
function indentAt(source: string, offset: number): string {
  return " ".repeat(columnOf(source, offset));
}

function keyStart(pair: Pair<unknown, unknown>): number | undefined {
  const key: unknown = pair.key;
  if (typeof key !== "object" || key === null || !("range" in key)) {
    return undefined;
  }
  const { range } = key;

  return Array.isArray(range) && typeof range[0] === "number" ? range[0] : undefined;
}

/** `[start, valueEnd)` of a node: the value text, *without* its trailing comment. */
function valueRange(node: unknown): readonly [number, number] | undefined {
  if (typeof node !== "object" || node === null || !("range" in node)) {
    return undefined;
  }
  const { range } = node;
  if (!Array.isArray(range) || typeof range[0] !== "number" || typeof range[1] !== "number") {
    return undefined;
  }

  return [range[0], range[1]];
}

/**
 * A pair's key as text, or `undefined` when the key is not a scalar — a complex
 * `? key` mapping, which nothing here can name.
 *
 * Scalars are stringified rather than required to be strings: a mapping can be
 * keyed on `1` or on `null`, and a refusal whose whole value is *quoting* the
 * key it refuses cannot drop it on the way.
 */
function keyText(pair: Pair<unknown, unknown>): string | undefined {
  const key: unknown = pair.key;
  if (typeof key !== "object" || key === null || !("value" in key)) {
    return undefined;
  }
  const { value } = key;

  return value === null ? "null" : String(value);
}

function pairNamed(
  map: YAMLMap<unknown, unknown>,
  name: string
): Pair<unknown, unknown> | undefined {
  return map.items.find((item) => keyText(item) === name);
}

/**
 * The axes, named by the schema that will judge the file afterwards rather than
 * restated here.
 *
 * `CoordinatesSchema` is a **strict** object, so its shape is not a hint: it is
 * the exhaustive list of keys a `coordinates:` mapping may hold, and any other
 * key in one is a misspelling `validate:content` refuses. Reading the list from
 * there is what lets this module tell an axis from a stranger without keeping a
 * second copy of the pair that could drift from it.
 *
 * `Object.keys` cannot carry the literal types, hence the assertion. `axesOf`
 * below is the compile-time half: an axis added to the schema would leave its
 * object literal incomplete, so this module cannot quietly write two keys out of
 * three.
 */
type Axis = keyof typeof CoordinatesSchema.shape;

const AXES = Object.keys(CoordinatesSchema.shape) as readonly Axis[];

const AXIS_NAMES: ReadonlySet<string> = new Set<string>(AXES);

/** The value each axis is to be written with. */
function axesOf(edit: CoordinateEdit): Readonly<Record<Axis, number>> {
  return { lat: edit.lat, lon: edit.lon };
}

/**
 * A value as the author typed it, for a refusal he has to recognise in his own
 * file.
 *
 * Sliced out of the source rather than re-serialised from the node: a list the
 * AST prints back is not the text he is looking at. Folded onto one line and
 * shortened, because the whole point is to be readable in a terminal.
 */
function sourceExcerpt(source: string, range: readonly [number, number]): string {
  const folded = source
    .slice(range[0], range[1])
    .trim()
    .replace(/\s*\r?\n\s*/g, " ");

  return folded.length > 40 ? `${folded.slice(0, 39)}…` : folded;
}

/**
 * The splices that write one place's coordinates. Four shapes, and the branch is
 * chosen from the AST rather than from a regular expression on the text:
 *
 * 1. no `coordinates:` key — append a block after the place's last entry;
 * 2. a block mapping — replace each axis that is there, append each that is not;
 * 3. a flow mapping holding both axes — replace the two scalars, in place, so a
 *    file written `{ lat: …, lon: … }` stays written that way;
 * 4. an empty `coordinates:` — or one holding an explicit `null`, or a flow
 *    mapping missing an axis — replace the value with a block, which is the one
 *    form always valid there.
 *
 * Two shapes get no branch at all and are refused: a mapping holding a key that
 * is not an axis, and a value that is neither null nor a mapping. See each check
 * for why forcing it through would be worse than stopping.
 */
function splicesForPlace(
  source: string,
  place: YAMLMap<unknown, unknown>,
  edit: CoordinateEdit
): readonly Splice[] | { readonly reason: string } {
  if (place.flow) {
    return {
      reason: "ce lieu est écrit en style « flow » ({ … }) → réécris-le en bloc de clés",
    };
  }

  const first = place.items[0];
  const firstOffset = first === undefined ? undefined : keyStart(first);
  if (firstOffset === undefined) {
    return { reason: "ce lieu n'a aucune clé lisible → réécris-le en bloc de clés" };
  }
  const keyIndent = indentAt(source, firstOffset);
  const axisValue = axesOf(edit);
  const newline = detectNewline(source);

  const block = (indent: string): string =>
    AXES.map((axis) => `${indent}${axis}: ${formatCoordinate(axisValue[axis])}`).join(newline);

  const coordinates = pairNamed(place, "coordinates");

  /* 1. No `coordinates:` at all: append the whole block after the last entry. */
  if (coordinates === undefined) {
    const placeRange = valueRange(place);
    if (placeRange === undefined) {
      return { reason: "ce lieu n'a pas de position lisible dans le fichier" };
    }
    const at = placeRange[1];
    // `range[1]` of a block collection lands just past the newline of its last
    // line — after any trailing comment — except at a file that ends without one.
    const lead = at === 0 || source[at - 1] === "\n" ? "" : newline;

    return [
      {
        start: at,
        end: at,
        text: `${lead}${keyIndent}coordinates:${newline}${block(`${keyIndent}  `)}${newline}`,
      },
    ];
  }

  const value: unknown = coordinates.value;
  const coordinatesKeyRange = valueRange(coordinates.key);
  const coordinatesValueRange = valueRange(value);

  if (coordinatesKeyRange === undefined || coordinatesValueRange === undefined) {
    return { reason: "« coordinates » n'a pas de position lisible dans le fichier" };
  }

  /**
   * Replaces whatever `coordinates:` holds with a block of the two axes, while
   * **keeping whatever else was on the key's own line** — which in practice means
   * the author's comment.
   *
   * This is the branch that corrupted files. It used to splice from the colon to
   * the start of the value, on the assumption that a null value starts just after
   * the colon. Measured: on `coordinates: # rempli par …` the null scalar's range
   * starts *at the `#`*, so the splice swallowed the `: ` separator and the block
   * came out flush against the comment —
   *
   *     lon: 135.75385# rempli par …
   *
   * — which YAML then reads as the *string* `"135.75385# rempli par …"`. The
   * comment was absorbed into the scalar, gone for good on the next run, and the
   * command exited 0 announcing the file had been rewritten.
   *
   * So the unit of replacement is the key's **line**, not the value's range: the
   * colon, whatever text was left on that line, the break, then the block.
   * Nothing outside that line is touched — except a value that genuinely spans
   * further lines, which is replaced through its end.
   */
  const replaceValueWithBlock = (): Splice => {
    const colon = coordinatesKeyRange[1];
    const { contentEnd, next } = lineEndFrom(source, colon);
    const valueOnKeyLine = coordinatesValueRange[0] <= contentEnd;
    const valueIsEmpty = coordinatesValueRange[0] === coordinatesValueRange[1];

    /**
     * What stays on the key's line once the value is dropped. Sliced out of the
     * source rather than rebuilt from `Pair.comment`, so the author's own spacing
     * before the `#` survives verbatim.
     *
     * For an *empty* value the slice starts where the comment starts, so the
     * separator between the colon and it has to be put back; for a value that has
     * text, the slice already begins with the space that preceded the comment.
     */
    const tail = valueOnKeyLine
      ? source.slice(coordinatesValueRange[1], contentEnd)
      : source.slice(colon + 1, contentEnd);
    const separator =
      valueIsEmpty && valueOnKeyLine ? source.slice(colon + 1, coordinatesValueRange[0]) : "";

    return {
      start: colon,
      end: Math.max(next, coordinatesValueRange[1]),
      text: `:${tail === "" ? "" : `${separator}${tail}`}${newline}${block(`${keyIndent}  `)}${newline}`,
    };
  };

  /* 2 & 3. A mapping: edited axis by axis, which is what keeps its comments. */
  if (isMap(value)) {
    /**
     * A key that is not an axis — `latitude`, `long`, `Lat`.
     *
     * This used to be pinned the other way round: the two axes were appended
     * beside the misspelling, the file came back with three or four keys, exit 0
     * and « fichier réécrit », and `validate:content` then refused it because
     * `CoordinatesSchema` is strict. Writing a file this command has just
     * declared good is worse than refusing to write it.
     *
     * The flow branch below is the sharper reason to check *here*, before either
     * shape is chosen: it rewrites the mapping whole, so `{ latitude: 35.6 }`
     * would come back as `lat`/`lon` with the number the author typed **deleted**
     * — a silent data loss no re-parse can see, since the result is valid YAML.
     */
    const strangers = value.items
      .map((item) => keyText(item) ?? "?")
      .filter((name) => !AXIS_NAMES.has(name));

    if (strangers.length > 0) {
      /**
       * `quotedList` rather than a template: these names come out of the
       * author's file and are printed to a terminal, so they are bounded and
       * neutralised at the point they are interpolated. A key spelled
       * `lo<ESC>[2J` would otherwise clear the screen showing the refusal — the
       * attack `finding.ts` exists for — the moment a caller stops escaping.
       */
      return {
        reason: `« coordinates » porte ${quotedList(strangers)} — les seules clés acceptées sont ${AXES.join(" et ")} → corrige l'orthographe à la main, puis relance`,
      };
    }

    const pairs = AXES.map((axis) => ({ axis, pair: pairNamed(value, axis) }));
    const missing = pairs.filter((entry) => entry.pair === undefined);

    /* A flow mapping missing an axis is rewritten whole; every other mapping is
       patched, because patching is what leaves the untouched lines untouched. */
    if (missing.length === 0 || !value.flow) {
      const splices: Splice[] = [];

      for (const { axis, pair } of pairs) {
        if (pair === undefined) {
          continue;
        }
        const range = valueRange(pair.value);
        if (range === undefined) {
          return {
            reason: `la clé « ${axis} » de « coordinates » n'a pas de position lisible dans le fichier`,
          };
        }
        splices.push({ start: range[0], end: range[1], text: formatCoordinate(axisValue[axis]) });
      }

      if (missing.length > 0) {
        /**
         * The absent axes are appended in **one** splice rather than one each.
         * Two splices at the same offset would be applied one after the other and
         * come out in reverse, so `lon:` would land above `lat:`.
         *
         * The indentation follows the axis already in the mapping when there is
         * one — an author who indents four spaces gets four — and the key's own
         * indentation plus two otherwise.
         */
        const firstOnFile = pairs.find((entry) => entry.pair !== undefined)?.pair;
        const firstAxisOffset = firstOnFile === undefined ? undefined : keyStart(firstOnFile);
        const axisIndent =
          firstAxisOffset === undefined ? `${keyIndent}  ` : indentAt(source, firstAxisOffset);
        const at = coordinatesValueRange[1];
        const lead = at === 0 || source[at - 1] === "\n" ? "" : newline;

        splices.push({
          start: at,
          end: at,
          text:
            lead +
            missing
              .map(
                ({ axis }) => `${axisIndent}${axis}: ${formatCoordinate(axisValue[axis])}${newline}`
              )
              .join(""),
        });
      }

      return splices;
    }

    return [replaceValueWithBlock()];
  }

  /**
   * 4. `coordinates:` left empty — or holding an explicit `null`, which is the
   * same statement with a word on it. Both are *nothing*, so replacing them with
   * the block loses nothing.
   */
  const valueIsAbsent =
    coordinatesValueRange[0] === coordinatesValueRange[1] ||
    (isScalar(value) && value.value === null);

  if (valueIsAbsent) {
    return [replaceValueWithBlock()];
  }

  /**
   * Anything else under `coordinates:` — a scalar, a list, an alias — is text the
   * author typed, and there is **no** acceptable way to write the two axes next
   * to it. Both possible outcomes are defects, which is the whole reason this
   * refusal exists:
   *
   * - replacing the value with the block keeps his comment and *silently deletes
   *   his value*. `coordinates: "35.68, 139.69"`, a pair he meant to convert by
   *   hand, would be gone with no trace and no warning;
   * - appending the block under the value produces **invalid YAML**. Measured on
   *   `coordinates: 42` — `yaml.parse` throws "All mapping items must start at
   *   the same column", so the command would announce « fichier réécrit » over a
   *   file neither `validate:content` nor the site can read again.
   *
   * Silent data loss or a corrupt file: neither is worth a rewrite, so the value
   * is named and the file is left exactly as it is. Same posture as the
   * misspelled-axis refusal above, for the same reason.
   */
  return {
    // `quoted` for the same reason as the misspelled axis above: this is a raw
    // slice of the author's file on its way to a terminal.
    reason: `« coordinates » porte la valeur ${quoted(sourceExcerpt(source, coordinatesValueRange))} au lieu d'un bloc ${AXES.join("/")} → remplace-la par « coordinates: » seul, le géocodage écrira les deux axes`,
  };
}

/* =========================================================== the shared driver ==

   Everything below the line is what the two writers have in common: locating an
   entry in a top-level sequence, applying its splices, and proving the result is
   the document it was plus the values that were asked for.
   ============================================================================ */

/**
 * The splices that write one entry, or the reason it will not be written.
 *
 * A refusal from here is always about **one** entry, which is what lets
 * {@link editSequenceEntries} report it with an `entryIndex` and lets the caller
 * drop that entry and write the rest.
 */
type EntryWriter<TEdit> = (
  source: string,
  entry: YAMLMap<unknown, unknown>,
  edit: TEdit
) => readonly Splice[] | { readonly reason: string };

type SequenceEdit<TEdit> = {
  readonly source: string;
  /** The top-level key holding the sequence: `"places"`, `"photos"`. */
  readonly collection: string;
  /** The noun a refusal uses for one of its entries: `"un lieu"`, `"une photo"`. */
  readonly entryNoun: string;
  readonly edits: readonly TEdit[];
  readonly indexOf: (edit: TEdit) => number;
  readonly writer: EntryWriter<TEdit>;
  /**
   * A refusal decided **before** any splice is computed — the place for a check
   * on the values themselves rather than on the file's shape. See the rounded
   * `(0, 0)` guard in {@link writeCoordinates} for why that ordering matters.
   */
  readonly precheck?: (edit: TEdit) => string | undefined;
  /**
   * Reads the values back out of the re-parsed document, at the index they were
   * asked for, and names what is wrong. Guards this module's offset arithmetic
   * and nothing else.
   */
  readonly verify: (rewritten: unknown, edit: TEdit) => string | undefined;
};

function editSequenceEntries<TEdit>(request: SequenceEdit<TEdit>): YamlEditResult {
  const { source, collection, entryNoun, edits, indexOf, writer, precheck, verify } = request;

  if (edits.length === 0) {
    return { state: "edited", text: source };
  }

  const document = parseDocument(source);
  if (document.errors.length > 0) {
    const [first] = document.errors;

    return { state: "unsupported", reason: first?.message ?? "le fichier YAML ne se relit pas" };
  }

  const sequence: unknown = document.get(collection, true);
  if (!isSeq(sequence)) {
    return { state: "unsupported", reason: `la clé « ${collection} » n'est pas une liste` };
  }

  const splices: Splice[] = [];

  for (const edit of edits) {
    const entryIndex = indexOf(edit);

    const refused = precheck?.(edit);
    if (refused !== undefined) {
      return { state: "unsupported", entryIndex, reason: refused };
    }

    const entry: unknown = sequence.items[entryIndex];
    if (!isMap(entry)) {
      return {
        state: "unsupported",
        entryIndex,
        reason: `cet indice ne désigne pas ${entryNoun} décrit${entryNoun.startsWith("une") ? "e" : ""} par des clés`,
      };
    }

    const produced = writer(source, entry, edit);
    if ("reason" in produced) {
      return { state: "unsupported", entryIndex, reason: produced.reason };
    }
    splices.push(...produced);
  }

  /**
   * Applied from the end of the file backwards, so that no splice shifts the
   * offsets of the ones still to come. Sorted rather than assumed in order: the
   * caller numbers entries, not bytes.
   */
  const ordered = [...splices].sort(
    (left, right) => right.start - left.start || (right.rank ?? 0) - (left.rank ?? 0)
  );
  let text = source;
  for (const splice of ordered) {
    text = `${text.slice(0, splice.start)}${splice.text}${text.slice(splice.end)}`;
  }

  /**
   * The result has to be the same document plus the values. A splice is computed
   * from offsets, and an offset arithmetic bug would write plausible nonsense —
   * so the output is parsed back before it is handed to a caller that is about to
   * overwrite a file with it.
   */
  const verification = parseDocument(text);
  if (verification.errors.length > 0) {
    const [first] = verification.errors;

    return {
      state: "unsupported",
      reason: `la réécriture aurait produit du YAML invalide (${first?.message ?? "erreur inconnue"})`,
    };
  }

  /**
   * Parsing only proves the result is *a* document, not that it is the right one:
   * a splice landing one line early writes onto the *previous* entry, which
   * re-reads cleanly and is wrong. So the values are read back at the index they
   * were asked for, along the same path a finding names — the one
   * `validate:content` will walk.
   */
  const rewritten: unknown = verification.toJS();

  for (const edit of edits) {
    const wrong = verify(rewritten, edit);
    if (wrong !== undefined) {
      return {
        state: "unsupported",
        entryIndex: indexOf(edit),
        reason: `la réécriture n'a pas relu ${wrong} — défaut de la réécriture, pas du contenu ; le fichier n'a pas été touché`,
      };
    }
  }

  return { state: "edited", text };
}

/* ================================================================ coordinates ==*/

/**
 * The source text with the given coordinates written into it, and nothing else
 * changed.
 *
 * The document is re-parsed inside the driver rather than handed in: it makes
 * this module testable from a string alone, and re-reading one 60-line file costs
 * nothing next to the network call that produced the coordinates.
 */
export function writeCoordinates(source: string, edits: readonly CoordinateEdit[]): YamlEditResult {
  return editSequenceEntries<CoordinateEdit>({
    source,
    collection: "places",
    entryNoun: "un lieu",
    edits,
    indexOf: (edit) => edit.placeIndex,
    writer: (text, place, edit) => splicesForPlace(text, place, edit),
    /**
     * The pair **as it will be written**, checked against the schema that will
     * judge the file afterwards.
     *
     * The file only ever holds {@link COORDINATE_DECIMALS} decimals, so the
     * domain's opinion of the numbers the service returned is not the same
     * question as its opinion of the numbers this module is about to write:
     * `lat: 1e-8, lon: -1e-8` is not (0, 0) and rounds to it. Writing that made
     * `validate:content` refuse the file and send the author back to the very
     * command that had produced it — a loop with no way out. The read-back guard
     * cannot see it, since it compares against the rounded value too, so the
     * check has to happen here, before anything is committed.
     */
    precheck: (edit) => {
      const rounded = {
        lat: Number(formatCoordinate(edit.lat)),
        lon: Number(formatCoordinate(edit.lon)),
      };

      return CoordinatesSchema.safeParse(rounded).success
        ? undefined
        : `arrondies à ${COORDINATE_DECIMALS} décimales, les coordonnées proposées donnent (${formatCoordinate(edit.lat)}, ${formatCoordinate(edit.lon)}), que le contenu refuse → choisis un autre candidat`;
    },
    /**
     * Compared against `Number(formatCoordinate(…))` rather than against the edit
     * itself, because the file only ever holds {@link COORDINATE_DECIMALS}
     * decimals: an eighth would make this guard fail on a correct write. And
     * deliberately *not* compared via `CoordinatesSchema.parse` — this guards the
     * offset arithmetic and nothing else. Whether the numbers themselves are
     * acceptable is decided in `precheck`, before any splice is computed; asking
     * it here would report a bad candidate as a bug in the writer.
     */
    verify: (rewritten, edit) => {
      const expected = axesOf(edit);
      const wrong = AXES.filter((axis) => {
        const written = valueAt(rewritten, ["places", edit.placeIndex, "coordinates", axis]);

        return typeof written !== "number" || written !== Number(formatCoordinate(expected[axis]));
      });

      return wrong.length === 0 ? undefined : wrong.join(" et ");
    },
  });
}

/* =============================================================== photo fields ==*/

/**
 * The three fields `npm run index-photos` writes on a photo, and the order they
 * are appended in when they are absent.
 *
 * Read off the type rather than written twice: an added field leaves the object
 * literal in {@link valuesOf} incomplete, so this module cannot quietly write two
 * fields out of three. Same compile-time device as `AXES` / `axesOf` above.
 */
const PHOTO_FIELDS = ["width", "height", "blurDataUrl"] as const;

type PhotoField = (typeof PHOTO_FIELDS)[number];

export type PhotoFieldsEdit = {
  /** Index into `photos[]`, as `TripSchema` and the findings number them. */
  readonly photoIndex: number;
  readonly width: number;
  readonly height: number;
  readonly blurDataUrl: string;
};

function valuesOf(edit: PhotoFieldsEdit): Readonly<Record<PhotoField, number | string>> {
  return { width: edit.width, height: edit.height, blurDataUrl: edit.blurDataUrl };
}

/**
 * A value as one line of YAML.
 *
 * `blurDataUrl` is base64 by the time the schema has accepted it, so a plain
 * scalar is always safe **for the values this pipeline produces** — and this
 * module deliberately does not depend on that. A single-quoted scalar is the one
 * form that can carry anything (only `'` needs doubling), so anything that is not
 * obviously a bare word gets quoted, and the driver's read-back guard confirms
 * the string that comes out is the string that went in.
 *
 * The plain form is kept for the common case because it is what the author would
 * have typed: quoting every placeholder would put 130 characters of quoted
 * base64 in a diff where a bare word belongs.
 */
function formatFieldValue(value: number | string): string {
  if (typeof value === "number") {
    return String(value);
  }

  // Starts with a letter or a digit, and holds nothing YAML reads as structure:
  // no space (so no ` #` comment and no `: ` separator), no quote, no bracket.
  return /^[A-Za-z0-9][A-Za-z0-9+/=:;,._-]*$/.test(value)
    ? value
    : `'${value.replaceAll("'", "''")}'`;
}

/**
 * The splices that write one photo's three fields. Three shapes, chosen from the
 * AST and never from a regular expression on the text:
 *
 * 1. the key is absent — append `key: value` after the entry's last line;
 * 2. the key holds a value — replace **the value's own range**, which leaves any
 *    trailing comment and the author's spacing before it untouched;
 * 3. the key is there and empty — or holds an explicit `null` — replace the
 *    whitespace between the colon and whatever follows.
 *
 * A mapping or a list under one of these keys gets no branch and is refused; see
 * that check for why forcing it through would be worse than stopping.
 */
function splicesForPhoto(
  source: string,
  photo: YAMLMap<unknown, unknown>,
  edit: PhotoFieldsEdit
): readonly Splice[] | { readonly reason: string } {
  if (photo.flow) {
    return {
      reason: "cette photo est écrite en style « flow » ({ … }) → réécris-la en bloc de clés",
    };
  }

  const first = photo.items[0];
  const firstOffset = first === undefined ? undefined : keyStart(first);
  if (firstOffset === undefined) {
    return { reason: "cette photo n'a aucune clé lisible → réécris-la en bloc de clés" };
  }
  const keyIndent = indentAt(source, firstOffset);
  const newline = detectNewline(source);
  const value = valuesOf(edit);

  const splices: Splice[] = [];
  const absent: PhotoField[] = [];

  for (const field of PHOTO_FIELDS) {
    const pair = pairNamed(photo, field);
    if (pair === undefined) {
      absent.push(field);
      continue;
    }

    const keyRange = valueRange(pair.key);
    const written: unknown = pair.value;
    const range = valueRange(written);

    if (keyRange === undefined || range === undefined) {
      return { reason: `la clé « ${field} » n'a pas de position lisible dans le fichier` };
    }

    /**
     * A mapping or a list where a number or a string belongs. Refused rather than
     * forced, and the two possible outcomes are why:
     *
     * - replacing the value keeps the author's comment and *silently deletes what
     *   he wrote* — a `width:` holding a note to himself, gone without a trace;
     * - appending beside it produces invalid YAML, and the command would announce
     *   « fichier réécrit » over a file `validate:content` can no longer read.
     *
     * Same posture as the coordinates writer's refusal for a scalar under
     * `coordinates:`, and it is the mirror image of it: there a *block* was
     * expected and a scalar refused, here a scalar is expected and a block
     * refused.
     */
    if (isMap(written) || isSeq(written)) {
      return {
        // `quoted` because this is a raw slice of the author's file on its way to
        // a terminal — the attack `finding.ts` exists for.
        reason: `la clé « ${field} » porte ${quoted(sourceExcerpt(source, range))} au lieu d'une valeur simple → remplace-la par « ${field}: » seul, l'indexation écrira la valeur`,
      };
    }

    const empty = range[0] === range[1];

    if (!empty) {
      /* 2. A value with text: replace exactly it. `valueRange` stops before any
            trailing comment, so the comment and its column survive verbatim. */
      splices.push({ start: range[0], end: range[1], text: formatFieldValue(value[field]) });
      continue;
    }

    /**
     * 3. `width:` with nothing after it, or `width: # à mesurer`.
     *
     * **This is the branch that corrupted files in the coordinates writer, and it
     * corrupts them here in exactly the same way.** On `width: # à mesurer` the
     * null scalar's range starts *at the `#`*, so inserting at the value's offset
     * gives `width: 1600# à mesurer` — which YAML reads as the **string**
     * `"1600# à mesurer"`. The comment is absorbed into the scalar, gone for good
     * on the next run, and the command exits 0 saying the file was rewritten.
     *
     * So the unit of replacement is the whitespace between the colon and whatever
     * comes next on that line, and the separator is put back on both sides when
     * there is something to separate from.
     */
    const colon = keyRange[1];
    const { contentEnd } = lineEndFrom(source, colon);
    const nextOnLine = Math.min(Math.max(range[0], colon + 1), contentEnd);
    const rest = source.slice(nextOnLine, contentEnd);

    splices.push({
      start: colon + 1,
      end: nextOnLine,
      text:
        rest === "" ? ` ${formatFieldValue(value[field])}` : ` ${formatFieldValue(value[field])} `,
    });
  }

  if (absent.length > 0) {
    const photoRange = valueRange(photo);
    if (photoRange === undefined) {
      return { reason: "cette photo n'a pas de position lisible dans le fichier" };
    }
    /**
     * The absent keys are appended in **one** splice rather than one each. Two
     * splices at the same offset are applied one after the other and come out in
     * reverse, so `height:` would land above `width:` — the same trap the
     * coordinates writer documents for its missing axes, and the reason
     * `appends them in the order they are declared, not reversed` is a test.
     */
    /**
     * Past the newline of the entry's last line, computed rather than taken from
     * `range[1]` directly.
     *
     * `range[1]` of a block collection lands just past that newline **when the
     * last line has a value**; when the last key was left empty it stops at the
     * colon instead, before the break — which is where the tie documented on
     * {@link Splice} comes from. Walking to the start of the following line
     * removes the tie in the ordinary case and keeps the diff to appended lines;
     * `rank` below covers the one case that cannot be walked past, a file ending
     * without a newline.
     */
    const at = lineEndFrom(source, Math.max(0, photoRange[1] - 1)).next;
    const lead = at === 0 || source[at - 1] === "\n" ? "" : newline;

    splices.push({
      start: at,
      end: at,
      rank: 1,
      text:
        lead +
        absent
          .map((field) => `${keyIndent}${field}: ${formatFieldValue(value[field])}${newline}`)
          .join(""),
    });
  }

  return splices;
}

/**
 * The source text with a photo's measured fields written into it, and nothing
 * else changed.
 *
 * The unhandled-key refusal the coordinates writer needs has **no counterpart
 * here**, and the asymmetry is deliberate rather than an omission: `coordinates:`
 * is a closed mapping, so a misspelled `latitude` inside it is a key this writer
 * would have to reason about. A photo entry is an open block whose other keys —
 * `src`, `alt`, `placeSlug` — are none of this writer's business, so a stranger
 * beside them is simply left alone. What a *misspelling* of one of these three
 * looks like is a key the schema does not know, and `validate:content` refuses it
 * with a better sentence than this module could produce.
 */
export function writePhotoFields(
  source: string,
  edits: readonly PhotoFieldsEdit[]
): YamlEditResult {
  return editSequenceEntries<PhotoFieldsEdit>({
    source,
    collection: "photos",
    entryNoun: "une photo",
    edits,
    indexOf: (edit) => edit.photoIndex,
    writer: (text, photo, edit) => splicesForPhoto(text, photo, edit),
    verify: (rewritten, edit) => {
      const expected = valuesOf(edit);
      const wrong = PHOTO_FIELDS.filter(
        (field) => valueAt(rewritten, ["photos", edit.photoIndex, field]) !== expected[field]
      );

      return wrong.length === 0 ? undefined : wrong.join(" et ");
    },
  });
}
