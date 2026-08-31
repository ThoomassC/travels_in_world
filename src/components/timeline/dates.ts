import type { PlainDate } from "@/domain/geo";

/**
 * Civil dates rendered for a reader, and the one trap that makes this a module
 * rather than three inline `toLocaleDateString` calls.
 *
 * **A `PlainDate` is a calendar day, not an instant.** `new Date("2024-04-12")`
 * is parsed as midnight *UTC*, and formatting that instant in the machine's own
 * zone shifts it backwards everywhere west of Greenwich: in
 * `America/Santiago` the trip that started on 12 April is printed as 11 April,
 * on the server, at build time, into static HTML nobody re-renders. The build
 * machine's timezone would silently become part of the published content.
 *
 * So every function here pins `timeZone: "UTC"` and builds its instant with
 * `Date.UTC` from the string's own parts. The suite is run under
 * `TZ=America/Santiago` as well as the local zone — the same guard
 * `tests/domain/trip.test.ts` documents for `durationOf`, and for the same
 * reason.
 *
 * These are presentation helpers, which is why they live here and not in
 * `src/domain/**`: the domain is pure of formatting concerns, and a localised
 * string is the most formatting-bound value there is.
 */

/** `YYYY-MM-DD` → the UTC instant of that calendar day at midnight. */
function utcInstant(date: PlainDate): Date {
  const year = Number.parseInt(date.slice(0, 4), 10);
  const month = Number.parseInt(date.slice(5, 7), 10);
  const day = Number.parseInt(date.slice(8, 10), 10);

  return new Date(Date.UTC(year, month - 1, day));
}

const UTC = "UTC" as const;

/** "12 avril 2024" — the unambiguous form, used wherever a date stands alone. */
export function formatDay(date: PlainDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: UTC,
  }).format(utcInstant(date));
}

/**
 * "12 avril" — the year dropped, for the two ends of a range that share it.
 *
 * Only ever used by {@link formatDayRange}, which decides whether dropping the
 * year is safe. A range spanning New Year keeps both years, because "28 décembre
 * — 3 janvier" reads as a trip going backwards in time.
 */
export function formatDayWithoutYear(date: PlainDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: UTC,
  }).format(utcInstant(date));
}

/** The four-digit year as written in the source string — no formatting, no zone. */
export function yearOf(date: PlainDate): string {
  return date.slice(0, 4);
}

/**
 * The two ends of a range, with the leading year elided when both share it.
 *
 * Returns the parts rather than a sentence: the joining word is a translation
 * ("du … au …"), and building it here would put a French preposition in a module
 * that has no message catalogue.
 */
export function formatDayRange(
  start: PlainDate,
  end: PlainDate,
  locale: string
): { readonly start: string; readonly end: string } {
  const sameYear = yearOf(start) === yearOf(end);

  return {
    start: sameYear ? formatDayWithoutYear(start, locale) : formatDay(start, locale),
    end: formatDay(end, locale),
  };
}

/**
 * The value for `<time dateTime>`, which is the machine-readable half of every
 * date on the page.
 *
 * A `PlainDate` is already exactly the HTML "date" microsyntax, so this is the
 * identity — written as a named function anyway, because the call sites read as
 * a conversion and the day the two formats diverge there is one place to change.
 */
export function machineDate(date: PlainDate): string {
  return date;
}
