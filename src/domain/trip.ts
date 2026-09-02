import { daysBetween } from "./geo";
import type { CountryCode, PlainDate } from "./geo";
import { referencedPlaceSlugs } from "./schema";
import type { Budget, Photo, Place, Step, StoryState, Tag, Trip } from "./schema";

/**
 * Derivations. Nothing here is ever stored: a duration, a per-person budget and
 * a country list are all functions of the trip, and the moment one of them is
 * written into a content file it starts disagreeing with the rest.
 */

export type Duration = { readonly nights: number; readonly days: number };

/**
 * `nights` is the number of calendar days between the two dates, `days` is
 * `nights + 1`. A one-day trip has 0 nights and 1 day, which is why `days`
 * cannot be counted from nights alone.
 */
export function durationOf(range: {
  readonly startDate: PlainDate;
  readonly endDate: PlainDate;
}): Duration {
  const nights = daysBetween(range.startDate, range.endDate);

  return { nights, days: nights + 1 };
}

/**
 * **Whether this trip has a récit to read, and therefore a page.**
 *
 * One predicate, named once, because five places need the answer and none of them
 * may disagree: the loader's two publication doors (`findTrip` and
 * `tripStaticParams`), `sitemap.xml`, `feed.xml`, and the freshness derivation
 * that decides which card is announced as new.
 *
 * **A predicate and not a comparison repeated at each site**, and what decides it
 * is the direction it fails in. Spelled `trip.story !== "unwritten"` — the shape
 * that reads most naturally at a call site — a third member added to
 * {@link StoryState} would silently inherit "has a page", and the journal would
 * advertise an address nobody wrote. Spelled as this equality, a new state has no
 * page until somebody decides it does, and `tests/domain/trip.test.ts` fails the
 * day the list grows, so the decision is taken rather than defaulted.
 *
 * Structural, like every derivation here: a parsed `Trip`, a `TripSummary` and a
 * component's own narrowed entry are all assignable, so no layer has to import
 * the schema to ask the question.
 */
export function hasStory(trip: { readonly story: StoryState }): boolean {
  return trip.story === "written";
}

export type PerPersonBudget = {
  readonly amountCents: number;
  readonly currency: Budget["currency"];
};

/**
 * An indicative figure, not a partition: rounded to the nearest cent with halves
 * away from zero, so 3 × 3334 is one cent more than the 10 001 that was spent.
 * Any rule has that property; this one never displays less than the average paid.
 *
 * `null`, not zero, when there is no budget — "nothing recorded" and "cost
 * nothing" are different statements and the page renders them differently.
 */
export function budgetPerPerson(trip: { readonly budget?: Budget | null }): PerPersonBudget | null {
  const budget = trip.budget;
  // `== null` covers both spellings of absence, and the domain's real source is
  // YAML: a `budget:` key left empty parses as `null`, never `undefined`. A
  // strict `=== undefined` walks straight into `null.totalCents`, and the trip
  // page — the one page that renders a budget — is the page that crashes.
  if (budget == null) {
    return null;
  }

  // Totals are non-negative (`BudgetSchema`), so `Math.round` is halves-up and
  // halves-away-from-zero at once — and never the banker's rounding that would
  // answer 2500 for 10 002 / 4.
  return {
    amountCents: Math.round(budget.totalCents / budget.travellers),
    currency: budget.currency,
  };
}

/**
 * The countries of the places the *steps* reach — including a place only a move
 * ever touches, which is how a country flown out of and back into still counts
 * as visited. Reading `places[]` instead would count a leftover declaration;
 * `TripSchema` rejects those, so the two readings can never disagree, and this
 * is the one the derivation implements.
 *
 * Ascending alphabetical on the code, not declaration order: the list is read as
 * a set ("3 pays : FR, JP, TH"), and a set rendered in file order changes every
 * time someone reorders the YAML.
 */
