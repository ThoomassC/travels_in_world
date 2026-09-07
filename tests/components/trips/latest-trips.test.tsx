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

/**
 * What `content/trips` actually holds today. The block used to show three and now
 * shows one, so the interesting count is no longer "more than the block renders"
 * in the abstract but the real catalogue's — thirteen.
 */
const THIRTEEN = SIXTY_TRIPS.slice(0, 13);

/**
 * The newest trip of a list, re-derived here instead of read off index 0.
 *
 * The block gets its answer from `latestTrips`, which is a `slice` and therefore
 * trusts the content façade's ordering (`startDate` descending, `slug` tiebreak).
 * A test that asserted on `THIRTEEN[0]` would be asserting the same `slice`
 * twice; comparing dates is the only spelling in which "le plus récent" is
 * checked rather than restated.
 */
const newestOf = (trips: readonly (typeof THIRTEEN)[number][]) =>
  [...trips].sort((left, right) => (left.startDate < right.startDate ? 1 : -1))[0];

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

    it("renders no ribbon: there is no card for one to sit on", () => {
      // The ribbon says "this card is the journal's most recent trip". With no
      // trip there is no such claim to make, and a stray "Nouveau !" floating
      // above the waiting message would announce something that is not there.
      latest([]);

      expect(screen.queryByText(frMessages.home.latestRibbon)).toBeNull();
    });
  });

  describe("with one published trip", () => {
    it("renders the block with a single card", () => {
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

  describe("with thirteen published trips — the real catalogue's size", () => {
    it("shows one card, and only one", () => {
      // Was "three and not four" until the owner asked for the single most
      // recent (7 September 2026). The case survives as "one and not two":
      // what it defends is that the block truncates at all.
      latest(THIRTEEN);

      expect(screen.getAllByRole("article")).toHaveLength(LATEST_TRIP_COUNT);
      expect(screen.getAllByRole("article")).toHaveLength(1);
    });

    it("shows the most recent trip, and not the oldest", () => {
      latest(THIRTEEN);

      const newest = newestOf(THIRTEEN);
      const oldest = [...THIRTEEN].sort((left, right) =>
        left.startDate < right.startDate ? -1 : 1
      )[0];

      if (newest === undefined || oldest === undefined) {
        throw new Error("the fixture must hold thirteen trips");
      }
      // Guards the fixture itself: if the two ever collapsed onto one trip the
      // assertions below would pass while proving nothing.
      expect(newest.title).not.toBe(oldest.title);

      expect(screen.getByRole("heading", { level: 3, name: newest.title })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: oldest.title })).toBeNull();
    });

    it("gives the card a heading one level below the section's", () => {
      // A skipped level is a real defect for a screen-reader user walking the
      // page by heading, and invisible to everyone else.
      latest(THIRTEEN);

      expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(LATEST_TRIP_COUNT);
    });
  });

  it("offers the way to the full listing after the cards, never before them", () => {
    /**
     * Reading order, not paint order. Beside the heading — the common
     * arrangement — the escape hatch comes *before* the trip for a keyboard or
     * screen-reader user, who then walks past the way out to reach the content
     * the section exists for.
     */
    latest([tripIn("FR", 0), tripIn("JP", 1)]);

    const links = screen.getAllByRole("link");
    const last = links.at(-1);

    expect(last).toHaveAccessibleName(frMessages.home.latestAll);
    expect(last).toHaveAttribute("href", "/fr/voyages");
  });
});

/**
 * The ribbon over the card — "un petit bandeau dessus avec écrit Nouveau !",
 * asked for by the owner on 7 September 2026.
 *
 * It is a different claim from the card's own `Nouveau récit` badge, which
 * follows the newest *publication*; this one says "the most recent journey of
 * this list". The two can sit on the same card, so both are pinned here.
 */
