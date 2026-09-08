/**
 * Everything the header's search knows, and none of how it behaves.
 *
 * **This module exists so that the client boundary stays about interaction.**
 * `./site-search.tsx` is the milestone's **third** `'use client'` — the first two
 * belong to the map (TIW-14) and the photo viewer (TIW-17), and `AGENTS.md` says
 * any further one is argued in review. The argument is thin if the component also
 * carries the index, the normalisation and the matching rule: those are pure
 * functions over strings, they need no browser, and every interesting case is a
 * cheap assertion. So they live here, on the server side of the line, and the
 * component is left with a listbox, a caret and a keyboard.
 *
 * Pure, and free of React, of Next and of both façades — the same shape as
 * `src/components/trips/catalogue.ts`, `src/components/map/countries.ts` and
 * `src/components/places/places.ts`, which is now the fourth time this repository
 * has made the same call for the same reason.
 */

import { hasStory } from "@/domain/trip";

/** The four families the panel groups its rows into, in reading order. */
export type SearchGroup = "trips" | "places" | "countries" | "pages";

/**
 * What the index reads of a trip, and nothing more.
 *
 * Structurally a subset of the content façade's `TripDetail`, so its value is
 * assignable without a line of adaptation — and narrower than it, so the layout,
 * the one place holding both, is where a rename upstream fails `npm run
 * typecheck`.
 *
 * **`places` and `photos`, hence `loadTrips()` and not `listTripSummaries()`.**
 * The summary carries the countries and the single `firstArrival`; the full list
 * of places and the photographs live on the detail alone. The façade memoises its
 * parse for the whole build, so the extra cost is a projection and never a second
 * read of the disk — the same note `src/app/[locale]/villes/page.tsx` carries.
 */
export type SearchableTrip = {
  readonly slug: string;
  readonly title: string;
  /** Read to order the rows and to date them: `YYYY-MM-DD`. */
  readonly startDate: string;
  /** The other end of the period. Equal to `startDate` on a single-day trip. */
  readonly endDate: string;
  /** Decides where the row leads. An untold trip has no page — see below. */
  readonly story: "written" | "unwritten";
  /**
   * Only the **count** is read, and that is why the element type says so little:
   * a row shows "6 étapes", so widening this to the real `Step` union would
   * couple the search's input to a discriminated union it never inspects.
   */
  readonly steps: readonly unknown[];
  readonly places: readonly {
    readonly name: string;
    /** ISO 3166-1 alpha-2, uppercase by schema. */
    readonly countryCode: string;
    /**
     * Read for **one** thing: where the dot goes in the row's vignette. Only the
     * first place of a trip is used, which is the same point the map anchors its
     * marker on.
     */
    readonly coordinates: { readonly lat: number; readonly lon: number };
  }[];
  /**
   * Only the alt text is read. It is the closest thing a récit has to prose, and
   * the note on {@link buildSearchEntries} says why that matters.
   */
  readonly photos: readonly { readonly alt: string }[];
  readonly tags: readonly string[];
};

/**
 * How the caller names a country and orders the rows. The same shape
 * `CountryLabels`, `CatalogueLabels` and `PlaceLabels` take, and for the same
 * reason: the arranging is worth a hundred test cases, an `Intl` lookup is not,
 * and a pure module that took a locale would have to know about
 * `Intl.DisplayNames` and about collation.
 */
export type SearchLabels = {
  readonly countryName: (code: string) => string;
  readonly compare: (left: string, right: string) => number;
  /**
   * "6 étapes" — a **plural**, so it is resolved by the caller and never here.
   * A pure module cannot pick a plural form: the rules belong to the language,
   * next-intl owns them, and French and Spanish do not agree with English on
   * zero. The caller passes the count through its own catalogue.
   */
  readonly stepCount: (count: number) => string;
  /** What stands where a date would, on a trip whose récit is not written yet. */
  readonly unwritten: string;
};

