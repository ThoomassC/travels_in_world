import { describe, expect, it } from "vitest";
import {
  buildSearchEntries,
  matchesQuery,
  normaliseForSearch,
  type SearchGroup,
  type SearchLabels,
  type SearchableTrip,
} from "@/components/search/entries";

/**
 * The search index, and the reason it is a pure module rather than a few lines
 * inside the client component that consumes it.
 *
 * Matching text is where a search is won or lost, and every interesting case is a
 * *string* case: an accent the reader did not type, an apostrophe the content
 * spells with U+2019 and the keyboard produces as U+0027, a two-word query whose
 * words are far apart in the entry. None of those needs React, a browser or a
 * render — they need a hundred cheap assertions, which is the same argument
 * `src/components/map/frame.ts` and `src/components/trips/catalogue.ts` make.
 *
 * It also keeps the client boundary honest: `site-search.tsx` is the milestone's
 * **third** `'use client'` and the only justification for it is the interaction.
 * Everything that is not interaction lives here, on the server side of the line.
 */

/** Labels that do not localise: a country's name is its code. */
const CODE_LABELS: SearchLabels = {
  countryName: (code) => code,
  compare: (left, right) => left.localeCompare(right, "fr"),
};

const trip = (
  slug: string,
  title: string,
  places: readonly { name: string; countryCode: string }[],
  extra: Partial<SearchableTrip> = {}
): SearchableTrip => ({
  slug,
  title,
  startDate: "2024-01-01",
  story: "written",
  places,
  photos: [],
  tags: [],
  ...extra,
});

/**
 * Two trips, three places, two countries — the smallest fixture in which a place
 * and its country are different rows, a country holds two trips, and one trip
 * crosses a border.
 */
const TRIPS: readonly SearchableTrip[] = [
  trip("corse-2024", "Corse", [
    { name: "Corte", countryCode: "FR" },
    { name: "Bonifacio", countryCode: "FR" },
  ]),
  trip("roses-2024", "Roses", [{ name: "Roses", countryCode: "ES" }]),
];

const entries = (trips = TRIPS) =>
  buildSearchEntries({
    trips,
    labels: CODE_LABELS,
    tripHref: (slug) => `/fr/voyages/${slug}`,
    tripEntryHref: (slug) => `/fr/voyages#voyage-${slug}`,
    countriesHref: "/fr/voyages",
    placesHref: "/fr/villes",
    pages: [],
  });

describe("normaliseForSearch", () => {
  /**
   * **Accents are folded, not stripped from the display.** The reader types
   * "crete" and the carnet spells "Crète"; a search that answers nothing there
   * is a search nobody uses twice. NFD then dropping the combining marks is the
   * whole of it — no table of substitutions to keep in step with a language.
   */
  it("folds accents so an unaccented query still finds an accented name", () => {
    expect(normaliseForSearch("Crète")).toBe("crete");
    expect(normaliseForSearch("Genève")).toBe("geneve");
    expect(normaliseForSearch("Málaga")).toBe("malaga");
  });

  /**
   * **Punctuation becomes a space rather than nothing**, and the difference is
   * "Les Sables-d'Olonne". Deleting the hyphen welds "sablesdolonne", which no
   * reader types; turning it into a separator gives three words a query can hit
   * one at a time.
   *
   * The apostrophe case is the one that actually bites: the content is written
   * with U+2019 (the typographic apostrophe, which is correct in French) and
   * every keyboard on earth produces U+0027. Both become a space here, so the
   * two spellings meet.
   */
  it("turns punctuation into separators, typographic apostrophe included", () => {
    expect(normaliseForSearch("Les Sables-d’Olonne")).toBe("les sables d olonne");
    expect(normaliseForSearch("Les Sables-d'Olonne")).toBe("les sables d olonne");
  });

  it("collapses whitespace and trims", () => {
    expect(normaliseForSearch("  Gand   et  Bruges \n")).toBe("gand et bruges");
  });

  it("answers an empty string for input that is only punctuation", () => {
    // Guards the caller: a query of `"…"` must not become a token that matches
    // every entry because it normalised to nothing but was still truthy.
    expect(normaliseForSearch("!?-'")).toBe("");
  });
});

