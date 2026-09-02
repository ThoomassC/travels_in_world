import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/i18n/messages/fr.json";
import { defaultLocale } from "@/i18n/routing";
import { VisitedCountries, type VisitedCountriesProps } from "@/components/map/visited-countries";
import type { CountingTrip, CountryLabels } from "@/components/map/countries";

/**
 * The map's textual equivalent, queried the way a reader meets it: by role and by
 * accessible name. Everything asserted here is what the server emitted — there is
 * no JavaScript in this component to change any of it afterwards, which is also
 * why the acceptance criterion "readable with JavaScript unavailable" needs no
 * fallback and no test of its own beyond the end-to-end one.
 */

const trip = (slug: string, ...countryCodes: string[]): CountingTrip => ({
  slug,
  countryCodes,
  story: "written",
});

/** The same, for a trip whose récit is not written (TIW-18). */
const untoldTrip = (slug: string, ...countryCodes: string[]): CountingTrip => ({
  slug,
  countryCodes,
  story: "unwritten",
});

/** Japan twice, and one trip crossing Peru and Bolivia. */
const TRIPS: readonly CountingTrip[] = [
  trip("japon-2025", "JP"),
  trip("japon-2024", "JP"),
  trip("perou-bolivie-2023", "PE", "BO"),
  trip("islande-2022", "IS"),
];

const NAMES: Record<string, string> = {
  BO: "Bolivie",
  IS: "Islande",
  JP: "Japon",
  PE: "Pérou",
};

const LABELS: CountryLabels = {
  countryName: (code) => NAMES[code] ?? code,
  compare: new Intl.Collator("fr").compare,
};

function renderCountries(props: Partial<VisitedCountriesProps> = {}) {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
      <VisitedCountries
        trips={TRIPS}
        labels={LABELS}
        tripHref={(slug) => `/fr/voyages/${slug}`}
        allTripsHref="/fr/voyages"
        {...props}
      />
    </NextIntlClientProvider>
  );
}

/** The count as the catalogue words it, so the assertion is not its own oracle. */
const tripsLabel = (count: number): string =>
  count === 0 ? "aucun voyage" : count === 1 ? "1 voyage" : `${count} voyages`;

