import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
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

      expect(screen.queryByRole("heading", { name: frMessages.home.latestHeading })).toBeNull();
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

/**
 * The badge inside the listing — "le voyage le plus récent le porte, et seulement
 * lui", observed on a rendered block rather than on the derivation.
 *
 * `freshSlug` is what the page resolves once and hands to all three placements,
 * so what these cases pin is the *distribution*: exactly one card, and the right
 * one. Which slug that is remains `freshestTrip`'s decision, covered boundary by
 * boundary in `tests/domain/freshness.test.ts`.
 */
describe("LatestTrips — the new-story badge", () => {
  /** Three trips is what this block renders, so three is what these cases use. */
  const THREE = SIXTY_TRIPS.slice(0, LATEST_TRIP_COUNT);

  const withFresh = (freshSlug?: string) =>
    renderWithMessages(<LatestTrips trips={THREE} locale={defaultLocale} freshSlug={freshSlug} />);

  it("badges exactly one card, and it is the one named", () => {
    const target = THREE[1];
    if (target === undefined) throw new Error("the fixture must hold three trips");

    withFresh(target.slug);

    const badges = screen.getAllByText(frMessages.trips.cardNew);

    expect(badges).toHaveLength(1);

    // The badge sits inside the card of the named trip and nowhere else — a
    // count of one is satisfied by a badge on the wrong card.
    const card = badges[0]?.closest("article");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByRole("link")).toHaveAccessibleName(target.title);
  });

  it("badges nothing when no publication is inside the window", () => {
    // `undefined` is the ordinary answer for a journal whose newest récit is
    // older than sixty days, not an error state.
    withFresh(undefined);

    expect(screen.queryByText(frMessages.trips.cardNew)).toBeNull();
  });

  it("badges nothing when the fresh trip is not among the three shown", () => {
    /**
     * A real state, and the ticket's own trap: this block lists the newest
     * *journeys* while the badge follows the newest *publication*, so a 2019
     * story written this morning is announced by the banner above and appears
     * far down the listing. No badge here is the correct outcome, not a miss.
     */
    withFresh("un-slug-qui-n-est-pas-dans-la-liste");

    expect(screen.queryByText(frMessages.trips.cardNew)).toBeNull();
    /**
     * And the block is otherwise unchanged: three cards plus the "voir tous les
     * voyages" link. Counted on links rather than on list items, because each
     * card carries its own facts list and `getAllByRole("listitem")` would count
     * those too.
     */
    expect(screen.getAllByRole("link")).toHaveLength(LATEST_TRIP_COUNT + 1);
  });

  it("badges nothing on an empty journal, where there is no block at all", () => {
    renderWithMessages(<LatestTrips trips={[]} locale={defaultLocale} freshSlug="japon-2024" />);

    expect(screen.queryByText(frMessages.trips.cardNew)).toBeNull();
  });
});
