import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { FreshTripBanner } from "@/components/trips/fresh-trip-banner";
import { tripEntry } from "./fixtures";
import { defaultLocale, frMessages, renderWithMessages } from "./support";

/**
 * The home page's "nouveau récit" banner — the second of TIW-19's three
 * placements, and the only one that says *when*.
 *
 * Whether the banner appears at all is the page's branch, not this component's:
 * it takes a `TripEntry` and never an optional, so "un site sans aucun voyage
 * publié n'affiche ni bandeau ni badge" is asserted where the branch lives
 * (`tests/domain/freshness.test.ts` for the rule, the E2E specs for the page).
 * What is pinned here is what a reader meets when it is there.
 */

const banner = (trip = tripEntry()) =>
  renderWithMessages(<FreshTripBanner trip={trip} locale={defaultLocale} />);

describe("FreshTripBanner", () => {
  it("announces the news in words", () => {
    banner();

    expect(screen.getByText(frMessages.home.freshLabel)).toBeInTheDocument();
  });

  it("names the trip in a heading, and that heading is the only link", () => {
    banner();

    expect(
      screen.getByRole("heading", { level: 2, name: "Japon, printemps 2024" })
    ).toBeInTheDocument();

    // One link, like a card: a second "lire le récit" anchor would be two tab
    // stops to one page, the defect `TripCard` refuses at length.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Japon, printemps 2024");
  });

  it("points at the trip's page, with the locale prefix", () => {
    banner();

    // Assembled from `tripPath` + `localePathname`, never written by hand: the
    // map and the cards link to these very URLs.
    expect(screen.getByRole("link")).toHaveAttribute("href", "/fr/voyages/japon-2024");
  });

  it("is a complementary landmark named by the trip it announces", () => {
    banner();

    // `<aside aria-labelledby>`: the banner points *into* the page's own content
    // — the same trip is in "Derniers voyages" below — so it is complementary
    // rather than a chapter, and a named landmark is one a reader can skip to.
    expect(screen.getByRole("complementary")).toHaveAccessibleName("Japon, printemps 2024");
  });

  /**
   * **The publication date, and it is the mitigation rather than a decoration.**
   *
   * The site is prerendered, so a badge outlives its sixtieth day until the next
   * build (`docs/fraicheur-au-prerendu.md`). A stale "Nouveau récit" is simply
   * wrong; a stale one carrying "publié le 2 mai 2024" lets the reader see that
   * for themselves. Deleting this line would remove the only honest half of the
   * banner in the one case the deployment cadence does not cover.
   */
  it("prints the day the récit was published, spelled out", () => {
    banner();

    expect(screen.getByText(/2 mai 2024/)).toBeInTheDocument();
  });

  it("carries the date as a machine-readable <time>, in the calendar's own spelling", () => {
    const { container } = banner();
    const time = container.querySelector("time");

    expect(time).not.toBeNull();
    expect(time).toHaveAttribute("datetime", "2024-05-02");
  });

  /**
   * The publication date and the trip's own dates are different facts, and the
   * banner shows the first. A component reading `endDate` would print "22 avril
   * 2024" here and pass every other case in this file.
   */
  it("shows the publication date and not the end of the journey", () => {
    banner(tripEntry({ publishedAt: "2026-03-01", endDate: "2019-08-30" }));

    expect(screen.getByText(/1 mars 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/2019/)).toBeNull();
  });

  /**
   * A day `PlainDateSchema` would have refused cannot arrive through the content
   * façade — but `TripEntry` is a structural type and `Intl` throws a
   * `RangeError` on an invalid `Date`. One bad string taking `next build` down
   * over a banner is a much worse failure than a banner printing a raw day.
   */
  it("prints the raw day rather than failing the build on one it cannot format", () => {
    banner(tripEntry({ publishedAt: "pas-un-jour" }));

    expect(screen.getByText(/pas-un-jour/)).toBeInTheDocument();
  });
});
