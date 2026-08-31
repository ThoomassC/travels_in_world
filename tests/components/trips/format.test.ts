import { describe, expect, it } from "vitest";
import {
  collatorFor,
  countryListOf,
  countryNameOf,
  countryNamesOf,
  formatDateRange,
} from "@/components/trips/format";

/**
 * The reader-facing formatting of a trip's facts. Everything here is `Intl`, so
 * the tests pin the *shape* of the answer and the decisions around it — never
 * ICU's wording, which belongs to the runtime's locale data.
 *
 * **Timezones.** Dates are calendar days held as strings, and the formatter is
 * pinned to UTC precisely so no machine's clock can shift one. Re-run this file
 * with `TZ=America/Santiago` (UTC−4, where a naive local formatting of
 * `2024-04-12` prints the 11th) or `TZ=Pacific/Auckland` and the rows below must
 * be identical — the same discipline `tests/domain/trip.test.ts` records for the
 * domain, and verified for this file.
 */

/**
 * ICU separates a French range with U+2009 THIN SPACE around a U+2013 EN DASH,
 * and that is *correct* French typography that must reach the page — so it is
 * normalised for the assertion rather than removed from the output. Without this
 * the expectations below would be string literals nobody can proof-read: the
 * failure reads `Expected "…2023 – 4…" Received "…2023 – 4…"`, byte-different and
 * pixel-identical. Measured on Node 24's ICU.
 */
const readable = (value: string): string => value.replace(/[   ]/g, " ");

describe("formatDateRange", () => {
  it("collapses a range inside one month to a single month and year", () => {
    expect(readable(formatDateRange("fr", "2024-04-12", "2024-04-26"))).toBe("12–26 avril 2024");
  });

  it("names both months when the trip crosses one", () => {
    expect(readable(formatDateRange("fr", "2024-04-12", "2024-05-03"))).toBe(
      "12 avril – 3 mai 2024"
    );
  });

  it("names both years when the trip crosses one", () => {
    expect(readable(formatDateRange("fr", "2023-12-28", "2024-01-04"))).toBe(
      "28 décembre 2023 – 4 janvier 2024"
    );
  });

  it("prints a one-day trip as one date, not as a range from a day to itself", () => {
    expect(formatDateRange("fr", "2024-06-01", "2024-06-01")).toBe("1 juin 2024");
  });

  it("keeps the typographic thin spaces ICU puts around the dash", () => {
    // The normalisation above must stay a test convenience: the page ships the
    // real characters, which are what keeps "3 mai" from wrapping away from its
    // dash.
    expect(formatDateRange("fr", "2024-04-12", "2024-05-03")).toContain(" – ");
  });

  it("keeps the day the traveller wrote down, whatever the machine's timezone", () => {
    /**
     * The regression this pins: `new Date("2024-04-12")` is midnight UTC, which
     * is the 11th in Santiago. Reading it back with anything but an explicit UTC
     * timezone prints the day before — a one-day error on every date of the site,
     * visible to nobody who develops in Europe.
     */
    expect(formatDateRange("fr", "2024-01-01", "2024-01-01")).toContain("1 janvier 2024");
    expect(formatDateRange("fr", "2024-12-31", "2024-12-31")).toContain("31 décembre 2024");
  });

  it("falls back to the raw days rather than throwing on a date it cannot read", () => {
    /**
     * Unreachable through the legitimate path — `PlainDateSchema` has already
     * rejected anything that is not a real calendar day — but `TripEntry` is a
     * structural type, so nothing in the type system says so. `Intl` throws a
     * `RangeError` on an invalid `Date`, and one bad day would take down the whole
     * listing at build time rather than the one card that carries it.
     */
    expect(formatDateRange("fr", "2024-02-30", "pas-une-date")).toBe("2024-02-30 – pas-une-date");
  });
});

