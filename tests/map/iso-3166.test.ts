import { describe, expect, it } from "vitest";
import { NUMERIC_BY_ALPHA2 } from "@/map/iso-3166";
import { readDatasetGeometries } from "./support";

/**
 * `NUMERIC_BY_ALPHA2` is a hand-transcribed table of ~250 rows, and it is the
 * join key between the content a traveller writes (`country: JP`) and the shape
 * the map fills. A single mistyped digit has no symptom worth the name: the build
 * stays green, the lint stays green, and one country on the planisphere is
 * shaded the wrong colour — or a trip silently fails to resolve because the
 * numeric it points at does not exist in the dataset.
 *
 * So the table is not reviewed, it is measured. The decisive case below is the
 * structural one: **exactly 174 of the dataset's 177 geometries must resolve to
 * an alpha-2**, and the three that do not must be the three the dataset ships
 * without an id. A digit transcribed wrong leaves a geometry orphaned and that
 * count moves — which is a property no amount of spot-checking gives you.
 *
 * The dataset side of every comparison is read straight from `node_modules` by
 * `./support`, never through the code under test; a count that both sides derive
 * from the same table proves nothing.
 */

const geometries = readDatasetGeometries();

/** The three territories world-atlas 110m ships with no `id` at all. */
const UNIDENTIFIED_TERRITORY_NAMES = ["Kosovo", "N. Cyprus", "Somaliland"];

const ALPHA2_PATTERN = /^[A-Z]{2}$/;
const NUMERIC_PATTERN = /^\d{3}$/;

/**
 * The direction the map actually joins in — numeric to alpha-2 — rebuilt here
 * rather than exported, so the production module keeps exactly one table and
 * cannot drift between two.
 */
function alpha2ByNumeric(): ReadonlyMap<string, string> {
  return new Map(Array.from(NUMERIC_BY_ALPHA2, ([alpha2, numeric]) => [numeric, alpha2]));
}

describe("the shape of every row", () => {
  /**
   * A lowercase key or a two-digit numeric never matches anything, so the country
   * it stands for is simply undrawable — and the only trace is a build error on a
   * trip nobody has written yet.
   */
  it("keys every row with an uppercase ISO 3166-1 alpha-2 code", () => {
    const malformed = Array.from(NUMERIC_BY_ALPHA2.keys()).filter(
      (alpha2) => !ALPHA2_PATTERN.test(alpha2)
    );

    expect(malformed).toEqual([]);
  });

  /**
   * Three digits, zero-padded, held as a string. `"040"` and `40` are different
   * keys to a `Map`, and the dataset spells its ids as padded strings — so a row
   * that dropped the padding or the quotes joins against nothing.
   */
  it("values every row with a three-digit zero-padded numeric code", () => {
    const malformed = Array.from(NUMERIC_BY_ALPHA2, ([alpha2, numeric]) => ({ alpha2, numeric }))
      .filter(({ numeric }) => !NUMERIC_PATTERN.test(numeric))
      .map(({ alpha2, numeric }) => `${alpha2} -> ${numeric}`);

    expect(malformed).toEqual([]);
  });

  /**
   * The table has to be injective, not just total: two alpha-2 codes sharing a
   * numeric means one of the two paints the other's country, and both look
   * plausible in a diff.
   *
   * Duplicate *keys* are deliberately not asserted on — a `ReadonlyMap` has
   * already collapsed them by the time a test can look, so the assertion would be
   * vacuous. The 174-of-177 count below is what catches that class of typo: a
   * collapsed key leaves one country pointing at the wrong numeric, and the
   * geometry it abandoned turns up orphaned.
   */
  it("maps no two alpha-2 codes onto the same numeric code", () => {
    const numerics = Array.from(NUMERIC_BY_ALPHA2.values());
    const duplicated = numerics.filter((numeric, index) => numerics.indexOf(numeric) !== index);

    expect(Array.from(new Set(duplicated))).toEqual([]);
  });
});

