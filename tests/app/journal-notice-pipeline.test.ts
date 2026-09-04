import { afterEach, describe, expect, it, vi } from "vitest";
import { listTripSummaries } from "@/content/loader";
import { freshestTrip } from "@/domain/freshness";
import { holdsNoStory } from "@/domain/trip";
import { fixtureRoots, temporaryContent, tripYaml } from "../content/support";

/**
 * TIW-35's rule over the **whole pipeline**: YAML on disk → `TripSchema` →
 * `summaryOf` → `holdsNoStory`. Everything the layout does except render.
 *
 * `tests/domain/trip.test.ts` covers the predicate on literals, and that is the
 * right place for it. What only this file can catch is a break in the chain
 * *between* the file and the rule — a `story` key the schema drops, a projection
 * that forgets to carry it, a `TripSummary` that stops being assignable. Every one
 * of those leaves the domain suite green and the banner silently stuck on, or
 * silently gone, on real content.
 *
 * **The second half is the acceptance criterion nothing else can assert**: the
 * banner and TIW-19's "nouveau récit" banner are mutually exclusive by
 * construction, because `freshestTrip` skips untold trips before comparing. That
 * is a claim about two derivations agreeing, so it is asserted where both are
 * called against one collection — here — rather than by reading either one's
 * source. `docs/le-bandeau-des-recits-a-venir.md` carries the argument.
 *
 * Modelled on `./freshness-pipeline.test.ts`, deliberately: the two answer the two
 * halves of the same question over the same fixtures, and a reader who has read one
 * should recognise the shape of the other.
 */

/** A day inside every fixture's freshness window, so the pairing below is testable at all. */
const A_DAY_IN_THE_WINDOW = "2026-01-06";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function summariesOfFixture(fixture: string) {
  vi.stubEnv("TIW_CONTENT_DIR", fixtureRoots(fixture).contentDir);

  return listTripSummaries();
}

async function summariesOfSources(trips: Readonly<Record<string, string>>) {
  const content = temporaryContent(trips);

  try {
    vi.stubEnv("TIW_CONTENT_DIR", content.contentDir);

    return await listTripSummaries();
  } finally {
    content.cleanup();
  }
}

describe("whether the journal holds a récit, read from a real collection", () => {
  /**
   * The repository's own state at the time of writing: `content/trips` holds
   * nothing but a `.gitkeep`, so this is production, and the banner is on.
   */
  it("holds none on a collection with no trip at all", async () => {
    const trips = await summariesOfFixture("no-trips");

    expect(trips).toEqual([]);
    expect(holdsNoStory(trips)).toBe(true);
  });

  /**
   * **The state this ticket exists for**, built from YAML rather than asserted on
   * literals: the places are known, the dates are not, so the journeys land as
   * `story: unwritten` (TIW-18). Countries tinted, markers drawn, not a récit to
   * read — and a visitor with no explanation concludes the site is broken.
   */
  it("holds none on a collection whose every trip is untold", async () => {
    const trips = await summariesOfSources({
      "rouen-2025": tripYaml({ slug: "slug: rouen-2025", story: "story: unwritten" }),
      "annecy-2025": tripYaml({ slug: "slug: annecy-2025", story: "story: unwritten" }),
    });

    // The chain, asserted before the rule: a `story` the schema dropped or a
    // projection that forgot it would make every case below pass for the wrong
    // reason.
    expect(trips.map((trip) => trip.story)).toEqual(["unwritten", "unwritten"]);
    expect(holdsNoStory(trips)).toBe(true);
  });

  /**
   * And the case that matters: **the banner goes on the first published récit**, not
   * on the majority of them. One written trip among untold ones is a journal with
   * something to read.
   */
  it("holds one as soon as a single récit is written, among untold ones", async () => {
    const trips = await summariesOfSources({
      "rouen-2025": tripYaml({ slug: "slug: rouen-2025", story: "story: unwritten" }),
      "annecy-2025": tripYaml({ slug: "slug: annecy-2025", story: "story: unwritten" }),
      "geneve-2025": tripYaml({ slug: "slug: geneve-2025" }),
    });

    expect(trips.filter((trip) => trip.story === "written")).toHaveLength(1);
    expect(holdsNoStory(trips)).toBe(false);
  });

  /**
   * The committed four-trip fixture, one of whose trips is untold — so this pins
   * that a mixed journal is a journal with récits, on content nobody wrote for this
   * test.
   */
  it("holds one on the four-trip fixture, whose stories are mixed", async () => {
    const trips = await summariesOfFixture("home-map");

    expect(trips.some((trip) => trip.story === "unwritten")).toBe(true);
    expect(holdsNoStory(trips)).toBe(false);
  });
});

/**
 * **The cohabitation criterion, and it is asserted as an impossibility rather than
 * as an arbitration.**
 *
 * The acceptance criterion asked which banner wins when both conditions are true.
 * The answer is that the pair cannot occur: both rules go through `hasStory`, and
 * `freshestTrip` drops untold trips *before* comparing, so a journal holding no
 * written récit can never produce a freshest one.
 *
 * That is worth its own block because it is precisely what an explicit switch would
 * have broken — and it would have broken silently, on the day somebody published a
 * récit and forgot to flip it.
 */
describe("the two banners of the home page", () => {
  const collections = [
    { label: "no trip at all", fixture: "no-trips" },
    { label: "four trips, stories mixed", fixture: "home-map" },
  ] as const;

  it.each(collections)("are never both on, on $label", async ({ fixture }) => {
    const trips = await summariesOfFixture(fixture);
    const notice = holdsNoStory(trips);
    const fresh = freshestTrip(trips, A_DAY_IN_THE_WINDOW) !== undefined;

    expect(notice && fresh).toBe(false);
  });

  it("are never both on, on a journal whose every trip is untold", async () => {
    const trips = await summariesOfSources({
      "rouen-2025": tripYaml({ slug: "slug: rouen-2025", story: "story: unwritten" }),
    });

    /**
     * The trap this row exists for: `publishedAt` is **required** even on an untold
     * trip (`TripSchema` says why at length), so the collection here does carry a
     * fresh publication date. A freshness rule filtering untold trips *after*
     * choosing a winner would answer "nouveau récit" on a trip with no récit and no
     * page — and both banners would be on at once, which is the state this ticket
     * was asked to arbitrate.
     */
    expect(trips[0]?.publishedAt).toBe("2024-05-02");
    expect(holdsNoStory(trips)).toBe(true);
    expect(freshestTrip(trips, "2024-05-03")).toBeUndefined();
  });
});
