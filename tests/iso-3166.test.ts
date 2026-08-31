import { describe, expect, it } from "vitest";
import { isAssignedCountryCode, NUMERIC_BY_ALPHA2 } from "@/iso-3166";

/**
 * The registry module's own contract, as opposed to what the map does with it —
 * `tests/map/iso-3166.test.ts` owns the join against `world-atlas`, and it stayed
 * there when TIW-29 moved this table out of `src/map`.
 *
 * What is asserted here is the predicate `src/content/validate.ts` refuses content
 * on. It is the only thing in this project that turns a country code into a build
 * failure, so every answer it gives has to be deliberate — including the two
 * `false` answers a careless implementation would turn into `true`.
 */
describe("isAssignedCountryCode", () => {
  it("accepts the codes the standard assigns", () => {
    for (const code of ["FR", "JP", "PE", "MA", "NZ", "GB"]) {
      expect(isAssignedCountryCode(code), code).toBe(true);
    }
  });

  /**
   * The four families of "well-formed and yet nobody's": a user-assigned code in
   * real use (`XK`, Kosovo — the case TIW-29 was opened on), a code ISO reserves
   * and never assigns (`UK`), a withdrawn one (`AN`, Netherlands Antilles), and a
   * plain typo (`ZZ`, `QQ`). `CountryCodeSchema` accepts all five.
   */
  it("refuses a code of the right shape that no country bears", () => {
    for (const code of ["XK", "UK", "AN", "ZZ", "QQ"]) {
      expect(isAssignedCountryCode(code), code).toBe(false);
    }
  });

  /**
   * Not a nicety: `validate:content` runs this *after* the shape check, so a
   * lowercase code has already been reported with the one message that can say
   * "you wrote `jp`, write `JP`". Upper-casing here would answer `true` and delete
   * that message.
   */
  it("is case-sensitive, because a lowercase code was already reported as such", () => {
    expect(isAssignedCountryCode("jp")).toBe(false);
    expect(isAssignedCountryCode("Jp")).toBe(false);
  });

  /**
   * The code arrives from parsed YAML, so an inherited property name is a value an
   * author can write. On a plain object `record["constructor"]` answers with a
   * function, which is truthy — `countryCode: constructor` would have been an
   * assigned country. `src/domain/continent.ts` reads through a `Map` for the same
   * reason.
   */
  it("treats an inherited property name as no country at all", () => {
    for (const code of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(isAssignedCountryCode(code), code).toBe(false);
    }
  });

  it("refuses the empty string and anything that is not two letters", () => {
    for (const code of ["", " ", "F", "JPN", "J P", "42"]) {
      expect(isAssignedCountryCode(code), code).toBe(false);
    }
  });
});

describe("the table the predicate reads", () => {
  /**
   * Guards the guard, the way `tests/domain/continent.test.ts` does: a truncated
   * or emptied table would make every `refuses` case above pass by knowing
   * nothing at all.
   */
  it("carries the 249 officially assigned codes", () => {
    expect(NUMERIC_BY_ALPHA2.size).toBe(249);
  });

  it("agrees with the predicate on every one of them", () => {
    const disagreements = [...NUMERIC_BY_ALPHA2.keys()].filter(
      (code) => !isAssignedCountryCode(code)
    );

    expect(disagreements).toEqual([]);
  });
});
