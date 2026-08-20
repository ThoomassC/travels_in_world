import { describe, expect, it } from "vitest";
import { describeField, formatReport } from "@/content/report";
import type { ContentFinding, ContentValidation } from "@/content/validate";

/**
 * The presentation layer, tested as a pure function of findings. The rules it
 * has to keep are the ones stated in TIW-9: one error per line, each line
 * prefixed with the repository-relative path so it can be pasted into an editor,
 * a readable field path, the exact command when one exists, findings grouped by
 * file, and a final count that does not lie.
 */

const FINDINGS: readonly ContentFinding[] = [
  {
    file: "content/trips/japon-2024/trip.yaml",
    field: ["places", 1, "coordinates"],
    location: { line: 13, column: 5 },
    problem: "la ville « Kyoto » est déclarée sans coordonnées",
    action: "lance « npm run geocode japon-2024 »",
    command: "npm run geocode japon-2024",
  },
  {
    file: "content/trips/japon-2024/trip.yaml",
    field: ["steps", 2, "fromSlug"],
    location: { line: 31, column: 5 },
    problem: "l'étape 2 part de « kyoto » alors que le séjour précédent est à « tokyo »",
    action: "corrige « fromSlug » ou l'ordre des étapes",
  },
  {
    file: "content/trips/perou-2023/trip.yaml",
    field: ["endDate"],
    location: { line: 5, column: 10 },
    problem: "le voyage se termine le 2023-03-01, avant son début le 2023-05-10",
    action: "corrige « endDate » ou « startDate »",
  },
];

const failing: ContentValidation = {
  contentDir: "content/trips",
  tripCount: 3,
  validCount: 1,
  failedCount: 2,
  structuralCount: 0,
  findings: FINDINGS,
};

const passing: ContentValidation = {
  contentDir: "content/trips",
  tripCount: 2,
  validCount: 2,
  failedCount: 0,
  structuralCount: 0,
  findings: [],
};

const plain = (validation: ContentValidation): string => formatReport(validation, { color: false });

/**
 * Built from its code point rather than written as an escape in a regular
 * expression literal: `no-control-regex` refuses the literal form, and this
 * project does not carry `eslint-disable` comments.
 */
const ESCAPE = String.fromCodePoint(27);

const stripAnsi = (text: string): string =>
  text.replaceAll(new RegExp(`${ESCAPE}\\[[0-9;]*m`, "g"), "");

describe("describeField", () => {
  it("writes an index as a bracket, not as a path segment", () => {
    expect(describeField(["steps", 2, "fromSlug"])).toBe("steps[2].fromSlug");
  });

  it("writes a nested field with dots", () => {
    expect(describeField(["places", 1, "coordinates", "lat"])).toBe("places[1].coordinates.lat");
  });

  it("has nothing to say about a finding that belongs to no field", () => {
    expect(describeField(undefined)).toBe("");
    expect(describeField([])).toBe("");
  });
});

describe("a report on a faulty collection", () => {
  const report = plain(failing);
  const lines = report.split("\n");

  it("puts every finding on its own line", () => {
    const errorLines = lines.filter((line) => line.includes("trip.yaml"));

    expect(errorLines).toHaveLength(FINDINGS.length);
  });

  it("prefixes each line with the repository-relative path, line and column", () => {
    expect(lines).toContain(
      "content/trips/japon-2024/trip.yaml:13:5 — places[1].coordinates : " +
        "la ville « Kyoto » est déclarée sans coordonnées → lance « npm run geocode japon-2024 »"
    );
  });

  it("names the faulty field with a readable path", () => {
    expect(report).toContain("steps[2].fromSlug");
    expect(report).not.toContain("steps.2.fromSlug");
  });

  it("groups the findings of one file together, separated from the next file", () => {
    const files = lines
      .filter((line) => line.includes("trip.yaml"))
      .map((line) => line.split(":")[0]);

    expect(files).toEqual([
      "content/trips/japon-2024/trip.yaml",
      "content/trips/japon-2024/trip.yaml",
      "content/trips/perou-2023/trip.yaml",
    ]);
    expect(report).toContain("\n\ncontent/trips/perou-2023/trip.yaml");
  });

  it("ends on an honest count of files, problems and trips", () => {
    expect(report).toContain("2 fichiers en erreur");
    expect(report).toContain("3 problèmes");
    expect(report).toContain("1 voyage validé");
    expect(report).toContain("2 en erreur");
  });

  it("quotes the command to run for the findings that have one", () => {
    expect(report).toContain("« npm run geocode japon-2024 »");
  });

  it("emits no ANSI escape when the output is not a terminal", () => {
    expect(report).not.toContain(ESCAPE);
  });

  it("colours the path and the command when the output is a terminal", () => {
    const coloured = formatReport(failing, { color: true });

    expect(coloured).toContain(ESCAPE);
    // Stripping the escapes has to give back exactly the plain report.
    expect(stripAnsi(coloured)).toBe(plain(failing));
  });
});

describe("a report on a healthy collection", () => {
  it("says how many trips were validated", () => {
    expect(plain(passing)).toContain("2 voyages validés");
  });

  it("says so plainly when there is nothing to validate", () => {
    const report = plain({ ...passing, tripCount: 0, validCount: 0 });

    expect(report).toContain("content/trips");
    expect(report).toMatch(/[Aa]ucun voyage/);
  });
});
