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
