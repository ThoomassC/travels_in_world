import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Test support for the content-validation suite.
 *
 * `process.cwd()` rather than `import.meta.dirname`: this suite runs under the
 * default Vitest config, hence under jsdom, where `import.meta.url` is not a
 * `file:` URL — the same trap `vitest.lint.config.ts` documents. Vitest sets the
 * working directory to the config root, so `process.cwd()` is the repository
 * root and stays one.
 */
export const REPO_ROOT = process.cwd();

const FIXTURES = path.join(REPO_ROOT, "tests/fixtures/content");

export type ContentRoots = {
  readonly contentDir: string;
  readonly publicDir: string;
  readonly repoRoot: string;
  /**
   * The visited-places file (TIW-36) — a *file*, not a directory, and beside the
   * trips directory rather than inside it: the trips root refuses a loose `.yaml`
   * because a trip is a directory, so a places file dropped in there would be
   * reported as content nobody reads.
   *
   * Named on every root whether the file exists or not: "no such file" is the
   * ordinary state of a journal and has to be assertable too.
   */
  readonly placesFile: string;
};

/**
 * One committed fixture case, laid out as the CLI expects a content root to be:
 * `trips/<slug>/trip.yaml` for the sources, `public/` for the files the photo
 * sources resolve against. Self-contained on purpose — a fixture that leaned on
 * the real `public/` would pass or fail depending on the site's own assets.
 */
export function fixtureRoots(name: string): ContentRoots {
  const caseDir = path.join(FIXTURES, name);

  return {
    contentDir: path.join(caseDir, "trips"),
    publicDir: path.join(caseDir, "public"),
    repoRoot: REPO_ROOT,
    placesFile: path.join(caseDir, "places.yaml"),
  };
}

export type TemporaryContent = ContentRoots & {
  /** The throwaway root, so a test can add what the builder does not model. */
  readonly root: string;
  readonly cleanup: () => void;
};

/**
 * A throwaway content root built from YAML sources, for the cases that do not
 * earn a committed fixture: the wording of a single rule. The committed cases
 * are the ones an acceptance criterion names.
 *
 * `repoRoot` is the temporary root itself, so the display paths in the findings
 * stay short and readable (`trips/japon-2024/trip.yaml`).
 */
export function temporaryContent(
  trips: Readonly<Record<string, string>>,
  files: readonly string[] = [],
  /**
   * The visited-places file's text, when the case has one. `undefined` writes no
   * file at all — which is a state worth building, not an omission: it is what
   * every journal looked like before TIW-36 and it must stay unremarkable.
   */
  places?: string
): TemporaryContent {
  const root = mkdtempSync(path.join(tmpdir(), "tiw-content-"));

  for (const [slug, source] of Object.entries(trips)) {
    const directory = path.join(root, "trips", slug);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "trip.yaml"), source, "utf8");
  }

  for (const file of files) {
    const target = path.join(root, "public", file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "", "utf8");
  }

  mkdirSync(path.join(root, "trips"), { recursive: true });

  const placesFile = path.join(root, "places.yaml");
  if (places !== undefined) {
    writeFileSync(placesFile, places, "utf8");
  }

  return {
    root,
    contentDir: path.join(root, "trips"),
    publicDir: path.join(root, "public"),
    repoRoot: root,
    placesFile,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/* ------------------------------------------------------------- YAML builders -- */

/**
 * The reference trip as YAML text, with `overrides` splicing in replacement
 * lines. Written as text rather than serialised from an object because the line
 * and column a finding points at are part of what this suite asserts.
 */
export function tripYaml(overrides: Readonly<Record<string, string>> = {}): string {
  const blocks: Record<string, string> = {
    slug: "slug: japon-2024",
    title: "title: Japon, printemps 2024",
    startDate: "startDate: 2024-04-12",
    endDate: "endDate: 2024-04-16",
    /**
     * Required since TIW-19, so every collection built here carries one.
     * Deliberately a **different day** from `endDate`: a builder that let the two
     * coincide would let a consumer reading the wrong field pass this whole suite.
     */
    publishedAt: "publishedAt: 2024-05-02",
    places: [
      "places:",
      "  - slug: tokyo",
      "    name: Tokyo",
      "    countryCode: JP",
      "    coordinates:",
      "      lat: 35.6762",
      "      lon: 139.6503",
      "  - slug: kyoto",
      "    name: Kyoto",
      "    countryCode: JP",
      "    coordinates:",
      "      lat: 35.0116",
      "      lon: 135.7681",
    ].join("\n"),
    steps: [
      "steps:",
      "  - kind: stay",
      "    placeSlug: tokyo",
      "    startDate: 2024-04-12",
      "    endDate: 2024-04-16",
      "  - kind: move",
      "    fromSlug: tokyo",
      "    toSlug: kyoto",
      "    mode: train",
      "    date: 2024-04-16",
    ].join("\n"),
    ...overrides,
  };

  return `${Object.values(blocks)
    .filter((block) => block !== "")
    .join("\n")}\n`;
}

/**
 * The visited-places file as YAML text (TIW-36), one entry per place.
 *
 * Text rather than a serialised object, for the reason `tripYaml` gives: the line
 * and column a finding points at are part of what this suite asserts, and a
 * serialiser would decide them.
 */
export type PlaceSource = {
  readonly slug: string;
  readonly name?: string;
  readonly countryCode?: string;
  /** Omitted writes no `coordinates:` block at all — the state `geocode` fixes. */
  readonly coordinates?: { readonly lat: number; readonly lon: number };
};

export function placesYaml(places: readonly PlaceSource[]): string {
  const lines = ["places:"];

  for (const place of places) {
    lines.push(`  - slug: ${place.slug}`);
    lines.push(`    name: ${place.name ?? place.slug}`);
    lines.push(`    countryCode: ${place.countryCode ?? "FR"}`);
    if (place.coordinates !== undefined) {
      lines.push("    coordinates:");
      lines.push(`      lat: ${place.coordinates.lat}`);
      lines.push(`      lon: ${place.coordinates.lon}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