/**
 * What a trip's vignette needs: a country to draw and a point inside it.
 *
 * **THE VIGNETTE IS A REAL MAP OF A REAL COUNTRY**, at the 50m vintage, fitted to
 * its own 40-unit frame — the owner asked for exactly that. It replaced a
 * graticule with a dot on it, which was honest but said very little, and it
 * replaced the mock-up's hand-drawn coastline, which said a great deal and none
 * of it true.
 *
 * The geometry is **not** here and cannot be: it comes from `@/map`, a server-only
 * façade, and this module is pure so that its hundred cases cost nothing. What
 * crosses is three numbers and a country code — `x` and `y` already placed inside
 * that country's tile by the caller, which is the only layer that knows the
 * projection. `src/map/country-tile.ts` is the other half.
 */
export type SearchArt = {
  /** ISO 3166-1 alpha-2. Names the `<symbol>` the row's `<use>` points at. */
  readonly country: string;
  /** Where the trip's first place lands in that country's tile, in tile units. */
  readonly x: number;
  readonly y: number;
  /** Whether the récit is written — the dot reads it, and so does the second line. */
  readonly told: boolean;
};

/** One row of the panel. */
export type SearchEntry = {
  /**
   * The `id` the `<li>` carries, and therefore what `aria-activedescendant`
   * points at while the reader walks the list with the arrow keys. Unique across
   * the whole index and made of `[a-z0-9-]` only, because it is also a fragment.
   */
  readonly id: string;
  readonly group: SearchGroup;
  /** What the reader sees first, and what a screen reader announces. */
  readonly label: string;
  /** The second line: a year, a country, a count. May be empty. */
  readonly detail: string;
  readonly href: string;
  /**
   * What the row's vignette draws — **trips only**, absent everywhere else.
   *
   * A place, a country and a page get a plain row, exactly as the mock-up the
   * owner chose showed them. That is not only a design decision: the vignette is
   * the most expensive thing in the panel, and the panel is in the HTML of every
   * document on the site. Fourteen trips carry it; the twenty-odd other rows do
   * not.
   */
  readonly art?: SearchArt;
  /**
   * What {@link matchesQuery} is run against — already normalised, so the filter
   * does no work per keystroke beyond `includes`.
   *
   * It carries **more than the label**: a trip is findable by a place it stays
   * in, by a country it crosses, by a tag and by the caption of a photograph,
   * none of which its row displays. That is the whole reason the index is built
   * rather than read off the rendered text.
   */
  readonly haystack: string;
};

export type SearchIndexInput = {
  readonly trips: readonly SearchableTrip[];
  readonly labels: SearchLabels;
  /** A told trip's own page. */
  readonly tripHref: (slug: string) => string;
  /** An untold trip's entry in the listing — the address that certainly exists. */
  readonly tripEntryHref: (slug: string) => string;
  /** The listing, grouped by country. */
  readonly countriesHref: string;
  /** The alphabetical index of places. */
  readonly placesHref: string;
  /** The site's own pages, in the order they should appear. */
  readonly pages: readonly { readonly label: string; readonly href: string }[];
  /**
   * Where a place lands inside its own country's vignette, in tile units — or
   * `undefined` when that country has no tile, in which case the row simply has
   * no drawing.
   *
   * A callback for the same reason `countryName` is one: the projection lives
   * behind `@/map`, which is server-only, and a pure module that imported it
   * could not be unit-tested at all.
   */
  readonly tilePointOf: (place: {
    readonly countryCode: string;
    readonly coordinates: { readonly lat: number; readonly lon: number };
  }) => { readonly x: number; readonly y: number } | undefined;
};

/**
 * Fold a string down to what a reader is really typing.
 *
 * Three transformations, and each one answers a case this carnet actually has:
 *
 * - **accents come off** (`NFD`, then drop the combining marks). The carnet
 *   spells "Crète" and "Genève"; a reader types "crete" and "geneve". A search
 *   that answers nothing there is a search nobody uses twice. Decomposition
 *   rather than a substitution table, so no language has to be maintained;
 * - **punctuation becomes a separator, not nothing.** "Les Sables-d'Olonne" with
 *   the hyphen deleted welds into a word nobody types. And the apostrophe is the
 *   case that actually bites: the content is written with U+2019, which is the
 *   correct French apostrophe, while every keyboard produces U+0027. Both become
 *   a space, so the two spellings meet;
 * - **whitespace collapses** and the result is trimmed, so a query is a clean
 *   list of words to test one at a time.
 *
 * `\p{Diacritic}` and `\p{L}\p{N}` need the `u` flag, which is why the two
 * expressions carry it. They are compiled once, at module scope: this runs on
 * every keystroke.
 */
