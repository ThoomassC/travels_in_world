import { describe, expect, it } from "vitest";
import { MARK_PIN_PATH, MARK_TIP, MARK_VIEWBOX } from "@/components/map/mark-art";

/**
 * The marker's geometry, checked as geometry.
 *
 * **Why a path string is worth a test at all.** Nobody reads a coastline out of a
 * `d`, and nothing below claims the pin *looks* like a pin — the eye does that.
 * What a test can hold is the three properties that make the drawing correct
 * rather than merely present, and every one of them is a property the pennant this
 * replaced did **not** have. The owner is the one who noticed: *« les balises
 * actuelles ne sont pas précises, tu peux utiliser un ping plus pointu ? »*
 *
 * The stylesheet anchors the glyph by subtracting {@link MARK_TIP} from the box's
 * centre, so a tip that drifted off the centre line would hang every marker on
 * this map slightly to one side of the place it names — silently, on a green
 * build, in a way only a reader who knows where Reykjavik is would catch.
 */

const numbersIn = (path: string): readonly number[] =>
  [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));

const [, , VIEWBOX_WIDTH, VIEWBOX_HEIGHT] = MARK_VIEWBOX.split(" ").map(Number) as [
  number,
  number,
  number,
  number,
];

describe("the pin's tip", () => {
  /**
   * **The property the pennant did not have.** Its foot sat at x = 3 of an
   * 18-unit box, so the drawing hung to one side of its own anchor and the
   * stylesheet needed a horizontal correction to compensate. A tip on the centre
   * line needs none, and that absence is the whole of "plus précis".
   */
  it("is on the box's centre line", () => {
    expect(MARK_TIP.x).toBe(VIEWBOX_WIDTH / 2);
  });

  it("is near the bottom of the box, with room for the stroke", () => {
    expect(MARK_TIP.y).toBeLessThan(VIEWBOX_HEIGHT);
    expect(MARK_TIP.y).toBeGreaterThan(VIEWBOX_HEIGHT * 0.9);
  });

  /** The walk starts at the tip and comes back to it: one closed contour. */
  it("is where the path opens and where it closes", () => {
    expect(MARK_PIN_PATH.startsWith(`M${MARK_TIP.x} ${MARK_TIP.y} `)).toBe(true);
    expect(MARK_PIN_PATH.endsWith(`${MARK_TIP.x} ${MARK_TIP.y} Z`)).toBe(true);
  });
});

describe("the pin's outline", () => {
  /**
   * **One closed contour**, which is what `paint-order: stroke` needs: the ring
   * that separates a marker from whatever tint it lands on is stroked before it is
   * filled, so two subpaths would be two outlines and the seam between head and
   * taper would show as a line across the middle of the mark.
   */
  it("is a single subpath", () => {
    expect(MARK_PIN_PATH.match(/M/g) ?? []).toHaveLength(1);
    expect(MARK_PIN_PATH.match(/Z/g) ?? []).toHaveLength(1);
  });

  it("stays inside its own box", () => {
    for (const value of numbersIn(MARK_PIN_PATH)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(VIEWBOX_HEIGHT);
    }
  });

  /**
   * **Symmetric about the centre line**, and this is not a matter of taste either.
   * `src/components/map/marks.ts` records the pennant's real cost: an asymmetric
   * marker always flies to the same side, so two markers a few pixels apart
   * overlap differently depending on which one is on the left. A shape that is its
   * own mirror overlaps the same way whichever order they come in.
   *
   * Asserted by reflecting every x about the centre and finding the same multiset
   * of coordinates, which holds for a mirrored path however its commands are
   * ordered.
   */
  it("is its own mirror about the centre line", () => {
    /* Coordinates come in pairs after the first `M`; the arc's three flags do not
       pair with anything, so they are excluded by name rather than by position. */
    const withoutFlags = MARK_PIN_PATH.replace(/A5\.5 5\.5 0 1 1 /, "A");
    const values = numbersIn(withoutFlags);
    const xs = values.filter((_value, index) => index % 2 === 0).sort((a, b) => a - b);
    const mirrored = xs.map((x) => VIEWBOX_WIDTH - x).sort((a, b) => a - b);

    expect(mirrored).toEqual(xs);
  });
});
