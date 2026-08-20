import { describeField, escapeControls } from "./finding";
import type { ContentFinding, ContentValidation } from "./finding";

export { describeField } from "./finding";

/**
 * Turning findings into the text Thomas reads. A pure function of its input: no
 * `fs`, no `process`, no colour decision of its own — the caller says whether the
 * output is a terminal, which is what keeps CI logs free of escape sequences.
 *
 * The shape of a line is fixed by TIW-9 and each part earns its place:
 *
 *     content/trips/japon-2024/trip.yaml:13:5 — places[1].coordinates : …  → lance « … »
 *     └ path, relative to the repository root  └ readable field   └ problem  └ what to do
 *
 * The path is first because it is what gets pasted into an editor, the line and
 * column are there because "somewhere in this file" is not an error message, and
 * the command is last because it is the only part that ends the problem.
 */

export type ReportOptions = { readonly color: boolean };

const ESCAPE = String.fromCodePoint(27);

const CODES = {
  bold: "1",
  dim: "2",
  cyan: "36",
  green: "32",
} as const;

type Palette = (code: keyof typeof CODES, text: string) => string;

function palette(color: boolean): Palette {
  if (!color) {
    return (_code, text) => text;
  }
  return (code, text) => `${ESCAPE}[${CODES[code]}m${text}${ESCAPE}[0m`;
}

function plural(count: number, singular: string, many: string): string {
  return `${count} ${count > 1 ? many : singular}`;
}

/**
 * The last guard on the two invariants of this output: one finding is one line,
 * and the only escape sequences on the stream are the ones chosen here.
 *
 * `quoted()` already neutralises the values it wraps, but a path, a filesystem
 * error message or a future message could carry a newline or an ESC too — and a
 * value that clears the screen destroys the very report it appears in. Escaping
 * at render time makes that impossible to forget, and it runs *before* the
 * palette so the colours it adds are the only ones left.
 */
function formatFinding(finding: ContentFinding, paint: Palette): string {
  const position =
    finding.location === undefined ? "" : `:${finding.location.line}:${finding.location.column}`;
  const field = describeField(finding.field);

  const head = paint("cyan", escapeControls(`${finding.file}${position}`));
  const named = field === "" ? "" : `${paint("bold", escapeControls(field))} : `;
  const problem = escapeControls(finding.problem);
  const action = escapeControls(finding.action);

  return `${head} ${paint("dim", "—")} ${named}${problem} ${paint("dim", "→")} ${paint("green", action)}`;
}

/**
 * Findings grouped by file, one blank line between files. The grouping is the
 * order itself rather than a heading: every line has to stay copy-pasteable on
 * its own, and a heading would tempt us to shorten the path on the lines below
 * it.
 */
function groupByFile(findings: readonly ContentFinding[]): readonly (readonly ContentFinding[])[] {
  const groups = new Map<string, ContentFinding[]>();

  for (const finding of findings) {
    const group = groups.get(finding.file);
    if (group === undefined) {
      groups.set(finding.file, [finding]);
    } else {
      group.push(finding);
    }
  }

  return [...groups.values()];
}

function summary(validation: ContentValidation): readonly string[] {
  const files = groupByFile(validation.findings).length;
  const problems = plural(validation.findings.length, "problème", "problèmes");

  // Nothing was read as a trip — a missing directory, or only stray files. The
  // per-trip tally would then read "aucun voyage validé, 0 en erreur", which
  // says nothing true about what happened.
  if (validation.tripCount === 0) {
    return [`${problems} — aucun voyage lu dans ${validation.contentDir}.`];
  }

  const validated =
    validation.validCount === 0
      ? "aucun voyage validé"
      : plural(validation.validCount, "voyage validé", "voyages validés");

  /**
   * A stray file is a problem in a file and in no trip. Without this clause the
   * two lines contradicted each other — "1 fichier en erreur, 1 problème." above
   * "1 voyage validé, 0 en erreur." — under a non-zero exit code.
   */
  const structural =
    validation.structuralCount === 0
      ? ""
      : `, plus ${plural(validation.structuralCount, "problème hors voyage", "problèmes hors voyage")}`;

  return [
    `${plural(files, "fichier en erreur", "fichiers en erreur")}, ${problems}.`,
    `${validated}, ${validation.failedCount} en erreur${structural}.`,
  ];
}

export function formatReport(validation: ContentValidation, options: ReportOptions): string {
  const paint = palette(options.color);

  if (validation.findings.length === 0) {
    if (validation.tripCount === 0) {
      return `Aucun voyage dans ${validation.contentDir} : rien à valider.`;
    }
    return `${plural(validation.tripCount, "voyage validé", "voyages validés")} dans ${
      validation.contentDir
    }, aucun problème.`;
  }

  const blocks = groupByFile(validation.findings).map((group) =>
    group.map((finding) => formatFinding(finding, paint)).join("\n")
  );

  return [
    ...blocks,
    summary(validation)
      .map((line) => paint("bold", line))
      .join("\n"),
  ].join("\n\n");
}
