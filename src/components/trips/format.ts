/**
 * The reader-facing formatting of a trip's facts: its dates, and the countries
 * it crossed.
 *
 * **Why this is not in the domain.** `docs/adr/0001-domain-purity.md` draws the
 * line explicitly — "le domaine divise et arrondit, il ne formate pas — le
 * formatage est de la locale, donc de la couche de présentation". Every function
 * here takes a locale and returns a string a reader sees; not one of them
 * decides anything about a trip.
 *
 * Every `Intl` object is memoised per locale. A sixty-trip listing formats sixty
 * ranges and several hundred country names, and building a fresh
 * `Intl.DateTimeFormat` for each is the one avoidable cost in this file —
 * `src/map/world.ts` memoises its own `DisplayNames` and `Collator` for the same
 * reason.
 */

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const regionNames = new Map<string, Intl.DisplayNames>();
const collators = new Map<string, Intl.Collator>();

/**
 * **`timeZone: "UTC"`, and it is the whole correctness of this module.**
 *
 * A calendar day is stored as `"2024-04-12"` and never as a `Date`, for the
 * reason `src/domain/geo.ts` gives: `new Date("2024-04-12")` is midnight UTC,
 * which is the 11th at 21:00 in Santiago. The strings are turned into instants
 * here only because `Intl` takes no other input — so the instant is built at
 * midnight UTC and read back in UTC, and the two cancel exactly. Remove this
 * option and every date on the site is a day early for half the planet, with
 * nothing failing in Europe to say so.
 */
function dateFormatterFor(locale: string): Intl.DateTimeFormat {
  const existing = dateFormatters.get(locale);
  if (existing !== undefined) {
    return existing;
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  dateFormatters.set(locale, formatter);

  return formatter;
}

function regionNamesFor(locale: string): Intl.DisplayNames {
  const existing = regionNames.get(locale);
  if (existing !== undefined) {
    return existing;
  }

  const names = new Intl.DisplayNames([locale], { type: "region" });
  regionNames.set(locale, names);

  return names;
}

/** The locale's own alphabetical order — never `String#localeCompare`, whose result depends on ambient locale data. */
export function collatorFor(locale: string): Intl.Collator {
  const existing = collators.get(locale);
  if (existing !== undefined) {
    return existing;
  }

  const collator = new Intl.Collator(locale);
  collators.set(locale, collator);

  return collator;
}

/** Midnight UTC of a `YYYY-MM-DD` day, or `null` if it is not one. */
function utcInstant(day: string): Date | null {
  const parsed = new Date(`${day}T00:00:00Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * A trip's dates as one phrase — `12–26 avril 2024`, `12 avril – 3 mai 2024`,
 * `28 décembre 2023 – 4 janvier 2024`, and a bare `1 juin 2024` for a one-day
 * trip.
 *
 * `formatRange` rather than two formatted dates joined by a dash: which parts a
 * range repeats and which it shares is a property of the language, exactly like
 * the separator `Intl.ListFormat` supplies below. Writing
 * `` `${from} – ${to}` `` renders "12 avril 2024 – 26 avril 2024" and no French
 * reader writes that.
 *
 * **No `<time>` element wraps the result, deliberately.** `<time>` carries one
 * machine-readable instant in its `datetime` attribute and HTML has no spelling
 * for a range, so the honest choices were a `<time>` whose `datetime` disagrees
 * with its own text, or none. Splitting the phrase back into two `<time>`
 * elements would mean giving up `formatRange` and with it the collapsing above.
 *
 * The fallback is for a day `PlainDateSchema` would have refused. It cannot be
 * reached through the content façade — but `TripEntry` is a structural type,
 * `Intl` throws a `RangeError` on an invalid `Date`, and one bad day taking down
 * the whole listing at build time is a much worse failure than one card showing
 * its raw dates.
 */
export function formatDateRange(locale: string, startDate: string, endDate: string): string {
  const from = utcInstant(startDate);
  const to = utcInstant(endDate);

  if (from === null || to === null) {
    return `${startDate} – ${endDate}`;
  }

  return dateFormatterFor(locale).formatRange(from, to);
}

/**
 * A country's localised name, or the code itself when ICU has never heard of it.
 *
 * ICU echoes its input back rather than answering `undefined` for an unknown
 * region — the trap `src/map/world.ts` documents — so both readings are folded
 * into the same answer. `CountryCodeSchema` validates the *shape* of a code and
 * deliberately not its existence, so this is reachable from real content, and
 * showing `"QQ"` is honest where showing `undefined` would not be.
 */
export function countryNameOf(locale: string, code: string): string {
  return regionNamesFor(locale).of(code) ?? code;
}

/**
 * The localised names of a trip's countries, in the reader's alphabetical order.
 *
 * The domain hands `countryCodes` sorted **by code** and says why: default
 * `sort` compares UTF-16 code units, which is deterministic everywhere, unlike
 * `localeCompare`. That is the right rule for a domain and the wrong one for a
 * page — on screen `["CH", "ES"]` reads "Suisse, Espagne". The locale-aware sort
 * belongs here, where the locale is known.
 *
 * Sorted on a copy: the façade memoises its projections for the whole life of a
 * build, so an in-place sort would reorder a shared array for every page
 * rendered afterwards.
 */
export function countryNamesOf(locale: string, codes: readonly string[]): readonly string[] {
  const collator = collatorFor(locale);

  return codes.map((code) => countryNameOf(locale, code)).sort(collator.compare);
}