export function visitedCountryCodes(trip: {
  readonly places: readonly Place[];
  readonly steps: readonly Step[];
}): readonly CountryCode[] {
  const referenced = new Set<string>();
  for (const step of trip.steps) {
    for (const slug of referencedPlaceSlugs(step)) {
      referenced.add(slug);
    }
  }

  const codes = new Set<CountryCode>();
  for (const place of trip.places) {
    if (referenced.has(place.slug)) {
      codes.add(place.countryCode);
    }
  }

  // Default `sort` compares UTF-16 code units — deterministic everywhere, unlike
  // `localeCompare`, whose order depends on the runtime's locale data.
  return [...codes].sort();
}

/**
 * The places a trip crosses, in the order it crosses them, each named once.
 *
 * **Step order, and never `places[]` order.** `places[]` is a declaration block:
 * its order is whatever the author happened to type, and `TripSchema` places no
 * meaning on it at all. The header calls this list "les villes traversées", so
 * the only order that is not a lie is the order the steps travel.
 *
 * A move contributes its departure *and* its arrival, in that order — which is
 * what makes a layover, a place passed through and never slept in, appear here
 * at all. `referencedPlaceSlugs` already answers in that order, so this function
 * adds the de-duplication and the lookup and nothing else.
 *
 * **A revisited place is named once, at its first crossing.** "Tokyo, Kyoto,
 * Tokyo" reads as a defect in a header promising the cities of a trip. Nothing
 * is lost by collapsing it: the two stays remain separate steps in the timeline,
 * where the distinction is the point, and the anchor scheme keys on the date as
 * well as the slug so they keep separate, stable, copyable identities there.
 *
 * Throws rather than skipping an unknown slug, the same reasoning as
 * {@link firstArrivalOf}: `TripSchema` refuses a step referencing an undeclared
 * place, so reaching that branch means the value never went through the schema,
 * and silently dropping the place would shrink a list the reader is told is
 * complete.
 */
export function visitedPlaces(trip: {
  readonly places: readonly Place[];
  readonly steps: readonly Step[];
}): readonly Place[] {
  const bySlug = new Map(trip.places.map((place) => [place.slug, place]));
  const seen = new Set<string>();
  const ordered: Place[] = [];

  for (const step of trip.steps) {
    for (const slug of referencedPlaceSlugs(step)) {
      if (seen.has(slug)) {
        continue;
      }
      seen.add(slug);

      const place = bySlug.get(slug);
      if (place === undefined) {
        throw notFromTheSchema(`a step references "${slug}", which is absent from places[]`);
      }
      ordered.push(place);
    }
  }

  return ordered;
}

/**
 * The reading rate the estimate is built on, exported because a test asserts it:
 * the table of expected minutes is written against this number, and a silent
 * change of the rate would leave every row passing while meaning something else.
 *
 * 200 words per minute is the conventional figure for adult silent reading of
 * non-technical prose. It is a convention, not a measurement of this site's
 * readers, and the estimate is presented to the reader as one.
 */
export const WORDS_PER_MINUTE = 200;

/** Never zero: "0 min de lecture" reads as broken, not as brief. */
const MINIMUM_READING_MINUTES = 1;

/**
 * Minutes of reading for a word count, rounded **up** and never below one.
 *
 * Rounding up is the direction that cannot disappoint: a page announcing "1 min"
 * for 350 words has under-promised by most of a minute, and the figure exists to
 * let a reader decide whether to start now.
 *
 * **On the input this receives today.** The word count is whatever the page can
 * actually count, and the current content model gives it very little: no step in
 * `TripSchema` carries prose — `StaySchema` is `{ kind, placeSlug, startDate,
 * endDate }` and nothing else — so every published trip lands on the one-minute
 * floor until a prose field exists. That is a starved input, not a wrong
 * function, and the distinction is deliberate: this stays a plain
 * words-to-minutes conversion, so the day steps carry text the only thing that
 * changes is what the caller counts.
 *
 * Throws on anything that is not a whole, finite, non-negative count. A word
 * count comes from a `.length`, so a negative or a fraction is a caller that has
 * gone wrong upstream, and answering "1 min" would hide it behind a plausible
 * number.
 */