describe("countryNameOf", () => {
  it("localises a country code", () => {
    expect(countryNameOf("fr", "JP")).toBe("Japon");
    expect(countryNameOf("fr", "PE")).toBe("Pérou");
  });

  it("names Kosovo, whose code the map cannot draw", () => {
    // `XK` is user-assigned, so it is absent from `src/map/iso-3166.ts` — but ICU
    // knows it, and the listing has to say something other than "XK".
    expect(countryNameOf("fr", "XK")).toBe("Kosovo");
  });

  it("hands back the code itself when ICU does not know it", () => {
    /**
     * ICU echoes the input for an unknown region rather than answering
     * `undefined`, which is exactly how a mistyped alpha-2 shows up — the same
     * trap `src/map/world.ts` documents. Showing the code is honest; showing
     * `undefined` under a heading is not.
     */
    expect(countryNameOf("fr", "QQ")).toBe("QQ");
  });
});

describe("countryNamesOf", () => {
  it("orders the names the way the reader reads them, not the way the codes sort", () => {
    /**
     * The domain hands `countryCodes` sorted by code — `deterministic
     * everywhere`, which is what a domain owes. On screen that is the wrong
     * order: `["CH", "ES"]` reads "Suisse, Espagne". The locale-aware sort
     * belongs here, where the locale is known.
     */
    expect(countryNamesOf("fr", ["CH", "ES"])).toEqual(["Espagne", "Suisse"]);
  });

  it("sorts accented names where French expects them", () => {
    expect(countryNamesOf("fr", ["ET", "ES", "EE"])).toEqual(["Espagne", "Estonie", "Éthiopie"]);
  });

  it("answers an empty list for no country", () => {
    expect(countryNamesOf("fr", [])).toEqual([]);
  });

  it("does not mutate the array it was given", () => {
    // The content façade memoises its projections for the whole build; an
    // in-place sort here would reorder a shared snapshot for every later page.
    const codes = ["JP", "FR"];

    countryNamesOf("fr", codes);

    expect(codes).toEqual(["JP", "FR"]);
  });
});

describe("countryListOf", () => {
  /**
   * What this pins is a *site-wide* agreement, not a string. The card used to
   * join country names with a hard-coded `", "` while the map's caption and the
   * trip page both went through `Intl.ListFormat`, so the very same two
   * countries read "Bolivie, Pérou" in the listing and "Bolivie et Pérou"
   * everywhere else. The assertion below is the two-item case precisely because
   * that is the only one where a comma and a conjunction differ.
   */
  it("joins two countries with the language's conjunction, not with a comma", () => {
    expect(countryListOf("fr", ["BO", "PE"])).toBe("Bolivie et Pérou");
  });

  it("keeps the comma between all but the last two", () => {
    expect(countryListOf("fr", ["JP", "TH", "PE"])).toBe("Japon, Pérou et Thaïlande");
  });

  it("prints a single country as itself, with no separator at all", () => {
    expect(countryListOf("fr", ["JP"])).toBe("Japon");
  });

  it("answers an empty string for no country", () => {
    // The card tests `countryCodes.length` and never renders this, but a
    // formatter that threw on an empty array would make that a coupling rather
    // than a choice.
    expect(countryListOf("fr", [])).toBe("");
  });

  it("orders the names the way the reader reads them, like countryNamesOf", () => {
    // `["CH", "ES"]` is the domain's by-code order, and it reads "Suisse et
    // Espagne" if the list is formatted before it is sorted.
    expect(countryListOf("fr", ["CH", "ES"])).toBe("Espagne et Suisse");
  });

  it("does not mutate the array it was given", () => {
    const codes = ["JP", "FR"];

    countryListOf("fr", codes);

    expect(codes).toEqual(["JP", "FR"]);
  });

  it("takes the locale as an argument and never from the ambient runtime", () => {
    /**
     * The rule `src/map/world.ts` and `collatorFor` both state. An
     * `Intl.ListFormat` built with no locale reads the machine's default, which
     * at build time is the builder's and not the page's — a defect that shows up
     * only on someone else's laptop.
     */
    expect(countryListOf("en", ["BO", "PE"])).toBe("Bolivia and Peru");
  });
});

describe("collatorFor", () => {
  it("compares in the locale's order, not in code-unit order", () => {
    // `"Éthiopie" < "Espagne"` is true on code units, and false in French.
    expect(collatorFor("fr").compare("Éthiopie", "Espagne")).toBeGreaterThan(0);
  });

  it("returns the same instance for the same locale", () => {
    // Sixty cards build a lot of comparisons; a new `Intl.Collator` per call is
    // the one avoidable cost in this file.
    expect(collatorFor("fr")).toBe(collatorFor("fr"));
  });
});
