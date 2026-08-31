import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { LATEST_TRIP_COUNT, LatestTrips } from "@/components/trips/latest-trips";
import { SIXTY_TRIPS, tripEntry, tripIn } from "./fixtures";
import { defaultLocale, frMessages, renderWithMessages } from "./support";

/**
 * The home page's second block, in the three states the acceptance criteria
 * name. The grouping arithmetic is already covered as a pure function in
 * `catalogue.test.ts`; what is asserted here is what a reader actually meets —
 * which heading, how many cards, and whether an empty block was rendered.
 */

const latest = (trips = SIXTY_TRIPS) =>
  renderWithMessages(<LatestTrips trips={trips} locale={defaultLocale} />);

describe("LatestTrips", () => {
  describe("with no published trip", () => {
    it("says so, and renders no empty block at all", () => {
      /**
       * The production state today: `content/trips` is empty. The criterion is
       * "an honest waiting message, no empty block" — so what must NOT be on the
       * page is a "Derniers voyages" heading with nothing under it, which reads
       * as a broken site rather than a new one.
       */
      latest([]);

      expect(
        screen.getByRole("heading", { level: 2, name: frMessages.home.emptyHeading })
      ).toBeInTheDocument();
      expect(screen.getByText(frMessages.home.emptyBody)).toBeInTheDocument();

      expect(
        screen.queryByRole("heading", { name: frMessages.home.latestHeading })
      ).toBeNull();
      expect(screen.queryByRole("list")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  describe("with one published trip", () => {
    it("renders the block with a single card, not a three-slot grid with two gaps", () => {
      latest([tripEntry()]);

      expect(
        screen.getByRole("heading", { level: 2, name: frMessages.home.latestHeading })
      ).toBeInTheDocument();
      // Counted by `<article>`, not by list item: each card carries its own
      // `<ul>` of facts, so "the list" is ambiguous in this DOM.
      expect(screen.getAllByRole("article")).toHaveLength(1);
      expect(
        screen.getByRole("heading", { level: 3, name: "Japon, printemps 2024" })
      ).toBeInTheDocument();
    });
  });

  describe("with sixty published trips", () => {
    it("shows the three most recent, and only those", () => {
      latest();

      expect(screen.getAllByRole("article")).toHaveLength(LATEST_TRIP_COUNT);
      // The façade's order is `startDate` descending, which the fixture already
      // carries — nothing here re-sorts it.
      expect(screen.getByRole("heading", { level: 3, name: "Voyage FR 0" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 3, name: "Voyage JP 1" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 3, name: "Voyage PE 2" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Voyage MA 3" })).toBeNull();
    });

    it("gives every card a heading one level below the section's", () => {
      // A skipped level is a real defect for a screen-reader user walking the
      // page by heading, and invisible to everyone else.
      latest();

      expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(LATEST_TRIP_COUNT);
    });
  });

  it("offers the way to the full listing after the cards, never before them", () => {
    /**
     * Reading order, not paint order. Beside the heading — the common
     * arrangement — the escape hatch comes *before* the three trips for a
     * keyboard or screen-reader user, who then walks past the way out to reach
     * the content the section exists for.
     */
    latest([tripIn("FR", 0), tripIn("JP", 1)]);

    const links = screen.getAllByRole("link");
    const last = links.at(-1);

    expect(last).toHaveAccessibleName(frMessages.home.latestAll);
    expect(last).toHaveAttribute("href", "/fr/voyages");
  });
});
