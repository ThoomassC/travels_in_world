import { describe, expect, it } from "vitest";
import { FRESHNESS_WINDOW_DAYS, freshestTrip, isFresh } from "@/domain/freshness";
import type { StoryState } from "@/domain/schema";

/**
 * The freshness derivation, and the only place in the project that decides what
 * "new" means.
 *
 * **Time is an argument here, never a reading.** That is the ticket's own
 * technical note and it is what makes every case below writable: nothing in
 * `src/domain/**` may call `Date.now()` (`docs/adr/0001-domain-purity.md` forbids
 * far less than that), so `today` is passed in, and a test can stand on any day
 * it likes. `docs/fraicheur-au-prerendu.md` records where the real value comes
 * from and what its granularity costs.
 *
 * The three boundary cases the acceptance criteria name — J+1 present, J+61
 * gone, an empty journal showing nothing — are the first three `describe`s.
 */

/** Twelve days after the reference publication; the arithmetic is `daysBetween`'s. */
const PUBLISHED = "2026-03-01";

/** `PUBLISHED` plus `days`, computed here so a test reads as an offset. */
function dayAfter(days: number): string {
  const instant = new Date(`${PUBLISHED}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);

  return instant.toISOString().slice(0, 10);
}

/**
 * `story` defaults to `"written"` here and is **required** on the type, which is
 * the pressure TIW-18 deliberately put on this helper: every construction of a
 * `Publication` now has to say whether there is a récit to announce, and the
 * default keeps the sixteen cases that predate the field reading as they did.
 */
const trip = (slug: string, publishedAt: string, story: StoryState = "written") => ({
  slug,
  publishedAt,
  story,
});

describe("the freshness window", () => {
  /**
   * The number is the acceptance criterion's, exported so the test and the code
   * cite one value rather than two that agree today. A silent change of the
   * window would otherwise leave every case below passing while meaning
   * something else — the reasoning `WORDS_PER_MINUTE` records in `./trip.ts`.
   */
  it("is the 60 days the criterion names", () => {
    expect(FRESHNESS_WINDOW_DAYS).toBe(60);
  });

  it("shows the badge the day after publication", () => {
    expect(isFresh(PUBLISHED, dayAfter(1))).toBe(true);
  });

  it("hides the badge on the sixty-first day", () => {
    expect(isFresh(PUBLISHED, dayAfter(61))).toBe(false);
  });

  /**
   * The half-open interval, stated as a pair rather than as a sentence: the
   * window is `[0, 60)` days, so the sixtieth day is the first one without a
   * badge. Both rows are here because a `<=` written by mistake passes the J+1
   * and J+61 cases above and fails only this one.
   */
  it.each([
    { age: 0, fresh: true, label: "the day it is published" },
    { age: 1, fresh: true, label: "the next day" },
    { age: 59, fresh: true, label: "the last day of the window" },
    { age: 60, fresh: false, label: "the first day past the window" },
    { age: 61, fresh: false, label: "the day the criterion names" },
    { age: 400, fresh: false, label: "a year later" },
  ])("at J+$age it is $fresh — $label", ({ age, fresh }) => {
    expect(isFresh(PUBLISHED, dayAfter(age))).toBe(fresh);
  });

  /**
   * A publication dated after the build is fresh, and deliberately so. It is
   * reachable two ways — a contributor writing tomorrow's date, and a build
   * machine whose clock is behind — and in both the trip is the newest thing the
   * journal holds. Answering `false` would hide the badge on exactly the récit it
   * exists for, which is the wrong direction to fail in.
   */
  it("treats a publication dated in the future as fresh", () => {
    expect(isFresh(PUBLISHED, dayAfter(-3))).toBe(true);
  });

  /**
   * A day neither side can parse is not fresh. `daysBetween` is only defined on
   * a real calendar day (`PlainDateSchema` is what guarantees one upstream), and
   * a `NaN` difference compared with `<` answers `false` on its own — this pins
   * that the answer is `false` and not an exception, because the caller is a page
   * being prerendered and a throw there is a failed build for a badge.
   */
  it.each(["", "2026-3-1", "pas-une-date", "2026-02-30"])(
    "answers false rather than throwing for %o",
    (day) => {
      expect(isFresh(day, dayAfter(1))).toBe(false);
      expect(isFresh(PUBLISHED, day)).toBe(false);
    }
  );
});

describe("which trip carries the badge", () => {
  it("shows nothing at all on a journal with no published trip", () => {
    expect(freshestTrip([], dayAfter(1))).toBeUndefined();
  });

  it("picks the single trip when there is one", () => {
    const only = trip("japon-2024", PUBLISHED);

    expect(freshestTrip([only], dayAfter(1))).toBe(only);
  });

  /**
   * **The trap the ticket sets, and the one case that matters most here.** The
   * publication date is not the trip's end date: a 2019 journey written up today
   * is news to the reader. The content façade orders by `startDate` descending,
   * so a derivation that trusted the incoming order — or read `endDate` — would
   * badge the wrong trip, and every rendering test would still be green.
   */
  it("reads the publication date and never the order it was handed", () => {
    const recentJourney = trip("japon-2026", dayAfter(-10));
    const oldJourneyJustWritten = trip("perou-2019", PUBLISHED);

    expect(freshestTrip([recentJourney, oldJourneyJustWritten], dayAfter(1))).toBe(
      oldJourneyJustWritten
    );
  });

  it("carries the badge on the most recent publication and on no other", () => {
    const newest = trip("islande-2026", PUBLISHED);
    const older = trip("japon-2024", dayAfter(-30));

    const chosen = freshestTrip([older, newest], dayAfter(1));

    expect(chosen).toBe(newest);
    expect(chosen).not.toBe(older);
  });

  /**
   * Two trips published the same day is a real state — a double release — and
   * `sort` being stable would otherwise make the winner depend on directory
   * order. The slug is the tiebreak, ascending, which is the rule the content
   * façade already uses for same-day trips (`byMostRecentThenSlug`).
   */
  it("breaks a same-day tie on the slug, ascending", () => {
    const bolivie = trip("bolivie-2026", PUBLISHED);
    const angola = trip("angola-2026", PUBLISHED);

    expect(freshestTrip([bolivie, angola], dayAfter(1))?.slug).toBe("angola-2026");
    expect(freshestTrip([angola, bolivie], dayAfter(1))?.slug).toBe("angola-2026");
  });

  it("shows nothing once the most recent publication has left the window", () => {
    const trips = [trip("islande-2026", PUBLISHED), trip("japon-2024", dayAfter(-30))];

    expect(freshestTrip(trips, dayAfter(61))).toBeUndefined();
  });

  /**
   * The newest trip being stale does **not** promote the runner-up. "Le dernier
   * voyage publié" is one trip or none; a journal whose latest récit is four
   * months old has no news, and badging the one before it would be inventing
   * some.
   */
  it("never falls back to an older trip when the newest is stale", () => {
    const trips = [trip("islande-2026", dayAfter(0)), trip("japon-2024", dayAfter(-1))];

    expect(freshestTrip(trips, dayAfter(70))).toBeUndefined();
  });

  /**
   * The input is not reordered. The façade memoises its projections for the whole
   * life of a build and hands the same array to every page, so a derivation
   * sorting in place would reorder the home page's listing as a side effect of
   * asking which trip is new — the reasoning `summaryOf` records at length.
   */
  it("leaves the array it was given untouched", () => {
    const trips = [trip("zanzibar-2020", dayAfter(-40)), trip("angola-2026", PUBLISHED)];
    const order = trips.map((entry) => entry.slug);

    freshestTrip(trips, dayAfter(1));

    expect(trips.map((entry) => entry.slug)).toEqual(order);
  });
});

/**
 * **A trip whose récit is not written can never be the new récit** (TIW-18), and
 * this is the one place in the project where those two states meet.
 *
 * The badge's own label is « Nouveau récit ». An untold trip has no récit and no
 * page, so announcing it is a promise with no address behind it: the marker's
 * accessible name would end in "nouveau récit" while the marker leads to a
 * listing, and the home banner would print a publication date for a story nobody
 * wrote.
 *
 * **Filtered before the comparison, not after it** — the opposite of what the
 * window does, and the difference is the whole rule. The window is applied to the
 * *winner*, because a journal whose newest récit is stale has no news and
 * promoting the runner-up would invent some. An untold trip is not stale news, it
 * is not news at all: it must not take part in the comparison, or a journal whose
 * most recent publication happens to be untold would announce nothing while a
 * perfectly fresh récit sat one line below it.
 */
describe("an untold trip is never the new récit", () => {
  it("never announces a trip whose récit is not written", () => {
    const untold = trip("maroc-2026", PUBLISHED, "unwritten");

    expect(freshestTrip([untold], dayAfter(1))).toBeUndefined();
  });

  /**
   * The case that separates "filtered before" from "filtered after", and the one a
   * `hasStory` check bolted onto the *result* would fail: the untold trip is the
   * most recent publication of the two, so a rule that picked the winner first and
   * then rejected it would leave the journal announcing nothing while `japon-2024`
   * is eleven days old and eminently announceable.
   */
  it("falls through to the newest récit that is actually written", () => {
    const untold = trip("maroc-2026", PUBLISHED, "unwritten");
    const written = trip("japon-2024", dayAfter(-11));

    expect(freshestTrip([untold, written], dayAfter(1))).toBe(written);
  });

  it("still shows nothing when every written récit has left the window", () => {
    const trips = [trip("maroc-2026", PUBLISHED, "unwritten"), trip("japon-2024", dayAfter(-70))];

    expect(freshestTrip(trips, dayAfter(1))).toBeUndefined();
  });

  /**
   * The tiebreak is unaffected, because it is applied among the trips that remain:
   * an untold trip with the alphabetically winning slug does not win by being
   * first.
   */
  it("does not let an untold trip win a same-day tie", () => {
    const angola = trip("angola-2026", PUBLISHED, "unwritten");
    const bolivie = trip("bolivie-2026", PUBLISHED);

    expect(freshestTrip([angola, bolivie], dayAfter(1))?.slug).toBe("bolivie-2026");
  });
});
