import { describe, expect, it } from "vitest";
import { frameAround } from "@/components/map/frame";
import {
  placeMarks,
  spreadCoincident,
  type PlacedMark,
  type TripMark,
} from "@/components/map/marks";
import { OVERLAP_RADIUS_PERCENT, overlappingMarks, worldPointOf } from "@/components/map/zones";

/**
 * Which markers a reader's finger would cover along with the one they aimed at —
 * the arithmetic behind the panel's "Aussi à cet endroit" block.
 *
 * **The shape of the answer changed with the panel, and these cases are where it
 * shows.** The panel used to belong to a *zone* and had to partition the markers,
 * so the grouping was single linkage and a chain of near-neighbours became one
 * list. A panel now belongs to one trip, so the only remaining question is
 * pairwise — "which markers overlap mine" — and the chaining case below asserts
 * that it no longer propagates.
 *
 * Pure, for the reason the rest of this folder is pure: the answer depends on
 * distances and on a sort, both of which are worth many cases and none of which
 * needs a browser.
 */

const WORLD = { width: 960, height: 500 };

const mark = (slug: string, x: number, y: number): TripMark => ({
  slug,
  title: slug,
  placeName: slug,
  href: `/fr/voyages/${slug}`,
  story: "written",
  point: { x, y },
});

/** The frame the whole world produces, so a percentage is a world unit / 9.6. */
const WHOLE = frameAround([], WORLD);

/**
 * The overlap radius expressed in **world units**, on the whole-world frame.
 *
 * Both axes convert at the same rate once the anisotropy correction is applied —
 * a percentage of the width is `x / 9.6`, and a percentage of the height, divided
 * by the world's 1.92 aspect, is `y / 9.6` too — so one number serves for the
 * horizontal and the vertical cases alike.
 */
const RADIUS_IN_WORLD = (OVERLAP_RADIUS_PERCENT * WORLD.width) / 100;

const place = (marks: readonly TripMark[], frame = WHOLE) =>
  spreadCoincident(placeMarks(marks, frame), frame);

/** The slugs of a marker's neighbours, in the order the panel would list them. */
const neighboursOf = (
  overlaps: ReadonlyMap<string, readonly PlacedMark[]>,
  slug: string
): readonly string[] => (overlaps.get(slug) ?? []).map((entry) => entry.mark.slug);

/**
 * Indexed access, without the non-null assertion this repository's sources do
 * not use. A missing entry is a defect of the test's own setup, so it fails here
 * with the reason rather than three assertions later with `undefined`.
 */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`No entry at index ${index} of a list of ${list.length}.`);
  }
  return value;
}

describe("worldPointOf", () => {
  it("is the inverse of placeMarks, so a marker lands back on its own point", () => {
    const marks = [mark("a", 137.4, 92.6), mark("b", 812.9, 407.1)];
    const placed = placeMarks(marks, WHOLE);

    expect(worldPointOf(at(placed, 0), WHOLE).x).toBeCloseTo(137.4, 1);
    expect(worldPointOf(at(placed, 0), WHOLE).y).toBeCloseTo(92.6, 1);
    expect(worldPointOf(at(placed, 1), WHOLE).x).toBeCloseTo(812.9, 1);
    expect(worldPointOf(at(placed, 1), WHOLE).y).toBeCloseTo(407.1, 1);
  });

  it("survives a cropped frame, where a percentage is not a world unit", () => {
    const frame = frameAround(
      [
        { x: 300, y: 120 },
        { x: 700, y: 300 },
      ],
      WORLD
    );
    const placed = placeMarks([mark("a", 512.5, 210.25)], frame);

    expect(worldPointOf(at(placed, 0), frame).x).toBeCloseTo(512.5, 1);
    expect(worldPointOf(at(placed, 0), frame).y).toBeCloseTo(210.25, 1);
  });

  it("gives two trips from the same city the same world point, spread or not", () => {
    /**
     * **This case asserts the opposite of what it used to**, and the reversal is
     * the correction of a real defect rather than a change of taste.
     *
     * It read: the coincidence nudge is a percentage of the frame, so converting
     * it here turns it into a fixed distance in *world units*, which grows on
     * screen as the reader zooms and separates the pair. That is true, and it is
     * the bug — a world distance is a distance on the Earth. Annecy and Genève,
     * 0.9 world units apart, were drawn 4.6 apart: one marker 150 km north of the
     * lake, the other 150 km south. Reported by the journal's owner, on a map
     * whose coordinates were correct.
     *
     * The nudge now travels beside the position as `PlacedMark.nudge`, in rem, and
     * the stylesheet applies it. So this function — the one that decides where the
     * marker is *on the Earth* — must return the projected point untouched, for a
     * spread marker exactly as for a lone one.
     */
    const same = { x: 500, y: 250 };
    const placed = place([
      mark("a", same.x, same.y),
      mark("b", same.x, same.y),
    ]);

    const first = worldPointOf(at(placed, 0), WHOLE);
    const second = worldPointOf(at(placed, 1), WHOLE);

    expect(first).toEqual(second);
    for (const point of [first, second]) {
      expect(point.x).toBeCloseTo(same.x, 1);
      expect(point.y).toBeCloseTo(same.y, 1);
    }
    // And the separation the reader will see is there, in screen units.
    expect(at(placed, 0).nudge).not.toEqual(at(placed, 1).nudge);
  });
});

