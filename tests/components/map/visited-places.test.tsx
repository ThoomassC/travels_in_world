import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { WorldMap } from "@/components/map/world-map";
import { VisitedCountries } from "@/components/map/visited-countries";
import { untoldOnlyCountryCodes, tallyVisitedCountries } from "@/components/map/countries";
import type { PlaceMark } from "@/components/map/marks";
import type { CountingPlace, CountingTrip } from "@/components/map/countries";
import frMessages from "@/i18n/messages/fr.json";
import { defaultLocale } from "@/i18n/routing";
import { tripMark, WORLD } from "./fixtures";

/**
 * **The visited places on the map, and in the list beside it** — TIW-36.
 *
 * A place is somewhere the journal has been with no journey written for it, so
 * with no date, no step and no page. The three properties this file holds are the
 * three that a green build would not show:
 *
 * 1. **the caption does not call a place a voyage.** Fourteen places and no trip
 *    at all is this journal's own state, and `marks.length` alone would have read
 *    « 14 voyages » — the exact class of invented fact `content/README.md` and
 *    `docs/lieux-visites.md` refuse.
 * 2. **the marker is a link to something that exists.** It has no page — the
 *    content façade has no door that could produce an address for one — so it
 *    points at its own entry in the list under the map, and that entry has to
 *    really be there. `#pays-bo` is what this repository paid to learn that a
 *    dangling fragment is a silent 200.
 * 3. **the textual equivalent counts them.** The drawing tints a country as soon
 *    as anything reaches it, so a list built from the trips alone would say
 *    « Aucun pays sur la carte pour l'instant » under five tinted countries.
 *
 * Rendered under `NextIntlClientProvider` with the real message catalogue, so the
 * assertions are on the sentences a reader gets rather than on message keys.
 */

const placeMark = (overrides: Partial<PlaceMark> = {}): PlaceMark => ({
  kind: "place",
  slug: "rouen",
  placeName: "Rouen",
  countryName: "France",
  href: "#lieu-rouen",
  point: { x: 470, y: 120 },
  ...overrides,
});

/**
 * Two shapes, because `WorldMap` refuses to render an empty frame — « never an
 * empty frame » is TIW-15's criterion — and the tint lists are drawn from these.
 * The `path` is a stub: nothing here asserts on geometry.
 */
const country = (code: string, name: string) => ({ code, name, path: "M0,0L1,1Z" });

const COUNTRIES = [country("FR", "France"), country("ES", "Espagne")];

function renderMap(props: {
  readonly marks?: readonly ReturnType<typeof tripMark>[];
  readonly places?: readonly PlaceMark[];
  readonly visited?: readonly ReturnType<typeof country>[];
  readonly untold?: readonly ReturnType<typeof country>[];
}) {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
      <WorldMap
        countries={COUNTRIES}
        visited={props.visited ?? []}
        untold={props.untold ?? []}
        marks={props.marks ?? []}
        places={props.places ?? []}
        world={WORLD}
      />
    </NextIntlClientProvider>
  );
}

const captionOf = (container: HTMLElement): string =>
  container.querySelector("figcaption")?.textContent ?? "";

describe("the caption counts places apart from voyages", () => {
  /**
   * The state of this journal on the day TIW-36 landed: fourteen places, five
   * countries, not one récit. The sentence must not open on what is missing
   * either — « aucun voyage publié, 14 lieux visités » describes an absence where
   * the reader is looking at a drawing full of markers.
   */
  it("says fourteen places and no voyage at all, without naming the absence", () => {
    const places = Array.from({ length: 14 }, (_, index) =>
      placeMark({ slug: `lieu-${index}`, point: { x: 460 + index, y: 120 } })
    );

    const { container } = renderMap({ places, untold: COUNTRIES });

    expect(captionOf(container)).toContain("14 lieux visités");
    expect(captionOf(container)).toContain("2 pays");
    expect(captionOf(container)).not.toContain("voyage");
  });

  it("names both when the journal holds trips and places", () => {
    const { container } = renderMap({
      marks: [tripMark()],
      places: [placeMark()],
      visited: [country("FR", "France")],
    });

    expect(captionOf(container)).toContain("1 voyage");
    expect(captionOf(container)).toContain("1 lieu visité");
  });

  /**
   * The clause is dropped and never rendered as a zero: « 0 lieu visité » on a
   * journal of sixty récits is a number that says nothing, on the one line whose
   * whole job is to describe the picture.
   */
  it("says nothing about places when there are none", () => {
    const { container } = renderMap({ marks: [tripMark()], visited: [country("FR", "France")] });

    expect(captionOf(container)).not.toContain("lieu");
  });

  /**
   * The frame is now fitted around markers of which none need be a voyage, so the
   * cropped wording cannot keep saying « recadrée sur les voyages publiés ». A
   * single place is enough to crop the world.
   */
  it("does not say it is cropped on the published trips when it is cropped on places", () => {
    const { container } = renderMap({ places: [placeMark()], untold: COUNTRIES });

    expect(captionOf(container)).toContain("recadrée");
    expect(captionOf(container)).not.toContain("recadrée sur les voyages");
  });
});

