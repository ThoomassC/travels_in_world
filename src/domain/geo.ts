import { z } from "zod";

/**
 * The scalar primitives every other domain schema is built on: an identifier
 * that survives a URL, a country code a map feature can be keyed on, a point on
 * the globe, and a calendar day.
 *
 * This module — like the rest of `src/domain/**` — depends on Zod and on
 * nothing else. See `docs/adr/0001-domain-purity.md`.
 */

/**
 * Lowercase alphanumeric groups joined by single hyphens. The exclusions matter
 * more than the inclusions: an uppercase letter, an underscore, an accent or a
 * leading/trailing hyphen would each produce a *second* URL for a place that
 * already has one.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SlugSchema = z
  .string()
  .regex(SLUG_PATTERN, 'Expected a lowercase hyphen-joined slug, such as "lyon-part-dieu".');

/**
 * Shape only, deliberately: this validates that the code *looks* like ISO
 * 3166-1 alpha-2, not that it exists. Checking against a registry would put a
 * copy of the ISO list in the domain and date it; the map renderer is where an
 * unknown code has a visible consequence, and it is the layer that owns the
 * list of features it can draw.
 */
export const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'Expected an uppercase ISO 3166-1 alpha-2 country code, such as "FR".');

/**
 * (0, 0) is what a failed geocoding returns, not a place: a missing YAML key, an
 * empty string parsed as a number and a provider with no match all collapse
 * there, and the only symptom is a marker floating in the Gulf of Guinea.
 *
 * The guard is on the *pair*, never on either coordinate alone — the equator and
 * the prime meridian both run through inhabited land.
 */
const NULL_ISLAND_MESSAGE =
  "Coordinates (0, 0) are the signature of a failed geocoding, not a place on earth.";

export const CoordinatesSchema = z
  .strictObject({
    // Zod 4's `z.number()` already rejects `NaN` and both infinities, so the
    // bounds below are the only finiteness this needs to state.
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .refine(({ lat, lon }) => !(lat === 0 && lon === 0), { message: NULL_ISLAND_MESSAGE });

const PLAIN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Length of a month, without indexing a table — `noUncheckedIndexedAccess`. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Whether a value is a real calendar day. Well-formed is not the same as real:
 * `2024-02-30` and `2025-13-01` both pass the regex, and the error only surfaces
 * later as a duration off by a few days.
 *
 * Exported because it is also the guard the cross-field rules need. Zod runs a
 * `refine` even when a leaf check on the value has already failed, so a rule can
 * be handed something that never passed this schema — and comparing `"2024-4-1"`
 * against a real day answers nonsense. The pattern is re-tested here, and
 * `RegExp.test` coerces rather than throws, so this is safe to call on any value
 * the parser may hand over, string or not.
 */
export function isPlainDate(candidate: string): boolean {
  if (!PLAIN_DATE_PATTERN.test(candidate)) {
    return false;
  }
  const year = Number.parseInt(candidate.slice(0, 4), 10);
  const month = Number.parseInt(candidate.slice(5, 7), 10);
  const day = Number.parseInt(candidate.slice(8, 10), 10);

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/**
 * A calendar day, held as a string, and never as a `Date`.
 *
 * A `Date` is an instant: `new Date("2024-04-12")` is midnight UTC, which is
 * 2024-04-11 at 21:00 in Santiago, so any local formatting of it prints the day
 * before. The domain stores the day the traveller wrote down, and the suite runs
 * under several timezones to prove nothing here reads the machine's own.
 */
export const PlainDateSchema = z
  .string()
  .regex(PLAIN_DATE_PATTERN, "Expected a calendar day written YYYY-MM-DD.")
  .refine(isPlainDate, { message: "Expected a day that exists on the calendar." });

export type Slug = z.infer<typeof SlugSchema>;
export type CountryCode = z.infer<typeof CountryCodeSchema>;
export type Coordinates = z.infer<typeof CoordinatesSchema>;
export type PlainDate = z.infer<typeof PlainDateSchema>;

/**
 * Days elapsed since 1970-01-01, computed from the civil fields alone (Howard
 * Hinnant's `days_from_civil`). No `Date` is built, so no timezone, no DST and
 * no leap second can shift the result: the clock change of 2024-03-31 makes one
 * local day 23 hours long, and a difference of epoch milliseconds divided by
 * 86 400 000 answers 4.958 nights for a 5-night trip across it.
 *
 * Valid for any proleptic Gregorian date; `PlainDateSchema` is what guarantees
 * the fields are a real day before this is called.
 */
function epochDay(date: PlainDate): number {
  const year = Number.parseInt(date.slice(0, 4), 10);
  const month = Number.parseInt(date.slice(5, 7), 10);
  const day = Number.parseInt(date.slice(8, 10), 10);

  // January and February are counted as months 11 and 12 of the previous year,
  // which puts the leap day at the end of the cycle and removes every special
  // case from the arithmetic below.
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;

  // 146 097 days per 400-year era; 719 468 days from 0000-03-01 to 1970-01-01.
  return era * 146097 + dayOfEra - 719468;
}

/** Calendar days from `from` to `to`; negative when `to` precedes `from`. */
export function daysBetween(from: PlainDate, to: PlainDate): number {
  return epochDay(to) - epochDay(from);
}