describe("matchesQuery", () => {
  const HAYSTACK = normaliseForSearch("Les Sables-d’Olonne Vendée France");

  it("matches a plain substring, whatever the case", () => {
    expect(matchesQuery(HAYSTACK, "olonne")).toBe(true);
    expect(matchesQuery(HAYSTACK, "OLONNE")).toBe(true);
  });

  it("matches an unaccented query against an accented entry", () => {
    expect(matchesQuery(HAYSTACK, "vendee")).toBe(true);
  });

  /**
   * **Every word must match, and they need not be adjacent.** "sables france"
   * is how a reader narrows: two facts they remember, in the order they think
   * of them, which is not the order the entry is written in. A single-substring
   * search answers nothing there and looks broken.
   */
  it("requires every word of the query, in any order and any position", () => {
    expect(matchesQuery(HAYSTACK, "sables france")).toBe(true);
    expect(matchesQuery(HAYSTACK, "france sables")).toBe(true);
    expect(matchesQuery(HAYSTACK, "sables japon")).toBe(false);
  });

  /**
   * An empty query matches everything, and that is the resting state of the
   * panel rather than a special case: with nothing typed, the list is the
   * complete index — which is also exactly what a reader without JavaScript
   * sees, because nothing has hidden anything.
   */
  it("matches everything when the query is empty or only punctuation", () => {
    expect(matchesQuery(HAYSTACK, "")).toBe(true);
    expect(matchesQuery(HAYSTACK, "   ")).toBe(true);
    expect(matchesQuery(HAYSTACK, "!!")).toBe(true);
  });
});