describe("a place's marker", () => {
  it("is a real link, so it has a link role and works without JavaScript", () => {
    renderMap({ places: [placeMark()], untold: COUNTRIES });

    expect(screen.getByRole("link", { name: /Rouen/ })).toHaveAttribute("href", "#lieu-rouen");
  });

  /**
   * The country is in the accessible name because « Valence » and « Roses » each
   * name a town in two countries, and two of the fourteen places this journal
   * holds are exactly that pair. A marker announcing « Valence » alone tells a
   * screen-reader user nothing about which one they have landed on.
   */
  it("names its country, which is what tells two homonyms apart", () => {
    renderMap({
      places: [placeMark({ slug: "valence", placeName: "Valence", countryName: "Espagne" })],
      untold: COUNTRIES,
    });

    expect(screen.getByRole("link", { name: /Valence, Espagne/ })).toBeVisible();
  });

  it("says in words that there is no récit, not only in the shape of its dot", () => {
    renderMap({ places: [placeMark()], untold: COUNTRIES });

    expect(screen.getByRole("link", { name: /récit à venir/ })).toBeVisible();
  });

  /**
   * **No `data-trip`, which is the whole interface to the interaction layer.**
   * `map-viewport.tsx` finds markers through `closest("a[data-trip]")` and opens
   * the zone's panel instead of navigating; a place carrying that attribute would
   * have its activation swallowed for a panel with no card to show, and the
   * marker would answer nothing at all.
   */
  it("carries no data-trip, so its activation is never intercepted", () => {
    const { container } = renderMap({ places: [placeMark()], untold: COUNTRIES });
    const marker = container.querySelector('a[data-place="rouen"]');

    expect(marker).not.toBeNull();
    expect(marker).not.toHaveAttribute("data-trip");
    expect(marker).not.toHaveAttribute("data-zone");
  });

  /** `lieu-<slug>` and `voyage-<slug>`: two namespaces, so a shared slug is safe. */
  it("keeps its own id namespace, so a place and a trip may share a slug", () => {
    const { container } = renderMap({
      marks: [tripMark({ slug: "annecy" })],
      places: [placeMark({ slug: "annecy", point: { x: 200, y: 200 } })],
      visited: [country("FR", "France")],
    });

    expect(container.querySelector("#voyage-annecy")).not.toBeNull();
    expect(container.querySelector("#lieu-annecy")).not.toBeNull();
    expect(container.querySelectorAll("li[id]")).toHaveLength(2);
  });
});

/* ------------------------------------------------- the textual equivalent -- */

const TRIPS: readonly CountingTrip[] = [
  { slug: "japon-2024", countryCodes: ["JP"], story: "written" },
];

const PLACES: readonly CountingPlace[] = [
  { slug: "rouen", name: "Rouen", countryCode: "FR" },
  { slug: "annecy", name: "Annecy", countryCode: "FR" },
  { slug: "roses", name: "Roses", countryCode: "ES" },
];

const LABELS = {
  countryName: (code: string) => ({ FR: "France", ES: "Espagne", JP: "Japon" })[code] ?? code,
  compare: new Intl.Collator("fr").compare,
};

function renderCountries(places: readonly CountingPlace[], trips: readonly CountingTrip[] = []) {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
      <VisitedCountries
        trips={trips}
        places={places}
        labels={LABELS}
        tripHref={(slug) => `/fr/voyages/${slug}`}
        allTripsHref="/fr/voyages"
      />
    </NextIntlClientProvider>
  );
}

