import { describe, expect, it } from "vitest";
import { placeMarks, spreadCoincident } from "@/components/map/marks";
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
    expect(Math.abs(Number(spread[0]?.topPercent) - Number(spread[1]?.topPercent))).toBeGreaterThan(
      2
    );
  });

  it("separates two markers that landed on the same spot", () => {
    const placed = placeMarks(twoAtTokyo(), CROPPED_FRAME);
    const spread = spreadCoincident(placed, CROPPED_FRAME);

    // The control, which is what keeps this test from passing for the wrong
    // reason: the two really were on top of each other before the spread.
    expect(placed[0]?.leftPercent).toBe(placed[1]?.leftPercent);
    expect(placed[0]?.topPercent).toBe(placed[1]?.topPercent);

    expect([spread[0]?.leftPercent, spread[0]?.topPercent]).not.toEqual([
      spread[1]?.leftPercent,
      spread[1]?.topPercent,
    ]);
  });

  /**
   * A pair goes straight up and straight down. That is what makes it read as one
   * place holding two trips rather than as two unrelated trips: the point they
   * share stays exactly the midpoint of the pair.
   */
  it("puts a pair above and below the point it shares, which stays the midpoint", () => {
    const placed = placeMarks(twoAtTokyo(), CROPPED_FRAME);
    const spread = spreadCoincident(placed, CROPPED_FRAME);

    expect(spread[0]?.leftPercent).toBe(placed[0]?.leftPercent);
    expect(spread[1]?.leftPercent).toBe(placed[0]?.leftPercent);
    expect((Number(spread[0]?.topPercent) + Number(spread[1]?.topPercent)) / 2).toBeCloseTo(
      Number(placed[0]?.topPercent),
      6
    );
  });

  /**
   * A percentage of the height is not the same number of pixels as a percentage
   * of the width. Without scaling the vertical component by the frame's ratio the
   * "circle" is an ellipse flattened by the same 1.92 factor as the map, and a
   * pair separates almost twice as far horizontally as vertically — for no reason
   * a reader could guess.
   */
  it("scales the vertical offset by the frame ratio, so the spread is round on screen", () => {
    const placed = placeMarks(twoAtTokyo(), CROPPED_FRAME);
    const spread = spreadCoincident(placed, CROPPED_FRAME);

    const verticalPercent = Math.abs(Number(spread[0]?.topPercent) - Number(placed[0]?.topPercent));

    expect(verticalPercent).toBeCloseTo(1.6 * (CROPPED_FRAME.width / CROPPED_FRAME.height), 1);
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
    const positions = new Set(spread.map((entry) => `${entry.leftPercent}|${entry.topPercent}`));

    expect(positions.size).toBe(count);
  });

  /**
   * A prerendered page has to be byte-identical between two builds of the same
   * content, or the deployment diff becomes unreadable. Fixed divisions of the
   * circle rather than anything drawn from a generator is what buys that.
   */
  it("is deterministic across calls", () => {
    const first = spreadCoincident(placeMarks(twoAtTokyo(), CROPPED_FRAME), CROPPED_FRAME);
    const second = spreadCoincident(placeMarks(twoAtTokyo(), CROPPED_FRAME), CROPPED_FRAME);

    expect(first.map(({ leftPercent, topPercent }) => [leftPercent, topPercent])).toEqual(
      second.map(({ leftPercent, topPercent }) => [leftPercent, topPercent])
    );
  });

  it("has nothing to do on an empty list", () => {
    expect(spreadCoincident([], CROPPED_FRAME)).toEqual([]);
  });
});