const DIACRITICS = /\p{Diacritic}/gu;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

export function normaliseForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(NON_WORD, " ")
    .trim();
}

/**
 * Does this row answer this query?
 *
 * **Every word, in any order, anywhere in the haystack.** Not one substring: a
 * reader narrowing a list types two facts they remember — "sables france" — in
 * the order they think of them, which is not the order the entry is written in.
 * A single-substring search answers nothing there and reads as broken.
 *
 * Substring and not prefix, because the useful half of a French place name is
 * often not its first: "olonne" has to find "Les Sables-d'Olonne".
 *
 * **An empty query matches everything**, and that is the panel's resting state
 * rather than a special case. With nothing typed the list is the complete index
 * — which is also exactly what a reader without JavaScript sees, because nothing
 * has hidden anything.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const words = normaliseForSearch(query).split(" ").filter(Boolean);

  return words.every((word) => haystack.includes(word));
}

/** `[a-z0-9-]` only: the id is also a fragment, so it may hold nothing else. */
function idFragment(text: string): string {
  return normaliseForSearch(text).replace(/ /g, "-") || "x";
}

/**
 * The whole index, in the order the panel reads it: Voyages, Lieux, Pays, Pages.
 *
 * **The order is decided here and the component does not sort.** Two sorts are
 * two answers to one question, and the day they disagree the bug is invisible —
 * the list simply looks wrong to somebody.
 *
 * **Trips keep the façade's order** (`startDate` descending) rather than being
 * collated: a journal's newest journey first is information, and alphabetising it
 * would throw that away. Places and countries are collated, because there the
 * reader is scanning for a name and needs the alphabet they are scanning with.
 *
 * **A place's identity is the pair name + country, never the slug** — the rule
 * `tallyVisitedPlaces` records after measuring it: `checkTrip` makes a slug unique
 * only inside its own `trip.yaml`, so two files may write `valence` for two
 * different towns, and keying on the name alone merges the Spanish Valencia with
 * the French one.
 *
 * **What a récit's text amounts to, since the owner asked for it to be searched.**
 * There is no body field: `src/domain/schema.ts` gives a trip a title, places,
 * steps, photographs and tags, and nothing that holds prose. So the free text a
 * récit owns is its photo captions and its tags, and both are folded into the
 * trip's haystack. The day a body field exists, this function is where it joins —
 * `tests/components/search/entries.test.ts` says so in a case of its own, so the
 * absence is a decision somebody recorded rather than a gap somebody will
 * rediscover.
 */
/**
 * The three-part second line of a trip's row: where, how long, when.
 *
 * `·` between the parts and not a comma, because two of the three already hold
 * commas of their own once a trip crosses two countries.
 *
 * **The period is a year and not the months the mock-up drew.** `formatDayRange`
 * in `src/components/timeline/dates.ts` returns two *full days* — "12 avril",
 * "20 avril 2024" — which is right for a trip page and twice too long for a row
 * 26 rem wide. A compact month range is a new locale-aware formatter with its own
 * behaviour to pin (abbreviations, the year elided or not, a range that crosses a
 * new year), and it was not opened here. What is here is honest: the year, or
 * both years when the trip crosses one.
 *
 * An untold trip says so **in words** where its date would be. That is the second
 * channel the pennant's colour needs: `docs/adr/0003` and every marker on the map
 * hold the same rule, a state carried by colour alone is a state some readers do
 * not have.
 */
function tripDetail(
  trip: SearchableTrip,
  countries: readonly string[],
  labels: SearchLabels
): string {
  const startYear = trip.startDate.slice(0, 4);
  const endYear = trip.endDate.slice(0, 4);
  const period =
    hasStory(trip) === false
      ? labels.unwritten
      : startYear === endYear
        ? startYear
        : `${startYear}–${endYear}`;

  return [
    countries.map((code) => labels.countryName(code)).join(", "),
    labels.stepCount(trip.steps.length),
    period,
  ].join(" · ");
}