describe("VisitedCountries", () => {
  describe("with published trips", () => {
    it("names every country reached and how many trips reach it", () => {
      // The fact the map had in no channel at all: five countries in the caption
      // and four city names on the markers, with nothing joining the two.
      renderCountries();

      for (const [name, count] of [
        ["Bolivie", 1],
        ["Islande", 1],
        ["Japon", 2],
        ["Pérou", 1],
      ] as const) {
        expect(
          screen.getByRole("link", { name: `${name} ${tripsLabel(count)}` })
        ).toBeInTheDocument();
      }
    });

    it("counts a country a trip merely crosses", () => {
      // `perou-bolivie-2023` arrives in Peru and crosses Bolivia. The marker
      // names Cusco only; without this row Bolivia is named nowhere.
      renderCountries();

      expect(screen.getByRole("link", { name: "Bolivie 1 voyage" })).toBeInTheDocument();
    });

    it("carries the count inside the link, not beside it", () => {
      /**
       * A screen reader announces a link and not its neighbours, so a count left
       * outside the anchor is a number the keyboard never hears — and the
       * acceptance criterion asks for the countries *with their number of trips*
       * to be navigable by keyboard.
       *
       * The explicit space is asserted here, not assumed: without it the
       * accessible name comes out "Japon2 voyages" under jsdom, and "Pays 102
       * voyages" at two digits — measured.
       */
      renderCountries();

      expect(screen.getByRole("link", { name: "Japon 2 voyages" }).textContent).toBe(
        "Japon 2 voyages"
      );
    });

    describe("where a country's link goes", () => {
      /**
       * The defect this replaced, and the reason these four cases exist.
       *
       * The first version linked every country to `/fr/voyages#pays-<code>`, a
       * section `TripCatalogue` renders. Measured on a production build of the
       * end-to-end fixture: `#pays-bo` was emitted and matched nothing, because
       * the catalogue files a trip under its *first arrival* country only, so a
       * country merely crossed has no section at all. A fragment matching no id
       * does not fail — it leaves the reader at the top of a long listing.
       */
      it("goes straight to the trip when a country holds exactly one", () => {
        renderCountries();

        expect(screen.getByRole("link", { name: "Islande 1 voyage" })).toHaveAttribute(
          "href",
          "/fr/voyages/islande-2022"
        );
        // The crossed country too: its one trip is the honest target, and it is
        // the page that actually names Bolivia.
        expect(screen.getByRole("link", { name: "Bolivie 1 voyage" })).toHaveAttribute(
          "href",
          "/fr/voyages/perou-bolivie-2023"
        );
      });

      it("goes to the whole listing when a country holds several", () => {
        renderCountries();

        expect(screen.getByRole("link", { name: "Japon 2 voyages" })).toHaveAttribute(
          "href",
          "/fr/voyages"
        );
      });

      it("emits no fragment at all, so nothing can dangle", () => {
        // The property, rather than the four cases: every target is a route.
        renderCountries();

        for (const link of screen.getAllByRole("link")) {
          expect(link.getAttribute("href")).not.toContain("#");
        }
      });
    });

    it("puts every country in the tab order and nothing else", () => {
      // "Entirely navigable by keyboard": one tab stop per country reached. The
      // 174 others are inside an `aria-hidden` SVG with no interactive element,
      // which is asserted on the drawing's side.
      renderCountries();

      expect(screen.getAllByRole("link")).toHaveLength(4);
      expect(screen.getAllByRole("listitem")).toHaveLength(4);
    });

    it("reads in the reader's alphabet, not in order of count", () => {
      renderCountries();

      expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
        "Bolivie 1 voyage",
        "Islande 1 voyage",
        "Japon 2 voyages",
        "Pérou 1 voyage",
      ]);
    });

    it("offers no further link to the whole listing", () => {
      /**
       * Every row is already a link into the journal, and the page carries two
       * more — the main navigation and the latest-trips block. A "voir tous les
       * voyages" between the rows and the reader's next heading would be noise.
       * The empty state is the one place it earns its keep.
       */
      renderCountries();

      expect(screen.queryByRole("link", { name: frMessages.map.allTrips })).not.toBeInTheDocument();
    });

    it("is a landmark named by its own heading, like its h2 sibling on the page", () => {
      /**
       * `LatestTrips` is a labelled `<section>`, so it is a region. When this
       * block was a bare `<div>`, "Derniers voyages" appeared in a screen
       * reader's landmark rotor and "Les pays visités" did not — two `h2`
       * chapters of one page reachable two different ways.
       */
      renderCountries();

      const region = screen.getByRole("region", { name: frMessages.map.countriesHeading });
      const heading = screen.getByRole("heading", {
        level: 2,
        name: frMessages.map.countriesHeading,
      });

      // Named *by* the heading, so the label exists once in the catalogue.
      expect(region).toHaveAttribute("aria-labelledby", heading.id);
      expect(region).toContainElement(heading);
    });

    it("declares its list role explicitly", () => {
      // `list-style: none` strips the role in Safari with VoiceOver, and a list
      // that lost its role also lost its item count. jsdom keeps the role either
      // way, so this asserts the attribute rather than the behaviour.
      renderCountries();

      expect(screen.getByRole("list")).toHaveAttribute("role", "list");
    });
  });

  describe("with no trip published", () => {
    /**
     * Today's production state — `content/trips` is empty until TIW-24 — and also
     * what a reader gets when the drawing failed on an empty journal. The
     * acceptance criterion is explicit: never an empty frame, and the fallback
     * carries a way to the complete listing.
     */
    it("says so in words rather than announcing a list of nothing", () => {
      renderCountries({ trips: [] });

      expect(screen.getByText(frMessages.map.countriesEmpty)).toBeVisible();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    });

    it("offers the way out the empty state needs", () => {
      renderCountries({ trips: [] });

      expect(screen.getByRole("link", { name: frMessages.map.allTrips })).toHaveAttribute(
        "href",
        "/fr/voyages"
      );
    });

    it("keeps its heading and its landmark, so the block is never a bare paragraph", () => {
      renderCountries({ trips: [] });

      expect(
        screen.getByRole("heading", { level: 2, name: frMessages.map.countriesHeading })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: frMessages.map.countriesHeading })
      ).toBeInTheDocument();
    });
  });

  describe("at sixty trips over twenty-three countries", () => {
    const codes = Array.from({ length: 23 }, (_, index) => `C${String(index).padStart(2, "0")}`);
    const trips = Array.from({ length: 60 }, (_, index) =>
      trip(`voyage-${index}`, codes[index % 23] ?? "ZZ")
    );
    const labels: CountryLabels = {
      countryName: (code) => `Pays ${code}`,
      compare: new Intl.Collator("fr").compare,
    };

    it("renders one row per country", () => {
      renderCountries({ trips, labels });

      expect(screen.getAllByRole("link")).toHaveLength(23);
    });

    it("sends every one of them to the listing, none holding a single trip", () => {
      // Each country holds two or three trips here, so no row qualifies for the
      // direct-to-trip target. Asserted so the rule's other branch is covered at
      // scale as well as in the four-trip case.
      renderCountries({ trips, labels });

      const hrefs = new Set(screen.getAllByRole("link").map((link) => link.getAttribute("href")));

      expect(hrefs).toEqual(new Set(["/fr/voyages"]));
    });

    it("distributes the sixty trips over the rows without losing one", () => {
      renderCountries({ trips, labels });

      const counted = screen
        .getAllByRole("listitem")
        .map((item) => Number(/(\d+) voyages?$/.exec(item.textContent ?? "")?.[1] ?? 0))
        .reduce((total, count) => total + count, 0);

      expect(counted).toBe(60);
    });
  });
});