describe("tallyVisitedCountries with places", () => {
  /**
   * The one that decides whether the page is coherent: a journal of places only
   * still has countries. Built from the trips alone, this list is empty while the
   * drawing tints five countries and carries fourteen markers.
   */
  it("has a row for a country no trip reaches", () => {
    const tally = tallyVisitedCountries([], PLACES, LABELS);

    expect(tally.map((entry) => `${entry.name} ${entry.places.length}`)).toEqual([
      "Espagne 1",
      "France 2",
    ]);
  });

  it("keeps a country's trips and its places on the same row", () => {
    const tally = tallyVisitedCountries(
      TRIPS,
      [{ slug: "tokyo", name: "Tokyo", countryCode: "JP" }],
      LABELS
    );

    expect(tally).toHaveLength(1);
    expect(tally[0]?.tripSlugs).toEqual(["japon-2024"]);
    expect(tally[0]?.places.map((place) => place.slug)).toEqual(["tokyo"]);
  });
});

describe("untoldOnlyCountryCodes with places", () => {
  /** A place has no récit by definition, so its country is in the distinct tint. */
  it("tints a country reached only by places as having nothing written", () => {
    expect([...untoldOnlyCountryCodes([], PLACES)].sort()).toEqual(["ES", "FR"]);
  });

  /**
   * « Every, not any », the rule the tint already followed for trips: one written
   * récit in a country falsifies "nothing here is written yet", and a dateless
   * place beside it does not bring it back.
   */
  it("does not tint a country whose written récit sits beside a dateless place", () => {
    const codes = untoldOnlyCountryCodes(TRIPS, [
      { slug: "tokyo", name: "Tokyo", countryCode: "JP" },
    ]);

    expect([...codes]).toEqual([]);
  });
});

describe("VisitedCountries with places", () => {
  /**
   * The anchor the marker points at, and the reason this test is not about
   * styling: `#lieu-<slug>` is a fragment a marker renders on every build, and a
   * fragment that resolves to nothing is a 200 that deposits the reader at the top
   * of the page without a word.
   */
  it("gives every place the id its own marker points at", () => {
    const { container } = renderCountries(PLACES);

    for (const place of PLACES) {
      expect(container.querySelector(`#lieu-${place.slug}`)).not.toBeNull();
    }
  });

  it("names the places under their country, which is the join the audit asked for", () => {
    renderCountries(PLACES);

    expect(screen.getByText("France")).toBeVisible();
    expect(screen.getByText("Rouen")).toBeVisible();
    expect(screen.getByText("Annecy")).toBeVisible();
  });

  it("counts the places of a country that has no trip", () => {
    renderCountries(PLACES);

    expect(screen.getByText("2 lieux visités")).toBeVisible();
    expect(screen.getByText("1 lieu visité")).toBeVisible();
  });

  /**
   * **A place is not a link**, and that is structural rather than aesthetic: it
   * has no page, and `src/content/loader.ts` has no door that could produce an
   * address for one.
   */
  it("renders no link for a place, since a place has no page", () => {
    const { container } = renderCountries(PLACES);

    expect(container.querySelector("#lieu-rouen")?.querySelector("a")).toBeNull();
  });

  /**
   * A country reached only by places leads nowhere: pointing its row at the trip
   * listing would answer « Aucun voyage publié » to a row that has just said
   * « France, 2 lieux visités ».
   */
  it("does not link a country that has no trip to the trip listing", () => {
    renderCountries(PLACES);

    expect(screen.queryAllByRole("link", { name: /France/ })).toEqual([]);
  });

  it("still links a country whose single trip has a page", () => {
    renderCountries([], TRIPS);

    expect(screen.getByRole("link", { name: /Japon/ })).toHaveAttribute(
      "href",
      "/fr/voyages/japon-2024"
    );
  });

  /** « récit à venir » is the textual channel of the distinct tint — WCAG 1.4.1. */
  it("says récit à venir on a country that holds only places", () => {
    renderCountries(PLACES);

    expect(screen.getAllByText("récit à venir")).toHaveLength(2);
  });

  /**
   * The empty state stays reachable, and its sentence now names what actually
   * arrives first: a place, not a récit.
   */
  it("still renders its empty state when there is neither trip nor place", () => {
    renderCountries([]);

    expect(screen.getByText(/Aucun pays sur la carte/)).toBeVisible();
  });
});
