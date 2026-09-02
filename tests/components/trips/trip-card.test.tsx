import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { TripCard } from "@/components/trips/trip-card";
import { tripEntry } from "./fixtures";
import { defaultLocale, frMessages, renderWithMessages } from "./support";

/**
 * One entry of a listing, queried the way a reader meets it: by role and by
 * accessible name. No `data-testid`, no snapshot — this repository has neither,
 * and a snapshot of a card records its markup rather than its behaviour.
 */

const card = (props: Partial<Parameters<typeof TripCard>[0]> = {}) =>
  renderWithMessages(
    <TripCard trip={tripEntry()} locale={defaultLocale} headingLevel={3} {...props} />
  );

describe("TripCard", () => {
  it("names the trip in a heading at the level it was given", () => {
    card({ headingLevel: 4 });

    expect(
      screen.getByRole("heading", { level: 4, name: "Japon, printemps 2024" })
    ).toBeInTheDocument();
  });

  it("carries exactly one link, and it is named by the trip's title", () => {
    /**
     * The decision this pins. A visible "Lire le récit" button *and* a linked
     * title would be two links per card to the same page: sixty entries would be
     * a hundred and twenty tab stops, and a screen reader's link list would carry
     * sixty entries all named "Lire le récit" — the defect
     * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` refuses for the map's
     * markers. So the title is the link, `.link::after` makes the whole card its
     * target, and the read affordance is `aria-hidden` decoration.
     */
    card();

    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Japon, printemps 2024");
  });

  it("does not announce the read affordance a second time", () => {
    card();

    // Visible to the eye, absent from the accessibility tree: the link above
    // already says what activating the card does.
    expect(screen.getByText(frMessages.trips.cardRead)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: frMessages.trips.cardRead })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("points at the trip's page, with the locale prefix", () => {
    card();

    // Assembled from `tripPath` + `localePathname`, never written by hand: the
    // map already links to these URLs, and two spellings drifting apart is a dead
    // link with nothing failing to say so.
    expect(screen.getByRole("link")).toHaveAttribute("href", "/fr/voyages/japon-2024");
  });

  it("states the countries, the dates and the duration as three separate facts", () => {
    card({
      trip: tripEntry({
        countryCodes: ["JP", "TH"],
        startDate: "2024-04-12",
        endDate: "2024-04-26",
        duration: { nights: 14, days: 15 },
      }),
    });

    const facts = screen.getAllByRole("listitem");

    expect(facts).toHaveLength(3);
    // Localised, ordered for a French reader — not the code order the domain
    // hands over — and joined by `Intl.ListFormat`, so the card spells a pair of
    // countries the way the map's caption and the trip page spell it. The
    // hard-coded `", "` this replaces printed "Japon, Thaïlande" while every
    // other view of the same fact printed "et".
    expect(facts[0]).toHaveTextContent("Japon et Thaïlande");
    expect(facts[1]?.textContent?.replace(/[   ]/g, " ")).toBe("12–26 avril 2024");
    expect(facts[2]).toHaveTextContent("15 jours");
  });

  it("says one day, not one days, for a trip that lasted a day", () => {
    card({
      trip: tripEntry({
        startDate: "2024-06-01",
        endDate: "2024-06-01",
        duration: { nights: 0, days: 1 },
      }),
    });

    expect(screen.getByText("1 jour")).toBeInTheDocument();
  });

  it("gives the cover an empty alt, because the title is right beside it", () => {
    const { container } = card();
    const image = container.querySelector("img");

    /**
     * `alt=""` is the correct value here and not a missing one: the cover repeats
     * the trip whose title is the very next thing in the card, so describing it
     * would announce the same trip twice. `TripSummary` carries no alt text for
     * the cover either — the photo's own alt lives on `photos[]`, which only the
     * trip page receives — so inventing one was never on offer.
     */
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("src", "/photos/japon-2024/tokyo.jpg");
    expect(image).toHaveAttribute("loading", "lazy");
    // No image is exposed to the accessibility tree, so nothing to find by role.
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("keeps the thumbnail's space when the trip has no photo", () => {
    const { container } = card({ trip: tripEntry({ coverPhotoSrc: undefined }) });

    // A card that simply omitted the box would be shorter than its neighbours in
    // a mixed listing, for a reason no reader could guess.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("omits the countries line rather than rendering an empty fact", () => {
    // Unreachable through the façade — `TripSchema` demands at least one place —
    // but the card must not answer an empty array with a blank bullet.
    card({ trip: tripEntry({ countryCodes: [] }) });

    const facts = screen.getAllByRole("listitem");

    expect(facts).toHaveLength(2);
  });

  it("shows the country's name, never its code", () => {
    card({ trip: tripEntry({ countryCodes: ["PE"] }) });

    const facts = screen.getAllByRole("listitem");

    expect(within(facts[0] as HTMLElement).getByText("Pérou")).toBeInTheDocument();
  });
});

/**
 * **The fallback thumbnail** (TIW-18), and what it replaced.
 *
 * A trip with no photograph used to get a `<div>` filled with a token gradient:
 * `aria-hidden`, carrying nothing, and — measured in the served HTML of the
 * populated fixture — three of them on `/fr/voyages` out of four cards. That is
 * the "emplacement gris" the acceptance criterion refuses by name.
 *
 * The criterion offers two shapes, a mini-map of the route or a typographic tile
 * carrying the title and the country. The mini-map is out on the document budget
 * and the reason is arithmetic rather than taste: a drawing needs country shapes,
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` refuses to prune them
 * because that makes the geometry depend on the content, and the world's paths
 * measure 30.1 KB brotli *once* in a document — against a 100 KB budget, with
 * sixty cards on a listing. A route polyline with no coastline under it is not a
 * map, it is a squiggle.
 *
 * So: the tile. What it carries is the **country and the year**, not the title,
 * and that is a deliberate reading of the criterion rather than an omission — the
 * card's heading is the very next element, and a tile repeating it reads as a
 * rendering fault. It stays `aria-hidden` for the reason `.cta` does: every word
 * in it is already in the card's own facts, so announcing it would say the same
 * things twice.
 */
describe("TripCard — the fallback thumbnail", () => {
  const noCover = (overrides: Partial<ReturnType<typeof tripEntry>> = {}) =>
    card({ trip: tripEntry({ coverPhotoSrc: undefined, ...overrides }) });

  it("shows no image and no broken source when the trip has no photo", () => {
    const { container } = noCover();

    /**
     * The criterion's "aucune icône d'image cassée" is a property of the markup,
     * not of the styling: an `<img>` with an empty or absent `src` is exactly what
     * paints the browser's broken-image glyph, so the assertion is that there is no
     * `<img>` element at all.
     */
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("picture")).toBeNull();
  });

  /**
   * The year is queried as an **exact** text node, which is what makes these
   * cases precise: the card's facts render "12–22 avril 2024", so a bare `2024`
   * can only be the tile's own line. Same trick for the country — with a tile
   * there are two nodes reading "Japon", with a cover there is one.
   */
  it("fills the thumbnail with the country and the year, as real text", () => {
    noCover();

    // Real text nodes and not a `content:` pseudo-element or a background image:
    // strip every rule from the stylesheet and the tile still says what it says.
    expect(screen.getByText("2024")).toBeInTheDocument();
    expect(screen.getAllByText("Japon")).toHaveLength(2);
  });

  it("keeps the tile out of the accessibility tree, since the card already says both", () => {
    noCover();

    /**
     * The country is in the card's facts and the year is inside its date range, so
     * an announced tile would repeat two things a screen reader has just been
     * given. Asserted as counts: three facts and one heading, exactly what a card
     * with a real cover exposes.
     */
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText("2024").closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("names every country of a trip that crossed several", () => {
    noCover({ countryCodes: ["BO", "PE"] });

    // Through the same `countryListOf` the facts use, so the tile cannot say
    // "Bolivie, Pérou" while the line below says "Bolivie et Pérou".
    expect(screen.getAllByText("Bolivie et Pérou")).toHaveLength(2);
  });

  it("still renders a tile for a trip whose countries are unknown", () => {
    /**
     * Unreachable through the façade — `TripSchema` demands at least one place —
     * but the tile must degrade to the year rather than to an empty box or to the
     * word "undefined". Same posture as the countries line right beside it.
     */
    const { container } = noCover({ countryCodes: [] });

    expect(screen.getByText("2024")).toBeInTheDocument();
    expect(container.textContent).not.toContain("undefined");
  });

  it("leaves a card that has a cover showing the photograph and nothing else", () => {
    const { container } = card();

    // The tile is the *absence* branch, and adding it must not lay a caption over
    // every real cover in the listing.
    expect(container.querySelector("img")).toHaveAttribute("src", "/photos/japon-2024/tokyo.jpg");
    expect(screen.queryByText("2024")).toBeNull();
    expect(screen.getAllByText("Japon")).toHaveLength(1);
  });
});

/**
 * The "nouveau récit" chip — the third of TIW-19's three placements.
 *
 * What is asserted here is deliberately not *which* trip is new: that is
 * `freshestTrip`'s decision and `tests/domain/freshness.test.ts` covers every
 * boundary of it. A card is handed a boolean, and these cases pin the two things
 * only a rendering can answer — that the badge is real text a screen reader
 * meets, and that it is absent by default.
 */
describe("TripCard — the new-story badge", () => {
  it("says nothing at all when the card is not the newest récit", () => {
    card();

    expect(screen.queryByText(frMessages.trips.cardNew)).toBeNull();
  });

  it("is absent by default, so a caller that forgets the prop cannot announce news", () => {
    // `isNew` is optional, and the safe default is the silent one: a listing
    // written before this ticket keeps rendering exactly as it did.
    card({ isNew: undefined });

    expect(screen.queryByText(frMessages.trips.cardNew)).toBeNull();
  });

  it("announces the newest récit in words, not by a colour or an animation", () => {
    card({ isNew: true });

    /**
     * `getByText` and not a class-name query, and that is the point of the case:
     * the badge has to be a text node in the accessibility tree. A `::before`
     * with a `content:` string, an `aria-label` on a coloured dot or a CSS-only
     * chip would all pass a visual review and fail here — which is the criterion
     * "le badge reste identifiable sans l'animation (libellé textuel)".
     */
    expect(screen.getByText(frMessages.trips.cardNew)).toBeInTheDocument();
  });

  it("does not turn the badge into a second link or a control", () => {
    card({ isNew: true });

    // One link per card stays the rule: the badge is a statement, not an
    // affordance, and a second tab stop per card is what `.cta` already refuses.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("leaves the card's own facts untouched", () => {
    card({ isNew: true });

    // The badge is added, nothing is displaced: the heading is still the title
    // and the three facts are still three.
    expect(
      screen.getByRole("heading", { level: 3, name: "Japon, printemps 2024" })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

/**
 * **A trip whose récit is not written** (TIW-18), as a card sees it.
 *
 * This is the acceptance criterion's hardest half — "aucun lien vers une page
 * inexistante n'est rendu" — and a card is where it is easiest to get wrong,
 * because the title has been a link since TIW-20 and nothing about an untold trip
 * looks different upstream. `tripStaticParams` has stopped building the page;
 * these cases are what stop the card pointing at it anyway.
 *
 * What replaces the link is **real text**, announced, and that is the one place
 * this card differs from every other decoration it carries. `.cta` and the
 * fallback tile are `aria-hidden` because the link beside them already says what
 * they say. Here there *is* no link, so « Récit à venir » is the only thing that
 * tells a reader why — hiding it would leave a screen reader with a title, three
 * facts and no explanation of why this entry goes nowhere.
 */
describe("TripCard — a trip whose récit is not written", () => {
  const untold = (overrides: Partial<ReturnType<typeof tripEntry>> = {}) =>
    card({ trip: tripEntry({ story: "unwritten", ...overrides }) });

  it("renders no link at all, because the page does not exist", () => {
    untold();

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders no anchor element either, not even one without an href", () => {
    const { container } = untold();

    /**
     * Asserted on the element and not only on the role. An `<a>` with no `href`
     * has no link role — so a `queryAllByRole("link")` of zero would be satisfied
     * by a placeholder anchor, which is the shape this would take if somebody
     * "kept the markup and dropped the href". It would still be a dead affordance
     * under the card-wide `::after` overlay.
     */
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("still names the trip in a heading, at the level it was given", () => {
    untold({ title: "Maroc, printemps 2026" });

    // Losing the link must not lose the heading: a listing walked by heading is
    // how a screen-reader reader scans sixty entries.
    expect(
      screen.getByRole("heading", { level: 3, name: "Maroc, printemps 2026" })
    ).toBeInTheDocument();
  });

  it("says « Récit à venir » in words a screen reader meets", () => {
    untold();

    const notice = screen.getByText(frMessages.trips.cardStoryToCome);

    expect(notice).toBeInTheDocument();
    // Not hidden, unlike `.cta` and the tile: with no link on the card, this is
    // the only thing that says why the entry leads nowhere.
    expect(notice.closest("[aria-hidden='true']")).toBeNull();
  });

  it("drops the read affordance rather than showing both", () => {
    untold();

    // "Lire le récit" beside "Récit à venir" would be the card contradicting
    // itself in two adjacent lines.
    expect(screen.queryByText(frMessages.trips.cardRead)).toBeNull();
  });

  it("keeps its dates, its countries and its duration", () => {
    untold();

    /**
     * The whole point of the state: the trip is *in* the journal. An untold entry
     * that showed only a title would be the empty frame the ticket refuses — it
     * carries exactly what a told entry carries, minus the story.
     */
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Japon")).toBeInTheDocument();
    expect(screen.getByText("11 jours")).toBeInTheDocument();
  });

  it("shows its cover when it has one, and the fallback tile when it does not", () => {
    const { container } = untold();
    expect(container.querySelector("img")).toHaveAttribute("src", "/photos/japon-2024/tokyo.jpg");

    const { container: bare } = card({
      trip: tripEntry({ story: "unwritten", coverPhotoSrc: undefined }),
    });
    expect(bare.querySelector("img")).toBeNull();
  });

  /**
   * A told trip is untouched by all of the above — the assertion that keeps this
   * a *branch* and not a rewrite of the card.
   */
  it("leaves a told trip with its link and its read affordance", () => {
    card();

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText(frMessages.trips.cardRead)).toBeInTheDocument();
    expect(screen.queryByText(frMessages.trips.cardStoryToCome)).toBeNull();
  });

  /**
   * The badge and this state cannot co-occur through the real pipeline —
   * `freshestTrip` never returns an untold trip — but `TripCard` takes a boolean
   * from a caller, so the two props are independent here. The card must not
   * announce a *new récit* it also says is unwritten.
   */
  it("never announces a new récit on a trip that has none", () => {
    card({ trip: tripEntry({ story: "unwritten" }), isNew: true });

    expect(screen.queryByText(frMessages.trips.cardNew)).toBeNull();
    expect(screen.getByText(frMessages.trips.cardStoryToCome)).toBeInTheDocument();
  });
});
