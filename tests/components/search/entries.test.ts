import { describe, expect, it } from "vitest";
import {
  buildSearchEntries,
  matchesQuery,
  normaliseForSearch,
  type SearchGroup,
  type SearchIndexInput,
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

/**
 * Labels that do not localise: a country's name is its code, and the plural is
 * spelt out rather than resolved. That is the point of the callbacks — the module
 * under test knows no language, so the fixture can be arithmetic.
 */
const CODE_LABELS: SearchLabels = {
  countryName: (code) => code,
  compare: (left, right) => left.localeCompare(right, "fr"),
  stepCount: (count) => `${count} étapes`,
  unwritten: "récit à venir",
};

/** Greenwich on the equator — the middle of the vignette, so an offset shows. */
const NOWHERE = { lat: 0, lon: 0 };

/**
 * A stand-in for `@/map`'s `countryTile(...).place`, and a deliberately dumb one:
 * this module's job is to *pair* a place with its country's projection, never to
 * project. A real Mercator here would test d3 — `tests/map/country-tile.test.ts`
 * does that, on real coastlines.
 *
 * `ZZ` answers `undefined`, which is how a country the dataset cannot draw
 * behaves: the row keeps its words and loses its vignette.
 */
const TILE_POINT_OF: SearchIndexInput["tilePointOf"] = ({ countryCode, coordinates }) =>
  countryCode === "ZZ" ? undefined : { x: coordinates.lon, y: coordinates.lat };

const place = (name: string, countryCode: string, coordinates = NOWHERE) => ({
  name,
  countryCode,
  coordinates,
});

const trip = (
  slug: string,
  title: string,
  places: readonly {
    name: string;
    countryCode: string;
    coordinates: { lat: number; lon: number };
  }[],
  extra: Partial<SearchableTrip> = {}
): SearchableTrip => ({
  slug,
  title,
  startDate: "2024-01-01",
  endDate: "2024-01-08",
  story: "written",
  steps: [{}, {}],
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
  trip("corse-2024", "Corse", [place("Corte", "FR"), place("Bonifacio", "FR")]),
  trip("roses-2024", "Roses", [place("Roses", "ES")]),
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
    tilePointOf: TILE_POINT_OF,
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
      trip("crete-2025", "Crète", [place("Héraklion", "GR")], {
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
        place("Valence", "FR"),
        place("Valence", "ES"),
      ]),
      trip("b", "B", [place("Valence", "FR")]),
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
      trip("japon-2024", "Japon, printemps 2024", [place("Tokyo", "JP")], {
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
      trip("t", "Titre", [place("Lieu", "FR")], {
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
        place("Les Sables-d'Olonne", "FR"),
        place("Noirmoutier-en-l'Île", "FR"),
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
    tilePointOf: TILE_POINT_OF,
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

/**
 * The illustrated row the owner chose from a sheet of five — direction 3's field
 * with direction 5's suggestions. Two things reach the markup from here: a second
 * line of three fields, and three numbers for the vignette.
 */
describe("what an illustrated trip row carries", () => {
  const rowFor = (trips: readonly SearchableTrip[]) =>
    entries(trips).find((entry) => entry.group === "trips");

  it("says where, how long and when, in that order", () => {
    const row = rowFor([
      trip("corse-2024", "Corse", [place("Corte", "FR"), place("Bonifacio", "FR")], {
        steps: [{}, {}, {}, {}, {}, {}],
      }),
    ]);

    expect(row?.detail).toBe("FR · 6 étapes · 2024");
  });

  /** A trip that crosses a border names both countries, in the order it met them. */
  it("names every country a trip crossed, once each", () => {
    const row = rowFor([
      trip("perou-2023", "Pérou et Bolivie", [
        place("Cusco", "PE"),
        place("La Paz", "BO"),
        place("Puno", "PE"),
      ]),
    ]);

    expect(row?.detail.startsWith("PE, BO · ")).toBe(true);
  });

  /** A trip that crosses a new year says so rather than picking one of the two. */
  it("gives both years when the trip crosses one", () => {
    const row = rowFor([
      trip("reveillon", "Réveillon", [place("Gand", "BE")], {
        startDate: "2023-12-28",
        endDate: "2024-01-03",
      }),
    ]);

    expect(row?.detail.endsWith(" · 2023–2024")).toBe(true);
  });

  /**
   * **An untold trip says so in words, where its date would be.** That is the
   * second channel the pennant's colour needs: `docs/adr/0003` and every marker
   * on the map hold the same rule — a state carried by colour alone is a state
   * some readers do not have.
   */
  it("puts the words where the date would be, on a trip with no récit", () => {
    const row = rowFor([
      trip("maroc-2023", "Maroc", [place("Marrakech", "MA")], { story: "unwritten" }),
    ]);

    expect(row?.detail.endsWith(" · récit à venir")).toBe(true);
    expect(row?.detail).not.toContain("2024");
  });

  /**
   * The vignette names a country and a point inside it, and both come from the
   * trip's **first** place — the same point the world map anchors its marker on,
   * so a row and a marker never disagree about where a trip left from.
   *
   * The projection itself is not here: it is `@/map`'s, behind a server-only
   * façade, and this module receives it as a callback. What is asserted is the
   * *pairing* — that the country and the coordinates handed to it are the first
   * place's and not another's.
   */
  it("names the first place's country and places the dot there", () => {
    const row = rowFor([
      trip("crete-2025", "Crète", [
        place("Héraklion", "GR", { lat: 35.32787, lon: 25.14341 }),
        // The second place must not move the dot, nor name the tile.
        place("La Canée", "GR", { lat: 35.51, lon: 24.02 }),
      ]),
    ]);

    // `TILE_POINT_OF` is the identity on longitude and latitude — see its note.
    expect(row?.art).toEqual({ country: "GR", x: 25.14341, y: 35.32787, told: true });
  });

  /**
   * **A country the dataset cannot draw costs the row its ornament and nothing
   * else.** The failure mode is stated here because it is the one the reader meets:
   * a row with no vignette still says where the trip went, in words.
   */
  it("gives no art when the country has no tile", () => {
    const row = rowFor([
      trip("nulle-part", "Nulle part", [place("Ailleurs", "ZZ", { lat: 1, lon: 1 })]),
    ]);

    expect(row?.art).toBeUndefined();
    expect(row?.detail).toContain("ZZ");
  });

  it("marks an untold trip's art, which is what draws a hollow pennant", () => {
    const row = rowFor([
      trip("maroc-2023", "Maroc", [place("Marrakech", "MA")], { story: "unwritten" }),
    ]);

    expect(row?.art?.told).toBe(false);
  });

  /**
   * **Only trips.** A place, a country and a page get a plain row — the shape the
   * mock-up drew, and the shape the panel's byte budget can afford: the index is
   * in the HTML of every document on the site.
   */
  it("gives no art to a place, a country or a page", () => {
    const rows = buildSearchEntries({
      trips: TRIPS,
      labels: CODE_LABELS,
      tripHref: (slug) => `/fr/voyages/${slug}`,
      tripEntryHref: (slug) => `/fr/voyages#voyage-${slug}`,
      countriesHref: "/fr/voyages",
      placesHref: "/fr/villes",
      pages: [{ label: "À propos", href: "/fr/a-propos" }],
      tilePointOf: TILE_POINT_OF,
    });

    for (const row of rows.filter((entry) => entry.group !== "trips")) {
      expect(row.art).toBeUndefined();
    }
    expect(rows.filter((entry) => entry.art !== undefined)).toHaveLength(TRIPS.length);
  });
});
