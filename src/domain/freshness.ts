import { daysBetween, isPlainDate } from "./geo";
import type { PlainDate } from "./geo";

/**
 * Which récit is *new*, and for how long — the whole of TIW-19's rule, as a pure
 * function of the journal and of one day.
 *
 * **Nothing is stored.** There is no `new:` key in a `trip.yaml` and there never
 * will be: a flag somebody has to tick is a flag somebody forgets to untick, and
 * the trip would be announced as new for years with a green build. The badge is
 * derived from `publishedAt` the way a duration is derived from two dates — the
 * rule this whole module family follows (`./trip.ts`, first paragraph).
 *
 * **`today` is an argument, and that is the load-bearing part.** The domain may
 * not read a clock — `docs/adr/0001-domain-purity.md` forbids far less than that
 * — so the caller supplies the day, which is what makes every boundary of the
 * window assertable at all. `src/app/build-day.ts` is the one module that turns a
 * real clock into that argument, and it is the only clock read on the whole
 * render path.
 *
 * **What that costs, said in full elsewhere**: the site is prerendered, so
 * `today` is the *build* day, and the badge therefore expires at the first build
 * after the window closes rather than at the stroke of midnight.
 * `docs/fraicheur-au-prerendu.md` is the arbitration — including the measured
 * reason a CSS-only expiry cannot exist and why a third client component was
 * refused. Do not "fix" this file by reading a clock in it.
 */

/**
 * The window, in days, and the acceptance criterion's own number.
 *
 * Exported because the suite asserts on it: a table of expected boundaries
 * written against a private constant stays green when the constant moves, and
 * then means something else. Same reasoning as `WORDS_PER_MINUTE` in `./trip.ts`.
 */
export const FRESHNESS_WINDOW_DAYS = 60;

/**
 * The two fields the derivation reads of a trip — a narrowing, not a copy of
 * `TripSummary`, so a component's own `TripEntry` and the façade's `TripSummary`
 * are both assignable to it without a line of adaptation.
 */
export type Publication = {
  readonly slug: string;
  readonly publishedAt: PlainDate;
};

/**
 * Whether a publication still falls inside the window, on the day given.
 *
 * **A half-open interval, `[0, FRESHNESS_WINDOW_DAYS)`.** Sixty days of badge is
 * days 0 to 59; the sixtieth day is the first one without. Written as `<` rather
 * than `<=` for that reason, and the suite pins both ends of the pair — a `<=`
 * slipped in by mistake passes "J+1 shows" and "J+61 hides" and fails only the
 * row at J+60.
 *
 * **A future publication is fresh.** A negative age is reachable from a
 * contributor writing tomorrow's date and from a build machine whose clock is
 * behind, and in both cases the trip is the newest thing the journal holds.
 * Refusing it would hide the badge on precisely the récit it exists for.
 *
 * **A day that is not a calendar day answers `false`, never a throw.** The caller
 * is a page being prerendered: `daysBetween` is only defined on a real day, and
 * one bad string taking `next build` down over a badge would be a far worse
 * failure than a missing badge. `TripSchema` is what keeps that branch
 * unreachable from real content; this function stays total because
 * {@link Publication} is a structural type and nothing stops a caller handing it
 * a bare string — the same contract `formatDateRange` states in
 * `src/components/trips/format.ts`.
 */
export function isFresh(publishedAt: PlainDate, today: PlainDate): boolean {
  if (!isPlainDate(publishedAt) || !isPlainDate(today)) {
    return false;
  }

  return daysBetween(publishedAt, today) < FRESHNESS_WINDOW_DAYS;
}

/**
 * The most recently published trip, or `undefined` — because there is none, or
 * because the most recent one has left the window.
 *
 * **One trip or none, never a runner-up.** When the newest récit is four months
 * old the journal has no news; promoting the trip behind it would be inventing
 * some. So the window is applied to the winner and not used as a filter before
 * the comparison — the two read the same on most inputs and differ on exactly the
 * state this rule is about.
 *
 * **Compared on `publishedAt`, which is not the order the caller hands over.**
 * The content façade sorts by `startDate` descending, and a 2019 journey written
 * up today is the newest *publication* while being the oldest *trip*. Taking
 * `trips[0]` would badge the wrong card and every rendering test would still
 * pass. String comparison is exact for `YYYY-MM-DD` — fixed width, zero-padded,
 * most significant first — the same reading `byMostRecentThenSlug` and
 * `TripSchema` both rest on.
 *
 * **The slug breaks a same-day tie, ascending.** Two récits released the same day
 * is a real state, and a comparison answering "equal" would let directory order
 * decide which one is announced.
 *
 * A `reduce` and not `[...trips].sort()`: the input must not be reordered — the
 * façade memoises its projections for the life of a build and hands the same
 * array to every page — and a full sort would pay O(n log n) to read one element.
 */
export function freshestTrip<T extends Publication>(
  trips: readonly T[],
  today: PlainDate
): T | undefined {
  const newest = trips.reduce<T | undefined>((best, trip) => {
    if (best === undefined) {
      return trip;
    }
    if (trip.publishedAt !== best.publishedAt) {
      return trip.publishedAt > best.publishedAt ? trip : best;
    }

    return trip.slug < best.slug ? trip : best;
  }, undefined);

  if (newest === undefined || !isFresh(newest.publishedAt, today)) {
    return undefined;
  }

  return newest;
}
