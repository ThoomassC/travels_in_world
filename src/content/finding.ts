/**
 * What a content problem *is*, before anything decides how to print it.
 *
 * Pure data and one formatting helper: no `fs`, no YAML, no Zod. `report.ts`
 * renders these, `validate.ts` produces them, and `diagnose.ts` words them —
 * which is why the shape lives on its own rather than in any of the three.
 */

/** A path inside a trip document: object keys and array indices, in order. */
export type FieldPath = readonly (string | number)[];

/** A 1-based position in the source file, the way an editor counts. */
export type SourceLocation = { readonly line: number; readonly column: number };

export type ContentFinding = {
  /** Repository-relative, POSIX-separated: the point is that it can be pasted. */
  readonly file: string;
  readonly field?: FieldPath;
  readonly location?: SourceLocation;
  /** What is wrong, in French, naming the values the author wrote. */
  readonly problem: string;
  /** What to do about it, in French — including the exact command when one exists. */
  readonly action: string;
  /** The command `action` tells the author to run, when there is one. */
  readonly command?: string;
};

export type ContentValidation = {
  /** Display path of the directory that was read, for the summary line. */
  readonly contentDir: string;
  readonly tripCount: number;
  readonly validCount: number;
  readonly failedCount: number;
  /**
   * Findings that belong to no trip: a stray file, an unreadable content root.
   * Counted apart so the summary cannot say "1 file in error" and "0 trips in
   * error" in the same breath.
   */
  readonly structuralCount: number;
  readonly findings: readonly ContentFinding[];
};

/**
 * A field path as a human writes it: `steps[2].fromSlug`, never
 * `steps.2.fromSlug` and never a raw array. This is the string the author has to
 * find in a 60-line YAML file, so it is the one form that matters.
 */
export function describeField(field: FieldPath | undefined): string {
  if (field === undefined) {
    return "";
  }

  return field.reduce<string>((rendered, segment) => {
    if (typeof segment === "number") {
      return `${rendered}[${segment}]`;
    }
    return rendered === "" ? segment : `${rendered}.${segment}`;
  }, "");
}

/**
 * The shape of a path, indices collapsed: `places[].coordinates`. Diagnoses are
 * keyed on this, so one entry covers every index of a collection.
 */
export function fieldShape(field: FieldPath): string {
  return field.reduce<string>((rendered, segment) => {
    if (typeof segment === "number") {
      return `${rendered}[]`;
    }
    return rendered === "" ? segment : `${rendered}.${segment}`;
  }, "");
}

/**
 * Control characters, made visible and harmless.
 *
 * Every quoted value comes from a file someone wrote, and it is printed to a
 * terminal. A value holding `ESC [ 2 J` clears the screen and homes the cursor:
 * the report the author is supposed to read erases itself, and the exit code is
 * the only thing left. A newline breaks the one-finding-one-line rule that makes
 * the output greppable, and NUL or BEL are simply invisible.
 *
 * So nothing raw ever reaches the stream: the escapes are rendered the way a
 * source file would write them, which keeps the value legible *and* inert.
 */
const CONTROL_ESCAPES = new Map([
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
  ["\u001b", "\\e"],
  ["\u0000", "\\0"],
  ["\u0007", "\\a"],
]);

function isControl(codePoint: number): boolean {
  // C0, DEL and C1 — the last one matters because a lone 0x9b is a CSI.
  return codePoint < 0x20 || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f);
}

export function escapeControls(text: string): string {
  let escaped = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    escaped += isControl(codePoint)
      ? (CONTROL_ESCAPES.get(character) ?? `\\x${codePoint.toString(16).padStart(2, "0")}`)
      : character;
  }
  return escaped;
}

/**
 * How much of a written value a message quotes. A 400-character value repeated
 * in the problem *and* in the action drowns the twelve findings around it, and
 * nobody needs 400 characters to recognise their own typo.
 */
const QUOTED_VALUE_LIMIT = 80;

/** Code points, not UTF-16 units: cutting a surrogate pair in half prints junk. */
function truncate(text: string, limit: number): string {
  const points = [...text];

  return points.length <= limit ? text : `${points.slice(0, limit).join("")}…`;
}

/**
 * A value from outside, made safe to print: bounded to {@link QUOTED_VALUE_LIMIT}
 * code points and stripped of anything that could move the cursor.
 *
 * Exported for the one caller that prints such a value *without* quotation marks:
 * the candidate list of `npm run geocode` (TIW-10), where a line already carrying
 * five fields from a third-party API would be unreadable with five pairs of
 * guillemets in it. The bounding and the neutralising are not negotiable there
 * either — the strings come from an HTTP response — so they live here, in one
 * place, rather than being restated at that call site.
 */
export function bounded(value: string): string {
  return escapeControls(truncate(value, QUOTED_VALUE_LIMIT));
}

/**
 * French quotation marks. Plain spaces inside them, not narrow no-break ones:
 * these messages are read in a terminal and grepped in CI logs, where an unusual
 * space character is a trap for whoever tries to search for the text they saw.
 *
 * The value is bounded and neutralised here rather than at each call site, so a
 * new message cannot forget to do it.
 */
export function quoted(value: string): string {
  return `« ${bounded(value)} »`;
}

/** `« a », « b » et « c` », for a message that has to agree in number. */
export function quotedList(values: readonly string[]): string {
  const quotedValues = values.map(quoted);
  const last = quotedValues.at(-1);

  if (quotedValues.length <= 1 || last === undefined) {
    return quotedValues.join("");
  }

  return `${quotedValues.slice(0, -1).join(", ")} et ${last}`;
}

/** The imperative form used everywhere a command exists: `lance « … »`. */
export function runCommand(command: string, verb = "lance"): string {
  return `${verb} ${quoted(command)}`;
}