export function estimateReadingMinutes(words: number): number {
  if (!Number.isInteger(words) || words < 0) {
    throw new TypeError(
      `estimateReadingMinutes expects a whole, non-negative word count; received ${words}.`
    );
  }

  return Math.max(MINIMUM_READING_MINUTES, Math.ceil(words / WORDS_PER_MINUTE));
}

/**
 * An invariant `TripSchema` guarantees was violated, which means the value never
 * went through it. Named rather than papered over with a `!` or a made-up place:
 * a derivation that invents a coordinate puts a marker somewhere on the map and
 * nobody ever learns why, whereas this message says exactly what to fix — parse
 * before deriving (`docs/adr/0001-domain-purity.md`).
 */
function notFromTheSchema(detail: string): Error {
  return new Error(
    `firstArrivalOf received a value TripSchema.parse() cannot produce: ${detail}. Parse the trip before deriving from it — see docs/adr/0001-domain-purity.md.`
  );
}

/**
 * **The place the trip's first step arrives at.** A stay arrives where it is
 * spent; a move arrives at its `toSlug`.
 *
 * Two readings are excluded, and both are real bugs rather than matters of taste
 * — this one was written wrong once in this very ticket and caught in review.
 *
 * *Not `places[0]`.* The order of `places[]` in a `trip.yaml` is declarative —
 * the order somebody happened to type the cities in — so reordering the file is a
 * legitimate edit that would move the trip's marker on the map.
 *
 * *Not the first step's departure either.* This is the reading that reads
 * plausibly and is wrong: for a trip that opens on a flight, the departure is
 * home. `TripSchema` documents Paris → Tokyo → Paris as valid — nobody declares a
 * night at home before leaving, so that is the shape of most real trips — and the
 * departure reading labels a trip to Japan with Paris. Nothing structural catches
 * it: the trip is valid, the coordinates are real, the country exists.
 *
 * Hence `.at(-1)` over {@link referencedPlaceSlugs}, which answers `[placeSlug]`
 * for a stay and `[fromSlug, toSlug]` for a move: the last entry is the arrival
 * in both cases.
 *
 * One accepted limit, documented rather than fixed: a contributor who *does*
 * declare a night at home before leaving gets home as the first arrival. That is
 * defensible — they wrote that stay — and correcting it would mean knowing where
 * "home" is, which is a concept this model does not have.
 *
 * `TripSchema` guarantees both halves this needs — at least one step, and every
 * step referencing a declared place — which is why the result is a `Place` and
 * not `Place | undefined`. The three guards below restore what
 * `noUncheckedIndexedAccess` takes away without a cast, and they are unreachable
 * for any value that came out of `TripSchema.parse()`.
 */
export function firstArrivalOf(trip: {
  readonly places: readonly Place[];
  readonly steps: readonly Step[];
}): Place {
  const first = trip.steps[0];
  if (first === undefined) {
    throw notFromTheSchema("steps[] is empty, which TripSchema rejects");
  }

  const arrivalSlug = referencedPlaceSlugs(first).at(-1);
  if (arrivalSlug === undefined) {
    throw notFromTheSchema("the first step references no place at all");
  }

  const arrival = trip.places.find((place) => place.slug === arrivalSlug);
  if (arrival === undefined) {
    throw notFromTheSchema(
      `the first step arrives at "${arrivalSlug}", which is absent from places[]`
    );
  }

  return arrival;
}

/**
 * The two projections the pages consume: the list page never needs `steps`, the
 * trip page needs everything. Both are built from a parsed trip plus the
 * derivations above, and every field type is taken from the schema rather than
 * written a second time.
 *
 * **Neither of them carries `draft`**, and that is deliberate. In production the
 * flag is `false` for every trip a page can see, so the only thing a consumer
 * could do with it is draw a conclusion that is always wrong on the one
 * environment where it is not: somebody writes `if (trip.draft)`, it works on
 * localhost, it never runs once online, and nothing says so. Whether a draft is
 * published is the loader's decision, taken before a projection exists.
 */
