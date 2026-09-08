import assert from "node:assert/strict";
import { brotliCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { CountryCode } from "@/domain/geo";
import { buildWorldGeometry } from "@/map/world";
import type { CountryShape } from "@/map/world";
import { coordinatesOf, OVERLY_PRECISE_NUMBER_PATTERN, readDatasetGeometries } from "./support";

/**
 * `buildWorldGeometry` is the whole of TIW-12: world-atlas TopoJSON in, SVG path
 * data out, computed once at build time so the browser receives neither d3 nor
 * the dataset. It runs during the build and never again, which is precisely why
 * it needs this much testing — a wrong answer here is baked into static HTML and
 * has no runtime symptom to notice.
 */

const FRENCH = "fr";

/** ISO 3166-1 numeric of Japan, the join key the ticket states outright. */
const JAPAN_NUMERIC = "392";

/**
 * The territories world-atlas 50m ships without an `id`. They can never be joined
 * to a country code, and they are still drawn: leaving them out would punch holes
 * in the map.
 *
 * **Three at 110m, five here**, and the two newcomers are what a finer vintage
 * draws rather than a change of policy: `Indian Ocean Ter.` and `Siachen Glacier`
 * are too small for the coarse simplification to carry at all.
 */
const UNIDENTIFIED_TERRITORY_NAMES = [
  "Indian Ocean Ter.",
  "Kosovo",
  "N. Cyprus",
  "Siachen Glacier",
  "Somaliland",
];

function build(visitedCountryCodes: readonly CountryCode[], locale: string = FRENCH) {
  return buildWorldGeometry({ visitedCountryCodes, locale });
}

/** Names in the order `visited` returns them — the only thing the order test needs. */
function visitedNames(visitedCountryCodes: readonly CountryCode[], locale: string): string[] {
  return build(visitedCountryCodes, locale).visited.map((shape) => shape.name);
}

function shapeFor(code: CountryCode, shapes: readonly CountryShape[]): CountryShape {
  const shape = shapes.find((candidate) => candidate.code === code);
  assert(shape !== undefined, `no shape carried the country code ${code}`);

  return shape;
}

describe("the background layer", () => {
  /**
   * All 240, not "the ones we could join". The background layer is the map: a
   * country dropped because its code was unknown leaves a hole in the ocean, and
   * an SVG with a missing path is as valid as one without.
   *
   * **240 shapes for 241 geometries**, and the difference is the one merge the 50m
   * vintage forces: numeric 036 arrives twice, as `Australia` and as its external
   * territory `Ashmore and Cartier Is.`, and `src/map/dataset.ts` concatenates the
   * two into one multi-part shape. The second assertion below reads the dataset
   * itself, so it moves with the vintage; the literal is what pins the merge.
   */
  it("produces one shape per geometry in the dataset", () => {
    const world = build([]);

    expect(world.countries).toHaveLength(240);
    expect(world.countries).toHaveLength(readDatasetGeometries().length - 1);
  });

  it("gives every country a non-empty path", () => {
    const empty = build([])
      .countries.filter((shape) => shape.path.length === 0)
      .map((shape) => shape.name);

    expect(empty).toEqual([]);
  });

  /**
   * Keeping the dataset's own order rather than sorting. The background layer is
   * painted in document order, and re-ordering it would change which coastline
   * overlaps which — a rendering difference with no test to notice it. The visited
   * layer is the one that gets sorted, for a reason the reader can see (a legend).
   */
  it("keeps the dataset's order, so the paint order is stable", () => {
    const ids = build([]).countries.map((shape) => shape.id);

    /**
     * Compared on `id`, not on `name`: `name` is localised for every joined
     * country, so a name-to-name comparison would only be asserting that French
     * and the dataset's English happen to agree — which they do not, and which is
     * not what "same order" means.
     *
     * The dataset's own order, minus the second occurrence of any repeated id.
     * That subtraction is the merge `src/map/dataset.ts` performs for numeric 036
     * — `Australia` and `Ashmore and Cartier Is.` become one multi-part shape, at
     * the position of the first. Written as a de-duplication rather than as a
     * literal so it still describes the rule if a later vintage repeats a
     * different code.
     */
    const seen = new Set<string>();
    const expected = readDatasetGeometries()
      .map((geometry) => geometry.id)
      .filter((id) => {
        if (id === null) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

    expect(ids).toEqual(expected);
  });
});

describe("the territories with no ISO identifier", () => {
  /**
   * The crash this whole block exists for. `id` is absent on five of the 241
   * geometries, so any code reaching for `geometry.id.padStart` or indexing a
   * table with it throws — during the build, on a dataset nobody changed.
   */
  it("builds the world without throwing over them", () => {
    expect(() => build([])).not.toThrow();
  });

  it("marks exactly those as unjoinable, in both fields at once", () => {
    const world = build([]);
    const unidentified = world.countries.filter((shape) => shape.id === null);

    expect(unidentified.map((shape) => shape.name).sort()).toEqual(UNIDENTIFIED_TERRITORY_NAMES);
    // `code` and `id` have to go missing together. A shape with an `id` of `null`
    // and a non-null `code` would be joinable on a key that does not exist, which
    // is how a country ends up painted as visited without ever being declared.
    expect(unidentified.map((shape) => shape.code)).toEqual(
      UNIDENTIFIED_TERRITORY_NAMES.map(() => null)
    );
  });

  /**
   * They fall back to the dataset's English label, because there is nothing to
   * localise them from: `Intl.DisplayNames` needs a region code and these have
   * none. An empty name would be the tempting shortcut, and it would produce an
   * empty `<title>` on a shape a screen reader still reaches.
   */
  it("labels them with the dataset's own name", () => {
    const names = build([])
      .countries.filter((shape) => shape.id === null)
      .map((shape) => shape.name);

    expect(names.sort()).toEqual(UNIDENTIFIED_TERRITORY_NAMES);
  });

  /**
   * Unjoinable is not undrawn. Every one of them is land: if they carry no path
   * the map shows white gaps, and the only way to notice is to look at the
   * rendered image.
   */
  it("still draws them", () => {
    const withoutPath = build([])
      .countries.filter((shape) => shape.id === null && shape.path.length === 0)
      .map((shape) => shape.name);

    expect(withoutPath).toEqual([]);
  });
});

describe("the join between a declared country code and a geometry", () => {
  /**
   * The join is on the ISO 3166-1 numeric id, never on a name — and this asserts
   * the `id`, not the label, because a name-keyed join happens to work for Japan
   * ("Japan" both sides) and would sail through a test that only read the name.
   */
  it("marks the geometry whose numeric id matches the declared code", () => {
    const world = build(["JP"]);

    expect(world.visited).toHaveLength(1);
    expect(world.visited.map((shape) => shape.id)).toEqual([JAPAN_NUMERIC]);
    expect(world.visited.map((shape) => shape.code)).toEqual(["JP"]);
  });

  /**
   * The case that actually discriminates. The dataset calls the DRC
   * "Dem. Rep. Congo"; ICU calls it "Congo-Kinshasa" in French and
   * "Congo - Kinshasa" in English. No vocabulary lines up, so a join written
   * against names — the dataset label against a localised name, in either
   * direction — finds nothing and either throws or silently leaves the country
   * unvisited. Only the numeric works.
   *
   * The same trap sits under "W. Sahara", "Bosnia and Herz.",
   * "Central African Rep." and "S. Sudan"; one row is enough to catch the
   * mistake, and this is the row whose two names share not one word.
   */
  it("joins a country whose dataset label matches no localised name", () => {
    const world = build(["CD"]);
    const congo = shapeFor("CD", world.visited);

    expect(congo.id).toBe("180");
    expect(congo.name).not.toBe("Dem. Rep. Congo");
    expect(congo.name).toMatch(/Kinshasa/);
  });

  /**
   * `visited` is a *subset*, sharing the layer below rather than duplicating it —
   * pinned by identity in the block further down. A code declared twice, or a `Set`
   * handed in instead of an array, must not double a shape.
   */
  it("accepts any iterable of codes and never repeats a shape", () => {
    const fromSet = buildWorldGeometry({
      visitedCountryCodes: new Set<CountryCode>(["JP", "ES"]),
      locale: FRENCH,
    });

    expect(fromSet.visited.map((shape) => shape.code)).toEqual(["ES", "JP"]);
    expect(build(["JP", "JP"]).visited.map((shape) => shape.code)).toEqual(["JP"]);
  });

  it("leaves visited empty when nothing is declared", () => {
    const world = build([]);

    expect(world.visited).toEqual([]);
    expect(world.countries).toHaveLength(240);
  });
});

describe("a declared code that resolves to no geometry", () => {
  /**
   * Failing the build is the feature. The alternative — skipping the code — means
   * a traveller writes `country: JP`, ships it, and finds the country unshaded on
   * the live site with nothing in the logs. These are content mistakes, so both
   * messages are written for the person who typed the code, and both have to name
   * it: "unknown country code" without the code is a message that sends its reader
   * grepping.
   *
   * The two failures are distinct on purpose, because the fixes are different. A
   * code outside ISO 3166-1 is a typo to correct. A real country missing from the
   * 110m vintage is a resolution decision to make — either a finer dataset or a
   * marker instead of a fill — and telling the author "unknown code" for it would
   * send them looking for a typo that is not there.
   */
  it("refuses a code that is not ISO 3166-1 at all, and says so", () => {
    // "ZZ" is user-assigned in ISO 3166-1 and will never be in the table.
    expect(() => build(["ZZ"])).toThrow(/ZZ/);
    expect(() => build(["ZZ"])).toThrow(/ISO 3166-1/);
  });

  /**
   * Gibraltar. A real country code with a real numeric (292) that world-atlas 50m
   * does not carry, alongside TV (798) and UM (581) — the only three of the 249
   * assigned codes that the shipped vintage misses and a finer one would draw.
   *
   * **This case used to name Monaco, and the switch to 50m is why it could not
   * stay.** MC (492) was one of the micro-states 110m omitted, together with SG,
   * MT and SM; 50m draws all four. The vintage that fixed the coastline also
   * emptied this test of its subject, which is the ordinary way a resolution
   * change lands: it does not break the rule, it moves the examples.
   */
  it("refuses a real country the 50m vintage does not carry, and says why", () => {
    expect(() => build(["GI"])).toThrow(/GI/);
    expect(() => build(["GI"])).toThrow(/50m/);
  });

  /**
   * The half that a single `toThrow()` would let rot: two failures reported with
   * one message is the same as one failure. This compares the messages rather
   * than trusting each pattern above to be specific enough.
   *
   * The discriminator is the *escape route*, not the vocabulary. Both messages
   * legitimately mention ISO 3166-1 — naming the numeric it resolved to is exactly
   * what makes the "missing geometry" message actionable — so "one says ISO and
   * the other does not" was a bad proxy, and this case used to assert it. What
   * genuinely separates them is that a typo has no resolution story to tell: only
   * the real-country failure may talk about the 50m vintage, because only there
   * is switching dataset a fix the author can consider.
   */
  it("tells the two failures apart", () => {
    const unknownCode = (() => {
      try {
        build(["ZZ"]);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return "";
    })();

    const missingGeometry = (() => {
      try {
        build(["GI"]);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return "";
    })();

    expect(unknownCode).not.toBe("");
    expect(missingGeometry).not.toBe("");
    expect(unknownCode).not.toBe(missingGeometry);
    expect(unknownCode).not.toMatch(/50m/);
  });
});

describe("the viewBox and the precision of the path data", () => {
  it("reports the 960×500 box the projection produces", () => {
    const world = build([]);

    expect(world.viewBox).toBe("0 0 960 500");
    expect(world.width).toBe(960);
    expect(world.height).toBe(500);
  });

  /**
   * One decimal, across all 240 paths and not a sample — the failure this catches
   * is a single geometry emitted through a different code path (a point feature, a
   * multi-polygon fallback) at full precision, which a sample of ten would miss
   * 94 times out of 100.
   */
  it("rounds every coordinate of every path to one decimal", () => {
    const tooPrecise = build([])
      .countries.filter((shape) => OVERLY_PRECISE_NUMBER_PATTERN.test(shape.path))
      .map((shape) => shape.name);

    expect(tooPrecise).toEqual([]);
  });

  /**
   * Everything drawn has to be inside the box, because SVG does not complain: a
   * path outside the viewBox is clipped away in silence. A wrong `translate` or a
   * projection swapped for one with different defaults shows up here, and nowhere
   * else, as a continent quietly missing an edge.
   *
   * Measured on the real dataset: x spans 6.3 to 953.7, y spans 8.3 to 499.3 — so
   * the assertion has real margin at the top and almost none at the bottom.
   */
  it("keeps every coordinate of every path inside the viewBox", () => {
    const world = build([]);
    const escaped = world.countries
      .filter((shape) =>
        coordinatesOf(shape.path).some(
          ({ x, y }) => x < 0 || x > world.width || y < 0 || y > world.height
        )
      )
      .map((shape) => shape.name);

    expect(escaped).toEqual([]);
  });
});

describe("the weight of the geometry payload", () => {
  /**
   * A non-regression guard, not a performance measurement. The number below does
   * not get faster or slower with the machine: it is the compressed size of a
   * deterministic string, so it either holds or someone changed the rounding.
   *
   * **THE CEILING WAS 34 KiB AND IS NOW 200, AND THAT IS THE ONE THING THIS
   * COMMENT EXISTS TO EXPLAIN.** The old paragraph ended "if this fails, the fix
   * is to find what stopped rounding — not to raise the ceiling", and it was
   * right about every failure it could imagine. This is the failure it could not:
   * the ceiling was raised on purpose, by the owner, after being shown the figure.
   *
   * WHY. At the 110m vintage three of the journal's fourteen places rendered in
   * the sea — Les Sables-d'Olonne by 2.0 px, Roses by 0.8, Noirmoutier by 0.2,
   * measured point-in-polygon — because the simplification straightens the French
   * Atlantic façade. The owner reported it as misplaced markers before anyone
   * measured it. `src/map/dataset.ts` carries the full comparison across the three
   * vintages and the trade it settles.
   *
   * WHAT IT COSTS, and the number is deliberately in this test rather than only in
   * a comment: 30.2 KiB brotli at 110m, **182.6 KiB at 50m**. The home document
   * grows by about 152 KiB, and it is the only route that renders the full map.
   *
   * WHAT THE GUARD STILL GUARDS, because a ceiling six times higher is worth
   * nothing if it guards nothing. Two things, both still live:
   *
   * - **the rounding.** At three decimals this same vintage measures far past
   *   200 KiB, so losing `createRoundingPathContext` is still a red test — which
   *   was the original purpose, and the only one the old ceiling served.
   * - **a third silent vintage bump.** 10m measures 512.6 KiB and would fail here
   *   rather than ship, exactly as 50m used to.
   *
   * If this fails, the fix is still to find what stopped rounding. Raising it
   * again is a decision with an owner's name on it, not a repair.
   */
  it("keeps every path together under 200 KiB brotli", () => {
    const pathData = build([])
      .countries.map((shape) => shape.path)
      .join("");
    const compressed = brotliCompressSync(Buffer.from(pathData, "utf8")).byteLength;

    expect(compressed).toBeLessThan(200 * 1024);
  });
});

describe("the order of the visited layer", () => {
  /**
   * Declared in a deliberately wrong order, because `visited` feeds a legend a
   * reader scans alphabetically. Sorting at render time instead would mean every
   * consumer re-sorts, and the second one to forget produces a legend in dataset
   * order without failing anything.
   */
  it("sorts by localised name, whatever order the codes arrive in", () => {
    expect(visitedNames(["JP", "ES", "AT"], "fr")).toEqual(["Autriche", "Espagne", "Japon"]);
  });

  /**
   * The case that separates `Intl.Collator` from `a < b`, which is what a
   * plain `.sort()` uses. French names starting with an accented capital are where
   * the two disagree: "É" is U+00C9, code unit 201, while "E" is 69 and "F" is 70.
   *
   * So raw code-unit order puts Égypte *last* — after Espagne and after France —
   * and a legend reading "Espagne, France, Égypte" looks like a bug in the data
   * rather than in the sort. Verified with `node -e`: `"Égypte" < "Espagne"` is
   * `false`, while `new Intl.Collator("fr").compare("Égypte", "Espagne")` is `-1`.
   *
   * The second assertion is what keeps this honest: it demands that the answer
   * *differ* from the raw sort, so the expectation above cannot be quietly
   * rewritten to match a broken implementation.
   */
  it("collates accented names the way French does, not the way code units do", () => {
    const names = visitedNames(["FR", "EG", "ES"], "fr");

    expect(names).toEqual(["Égypte", "Espagne", "France"]);
    expect(names).not.toEqual([...names].sort());
  });

  /**
   * The locale is a parameter, not a decoration. This is the case that fails if
   * the names come from a hard-coded French table or the collator is pinned to
   * "fr": English changes both halves at once, the labels *and* their order —
   * Autriche/Espagne/Japon becomes Austria/Japan/Spain.
   */
  it("changes both the names and their order with the locale", () => {
    const french = visitedNames(["JP", "ES", "AT"], "fr");
    const english = visitedNames(["JP", "ES", "AT"], "en");

    expect(english).toEqual(["Austria", "Japan", "Spain"]);
    expect(english).not.toEqual(french);
    expect(build(["JP", "ES", "AT"], "en").visited.map((shape) => shape.code)).toEqual([
      "AT",
      "JP",
      "ES",
    ]);
  });
});

describe("the identity shared between the two layers", () => {
  /**
   * Same object, not an equal one — `toBe`, never `toEqual`. TIW-13 renders the
   * background layer once and refers to a visited country with `<use href="#…">`
   * rather than emitting its path a second time; at 30 KiB of path data, doing it
   * twice doubles the page.
   *
   * `toEqual` would pass on a deep copy and the duplication would ship. So would a
   * reviewer reading the diff: two structurally identical objects look right.
   */
  it("returns the very same shape object in visited and in countries", () => {
    const world = build(["JP"]);
    const visited = shapeFor("JP", world.visited);
    const background = shapeFor("JP", world.countries);

    expect(visited).toBe(background);
  });

  /**
   * Every visited entry, not just the one above — a `find`-based implementation
   * shares identity by accident and a `map`-based one copies every time, so the
   * guard has to cover the whole set. `Array.prototype.includes` compares by
   * reference for objects, which is `toBe` applied 240 times in one assertion.
   */
  it("shares identity for every visited country at once", () => {
    const world = build(["JP", "ES", "AT", "CD", "BR", "AU"]);
    const copied = world.visited
      .filter((shape) => !world.countries.includes(shape))
      .map((shape) => shape.code);

    expect(world.visited).toHaveLength(6);
    expect(copied).toEqual([]);
  });
});
