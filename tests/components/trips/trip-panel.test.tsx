import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { PANEL_PHOTO_LIMIT, panelPhotos } from "@/components/photos/collection";
import { TripPanel } from "@/components/trips/trip-panel";
import { photo, photos } from "../photos/fixtures";
import { tripEntry } from "./fixtures";
import { defaultLocale, frMessages, renderWithMessages } from "./support";

/**
 * The body of a marker's panel: one trip's own facts, its cities, a strip of
 * photographs and a way out of the panel.
 *
 * Queried by role and by accessible name, like the rest of this suite — the
 * panel is the one place on the home page where a reader who clicked a marker
 * has nothing but this component between them and the trip.
 */

const panel = (props: Partial<Parameters<typeof TripPanel>[0]> = {}) =>
  renderWithMessages(
    <TripPanel
      trip={tripEntry()}
      locale={defaultLocale}
      cityNames={["Tokyo", "Kyoto", "Osaka"]}
      photos={[]}
      {...props}
    />
  );

/** The photo strip, found by the name the criterion gives it. */
const photoList = (title = "Japon, printemps 2024") =>
  screen.queryByRole("list", { name: `Photos de ${title}` });

describe("TripPanel", () => {
  /**
   * The panel's own `<h2>` holds the trip's title and is rendered by the map
   * layer; a `<h3>` follows this body. A heading emitted here would land between
   * the two and either duplicate the title or skip a level — a real defect for a
   * reader walking the document by heading, and invisible to everyone else.
   */
  it("emits no heading of its own", () => {
    panel();

    expect(screen.queryAllByRole("heading")).toHaveLength(0);
  });

  it("states the countries, the dates and the duration", () => {
    panel({
      trip: tripEntry({
        countryCodes: ["JP", "TH"],
        startDate: "2024-04-12",
        endDate: "2024-04-26",
        duration: { nights: 14, days: 15 },
      }),
    });

    /**
     * The same three facts the card states, formatted by the same helpers.
     * "Japon et Thaïlande" and not "Japon, Thaïlande" is the assertion that
     * catches a second, nearby spelling of one fact being introduced here.
     */
    const facts = screen.getAllByRole("listitem");

    expect(facts).toHaveLength(3);
    expect(facts[0]).toHaveTextContent("Japon et Thaïlande");
    expect(facts[1]?.textContent?.replace(/[   ]/g, " ")).toBe("12–26 avril 2024");
    expect(facts[2]).toHaveTextContent("15 jours");
  });

  /** The last separator of an enumeration is a property of the language. */
  it("enumerates the cities with the locale's own conjunction", () => {
    panel();

    expect(screen.getByText("Villes : Tokyo, Kyoto et Osaka")).toBeInTheDocument();
    expect(screen.queryByText("Villes : Tokyo, Kyoto, Osaka")).toBeNull();
  });

  /** A « Villes : » with nothing after it is a colon, not a fact. */
  it("omits the cities line when the trip has none", () => {
    panel({ cityNames: [] });

    expect(screen.queryByText(/^Villes/)).toBeNull();
  });

  /**
   * No « pas encore de photos » stand-in: an empty strip promises a delivery
   * nobody committed to, and the ordinary state of this repository's thirteen
   * trips is exactly this one.
   */
  it("renders no photo strip and no substitute sentence when there is no photo", () => {
    panel({ photos: [] });

    expect(photoList()).toBeNull();
    expect(screen.queryByRole("link", { name: /voir en grand/i })).toBeNull();
  });

  it("gives each photo a link to the file itself, under a named list", () => {
    panel({ photos: [photo({ src: "/a.jpg" }), photo({ src: "/b.jpg" })] });

    const strip = photoList();

    expect(strip).not.toBeNull();

    const links = within(strip as HTMLElement).getAllByRole("link");

    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/a.jpg");
    expect(links[1]).toHaveAttribute("href", "/b.jpg");
  });

  /**
   * WCAG 2.4.4: the photo's `alt` describes the picture, the appended text says
   * what activating the link does. Both are text nodes, never an `aria-label`.
   */
  it("names each photo link by the picture and by what it opens", () => {
    panel({ photos: [photo({ src: "/a.jpg", alt: "Une ruelle de Shinjuku" })] });

    expect(
      screen.getByRole("link", {
        name: `Une ruelle de Shinjuku ${frMessages.photos.openFullSize}`,
      })
    ).toBeInTheDocument();
  });

  /** End to end with `panelPhotos`, the only place the ceiling is decided. */
  it("shows no more than PANEL_PHOTO_LIMIT photographs", () => {
    panel({ photos: panelPhotos({ photos: photos(9) }) });

    const strip = photoList();

    expect(within(strip as HTMLElement).getAllByRole("link")).toHaveLength(PANEL_PHOTO_LIMIT);
  });

  it("links a written trip to its page, with the locale prefix", () => {
    panel();

    expect(screen.getByRole("link", { name: frMessages.trips.cardRead })).toHaveAttribute(
      "href",
      "/fr/voyages/japon-2024"
    );
  });

  /**
   * **The defect this fixes.** A trip whose récit is not written has no page, so
   * the card renders no link at all — and its panel was therefore a dead end:
   * the reader clicked a marker, read four facts and had nowhere to go. The
   * thirteen trips of this repository are all in that state.
   */
  it("offers an untold trip a way into the listing instead of a dead end", () => {
    panel({ trip: tripEntry({ story: "unwritten" }) });

    expect(screen.getByText(frMessages.trips.cardStoryToCome)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: frMessages.trips.cardRead })).toBeNull();
    expect(screen.getByRole("link", { name: frMessages.trips.panelSeeInListing })).toHaveAttribute(
      "href",
      "/fr/voyages#voyage-japon-2024"
    );
  });

  /** A told trip is offered its own page and never the listing as well: two ways
   * out of a four-line panel is a choice a reader has no basis to make. */
  it("does not offer the listing link to a trip that has a page", () => {
    panel();

    expect(screen.queryByText(frMessages.trips.cardStoryToCome)).toBeNull();
    expect(screen.queryByRole("link", { name: frMessages.trips.panelSeeInListing })).toBeNull();
  });
});
