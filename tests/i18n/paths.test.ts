import { describe, expect, it } from "vitest";
import { TRIP_SEGMENT, tripPath } from "@/i18n/paths";

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