describe("LatestTrips — the ribbon over the newest trip", () => {
  it("renders the ribbon as real text, findable by its content", () => {
    /**
     * Not `aria-label`, not a `::before { content: }`, not a visually hidden twin
     * of a coloured strip. `getByText` is the assertion that makes that
     * structural: a pseudo-element carries no text node, so this case fails the
     * moment the ribbon becomes decoration. Same doctrine as the card's badge and
     * the map marker's label.
     */
    latest(THIRTEEN);

    expect(screen.getByText(frMessages.home.latestRibbon)).toBeInTheDocument();
  });

  it("puts the ribbon before the card's title in the DOM", () => {
    // Reading order, again: a reader meets "Nouveau !" and then the trip it
    // qualifies. A ribbon announced after the card would be labelling the thing
    // behind it.
    latest(THIRTEEN);

    const newest = newestOf(THIRTEEN);
    if (newest === undefined) throw new Error("the fixture must hold thirteen trips");

    const ribbon = screen.getByText(frMessages.home.latestRibbon);
    const title = screen.getByRole("heading", { level: 3, name: newest.title });

    expect(ribbon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts the ribbon above the card and not inside it, in the card's own list item", () => {
    /**
     * "Un petit bandeau dessus" — over the card, not a second chip within it. The
     * `<article>` belongs to `TripCard`, which this block must not reach into;
     * the `<li>` is the association a screen reader gets instead, and it is what
     * keeps "Nouveau !" and the trip one item rather than two.
     */
    latest(THIRTEEN);

    const ribbon = screen.getByText(frMessages.home.latestRibbon);

    expect(ribbon.closest("article")).toBeNull();

    const item = ribbon.closest("li");
    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).getByRole("article")).toBeInTheDocument();
  });

  it("renders exactly one ribbon", () => {
    latest(THIRTEEN);

    expect(screen.getAllByText(frMessages.home.latestRibbon)).toHaveLength(1);
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
  /** What this block renders, so what these cases use. */
  const SHOWN = SIXTY_TRIPS.slice(0, LATEST_TRIP_COUNT);

  const withFresh = (freshSlug?: string) =>
    renderWithMessages(<LatestTrips trips={SHOWN} locale={defaultLocale} freshSlug={freshSlug} />);

  it("badges the card when the trip shown is the one named", () => {
    const target = SHOWN[0];
    if (target === undefined) throw new Error("the fixture must hold the shown trip");

    withFresh(target.slug);

    const badges = screen.getAllByText(frMessages.trips.cardNew);

    expect(badges).toHaveLength(1);

    // The badge sits inside the card of the named trip and nowhere else — a
    // count of one is satisfied by a badge on the wrong card.
    const card = badges[0]?.closest("article");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByRole("link")).toHaveAccessibleName(target.title);
  });

  it("carries the badge and the ribbon at once — they are two different claims", () => {
    /**
     * The trap this block has to keep clear. `Nouveau récit` follows the newest
     * *publication* and is gated on `hasStory`; `Nouveau !` says this is the
     * newest *journey* of the list. Nothing makes them exclusive, and a
     * refactor that folded one into the other would pass every case above.
     */
    const target = SHOWN[0];
    if (target === undefined) throw new Error("the fixture must hold the shown trip");

    withFresh(target.slug);

    expect(screen.getByText(frMessages.trips.cardNew)).toBeInTheDocument();
    expect(screen.getByText(frMessages.home.latestRibbon)).toBeInTheDocument();
  });

  it("badges nothing when no publication is inside the window", () => {
    // `undefined` is the ordinary answer for a journal whose newest récit is
    // older than sixty days, not an error state.
    withFresh(undefined);

    expect(screen.queryByText(frMessages.trips.cardNew)).toBeNull();
    // …and the ribbon is unaffected: it does not depend on publication at all.
    expect(screen.getByText(frMessages.home.latestRibbon)).toBeInTheDocument();
  });

  it("badges nothing when the fresh trip is not the one shown", () => {
    /**
     * A real state, and the ticket's own trap: this block lists the newest
     * *journey* while the badge follows the newest *publication*, so a 2019
     * story written this morning is announced by the banner above and appears
     * far down the full listing. No badge here is the correct outcome, not a
     * miss — and it is now the common case, since the block shows one card.
     */
    withFresh("un-slug-qui-n-est-pas-dans-la-liste");

    expect(screen.queryByText(frMessages.trips.cardNew)).toBeNull();
    /**
     * And the block is otherwise unchanged: the card plus the "voir tous les
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
