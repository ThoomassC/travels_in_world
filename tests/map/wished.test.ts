import { describe, expect, it } from "vitest";
import type { CountryCode } from "@/domain/geo";
import { labelAnchorOf, ringsOfPath } from "@/map/anchor";
import { buildWorldGeometry } from "@/map/world";

/**
 * **The third bucket of the geometry façade** (TIW-39): the countries the owner
 * wants to visit, which the map tints in a state of their own.
 *
 * Everything here is the same shape of decision `visited` already made, one
 * bucket over, and it is in a file of its own rather than in `world.test.ts`
 * because it asks one question that bucket never had to: a tinted country now
 * carries a *note*, so it needs a point as well as a path.
 *
 * The two properties that matter, and neither is cosmetic:
 *
 * - **a code the map cannot draw fails the build**, exactly as a visited one
 *   does. The wishlist is hand-written content like a trip is, so `HRV` or `XK`
 *   must stop the build naming the code — not disappear from the drawing while
 *   `npm run build` reports success;
 * - **a country cannot be visited and wished for at once.** The drawing paints
 *   one shape once, and the three layers are handed over disjoint (see
 *   `WorldMapProps`), so an overlap has no rendering. Choosing one silently would
 *   make the map disagree with the file that produced it.
 */

const FRENCH = "fr";

const build = (
  visitedCountryCodes: readonly CountryCode[],
  wishedCountryCodes: readonly CountryCode[]
) => buildWorldGeometry({ visitedCountryCodes, wishedCountryCodes, locale: FRENCH });

describe("the wished layer", () => {
  it("is empty when nothing is wished for, and the option may be left out", () => {
    expect(buildWorldGeometry({ visitedCountryCodes: ["FR"], locale: FRENCH }).wished).toEqual([]);
    expect(build(["FR"], []).wished).toEqual([]);
  });

  it("carries one entry per wished country, with its localised name and its path", () => {
    const { wished } = build([], ["HR", "IT"]);

    expect(wished.map((country) => country.code)).toEqual(["HR", "IT"]);
    expect(wished.map((country) => country.name)).toEqual(["Croatie", "Italie"]);
    for (const country of wished) {
      expect(country.path.length).toBeGreaterThan(0);
    }
  });

  /**
   * Sorted by localised name, like `visited`, and for the identical reason: DOM
   * order is tab order, and a keyboard reader walking the notes in an order no
   * label explains is walking noise. `Intl.Collator` and not `<`, because in
   * French "Égypte" sorts before "Espagne" and code-unit order puts every
   * accented letter after `Z`.
   */
  it("sorts by localised name, whatever order the codes arrive in", () => {
    expect(build([], ["PT", "HR", "ME", "IT"]).wished.map((country) => country.name)).toEqual([
      "Croatie",
      "Italie",
      "Monténégro",
      "Portugal",
    ]);
  });

  it("never repeats a country, however many times the file names it", () => {
    expect(build([], ["IT", "IT", "IT"]).wished.map((country) => country.code)).toEqual(["IT"]);
  });

  /**
   * The anchor is the whole reason this bucket is richer than `visited`: the note
   * is an HTML element over the drawing, and it has to hang somewhere inside the
   * country it names. `labelAnchorOf` owns the arithmetic and
   * `tests/map/anchor.test.ts` owns its cases; what is asserted here is that the
   * façade really carries the answer through, on the four countries this ticket
   * is about.
   */
  it("anchors every wished country inside its own shape", () => {
    const { wished } = build([], ["HR", "IT", "ME", "PT"]);

    expect(wished).toHaveLength(4);
    for (const country of wished) {
      expect(country.anchor).toEqual(labelAnchorOf(country.path));
      expect(insideRings(country.path, country.anchor)).toBe(true);
    }
  });

  it("keeps the anchor inside the projected world box", () => {
    for (const country of build([], ["HR", "IT", "ME", "PT"]).wished) {
      expect(country.anchor.x).toBeGreaterThanOrEqual(0);
      expect(country.anchor.x).toBeLessThanOrEqual(960);
      expect(country.anchor.y).toBeGreaterThanOrEqual(0);
      expect(country.anchor.y).toBeLessThanOrEqual(500);
    }
  });

  it("leaves the background layer and the visited layer alone", () => {
    const without = buildWorldGeometry({ visitedCountryCodes: ["FR"], locale: FRENCH });
    const with_ = build(["FR"], ["IT"]);

    expect(with_.countries.length).toBe(without.countries.length);
    expect(with_.visited.map((country) => country.code)).toEqual(["FR"]);
  });
});

describe("a wished code the map cannot honour", () => {
  it("refuses a code ISO 3166-1 assigns to nobody, and names it", () => {
    expect(() => build([], ["ZZ"])).toThrow(/ZZ/);
    expect(() => build([], ["ZZ"])).toThrow(/ISO 3166-1/);
  });

  it("refuses a real country the shipped vintage has no shape for, and says why", () => {
    expect(() => build([], ["GI"])).toThrow(/GI/);
    expect(() => build([], ["GI"])).toThrow(/50m/);
  });

  /**
   * The message has to say which *list* the code came from. Both lists are
   * hand-written files and both refuse the same codes; a build that says
   * « le code pays « ZZ » n'est pas reconnu » and stops there sends the author
   * grepping thirteen `trip.yaml` files for a code that is in `wishlist.yaml`.
   */
  it("says the code came from the wishlist and not from a trip", () => {
    expect(() => build([], ["ZZ"])).toThrow(/wishlist\.yaml/);
    expect(() => build(["ZZ"], [])).not.toThrow(/wishlist\.yaml/);
  });

  /**
   * Every offending code at once, like the visited list: an author with two bad
   * codes should not need two builds to see two lines.
   */
  it("reports every bad code in one message", () => {
    const message = (() => {
      try {
        build([], ["ZZ", "QQ"]);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return "";
    })();

    expect(message).toMatch(/ZZ/);
    expect(message).toMatch(/QQ/);
  });
});

describe("a country that is both visited and wished for", () => {
  /**
   * PROVEN BY THE RENDERING, not by taste. `WorldMapProps` states that the three
   * tinted lists arrive disjoint, because the layers are painted one over the
   * other and a country in two of them would be drawn twice — the second paint
   * hiding the first, so the map would silently show one state and the content
   * would say two.
   *
   * Refused rather than resolved: "visited wins" and "wished wins" are both
   * defensible, which is exactly why the map must not pick one on the author's
   * behalf. The file says two contradictory things and the person who wrote it is
   * the one who can say which.
   */
  it("fails the build naming the country and both lists", () => {
    expect(() => build(["IT"], ["IT"])).toThrow(/IT/);
    expect(() => build(["IT"], ["IT"])).toThrow(/wishlist\.yaml/);
  });

  it("does not fail when the two lists are merely adjacent", () => {
    expect(() => build(["FR", "ES"], ["IT", "PT"])).not.toThrow();
  });
});

/** Even-odd containment, written out so the assertion is not the code under test. */
function insideRings(path: string, point: { readonly x: number; readonly y: number }): boolean {
  let crossings = 0;

  for (const ring of ringsOfPath(path)) {
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (a === undefined || b === undefined) {
        continue;
      }
      if (a.y > point.y !== b.y > point.y) {
        if (a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x) > point.x) {
          crossings += 1;
        }
      }
    }
  }

  return crossings % 2 === 1;
}
