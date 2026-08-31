import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { WithdrawnNotice } from "@/app/[locale]/voyages/[slug]/withdrawn-notice";
import { tripIn } from "../components/trips/fixtures";
import { defaultLocale, frMessages, renderWithMessages } from "../components/trips/support";

/**
 * The page left at the address of a withdrawn trip.
 *
 * It is rendered here rather than only end to end because the state that matters —
 * three published trips to offer instead of an empty catalogue — is not the state
 * the E2E build is in: `content/trips/` is empty, so the served page shows the
 * waiting block. Both states are asserted, and the populated one only here.
 *
 * The real message catalogue, through `renderWithMessages`, for the reason that
 * helper records: a stub would let this component read a key that does not exist in
 * `fr.json` and still pass, which on a French-only site is invisible otherwise.
 */

const sixTrips = ["JP", "PE", "FR", "IS", "MA", "IT"].map((code, index) => tripIn(code, index));

describe("what a reader is told", () => {
  it("names what happened in the reader's words, with no status code and no slug", () => {
    renderWithMessages(<WithdrawnNotice locale={defaultLocale} trips={[]} />);

    /**
     * `<h1>`: this is the page's subject. And the criterion's "aucune trace
     * technique" — the heading must not carry 410, 404, a slug or the word "erreur".
     */
    const heading = screen.getByRole("heading", { level: 1, name: frMessages.withdrawn.title });

    expect(heading).toBeInTheDocument();
    expect(heading.textContent).not.toMatch(/\b(410|404|erreur|slug)\b/i);
  });

  it("explains that the address was right", () => {
    renderWithMessages(<WithdrawnNotice locale={defaultLocale} trips={[]} />);

    // The distinction the whole page exists for: a 404 tells the reader they
    // mis-copied the link, and this one tells them they did not.
    expect(screen.getByText(frMessages.withdrawn.body)).toBeInTheDocument();
  });
});

describe("the two ways out the criterion asks for", () => {
  it("offers the map", () => {
    renderWithMessages(<WithdrawnNotice locale={defaultLocale} trips={[]} />);

    const map = screen.getByRole("link", { name: frMessages.withdrawn.backMap });

    // Locale-prefixed, which is what `localePathname` is for: a bare `/` would be a
    // redirect on every click.
    expect(map).toHaveAttribute("href", `/${defaultLocale}`);
  });

  it("offers the full listing, through the same block as the home page", () => {
    renderWithMessages(<WithdrawnNotice locale={defaultLocale} trips={sixTrips} />);

    expect(screen.getByRole("link", { name: frMessages.home.latestAll })).toHaveAttribute(
      "href",
      `/${defaultLocale}/voyages`
    );
  });
});

describe("the latest trips", () => {
  it("shows three of them, and not the whole catalogue", () => {
    renderWithMessages(<WithdrawnNotice locale={defaultLocale} trips={sixTrips} />);

    /**
     * The number lives in `LatestTrips` (`LATEST_TRIP_COUNT`), not here — this page
     * reuses the home page's block rather than reimplementing it, so the two cannot
     * disagree about what "les derniers voyages" means. What is asserted is that
     * this page really goes through it: six entries in, three headings out.
     */
    expect(
      screen.getByRole("heading", { level: 2, name: frMessages.home.latestHeading })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });

  it("renders the honest waiting block when nothing is published", () => {
    // The production state today: `content/trips/` is empty. A "Derniers voyages"
    // heading above nothing, on the page of a withdrawn story, would be the one
    // thing worse than the withdrawal.
    renderWithMessages(<WithdrawnNotice locale={defaultLocale} trips={[]} />);

    expect(
      screen.getByRole("heading", { level: 2, name: frMessages.home.emptyHeading })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: frMessages.home.latestHeading })
    ).toBeNull();
  });
});
