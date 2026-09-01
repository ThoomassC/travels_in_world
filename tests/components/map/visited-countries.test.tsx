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

const trip = (slug: string, ...countryCodes: string[]): CountingTrip => ({ slug, countryCodes });

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