/**
 * The vignette: the country of the trip's **first place**, with the dot on that
 * place.
 *
 * The first place and not the trip's "main" country, because it is the same point
 * the world map anchors its marker on — so a row and a marker never disagree about
 * where a trip left from. A trip crossing a border shows the country it started
 * in; its second line names them all.
 *
 * Two ways there is no vignette, and both are silent by design: a trip with no
 * place (which the schema forbids, but this module takes its input from a caller
 * and not from the parser), and a country the dataset cannot draw. Either way the
 * row keeps its words and loses an ornament.
 */
function tripArt(trip: SearchableTrip, tilePointOf: SearchIndexInput["tilePointOf"]): SearchArt | undefined {
  const first = trip.places[0];
  if (first === undefined) {
    return undefined;
  }

  const point = tilePointOf(first);
  if (point === undefined) {
    return undefined;
  }

  return {
    country: first.countryCode,
    x: point.x,
    y: point.y,
    told: hasStory(trip),
  };
}

export function buildSearchEntries({
  trips,
  labels,
  tripHref,
  tripEntryHref,
  countriesHref,
  placesHref,
  pages,
  tilePointOf,
}: SearchIndexInput): readonly SearchEntry[] {
  const tripRows: SearchEntry[] = trips.map((trip) => {
    const countries = [...new Set(trip.places.map((place) => place.countryCode))];

    return {
      id: `q-t-${idFragment(trip.slug)}`,
      group: "trips",
      label: trip.title,
      detail: tripDetail(trip, countries, labels),
      art: tripArt(trip, tilePointOf),
      // The same branch the map's markers take, and for the same reason: an
      // untold trip has no page, so a row pointing at one would put a 404 in the
      // suggestions of every document on the site.
      href: hasStory(trip) ? tripHref(trip.slug) : tripEntryHref(trip.slug),
      haystack: normaliseForSearch(
        [
          trip.title,
          trip.startDate.slice(0, 4),
          ...trip.places.map((place) => place.name),
          ...countries,
          ...countries.map((code) => labels.countryName(code)),
          ...trip.tags,
          ...trip.photos.map((photo) => photo.alt),
        ].join(" ")
      ),
    };
  });

  /**
   * Keyed by name + country, which is a place's identity. See the header.
   *
   * **A separator no `trip.yaml` can hold**, and not a space, because half the
   * places in this carnet are more than one word: "Les Sables-d'Olonne FR" split
   * back on a space gives the place "Les" in the country "Sables-d'Olonne". The
   * value carries the two fields anyway, so nothing ever splits the key back —
   * it is only ever compared. Written as the escape `\u0000` rather than pasted,
   * because a NUL byte in a source file makes it binary to git and to grep;
   * measured, having done exactly that once while writing this line.
   */
  const placesByKey = new Map<string, { readonly name: string; readonly countryCode: string }>();
  const countries = new Set<string>();

  for (const trip of trips) {
    for (const place of trip.places) {
      placesByKey.set(`${place.name}\u0000${place.countryCode}`, {
        name: place.name,
        countryCode: place.countryCode,
      });
      countries.add(place.countryCode);
    }
  }

  const placeRows: SearchEntry[] = [...placesByKey.values()]
    .map((place) => {
      const countryName = labels.countryName(place.countryCode);

      return {
        id: `q-l-${idFragment(`${place.name}-${place.countryCode}`)}`,
        group: "places" as const,
        label: place.name,
        detail: countryName,
        href: placesHref,
        haystack: normaliseForSearch(`${place.name} ${place.countryCode} ${countryName}`),
      };
    })
    .sort((left, right) => labels.compare(left.label, right.label));

  const countryRows: SearchEntry[] = [...countries]
    .map((code) => {
      const name = labels.countryName(code);

      return {
        id: `q-p-${idFragment(code)}`,
        group: "countries" as const,
        label: name,
        detail: "",
        href: countriesHref,
        haystack: normaliseForSearch(`${name} ${code}`),
      };
    })
    .sort((left, right) => labels.compare(left.label, right.label));

  const pageRows: SearchEntry[] = pages.map((page) => ({
    id: `q-s-${idFragment(page.label)}`,
    group: "pages",
    label: page.label,
    detail: "",
    href: page.href,
    haystack: normaliseForSearch(page.label),
  }));

  return [...tripRows, ...placeRows, ...countryRows, ...pageRows];
}