export type TripSummary = {
  readonly slug: Trip["slug"];
  readonly title: Trip["title"];
  readonly startDate: Trip["startDate"];
  readonly endDate: Trip["endDate"];
  /**
   * The day the récit went online, which is **not** `endDate` — see the field's
   * own note in `./schema.ts`.
   *
   * On the summary and not only on the detail, because the two views that read it
   * are both listings: the freshness derivation (`./freshness.ts`) picks which
   * card carries the badge, and the RSS feed orders and dates its items by it.
   */
  readonly publishedAt: Trip["publishedAt"];
  readonly duration: Duration;
  readonly countryCodes: readonly CountryCode[];
  /**
   * Where the first step arrives, which is where the itinerary begins. Stated as
   * the fact and not as a use: naming a rendering — a marker, a pin — is what got
   * `anchorPlace` refused, and the domain does not know that a map exists.
   */
  readonly firstArrival: Place;
  readonly coverPhotoSrc: Trip["coverPhotoSrc"];
  readonly tags: readonly Tag[];
  /**
   * Whether the récit is written (TIW-18) — see {@link hasStory}.
   *
   * **On the summary and not only on the detail**, which is the opposite call from
   * `draft` right below, and for a reason that is not symmetry: every consumer of
   * this field is a *listing*. A card decides whether its title is a link at all,
   * the map's marker decides where it points, and the sitemap and the feed decide
   * whether to advertise an address. The detail page never reads it — a page that
   * renders at all is a page whose story is written, which the loader guarantees.
   */
  readonly story: StoryState;
};

export type TripDetail = TripSummary & {
  readonly places: readonly Place[];
  readonly steps: readonly Step[];
  readonly photos: readonly Photo[];
  readonly budget: Trip["budget"];
  readonly budgetPerPerson: PerPersonBudget | null;
};

/**
 * Field by field, never a spread of the parsed trip: the projection is the list
 * of fields the list page may see, and `{ ...trip }` would hand it `steps`,
 * `budget` and `draft` the day one of them is added to the schema. Every derived
 * value is taken from the derivation above rather than recomputed, so fixing a
 * rounding or an ordering rule fixes the card too.
 *
 * **Every array is copied, and that is not defensive style.** The caller of these
 * projections memoises the parsed `Trip`s for the whole life of a build process
 * and hands the same objects to every page, so a field returned by reference is
 * *shared*. `readonly` is compile-time only: a consumer writing
 * `detail.steps.sort(byDate)` or `detail.photos.reverse()` would reorder the
 * snapshot for every page rendered afterwards, with no error anywhere. A copy per
 * projection is one small array per page, which is nothing next to a corrupted
 * build.
 *
 * The limit, so nobody reads more into it than it gives: this protects against
 * `sort`, `reverse`, `push` and their kin, **not** against mutating an object
 * *inside* an array — `detail.places[0].coordinates.lat = 0` still reaches the
 * memoised trip, and so does `summary.firstArrival`, which is a `Place` and not an
 * array. A deep freeze would close that, and would be paid on every page for a
 * risk no consumer in this repository presents; the shallow copy closes the one
 * that reads as ordinary code.
 *
 * `countryCodes` and `duration` need no copy: the derivations above build a fresh
 * value on every call.
 */
export function summaryOf(trip: Trip): TripSummary {
  return {
    slug: trip.slug,
    title: trip.title,
    startDate: trip.startDate,
    endDate: trip.endDate,
    publishedAt: trip.publishedAt,
    duration: durationOf(trip),
    countryCodes: visitedCountryCodes(trip),
    firstArrival: firstArrivalOf(trip),
    coverPhotoSrc: trip.coverPhotoSrc,
    tags: [...trip.tags],
    story: trip.story,
  };
}

/**
 * The detail is a superset of the summary — the trip page renders both halves —
 * so it is built *on* `summaryOf` rather than beside it. Two field lists that
 * have to agree are two field lists that eventually do not.
 */
export function detailOf(trip: Trip): TripDetail {
  return {
    ...summaryOf(trip),
    // Copied, for the reason written on `summaryOf`: these three are the arrays a
    // page is most likely to sort, and the trip they come from is memoised.
    places: [...trip.places],
    steps: [...trip.steps],
    photos: [...trip.photos],
    budget: trip.budget,
    budgetPerPerson: budgetPerPerson(trip),
  };
}
