import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BASEMAP_VINTAGE,
  DRAWABLE_COUNTRY_CODES,
  FINER_BASEMAP_VINTAGES,
  FINER_VINTAGE_COUNTRY_CODES,
  REGENERATE_COMMAND,
} from "@/basemap-coverage";
import { NUMERIC_BY_ALPHA2 } from "@/iso-3166";
import { DATASET_VINTAGES, readDatasetGeometries, SHIPPED_DATASET_VINTAGE } from "./support";
import type { DatasetVintage } from "./support";

/**
 * **The freshness guard of a generated artefact, and the reason the artefact is
 * allowed to exist at all.**
 *
 * `src/basemap-coverage.ts` is the only way `src/content/validate.ts` can answer
 * "can the map draw this country?" without importing `world-atlas`, `d3-geo` and
 * `topojson-client` into the content layer — which `travels-in-world/map-entry-point`
 * forbids, and rightly: those three are what the `@/map` façade exists to keep out
 * of a client bundle.
 *
 * The price of that is a committed list that can go stale. A generated artefact
 * that lies is worse than no artefact, so this suite recomputes the whole answer
 * from the packaged TopoJSON — read here by `support.ts`, independently of both
 * the generator and `src/map/dataset.ts` — and compares. A `world-atlas` bump
 * without a regeneration fails here, by name, with the command to run.
 *
 * This is the *primary* guard. There is a second one, deliberately cheaper and
 * deliberately elsewhere: `src/map/world.ts` cross-checks the same list against
 * the dataset it actually projected, so a stale artefact cannot survive a
 * `next build` either. Two guards because they fail at different moments — this
 * one on every `npm test`, that one on the only run that ships.
 */

const alpha2ByNumeric = new Map([...NUMERIC_BY_ALPHA2].map(([alpha2, id]) => [id, alpha2]));

/** The alpha-2 codes a vintage carries a shape for, recomputed from the package. */
function codesDrawnBy(vintage: DatasetVintage): ReadonlySet<string> {
  const codes = new Set<string>();

  for (const geometry of readDatasetGeometries(vintage)) {
    const code = geometry.id === null ? undefined : alpha2ByNumeric.get(geometry.id);
    if (code !== undefined) {
      codes.add(code);
    }
  }

  return codes;
}

const sorted = (codes: Iterable<string>): readonly string[] => [...codes].sort();