/**
 * **A country whose récits are not written** (TIW-18), in the map's textual
 * equivalent.
 *
 * This block is where the acceptance criterion's two halves actually meet, and
 * where the bug lived before this ticket. The row of a country holding exactly
 * one trip links **straight to that trip's page**, which is more precise than any
 * listing section — a decision this component records making, after measuring
 * that its first `#pays-xx` fragment dangled. The moment a trip can exist without
 * a page, that same precision becomes a 404: one untold trip in one country, and
 * the map's equivalent points at an address the build never wrote.
 *
 * It is also the channel that makes the distinct country tint legible at all. The
 * `<svg>` is `aria-hidden` (ADR 0003) and a dashed stroke says nothing to a
 * screen reader, so « récit à venir » on the row is what carries the third state
 * in words — WCAG 1.4.1 satisfied by text rather than by a second colour.
 */
describe("VisitedCountries — a country whose récit is not written", () => {
  const MIXED: readonly CountingTrip[] = [
    ...TRIPS,
    untoldTrip("maroc-2026", "MA"),
    untoldTrip("chili-2026", "CL"),
    trip("chili-2020", "CL"),
  ];

  const NAMED: CountryLabels = {
    countryName: (code) => ({ ...NAMES, CL: "Chili", MA: "Maroc" })[code] ?? code,
    compare: new Intl.Collator("fr").compare,
  };

  it("never links a country whose only trip has no page", () => {
    renderCountries({ trips: MIXED, labels: NAMED });

    const row = screen.getByRole("link", { name: /^Maroc/ });

    /**
     * The listing, not `/fr/voyages/maroc-2026`. It is chosen because it
     * certainly exists *and* because it holds the answer: an untold trip is
     * rendered there, with its dates, its countries and « Récit à venir ».
     */
    expect(row).toHaveAttribute("href", "/fr/voyages");
  });

  it("says « récit à venir » on that row, in words", () => {
    renderCountries({ trips: MIXED, labels: NAMED });

    const row = screen.getByRole("link", { name: /^Maroc/ });

    // Inside the link's own accessible name, like the trip count beside it: a
    // screen reader announces the link and not its neighbours.
    expect(row).toHaveAccessibleName(`Maroc ${tripsLabel(1)} ${frMessages.map.countryStoryToCome}`);
  });

  it("still links a country holding one written récit straight to its page", () => {
    renderCountries({ trips: MIXED, labels: NAMED });

    // The behaviour this ticket must not regress: Iceland has exactly one trip
    // and it is written, so the precise link stays precise.
    expect(screen.getByRole("link", { name: /^Islande/ })).toHaveAttribute(
      "href",
      "/fr/voyages/islande-2022"
    );
  });

  /**
   * The mixed country, and the case that separates "any" from "every". Chile
   * holds one written récit and one untold journey: there *is* something to read,
   * so the row must not say « récit à venir » — and with two trips it goes to the
   * listing, which is the pre-existing rule and not a new one.
   */
  it("says nothing about the state of a country that holds one written récit", () => {
    renderCountries({ trips: MIXED, labels: NAMED });

    const row = screen.getByRole("link", { name: /^Chili/ });

    expect(row).toHaveAccessibleName(`Chili ${tripsLabel(2)}`);
    expect(row).toHaveAttribute("href", "/fr/voyages");
  });

  /**
   * A country with one written and one untold trip could link to the written one
   * — and deliberately does not. The row announces "2 voyages", so sending the
   * reader to one of them names a destination the label does not, which is the
   * 2.4.4 defect this component's `#pays-xx` note already paid for once.
   */
  it("does not single out the one readable trip of a two-trip country", () => {
    renderCountries({ trips: MIXED, labels: NAMED });

    expect(screen.getByRole("link", { name: /^Chili/ })).not.toHaveAttribute(
      "href",
      "/fr/voyages/chili-2020"
    );
  });

  it("counts an untold trip in its country's total", () => {
    renderCountries({ trips: MIXED, labels: NAMED });

    /**
     * "Where has he been" includes a country he went to and has not written up —
     * the whole point of the state. This is also what keeps the row agreeing with
     * the `<figcaption>` beside it, which counts `visited + untold`.
     */
    expect(screen.getByRole("link", { name: /^Maroc/ })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("leaves a journal whose every récit is written exactly as it was", () => {
    renderCountries();

    // No wording added, no link changed: the branch must not leak into the
    // ordinary case, which is every journal until an author uses the field.
    expect(screen.getByRole("link", { name: /^Islande/ })).toHaveAccessibleName(
      `Islande ${tripsLabel(1)}`
    );
    expect(screen.queryByText(frMessages.map.countryStoryToCome)).toBeNull();
  });
});