describe("the rows a mistake would be easiest to hide in", () => {
  /**
   * Spot checks across every continent, `JP` being the one the ticket states
   * outright. These do not prove the table; they make a wholesale mistake — a
   * table pasted from the alpha-3 column, or shifted by one row — fail with a
   * readable message instead of as an arithmetic surprise in the count above.
   */
  it.each([
    { alpha2: "JP", numeric: "392" },
    { alpha2: "FR", numeric: "250" },
    { alpha2: "DE", numeric: "276" },
    { alpha2: "US", numeric: "840" },
    { alpha2: "BR", numeric: "076" },
    { alpha2: "ZA", numeric: "710" },
    { alpha2: "AU", numeric: "036" },
    { alpha2: "CN", numeric: "156" },
    { alpha2: "IN", numeric: "356" },
    { alpha2: "RU", numeric: "643" },
    { alpha2: "EG", numeric: "818" },
    { alpha2: "NG", numeric: "566" },
    { alpha2: "MX", numeric: "484" },
    { alpha2: "CA", numeric: "124" },
    { alpha2: "AR", numeric: "032" },
    { alpha2: "ID", numeric: "360" },
  ])("maps $alpha2 to $numeric", ({ alpha2, numeric }) => {
    expect(NUMERIC_BY_ALPHA2.get(alpha2)).toBe(numeric);
  });
});

describe("the table against the dataset it has to join with", () => {
  /**
   * The strongest guard in this file, and the reason the others can stay light.
   *
   * world-atlas 110m ships 177 country geometries, 174 of which carry an ISO
   * 3166-1 numeric id. Every one of those 174 has to find an alpha-2 in the
   * table. A single digit transcribed wrong breaks the pair in both directions at
   * once — the alpha-2 points at a numeric nothing owns, and the geometry it was
   * meant for is left orphaned — so this count cannot stay at 174 through a typo.
   *
   * The failure names the orphans, because "expected 174, got 173" is not
   * actionable and "OrphanedNumeric 704 (Vietnam)" is.
   */
  it("resolves exactly 174 of the 177 geometries to an alpha-2 code", () => {
    const byNumeric = alpha2ByNumeric();
    const identified = geometries.filter((geometry) => geometry.id !== null);
    const orphaned = identified
      .filter((geometry) => geometry.id !== null && !byNumeric.has(geometry.id))
      .map((geometry) => `${geometry.id} (${geometry.name})`);

    expect(geometries).toHaveLength(177);
    expect(identified).toHaveLength(174);
    expect(orphaned).toEqual([]);
  });

  /**
   * The other half of the same count. Three geometries have no id in this vintage
   * and can never be joined — they are drawn as background and nothing else. If a
   * fourth appears, or one of these three gains an id, the "174" above stops
   * meaning what it says, and the map's handling of unjoinable shapes needs
   * revisiting rather than the number being nudged.
   */
  it("leaves exactly Kosovo, N. Cyprus and Somaliland unidentified", () => {
    const unidentified = geometries
      .filter((geometry) => geometry.id === null)
      .map((geometry) => geometry.name)
      .sort();

    expect(unidentified).toEqual(UNIDENTIFIED_TERRITORY_NAMES);
  });

  /**
   * A second, independent opinion on the same 174 rows, from ICU rather than from
   * the dataset. `Intl.DisplayNames` falls back to echoing the input when it does
   * not recognise a region, so a code that ICU cannot name — `"XK"`, a typo, an
   * alpha-3 slipped into the column — comes back identical to what went in.
   *
   * Deliberately not compared against `properties.name`: the two vocabularies
   * diverge legitimately on some twenty rows ("W. Sahara" / "Western Sahara",
   * "Dem. Rep. Congo" / "Congo - Kinshasa", "Bosnia and Herz.", "S. Sudan"), and a
   * test carrying an exception list that long is a test that gets disabled at the
   * first ICU update. Recognition alone is the part that holds.
   */
  it("names every resolved alpha-2 code through ICU", () => {
    const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    const byNumeric = alpha2ByNumeric();
    const unrecognised = geometries
      .map((geometry) => (geometry.id === null ? undefined : byNumeric.get(geometry.id)))
      .filter((alpha2): alpha2 is string => alpha2 !== undefined)
      .filter((alpha2) => {
        const name = regionNames.of(alpha2);
        return name === undefined || name === alpha2;
      });

    expect(unrecognised).toEqual([]);
  });
});
