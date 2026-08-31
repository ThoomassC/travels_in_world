import { describe, expect, it } from "vitest";
import { VisitedCountries } from "@/components/map/visited-countries";
import type { NamedCountry } from "@/components/map/countries";
import { TripCatalogue } from "@/components/trips/trip-catalogue";
import { tripIn } from "../trips/fixtures";
import { renderWithMessages, defaultLocale } from "../trips/support";
import { tripsCountryPath } from "@/i18n/paths";

/**
 * The one contract of this ticket that spans two components, and the one that
 * fails **in silence**.
 *
 * The map's textual equivalent links a country to the group of trips that country
 * holds, and that group is a `<section>` of `/fr/voyages` rendered by
 * `TripCatalogue`. Neither side imports the other; both call `countryAnchor`. If
 * one of them stops, nothing errors: a fragment that matches no `id` is not a
 * failure to a browser, it simply leaves the reader at the top of a page of sixty
 * trips — the exact defect `docs/adr/0003-carte-svg-inerte-et-balises-html.md`
 * records for `#voyage-<slug>` before the marker `id`s existed.
 *
 * So this spec renders **both** sides from one set of countries and checks that
 * every href the map emits resolves to an `id` the listing emits. It is the only
 * test in the repository that compares the two.
 */

const TRIPS = [tripIn("JP", 0), tripIn("JP", 1), tripIn("PE", 2), tripIn("IS", 3)];

const VISITED: readonly NamedCountry[] = [
  { code: "IS", name: "Islande" },
  { code: "JP", name: "Japon" },
  { code: "PE", name: "Pérou" },
];

/** The fragment of an href, without the `#`. */
const fragmentOf = (href: string): string => href.slice(href.indexOf("#") + 1);

describe("the country fragment, on both sides", () => {
  it("lands every country link of the map on a section of the listing", () => {
    const listing = renderWithMessages(<TripCatalogue trips={TRIPS} locale={defaultLocale} />);
    const targets = new Set(
      [...listing.container.querySelectorAll("section[id]")].map((section) => section.id)
    );

    const map = renderWithMessages(
      <VisitedCountries
        visited={VISITED}
        tripCountryCodes={TRIPS.map((trip) => trip.countryCodes)}
        countryHref={tripsCountryPath}
        allTripsHref="/voyages"
      />
    );
    const fragments = [...map.container.querySelectorAll("a[href]")].map((link) =>
      fragmentOf(link.getAttribute("href") ?? "")
    );

    // Guards against a green run on an empty query: three countries, three links.
    expect(fragments).toHaveLength(VISITED.length);
    for (const fragment of fragments) {
      expect(targets).toContain(fragment);
    }
  });

  it("gives the listing's country sections an id at all", () => {
    // The half that is not this ticket's own file, so it is the half most likely
    // to be lost in a merge or a refactor of the listing.
    const { container } = renderWithMessages(
      <TripCatalogue trips={TRIPS} locale={defaultLocale} />
    );

    const ids = [...container.querySelectorAll("section[id]")].map((section) => section.id).sort();

    expect(ids).toEqual(["pays-is", "pays-jp", "pays-pe"]);
  });

  it("makes those sections a focus target, not just a scroll target", () => {
    /**
     * `tabIndex={-1}`, for the reason `<main>` carries it: without it Safari moves
     * the scroll position and not the focus, so the Tab after following the
     * fragment resumes from the top of the document — and the reader who asked
     * for Japan is back at the page heading.
     */
    const { container } = renderWithMessages(
      <TripCatalogue trips={TRIPS} locale={defaultLocale} />
    );

    for (const section of container.querySelectorAll("section[id^='pays-']")) {
      expect(section).toHaveAttribute("tabindex", "-1");
    }
  });

  it("keeps the fragment out of the continent sections, which are not link targets", () => {
    // `TripCatalogue` nests country sections inside continent sections. Only the
    // countries are addressed, so a continent must not accidentally carry an id
    // that shadows one.
    const { container } = renderWithMessages(
      <TripCatalogue trips={TRIPS} locale={defaultLocale} />
    );

    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);

    expect(ids.filter((id) => !id.startsWith("pays-"))).toEqual([]);
  });
});
