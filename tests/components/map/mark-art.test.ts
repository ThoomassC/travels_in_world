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

/**
 * An arc command carries three flags between its radii and its endpoint, and they
 * pair with nothing. Dropping the whole prefix leaves a stream of coordinate pairs,
 * which is what lets the cases below read x at the even indices.
 */
const withoutArcFlags = (path: string): string =>
  path.replace(/A[\d.]+ [\d.]+ \d+ \d+ \d+ /g, "");

const [, , VIEWBOX_WIDTH, VIEWBOX_HEIGHT] = MARK_VIEWBOX.split(" ").map(Number) as [
  number,
  number,
  number,
  number,
];

describe("the pin's point", () => {
  /**
   * **The property the pennant did not have.** Its foot sat at x = 3 of an
   * 18-unit box, so the drawing hung to one side of its own anchor and the
   * stylesheet needed a horizontal correction to compensate. A point on the centre
   * line needs none, and that absence is the whole of "plus précis".
   */
  it("is on the box's centre line", () => {
    expect(MARK_TIP.x).toBe(VIEWBOX_WIDTH / 2);
  });

  it("is the lowest thing in the drawing, with room for the stroke", () => {
    const ys = numbersIn(withoutArcFlags(MARK_PIN_PATH)).filter(
      (_value, index) => index % 2 === 1
    );

    expect(Math.max(...ys)).toBe(MARK_TIP.y);
    expect(MARK_TIP.y).toBeLessThan(VIEWBOX_HEIGHT);
  });

  /** The walk starts there, which is what makes the two flanks its two tangents. */
  it("is where the path opens", () => {
    expect(MARK_PIN_PATH.startsWith(`M${MARK_TIP.x} ${MARK_TIP.y} `)).toBe(true);
  });
});

describe("the pin's eyelet", () => {
  /**
   * **Two subpaths, and this one is meant to be outlined** — which is a departure
   * from the two shapes before it, both of which were a single contour precisely
   * so that `paint-order: stroke` would not draw a seam across them. Here the ring
   * around the hole is the feature: filled solid, a teardrop at this size is a blob
   * whose only detail is its silhouette.
   */
  it("is a second contour, so the winding rule can make it a hole", () => {
    expect(MARK_PIN_PATH.match(/M/g) ?? []).toHaveLength(2);
    expect(MARK_PIN_PATH.match(/Z/g) ?? []).toHaveLength(2);
  });

  /**
   * And it sits inside the head rather than straddling its edge — the failure a
   * radius or a centre nudged by hand would produce, and one that renders as a
   * bite taken out of the pin rather than as a hole in it.
   */
  it("sits wholly inside the head", () => {
    const [, eyelet] = MARK_PIN_PATH.split("M").filter(Boolean);
    const radii = [...(eyelet ?? "").matchAll(/A([\d.]+) /g)].map((match) => Number(match[1]));
    const head = Number(
      [...MARK_PIN_PATH.matchAll(/A([\d.]+) /g)].map((match) => match[1])[0] ?? 0
    );

    expect(radii.length).toBeGreaterThan(0);
    for (const radius of radii) {
      expect(radius).toBeLessThan(head);
      // Two fifths of the head: larger and the pin is a ring on a stalk, smaller
      // and it fills in at the size this renders.
      expect(radius / head).toBeLessThan(0.5);
      expect(radius / head).toBeGreaterThan(0.25);
    }
  });
});

describe("the pin's outline", () => {
  it("stays inside its own box", () => {
    for (const value of numbersIn(withoutArcFlags(MARK_PIN_PATH))) {
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
   * Asserted on the **set of points**, not on a list of x values: every point the
   * path names must have its mirror in the path too. A multiset would fail on a
   * correct drawing — a closed subpath writes its first point twice, so the eyelet
   * lists 10.4 on both sides of 5.6 — and a bare list of x values would pass on a
   * wrong one, since it never checks that the mirrored x kept the same y.
   */
  it("is its own mirror about the centre line", () => {
    // A thousandth of a unit: `16 - 10.4` is 5.600000000000001 in binary floating
    // point, and a marker is not asymmetric by 10^-15 of a pixel.
    const round = (value: number): number => Number(value.toFixed(3));
    const values = numbersIn(withoutArcFlags(MARK_PIN_PATH));

    const points = new Set<string>();
    for (let index = 0; index + 1 < values.length; index += 2) {
      points.add(`${round(values[index] as number)},${round(values[index + 1] as number)}`);
    }

    expect(points.size).toBeGreaterThan(3);
    for (const point of points) {
      const [x, y] = point.split(",").map(Number) as [number, number];
      expect(points, `no mirror for ${point}`).toContain(
        `${round(VIEWBOX_WIDTH - x)},${round(y)}`
      );
    }
  });
});
