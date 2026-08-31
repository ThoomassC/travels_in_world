import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/i18n/messages/fr.json";
import { defaultLocale } from "@/i18n/routing";
import { VisitedCountries, type VisitedCountriesProps } from "@/components/map/visited-countries";
import type { NamedCountry } from "@/components/map/countries";

/**
 * The map's textual equivalent, queried the way a reader meets it: by role and by
 * accessible name. Everything asserted here is what the server emitted — there is
 * no JavaScript in this component to change any of it afterwards, which is also
 * why the acceptance criterion "readable with JavaScript unavailable" needs no
 * fallback and no test of its own beyond the end-to-end one.
 */

const country = (code: string | null, name: string): NamedCountry => ({ code, name });

/** As `buildWorldGeometry` hands it over: the tinted subset, collated by name. */
const VISITED: readonly NamedCountry[] = [
  country("BO", "Bolivie"),
  country("IS", "Islande"),
  country("JP", "Japon"),
  country("PE", "Pérou"),
];

/** Japan twice, and one trip crossing Peru and Bolivia. */
const TRIPS: readonly (readonly string[])[] = [["JP"], ["JP"], ["PE", "BO"], ["IS"]];

const countryHref = (code: string): string => `/fr/voyages#pays-${code.toLowerCase()}`;

function renderCountries(props: Partial<VisitedCountriesProps> = {}) {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
      <VisitedCountries
        visited={VISITED}
        tripCountryCodes={TRIPS}
        countryHref={countryHref}
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
    it("names every visited country and how many trips reach it", () => {
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

    it("carries the count inside the link, not beside it", () => {
      /**
       * A screen reader announces a link and not its neighbours, so a count left
       * outside the anchor is a number the keyboard never hears — and the
       * acceptance criterion asks for the countries *with their number of trips*
       * to be navigable by keyboard.
       */
      renderCountries();

      const japan = screen.getByRole("link", { name: "Japon 2 voyages" });

      // The explicit space between the two spans is asserted here, not assumed:
      // without it the accessible name comes out "Japon2 voyages" under jsdom,
      // and "Pays 102 voyages" at two digits — measured.
      expect(japan.textContent).toBe("Japon 2 voyages");
    });

    it("makes each country a link into the group of trips it holds", () => {
      // Linking rather than duplicating: `/fr/voyages` already lists which trips
      // are in which country, grouped continent → country → trip. The fragment
      // is what keeps that a promise the document can keep.
      renderCountries();

      expect(screen.getByRole("link", { name: "Japon 2 voyages" })).toHaveAttribute(
        "href",
        "/fr/voyages#pays-jp"
      );
      expect(screen.getByRole("link", { name: "Pérou 1 voyage" })).toHaveAttribute(
        "href",
        "/fr/voyages#pays-pe"
      );
    });

    it("puts every country in the tab order and nothing else", () => {
      // "Entirely navigable by keyboard": one tab stop per visited country. The
      // 174 others are inside an `aria-hidden` SVG with no interactive element,
      // which is asserted on the drawing's side.
      renderCountries();

      expect(screen.getAllByRole("link")).toHaveLength(VISITED.length);
      expect(screen.getAllByRole("listitem")).toHaveLength(VISITED.length);
    });

    it("reads in the order it was given, which is the caption's order", () => {
      renderCountries();

      expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
        "Bolivie 1 voyage",
        "Islande 1 voyage",
        "Japon 2 voyages",
        "Pérou 1 voyage",
      ]);
    });

    it("offers no fourth link to the whole listing", () => {
      /**
       * Every row is already a link into `/fr/voyages`, and the page carries two
       * more — the main navigation and the latest-trips block. A "voir tous les
       * voyages" between the rows and the reader's next heading would be noise.
       * The empty state is the one place it earns its keep.
       */
      renderCountries();

      expect(screen.queryByRole("link", { name: frMessages.map.allTrips })).not.toBeInTheDocument();
    });

    it("holds its heading at the level of the page's other chapters", () => {
      // `h2`, like "Derniers voyages" below it: a sibling chapter of the home
      // page and not a footnote to the map.
      renderCountries();

      expect(
        screen.getByRole("heading", { level: 2, name: frMessages.map.countriesHeading })
      ).toBeInTheDocument();
    });

    it("declares its list role explicitly", () => {
      // `list-style: none` strips the role in Safari with VoiceOver, and a list
      // that lost its role also lost its item count. jsdom keeps the role either
      // way, so this asserts the attribute rather than the behaviour.
      renderCountries();

      expect(screen.getByRole("list")).toHaveAttribute("role", "list");
    });
  });

  describe("with no country to list", () => {
    /**
     * Today's production state — `content/trips` is empty until TIW-24 — and also
     * what a reader gets when the drawing failed on an empty journal. The
     * acceptance criterion is explicit: never an empty frame, and the fallback
     * carries a way to the complete listing.
     */
    it("says so in words rather than announcing a list of nothing", () => {
      renderCountries({ visited: [], tripCountryCodes: [] });

      expect(screen.getByText(frMessages.map.countriesEmpty)).toBeVisible();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    });

    it("offers the way out the empty state needs", () => {
      renderCountries({ visited: [], tripCountryCodes: [] });

      const out = screen.getByRole("link", { name: frMessages.map.allTrips });

      expect(out).toHaveAttribute("href", "/fr/voyages");
    });

    it("keeps its heading, so the block is never a bare paragraph", () => {
      renderCountries({ visited: [], tripCountryCodes: [] });

      expect(
        screen.getByRole("heading", { level: 2, name: frMessages.map.countriesHeading })
      ).toBeInTheDocument();
    });
  });

  describe("at sixty trips over twenty-three countries", () => {
    const codes = Array.from({ length: 23 }, (_, index) => `C${index}`);
    const visited = codes.map((code, index) => country(code, `Pays ${index}`));
    const trips = Array.from({ length: 60 }, (_, index) => [codes[index % 23] ?? "ZZ"]);

    it("renders one row per country and keeps every href distinct", () => {
      renderCountries({ visited, tripCountryCodes: trips });

      const links = screen.getAllByRole("link");
      const hrefs = links.map((link) => link.getAttribute("href"));

      expect(links).toHaveLength(23);
      expect(new Set(hrefs).size).toBe(23);
    });

    it("distributes the sixty trips over the rows without losing one", () => {
      renderCountries({ visited, tripCountryCodes: trips });

      const counted = screen
        .getAllByRole("listitem")
        .map((item) => Number(/(\d+) voyages?$/.exec(item.textContent ?? "")?.[1] ?? 0))
        .reduce((total, count) => total + count, 0);

      expect(counted).toBe(60);
    });
  });

  describe("the degenerate inputs", () => {
    it("skips the geometries the dataset leaves unidentified", () => {
      renderCountries({
        visited: [country("JP", "Japon"), country(null, "Territoire non identifié")],
        tripCountryCodes: [["JP"]],
      });

      expect(screen.getAllByRole("link")).toHaveLength(1);
      expect(screen.queryByText(/Territoire non identifié/)).not.toBeInTheDocument();
    });

    it("still renders a row for a country no trip reaches, rather than hiding it", () => {
      // Unreachable through the sanctioned path, but a silently missing row would
      // put this list at odds with the "N pays" the caption announces — and that
      // disagreement is the one a reader can catch.
      renderCountries({
        visited: [country("JP", "Japon"), country("FR", "France")],
        tripCountryCodes: [["JP"]],
      });

      expect(screen.getByRole("link", { name: "France aucun voyage" })).toBeInTheDocument();
    });
  });
});
