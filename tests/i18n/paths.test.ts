import { describe, expect, it } from "vitest";
import { countryAnchor, TRIP_SEGMENT, tripPath, tripsCountryPath } from "@/i18n/paths";

/**
 * A four-line module gets a spec for one reason: these strings are URLs, and a
 * URL that has been shared is a promise. The map (TIW-13) links to them before
 * the page (TIW-16) exists, so the two tickets agree on a value that nothing
 * else in the build compares — a silent rename ships a home page full of 404s.
 *
 * This file is that comparison. It goes red the day the segment changes, which
 * is the moment to decide whether a redirect is owed to the old address.
 */

describe("tripPath", () => {
  it("builds a locale-agnostic path from the trip segment and the slug", () => {
    expect(tripPath("japon-2024")).toBe("/voyages/japon-2024");
  });

  it("carries no locale prefix, which is @/i18n/navigation's job and not this one", () => {
    // A `/fr` slipped in here would be prefixed twice by `getPathname`, giving
    // `/fr/fr/voyages/…` — a 404 that looks like a routing bug rather than a
    // string bug.
    expect(tripPath("japon-2024").startsWith("/voyages/")).toBe(true);
  });

  it.each(["japon-2024", "perou-2023", "pyrenees-2022"])(
    "is a plain absolute path for %s",
    (slug) => {
      expect(tripPath(slug)).toBe(`/${TRIP_SEGMENT}/${slug}`);
    }
  );

  /**
   * Pinned literally, not through the constant: asserting `tripPath(s)` against
   * a template built from `TRIP_SEGMENT` is a tautology that passes whatever the
   * segment becomes. This is the line that has to be edited on purpose.
   */
  it("names the segment in French, and the value is pinned", () => {
    expect(TRIP_SEGMENT).toBe("voyages");
  });
});

/**
 * The fragment the map's textual equivalent (TIW-15) aims at, and the `id`
 * `TripCatalogue` puts on a country's section. Both call the function below, so
 * this spec is the pin on the *value* — the one thing that can be renamed on one
 * side without anything failing, because a fragment that matches nothing does not
 * error: the browser leaves the reader at the top of a page of sixty trips.
 */
describe("countryAnchor", () => {
  it("is pinned literally, so a rename is a decision and not a side effect", () => {
    expect(countryAnchor("JP")).toBe("pays-jp");
  });

  it("lowercases the ISO code, which arrives uppercase by schema", () => {
    // Fragments are compared byte for byte by every browser, and every other
    // address on this site is lowercase.
    expect(countryAnchor("PE")).toBe("pays-pe");
    expect(countryAnchor("bo")).toBe("pays-bo");
  });

  it("gives a distinct anchor to each of the 249 assigned codes", () => {
    // A collision would silently send two countries to the same section.
    const codes = ["JP", "PE", "BO", "IS", "FR", "US", "CA"];

    expect(new Set(codes.map(countryAnchor)).size).toBe(codes.length);
  });

  it("cannot collide with the home page's per-trip fragments", () => {
    // The map's markers carry `id="voyage-<slug>"`. Different pages, but the two
    // prefixes are worth keeping visibly apart.
    expect(countryAnchor("JP").startsWith("voyage-")).toBe(false);
  });
});

describe("tripsCountryPath", () => {
  it("addresses the full listing at one country's section", () => {
    expect(tripsCountryPath("JP")).toBe("/voyages#pays-jp");
  });

  it("is the listing's own path plus a fragment, never a route of its own", () => {
    // Not a per-country page: `/voyages` is prerendered once and already groups
    // by country, so a second route would be a second rendering of the same
    // content — and this ticket links to that inventory rather than duplicating.
    expect(tripsCountryPath("PE").split("#")[0]).toBe(`/${TRIP_SEGMENT}`);
  });

  it("carries no locale prefix, which the page adds with localePathname", () => {
    expect(tripsCountryPath("IS").startsWith("/voyages")).toBe(true);
  });
});