describe("the generated coverage of the shipped basemap", () => {
  it("names the vintage `src/map/dataset.ts` is built from", () => {
    expect(BASEMAP_VINTAGE).toBe(SHIPPED_DATASET_VINTAGE);
  });

  /**
   * The assertion the whole artefact hangs on. Written as two sorted arrays
   * rather than as a set comparison so a failure prints *which* codes moved:
   * "expected 174, got 175" would send the next reader diffing a generated file
   * by hand.
   */
  it("lists exactly the countries the shipped vintage draws", () => {
    expect(sorted(DRAWABLE_COUNTRY_CODES)).toEqual(sorted(codesDrawnBy(SHIPPED_DATASET_VINTAGE)));
  });

  it("lists exactly the countries some finer vintage draws", () => {
    const finer = new Set<string>();
    for (const vintage of FINER_BASEMAP_VINTAGES) {
      for (const code of codesDrawnBy(vintage)) {
        finer.add(code);
      }
    }

    expect(sorted(FINER_VINTAGE_COUNTRY_CODES)).toEqual(sorted(finer));
  });

  it("covers every vintage the package ships, so nothing is silently ignored", () => {
    expect([BASEMAP_VINTAGE, ...FINER_BASEMAP_VINTAGES].sort()).toEqual([...DATASET_VINTAGES].sort());
  });

  /**
   * A finer vintage that dropped a country the coarse one draws would make
   * "switch vintage" bad advice for that code. Measured today: it never happens,
   * 110m is a strict subset of 50m ∪ 10m.
   */
  it("keeps the shipped vintage a subset of the finer ones", () => {
    const missing = [...DRAWABLE_COUNTRY_CODES].filter(
      (code) => !FINER_VINTAGE_COUNTRY_CODES.has(code)
    );

    expect(missing).toEqual([]);
  });

  /**
   * The number that decided TIW-30. The ticket assumed "at least SG, MC, MT, SM";
   * the measurement says 75 of the 249 assigned codes, which is what ruled out
   * documenting them one by one in `content/README.md`.
   */
  it("leaves 75 assigned codes with no shape at all, Singapore among them", () => {
    const undrawable = [...NUMERIC_BY_ALPHA2.keys()].filter(
      (code) => !DRAWABLE_COUNTRY_CODES.has(code)
    );

    expect(undrawable).toHaveLength(75);
    expect(undrawable).toContain("SG");
  });

  /**
   * The eleven codes no vintage of this package draws — French overseas
   * départements and a handful of dependencies. They are why the refusal message
   * has two shapes: telling the author of a trip to Martinique to "switch to the
   * 50m vintage" would be sending them to buy 152 KB of paths that still would
   * not draw their country.
   */
  it("knows that some codes no vintage draws, so the way out is not offered blindly", () => {
    const nowhere = [...NUMERIC_BY_ALPHA2.keys()].filter(
      (code) => !DRAWABLE_COUNTRY_CODES.has(code) && !FINER_VINTAGE_COUNTRY_CODES.has(code)
    );

    expect(nowhere).toEqual(["BQ", "BV", "CC", "CX", "GF", "GP", "MQ", "RE", "SJ", "TK", "YT"]);
  });

  it("carries the command that regenerates it, so a failure here is actionable", () => {
    expect(REGENERATE_COMMAND).toBe("npm run basemap:coverage");
  });
});

/**
 * The second guard, and the one that makes the artefact incapable of shipping a
 * lie: `src/map/world.ts` holds the real geometry, so it is the only module that
 * can tell whether the committed list still describes it. It compares once per
 * process and throws before drawing anything.
 *
 * Exercised through a substituted `@/basemap-coverage` rather than by editing the
 * real file, because the real file is correct and has to stay correct: this suite
 * asserts *that the comparison happens*, which is the half a green list can never
 * prove on its own.
 */
describe("a coverage artefact that no longer matches the dataset", () => {
  afterEach(() => {
    vi.doUnmock("@/basemap-coverage");
    vi.resetModules();
  });

  async function buildWith(codes: readonly string[]): Promise<() => unknown> {
    vi.resetModules();
    vi.doMock("@/basemap-coverage", () => ({
      BASEMAP_VINTAGE: "110m",
      FINER_BASEMAP_VINTAGES: ["50m", "10m"] as const,
      DRAWABLE_COUNTRY_CODES: new Set(codes),
      FINER_VINTAGE_COUNTRY_CODES: new Set(codes),
      REGENERATE_COMMAND: "npm run basemap:coverage",
    }));

    const { buildWorldGeometry } = await import("@/map/world");

    return () => buildWorldGeometry({ visitedCountryCodes: ["JP"], locale: "fr" });
  }

  it("refuses to draw when the list claims a country the dataset has no shape for", async () => {
    const build = await buildWith([...DRAWABLE_COUNTRY_CODES, "SG"]);

    expect(build).toThrow(/SG/);
    expect(build).toThrow(/basemap:coverage/);
  });

  it("refuses to draw when the list has lost a country the dataset does draw", async () => {
    const build = await buildWith([...DRAWABLE_COUNTRY_CODES].filter((code) => code !== "JP"));

    expect(build).toThrow(/JP/);
    expect(build).toThrow(/basemap:coverage/);
  });

  it("draws normally when the list matches", async () => {
    const build = await buildWith([...DRAWABLE_COUNTRY_CODES]);

    expect(build).not.toThrow();
  });
});
