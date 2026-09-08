import { describe, expect, it } from "vitest";
import { placeMarks, spreadCoincident } from "@/components/map/marks";
import { worldPointOf } from "@/components/map/zones";
import { CROPPED_FRAME, tripMark } from "./fixtures";

/**
 * The overlap mitigation, in its own file because it answers a different question
 * from `placeMarks`: not "where does this marker go" but "what happens when two
 * of them go to the same place".
 *
 * Two trips leaving from the same city is one of the likeliest shapes this
 * journal will hold — two visits to Japan, both anchored on Tokyo — and two `<a>`
 * at identical coordinates means the lower one answers no click at all: 44 px of
 * target that does nothing, for a link the keyboard still reaches. That
 * asymmetry between pointer and keyboard is the defect.
 *
 * What is asserted below is deliberately weaker than "the targets no longer
 * overlap", because that claim cannot be made from here: separating two 44 px
 * boxes needs the map's rendered width, which is fluid and unknown at build time,
 * and a percentage cannot promise a distance in pixels. What *can* be asserted is
 * that coincident markers stop being coincident, deterministically, and that no
 * marker which was already alone is moved a single hundredth of a percent.
 */
describe("spreadCoincident", () => {
  const AT_TOKYO = { x: 800, y: 150 };

  /**
   * **THE DEFECT THIS FILE WAS REWRITTEN FOR, and it was visible on the site.**
   *
   * The first version moved the two percentages. `worldPointOf` then converted
   * them back into world units, so the nudge stopped being a screen distance and
   * became a **geographic** one — a fixed number of kilometres, baked into the
   * prerendered marker, growing on screen as the reader zoomed in. The note it
   * replaced in `../zones.ts` called that growth the fix.
   *
   * On the journal's own content, measured in the served page against the
   * projection of the very same coordinates:
   *
   *   Annecy   46.20 N  drawn 4.6 world units north of its point  (~150 km)
   *   Genève   45.91 N  drawn 4.6 world units south of its point  (~150 km)
   *   La Rochelle / Les Sables-d'Olonne / Noirmoutier — a triangle
   *            of the same radius, two of the three out in the Atlantic
   *
   * The coordinates in `content/trips/**` were right the whole time. What follows
   * is the invariant that keeps them right: **the spread never moves a marker's
   * position.** It writes a `nudge`, in rem, which the stylesheet applies as a
   * screen-space translate — so the separation is a constant number of pixels at
   * every zoom, and the anchor stays on the town.
   *
   * PROVEN BY DELIBERATE FAILURE — restoring the old body of `spreadCoincident`:
   *
   *   -leftPercent: entry.leftPercent,
   *   -topPercent: entry.topPercent,
   *   +leftPercent: round(entry.leftPercent + 1.6 * Math.cos(angle)),
   *   +topPercent: round(entry.topPercent + 1.6 * verticalScale * Math.sin(angle)),
   *
   *   npm test -> 3 failed | 27 passed
   *     expected { x: 800, y: 145.39 } to deeply equal { x: 800, y: 150 }
   *     expected [ 50, 46.93 ] to deeply equal [ 50, 53.07 ]
   *     expected { x: 499.97, y: 234.65 } to deeply equal { x: 499.97, y: 265.35 }
   */
  it("never moves a marker off the point its coordinates project to", () => {
    const marks = twoAtTokyo();
    const placed = placeMarks(marks, CROPPED_FRAME);
    const spread = spreadCoincident(placed, CROPPED_FRAME);

    for (const entry of spread) {
      expect(worldPointOf(entry, CROPPED_FRAME)).toEqual(AT_TOKYO);
    }
  });

  /**
   * And the separation it writes instead: a screen offset, in rem, opposite for a
   * pair. `rem` and not a percentage of the frame — a percentage of *which*
   * frame, when the reader chooses it? The old code answered "the one the build
   * cropped", which is the whole defect above.
   */
  it("separates a pair with opposite screen offsets, in rem", () => {
    const spread = spreadCoincident(placeMarks(twoAtTokyo(), CROPPED_FRAME), CROPPED_FRAME);

    const [first, second] = spread;

    expect(first?.nudge?.x).toBe(0);
    expect(second?.nudge?.x).toBe(0);
    expect(Number(first?.nudge?.y)).toBeLessThan(0);
    expect(Number(second?.nudge?.y)).toBe(-Number(first?.nudge?.y));
    // Half a marker's own 2.75rem target: a crescent of each stays exposed.
    expect(Math.abs(Number(first?.nudge?.y))).toBeCloseTo(0.75, 2);
  });

  /**
   * The offsets are a circle **on screen**, which in rem needs no correction at
   * all. The version this replaces scaled its vertical component by the frame's
   * 1.92 aspect ratio, because it was working in percentages of two different
   * lengths; a rem is a rem in both axes.
   */
  it("puts three markers on a round circle, with no aspect correction", () => {
    const marks = Array.from({ length: 3 }, (_unused, index) =>
      tripMark({ slug: `voyage-${index}`, point: AT_TOKYO })
    );
    const spread = spreadCoincident(placeMarks(marks, CROPPED_FRAME), CROPPED_FRAME);

    for (const entry of spread) {
      expect(Math.hypot(Number(entry.nudge?.x), Number(entry.nudge?.y))).toBeCloseTo(0.75, 2);
    }
  });

  const twoAtTokyo = () => [
    tripMark({ slug: "japon-2024", point: AT_TOKYO }),
    tripMark({ slug: "japon-2019", point: AT_TOKYO }),
  ];

  it("returns the very same array when nothing overlaps", () => {
    // Hand-placed and far apart, not generated: `manyTripMarks` over a European
    // extent puts sixty markers inside a handful of cells, which is a genuine
    // overlap and the opposite of what this case is about.
    const placed = placeMarks(
      [
        tripMark({ slug: "a", point: { x: 700, y: 100 } }),
        tripMark({ slug: "b", point: { x: 800, y: 160 } }),
        tripMark({ slug: "c", point: { x: 900, y: 210 } }),
      ],
      CROPPED_FRAME
    );

    expect(spreadCoincident(placed, CROPPED_FRAME)).toBe(placed);
  });

  /**
   * The defect an accessibility audit found in the first version, which grouped
   * on the **exact equality** of the two rounded percentages.
   *
   * Percentages carry two decimals, so exact equality means agreeing to 0.01 % —
   * about 0.03 world units, four kilometres on a cropped frame. Charles-de-Gaulle
   * and central Paris are further apart than that: they produced different keys,
   * were therefore left alone, and then overlapped within a pixel of each other.
   * The buried marker had a clickable area of zero, which is the entire failure
   * this function exists to prevent — and the version that shipped it passed
   * every test in this file, because every case used *identical* points.
   */
  it("separates two markers that are close without being identical", () => {
    const nearlyTogether = [
      tripMark({ slug: "paris-2024", point: { x: 800, y: 150 } }),
      tripMark({ slug: "roissy-2023", point: { x: 800.4, y: 150.2 } }),
    ];
    const placed = placeMarks(nearlyTogether, CROPPED_FRAME);
    const spread = spreadCoincident(placed, CROPPED_FRAME);

    // The control: they are genuinely at different percentages, so the old
    // equality test saw two separate markers and did nothing.
    expect(placed[0]?.leftPercent).not.toBe(placed[1]?.leftPercent);

    expect(spread).not.toBe(placed);
    // Both are nudged, in opposite directions, and neither has moved a hundredth
    // of a percent off the point its coordinates project to.
    // `toBeCloseTo` on the horizontal component, not equality: `cos(π/2)` is
    // 6.1e-17 in binary floating point, which rounds to a zero of either sign.
    expect(Number(spread[0]?.nudge?.x)).toBeCloseTo(0, 6);
    expect(spread[0]?.nudge?.y).toBe(-0.75);
    expect(Number(spread[1]?.nudge?.x)).toBeCloseTo(0, 6);
    expect(spread[1]?.nudge?.y).toBe(0.75);
    expect(spread.map(({ leftPercent }) => leftPercent)).toEqual(
      placed.map(({ leftPercent }) => leftPercent)
    );
  });

  it("separates two markers that landed on the same spot", () => {
    const placed = placeMarks(twoAtTokyo(), CROPPED_FRAME);
    const spread = spreadCoincident(placed, CROPPED_FRAME);

    // The control, which is what keeps this test from passing for the wrong
    // reason: the two really were on top of each other before the spread.
    expect(placed[0]?.leftPercent).toBe(placed[1]?.leftPercent);
    expect(placed[0]?.topPercent).toBe(placed[1]?.topPercent);

    // They stay on top of each other — that is the fix — and what tells them
    // apart is the screen offset the stylesheet will apply.
    expect([spread[0]?.leftPercent, spread[0]?.topPercent]).toEqual([
      spread[1]?.leftPercent,
      spread[1]?.topPercent,
    ]);
    expect(spread[0]?.nudge).not.toEqual(spread[1]?.nudge);
  });

  /**
   * A pair goes straight up and straight down. That is what makes it read as one
   * place holding two trips rather than as two unrelated trips: the point they
   * share stays exactly the midpoint of the drawn pair.
   */
  it("puts a pair above and below the point it shares, which stays the midpoint", () => {
    const spread = spreadCoincident(placeMarks(twoAtTokyo(), CROPPED_FRAME), CROPPED_FRAME);

    expect(Number(spread[0]?.nudge?.x) + Number(spread[1]?.nudge?.x)).toBeCloseTo(0, 6);
    expect(Number(spread[0]?.nudge?.y) + Number(spread[1]?.nudge?.y)).toBeCloseTo(0, 6);
  });

  it("leaves a marker that shares its spot with nobody exactly where it was", () => {
    const alone = tripMark({ slug: "perou-2023", point: { x: 700, y: 200 } });
    const placed = placeMarks([...twoAtTokyo(), alone], CROPPED_FRAME);
    const spread = spreadCoincident(placed, CROPPED_FRAME);

    expect(spread[2]).toBe(placed[2]);
  });

  it("preserves the input order, which is the tab order", () => {
    const spread = spreadCoincident(placeMarks(twoAtTokyo(), CROPPED_FRAME), CROPPED_FRAME);

    expect(spread.map((entry) => entry.mark.slug)).toEqual(["japon-2024", "japon-2019"]);
  });

  it("carries the very trip objects it was given", () => {
    const marks = twoAtTokyo();
    const spread = spreadCoincident(placeMarks(marks, CROPPED_FRAME), CROPPED_FRAME);

    expect(spread[0]?.mark).toBe(marks[0]);
    expect(spread[1]?.mark).toBe(marks[1]);
  });

  it.each([3, 4, 5])("spreads %i coincident markers onto distinct positions", (count) => {
    const marks = Array.from({ length: count }, (_unused, index) =>
      tripMark({ slug: `voyage-${index}`, point: AT_TOKYO })
    );
    const spread = spreadCoincident(placeMarks(marks, CROPPED_FRAME), CROPPED_FRAME);
    /*
      On the nudges, because the positions are all identical now — and identical
      on purpose. What has to be distinct is where the stylesheet draws them.
    */
    const offsets = new Set(spread.map((entry) => `${entry.nudge?.x}|${entry.nudge?.y}`));

    expect(offsets.size).toBe(count);
  });

  /**
   * A prerendered page has to be byte-identical between two builds of the same
   * content, or the deployment diff becomes unreadable. Fixed divisions of the
   * circle rather than anything drawn from a generator is what buys that.
   */
  it("is deterministic across calls", () => {
    const first = spreadCoincident(placeMarks(twoAtTokyo(), CROPPED_FRAME), CROPPED_FRAME);
    const second = spreadCoincident(placeMarks(twoAtTokyo(), CROPPED_FRAME), CROPPED_FRAME);

    expect(first.map(({ leftPercent, topPercent, nudge }) => [leftPercent, topPercent, nudge])).toEqual(
      second.map(({ leftPercent, topPercent, nudge }) => [leftPercent, topPercent, nudge])
    );
  });

  it("has nothing to do on an empty list", () => {
    expect(spreadCoincident([], CROPPED_FRAME)).toEqual([]);
  });
});