describe("overlappingMarks", () => {
  it("has nothing to say when there is no marker", () => {
    expect(overlappingMarks([], WHOLE).size).toBe(0);
  });

  it("leaves a lone marker out of the map rather than giving it an empty list", () => {
    /**
     * The contract, asserted rather than described: **a marker with no neighbour
     * is absent.** `get` answers `undefined`, the caller writes `?? []`, and the
     * "Aussi à cet endroit" block cannot be rendered empty by a caller that
     * forgot to check a length.
     */
    const overlaps = overlappingMarks(place([mark("islande-2022", 400, 120)]), WHOLE);

    expect(overlaps.size).toBe(0);
    expect(overlaps.has("islande-2022")).toBe(false);
  });

  it("gives two markers a reader could not tell apart each other", () => {
    /**
     * Tokyo and Osaka, the fixture's own case: about 400 km apart, which over a
     * cropped world is a handful of pixels. It is the pair that makes axe's
     * `target-size` fire on the delivered map, so it is exactly the pair the
     * panel's secondary block exists for — a reader clicking there cannot have
     * meant one of them in particular.
     */
    const overlaps = overlappingMarks(
      place([
        mark("japon-2024", 830.4, 172.6),
        mark("japon-2025", 826.2, 176.1),
      ]),
      WHOLE
    );

    expect(neighboursOf(overlaps, "japon-2024")).toEqual(["japon-2025"]);
    expect(neighboursOf(overlaps, "japon-2025")).toEqual(["japon-2024"]);
  });

  it("says nothing about two markers a reader can plainly tell apart", () => {
    const overlaps = overlappingMarks(
      place([mark("a", 100, 100), mark("b", 800, 400)]),
      WHOLE
    );

    expect(overlaps.size).toBe(0);
  });

  it("does not chain: A touches B and B touches C, but A never gets C", () => {
    /**
     * **The case that proves the change.** The zone grouping was single linkage —
     * a marker joined a zone as soon as it was within the radius of any ONE of its
     * members — so these three came out as one list of three, and clicking Paris
     * on the real content opened "Les 6 voyages à cet endroit" where only two
     * pairs actually overlap.
     *
     * A panel belongs to one trip now, and the only remaining question is what a
     * finger covers, which is a pairwise fact. `0.6` of the radius each step, so
     * each neighbouring pair overlaps and the outer two, `1.2` radii apart, do
     * not.
     */
    const step = RADIUS_IN_WORLD * 0.6;
    const overlaps = overlappingMarks(
      place([
        mark("a", 400, 250),
        mark("b", 400 + step, 250),
        mark("c", 400 + 2 * step, 250),
      ]),
      WHOLE
    );

    expect(neighboursOf(overlaps, "a")).toEqual(["b"]);
    expect(neighboursOf(overlaps, "c")).toEqual(["b"]);
    // And B, which really does touch both, gets both — in slug order, since the
    // two are exactly the same distance away.
    expect(neighboursOf(overlaps, "b")).toEqual(["a", "c"]);
  });

  it("lists the nearest neighbour first", () => {
    // The reader's first row is the marker their finger was most likely on.
    const overlaps = overlappingMarks(
      place([
        mark("centre", 400, 250),
        mark("loin", 400 + RADIUS_IN_WORLD * 0.8, 250),
        mark("proche", 400 + RADIUS_IN_WORLD * 0.2, 250),
      ]),
      WHOLE
    );

    expect(neighboursOf(overlaps, "centre")).toEqual(["proche", "loin"]);
  });

  it("breaks a distance tie on the slug, so two builds of the same content agree", () => {
    // The page is prerendered: an order that depended on input order would make
    // the HTML depend on the order the content façade happened to hand the trips.
    const gap = RADIUS_IN_WORLD * 0.5;
    const overlaps = overlappingMarks(
      place([
        mark("centre", 400, 250),
        mark("zanzibar", 400 + gap, 250),
        mark("albanie", 400 - gap, 250),
      ]),
      WHOLE
    );

    expect(neighboursOf(overlaps, "centre")).toEqual(["albanie", "zanzibar"]);
  });

  it("never makes a marker its own neighbour", () => {
    /**
     * Distance zero passes every threshold, so the exclusion has to be explicit.
     * A panel listing its own trip under "Aussi à cet endroit" would be the map
     * offering the reader the page they are already looking at.
     */
    const overlaps = overlappingMarks(
      place([mark("a", 500, 250), mark("b", 500, 250)]),
      WHOLE
    );

    expect(neighboursOf(overlaps, "a")).toEqual(["b"]);
    expect(neighboursOf(overlaps, "b")).toEqual(["a"]);
  });

  it("measures the distance on screen and not in percent of each axis", () => {
    /**
     * A percentage of the height is not the same number of pixels as a
     * percentage of the width — the world's box is 1.92 times wider than it is
     * tall — so an unscaled comparison pairs vertical neighbours nearly twice as
     * eagerly as horizontal ones, for no reason a reader could guess. Same
     * correction `spreadCoincident` applies in the other direction.
     *
     * The two pairs below are the same distance apart *on screen*: one
     * horizontally, one vertically. They must fall on the same side of the
     * threshold.
     */
    const gap = RADIUS_IN_WORLD * 1.4;
    const horizontal = overlappingMarks(
      place([mark("a", 300, 250), mark("b", 300 + gap, 250)]),
      WHOLE
    );
    const vertical = overlappingMarks(
      place([mark("a", 300, 100), mark("b", 300, 100 + gap)]),
      WHOLE
    );

    expect(horizontal.size).toBe(0);
    expect(vertical.size).toBe(0);
  });

  it("still answers on a frame with no area", () => {
    /**
     * Unreachable through `frameAround`, which throws for a world with none, and
     * through `placeMarks`, which answers nothing for a frame with none. Asserted
     * because the fallback aspect of 1 is what keeps the function answering at all
     * rather than dividing by zero and pairing every marker with every other.
     */
    const placed = placeMarks(
      [mark("a", 500, 250), mark("b", 500, 250)],
      WHOLE
    );
    const overlaps = overlappingMarks(placed, { viewBox: "", x: 0, y: 0, width: 0, height: 0 });

    expect(neighboursOf(overlaps, "a")).toEqual(["b"]);
  });

  it("keeps a marker whose distance cannot be measured out of everyone's list", () => {
    /**
     * `NaN <= r` is false, so an unmeasurable marker is nobody's neighbour rather
     * than everybody's. Written as a `PlacedMark` literal because no framing this
     * component can be handed produces one — which is exactly why the branch would
     * otherwise never be exercised.
     */
    const measurable: PlacedMark = {
      mark: mark("a", 500, 250),
      leftPercent: 50,
      topPercent: 50,
    };
    const unmeasurable: PlacedMark = {
      mark: mark("b", 500, 250),
      leftPercent: Number.NaN,
      topPercent: Number.NaN,
    };

    const overlaps = overlappingMarks([measurable, unmeasurable], WHOLE);

    expect(overlaps.size).toBe(0);
  });
});
