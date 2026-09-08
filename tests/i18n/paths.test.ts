import { describe, expect, it } from "vitest";
import {
  COUNTRY_SEGMENT,
  countryPath,
  countrySlug,
  countrySlugsByCode,
  PUBLISHED_COUNTRY_SLUGS,
  TRIP_SEGMENT,
  tripPath,
} from "@/i18n/paths";

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
 * The country pages (TIW-39), and the one thing about them that can break
 * without anybody touching this repository.
 *
 * A country's slug is derived from its **French** name, and that name comes from
 * `Intl.DisplayNames` — i.e. from the ICU data bundled with whatever Node the
 * build runs on. ICU renames regions: it has moved « Macédoine » to « Macédoine
 * du Nord », « Swaziland » to « Eswatini », « Biélorussie » to « Bélarus ». A
 * rename like that would silently move `/fr/pays/<slug>` for a country already
 * linked, and nothing in a green build would say so — the exact failure
 * `src/i18n/slug-history.ts` exists to refuse for trips.
 *
 * So the slugs of the countries this carnet already reaches are **frozen** in
 * `PUBLISHED_COUNTRY_SLUGS`, and two things read that register: the assertions
 * below, which go red under a new ICU, and `countrySlugsByCode`, which throws
 * during `next build` rather than shipping a moved address.
 */

const frenchRegionNames = new Intl.DisplayNames(["fr"], { type: "region" });
const frenchNameOf = (code: string): string => frenchRegionNames.of(code) ?? code;

describe("countryPath", () => {
  it("names the segment in French, and the value is pinned", () => {
    // Pinned literally and not through the constant, for the reason `tripPath`'s
    // own case gives: a template built from the constant is a tautology.
    expect(COUNTRY_SEGMENT).toBe("pays");
  });

  it("builds a locale-agnostic path from the country segment and the slug", () => {
    expect(countryPath("france")).toBe("/pays/france");
  });

  it("carries no locale prefix, which is @/i18n/navigation's job and not this one", () => {
    expect(countryPath("grece").startsWith("/pays/")).toBe(true);
  });
});

describe("countrySlug", () => {
  it.each([
    ["France", "france"],
    ["Espagne", "espagne"],
    ["Grèce", "grece"],
    ["Belgique", "belgique"],
    ["Suisse", "suisse"],
  ])("folds %s to %s", (name, slug) => {
    expect(countrySlug(name)).toBe(slug);
  });

  it.each([
    // The shapes ICU's French region names actually take, so the folding is
    // asserted against the alphabet it will meet rather than against ASCII.
    ["Côte d’Ivoire", "cote-d-ivoire"],
    ["Bosnie-Herzégovine", "bosnie-herzegovine"],
    ["États-Unis", "etats-unis"],
    ["Åland", "aland"],
    ["Saint-Barthélemy", "saint-barthelemy"],
  ])("folds %s to %s", (name, slug) => {
    expect(countrySlug(name)).toBe(slug);
  });

  /**
   * The same alphabet `SlugSchema` accepts for a trip, because these strings end
   * up in the same kind of address: lowercase, digits, single hyphens, no edges.
   */
  it.each(["France", "Côte d’Ivoire", "Trinité-et-Tobago", "Saint-Kitts-et-Nevis"])(
    "produces a slug of the project's own alphabet for %s",
    (name) => {
      expect(countrySlug(name)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  );

  /**
   * A name that folds to nothing has no address, and inventing one — `""`, or the
   * code — would publish a page at `/fr/pays/`. It throws at build time instead.
   */
  it("refuses a name that folds to nothing rather than inventing an address", () => {
    expect(() => countrySlug("———")).toThrow(/slug/i);
  });
});

describe("PUBLISHED_COUNTRY_SLUGS — the register ICU cannot move", () => {
  it("holds the five countries the carnet reaches today", () => {
    expect(PUBLISHED_COUNTRY_SLUGS).toEqual({
      BE: "belgique",
      CH: "suisse",
      ES: "espagne",
      FR: "france",
      GR: "grece",
    });
  });

  /**
   * THE ICU ALARM. Each registered code is re-derived from the runtime's own
   * French region name; a Node whose ICU renamed one of these countries makes
   * this red, which is the moment to decide whether a redirect is owed to the
   * address people already have.
   */
  it.each(Object.entries(PUBLISHED_COUNTRY_SLUGS))(
    "%s still derives « %s » from this runtime's ICU",
    (code, slug) => {
      expect(countrySlug(frenchNameOf(code))).toBe(slug);
    }
  );
});

describe("countrySlugsByCode", () => {
  it("maps each visited code to its slug", () => {
    expect([...countrySlugsByCode(["FR", "GR"], frenchNameOf)]).toEqual([
      ["FR", "france"],
      ["GR", "grece"],
    ]);
  });

  it("is the same map whatever the order the codes arrive in", () => {
    expect([...countrySlugsByCode(["GR", "FR"], frenchNameOf).keys()].sort()).toEqual(["FR", "GR"]);
  });

  it("counts a code once even when the caller repeats it", () => {
    expect(countrySlugsByCode(["FR", "FR"], frenchNameOf).size).toBe(1);
  });

  /**
   * The guard that makes `next build` — and not only `npm test` — the thing that
   * goes red when ICU moves a name. Simulated with an injected resolver, because
   * the real ICU cannot be moved from a test.
   */
  it("throws when a registered country no longer derives its frozen slug", () => {
    const renamed = (code: string): string => (code === "GR" ? "Hellade" : frenchNameOf(code));

    expect(() => countrySlugsByCode(["GR"], renamed)).toThrow(/GR/);
  });

  /**
   * Two countries claiming one address is a page that renders one of them and
   * drops the other, decided by iteration order. It fails the build instead.
   */
  it("refuses two codes that fold to one slug", () => {
    const ambiguous = (code: string): string =>
      code === "FR" || code === "GR" ? "Ailleurs" : code;

    expect(() => countrySlugsByCode(["FR", "GR"], ambiguous)).toThrow(/ailleurs/i);
  });

  it("accepts a country the register has never seen, which is how a new one arrives", () => {
    expect(countrySlugsByCode(["JP"], frenchNameOf).get("JP")).toBe("japon");
  });
});