describe("buildSearchEntries", () => {
  it("gives a trip, each of its places and each of its countries a row", () => {
    const built = entries();

    expect(built.filter((entry) => entry.group === "trips").map((entry) => entry.label)).toEqual([
      "Corse",
      "Roses",
    ]);
    expect(built.filter((entry) => entry.group === "places").map((entry) => entry.label)).toEqual([
      "Bonifacio",
      "Corte",
      "Roses",
    ]);
    expect(built.filter((entry) => entry.group === "countries").map((entry) => entry.label)).toEqual(
      ["ES", "FR"]
    );
  });

  /**
   * **A place and a trip may share a name, and both rows must survive it.**
   * "Roses" is the trip and the town; collapsing them would lose a destination,
   * and the two rows go to different addresses. The `detail` line is what tells
   * a reader which is which, so it is asserted here rather than left to the
   * component.
   */
  it("keeps a trip and a place of the same name apart", () => {
    const named = entries().filter((entry) => entry.label === "Roses");

    expect(named).toHaveLength(2);
    expect(new Set(named.map((entry) => entry.group))).toEqual(new Set(["trips", "places"]));
    expect(new Set(named.map((entry) => entry.href)).size).toBe(2);
  });

  /**
   * **Where a trip's row leads depends on whether its récit is written**, and it
   * is the same rule the map's markers follow (TIW-18): `tripStaticParams` never
   * built a page for an untold trip, so pointing at one would put a 404 in the
   * suggestions of every document on the site.
   */
  it("sends an untold trip to its entry in the listing, never to a page that does not exist", () => {
    const built = entries([
      trip("crete-2025", "Crète", [{ name: "Héraklion", countryCode: "GR" }], {
        story: "unwritten",
      }),
    ]);
    const [row] = built.filter((entry) => entry.group === "trips");

    expect(row?.href).toBe("/fr/voyages#voyage-crete-2025");
  });

  it("sends a told trip to its own page", () => {
    const [row] = entries().filter((entry) => entry.group === "trips");

    expect(row?.href).toBe("/fr/voyages/corse-2024");
  });

  /**
   * The identity of a place is the pair name + country, never the slug — the
   * same rule `tallyVisitedPlaces` records and for the same measured reason: a
   * slug is unique only inside its own `trip.yaml`, so two files may write
   * `valence` and `valencia` for two different towns.
   */
  it("counts one row per name-and-country pair, not per mention", () => {
    const built = entries([
      trip("a", "A", [
        { name: "Valence", countryCode: "FR" },
        { name: "Valence", countryCode: "ES" },
      ]),
      trip("b", "B", [{ name: "Valence", countryCode: "FR" }]),
    ]);

    expect(built.filter((entry) => entry.label === "Valence")).toHaveLength(2);
  });

  /**
   * **The haystack carries more than the label**, which is the point of building
   * it here rather than matching on the visible text: a trip is findable by a
   * country it crosses, by a place it stays in, by a tag, and by the alt text of
   * a photograph — none of which the row displays.
   */
  it("makes a trip findable by its places, its countries, its tags and its photo captions", () => {
    const built = entries([
      trip("japon-2024", "Japon, printemps 2024", [{ name: "Tokyo", countryCode: "JP" }], {
        tags: ["train", "randonnee"],
        photos: [{ alt: "Une ruelle de Shinjuku sous la pluie" }],
      }),
    ]);
    const [row] = built.filter((entry) => entry.group === "trips");
    const haystack = row?.haystack ?? "";

    expect(matchesQuery(haystack, "tokyo")).toBe(true);
    expect(matchesQuery(haystack, "JP")).toBe(true);
    expect(matchesQuery(haystack, "train")).toBe(true);
    expect(matchesQuery(haystack, "shinjuku")).toBe(true);
    expect(matchesQuery(haystack, "pluie")).toBe(true);
    expect(matchesQuery(haystack, "islande")).toBe(false);
  });

  /**
   * **There is no récit body to index, and that is a property of the model
   * rather than of today's content.** `TripDetail` carries a title, places,
   * steps, photos and tags; nothing in `src/domain/schema.ts` holds prose. So
   * "search the text of the récits" resolves to the photo captions and the tags
   * — the only free text a récit owns — and this case is what says so out loud,
   * so that the day a body field is added, someone finds this and widens the
   * haystack instead of wondering why the search misses it.
   */
  it("indexes the only free text a récit owns: captions and tags", () => {
    const built = entries([
      trip("t", "Titre", [{ name: "Lieu", countryCode: "FR" }], {
        photos: [{ alt: "Le chemin des philosophes au petit matin" }, { alt: "" }],
        tags: ["velo"],
      }),
    ]);

    expect(built[0]?.haystack).toContain("philosophes");
    expect(built[0]?.haystack).toContain("velo");
  });

  /**
   * **A place whose name is more than one word**, which is half of them here:
   * Les Sables-d'Olonne, Gand et Bruges, Noirmoutier-en-l'Île. The first version
   * of this function keyed places on `` `${name} ${countryCode}` `` and split
   * that back on a space — so "Les Sables-d'Olonne FR" became the place "Les" in
   * the country "Sables-d'Olonne". Every fixture in this file was one word, so
   * every test passed.
   */
  it("keeps a multi-word place name whole, name and country both", () => {
    const built = entries([
      trip("v", "Vendée", [
        { name: "Les Sables-d'Olonne", countryCode: "FR" },
        { name: "Noirmoutier-en-l'Île", countryCode: "FR" },
      ]),
    ]);
    const places = built.filter((entry) => entry.group === "places");

    expect(places.map((entry) => entry.label)).toEqual([
      "Les Sables-d'Olonne",
      "Noirmoutier-en-l'Île",
    ]);
    expect(places.every((entry) => entry.detail === "FR")).toBe(true);
    // And the row is findable by the half of the name a reader actually types.
    expect(matchesQuery(places[0]?.haystack ?? "", "olonne")).toBe(true);
  });

  /** Ids are what `aria-activedescendant` points at, so they must be unique. */
  it("gives every row a unique id", () => {
    const built = entries();
    const ids = built.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
    // And a shape a fragment can carry: no spaces, no accents, no punctuation.
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("puts the site's own pages last, in the order they were given", () => {
    const built = buildSearchEntries({
      trips: TRIPS,
      labels: CODE_LABELS,
      tripHref: (slug) => `/fr/voyages/${slug}`,
      tripEntryHref: (slug) => `/fr/voyages#voyage-${slug}`,
      countriesHref: "/fr/voyages",
      placesHref: "/fr/villes",
      pages: [
        { label: "Carte", href: "/fr" },
        { label: "À propos", href: "/fr/a-propos" },
      ],
    });

    expect(built.slice(-2).map((entry) => entry.label)).toEqual(["Carte", "À propos"]);
    expect(built.slice(-2).every((entry) => entry.group === "pages")).toBe(true);
  });

  it("renders nothing at all for an empty journal, pages aside", () => {
    expect(entries([])).toEqual([]);
  });

  /**
   * The groups come out in one order and the component does not sort: a reader
   * scanning the panel reads Voyages, then Lieux, then Pays, then Pages, and a
   * second sort somewhere else is a second answer to the same question.
   */
  it("orders the groups the way the panel reads them", () => {
    const groups = entries().map((entry) => entry.group);
    const firstOf = (group: SearchGroup) => groups.indexOf(group);

    expect(firstOf("trips")).toBeLessThan(firstOf("places"));
    expect(firstOf("places")).toBeLessThan(firstOf("countries"));
  });
});
