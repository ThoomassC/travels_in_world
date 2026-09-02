import { afterEach, describe, expect, it, vi } from "vitest";
import { listTripSummaries } from "@/content/loader";
import { freshestTrip } from "@/domain/freshness";
import { fixtureRoots } from "../content/support";

/**
 * The badge's three acceptance criteria, exercised over the **whole pipeline**
 * and with the dates injected: committed YAML on disk → `TripSchema` →
 * `summaryOf` → `freshestTrip`. Everything the pages do except render.
 *
 * `tests/domain/freshness.test.ts` covers the rule's boundaries on literals, and
 * that is the right place for them. What only this file can catch is a break in
 * the chain *between* the file and the rule: a `publishedAt` the schema drops, a
 * projection that forgets to carry it, a `TripSummary` that stops being
 * assignable to `Publication`. Every one of those leaves the domain suite green
 * and the badge silently absent.
 *
 * **Why this is not an E2E spec.** It could be, and it would cost a build per
 * date — a served page pins one day, because the day is a build input. Here the
 * day is an argument, so J+1 and J+61 are two calls over one collection. The
 * rendered half is asserted once, at J+1, in `tests/e2e/fresh-trip.populated.spec.ts`.
 *
 * The fixture is `home-map`, four trips whose newest **publication** is
 * `islande-2022` — the oldest **journey** of the four. That is the ticket's trap
 * built into the data: a derivation reading `startDate`, or trusting the order
 * the façade hands over, answers `japon-2025` here and passes on any fixture
 * where the two agree.
 */

/** `islande-2022`'s `publishedAt`, and the newest of the fixture's four. */
const NEWEST_PUBLICATION = "2026-01-05";

/** `NEWEST_PUBLICATION` plus `days`, so a case reads as an offset. */
function dayAfter(days: number): string {
  const instant = new Date(`${NEWEST_PUBLICATION}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);

  return instant.toISOString().slice(0, 10);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

async function summariesOf(fixture: string) {
  vi.stubEnv("TIW_CONTENT_DIR", fixtureRoots(fixture).contentDir);

  return listTripSummaries();
}

describe("the newest récit, read from the committed collection", () => {
  it("carries the publication date the file declares", async () => {
    const trips = await summariesOf("home-map");
    const islande = trips.find((trip) => trip.slug === "islande-2022");

    /**
     * The link in the chain nothing else would notice breaking. If `publishedAt`
     * stopped reaching `TripSummary`, `freshestTrip` would compare `undefined`
     * against `undefined`, answer the first trip, and every case below would
     * still pass for the wrong reason.
     */
    expect(islande?.publishedAt).toBe(NEWEST_PUBLICATION);
  });

  it("is the newest publication and not the newest journey", async () => {
    const trips = await summariesOf("home-map");

    // The façade's own order — `startDate` descending — puts the 2025 trip first.
    expect(trips[0]?.slug).toBe("japon-2025");
    // The badge follows the publication date, so it lands on the 2022 journey.
    expect(freshestTrip(trips, dayAfter(1))?.slug).toBe("islande-2022");
  });

  it("is present at J+1", async () => {
    const trips = await summariesOf("home-map");

    expect(freshestTrip(trips, dayAfter(1))).toBeDefined();
  });

  it("is gone at J+61", async () => {
    const trips = await summariesOf("home-map");

    expect(freshestTrip(trips, dayAfter(61))).toBeUndefined();
  });

  /**
   * The window's own edge, over real content: the badge survives the last day of
   * the sixty and not the first day after. A `<=` slipped into the rule passes
   * J+1 and J+61 and fails only here.
   */
  it.each([
    { age: 59, expected: "islande-2022" },
    { age: 60, expected: undefined },
  ])("at J+$age answers $expected", async ({ age, expected }) => {
    const trips = await summariesOf("home-map");

    expect(freshestTrip(trips, dayAfter(age))?.slug).toBe(expected);
  });

  /**
   * And the third criterion: a journal with no published trip announces nothing.
   * The `no-trips` fixture is a content root holding only a `.gitkeep`, which is
   * the repository's own state until TIW-24 — so this is production today.
   */
  it("announces nothing on a collection with no published trip", async () => {
    const trips = await summariesOf("no-trips");

    expect(trips).toEqual([]);
    expect(freshestTrip(trips, dayAfter(1))).toBeUndefined();
  });
});
