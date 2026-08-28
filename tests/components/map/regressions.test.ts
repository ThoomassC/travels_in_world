import { describe, expect, it } from "vitest";
import { frameAround } from "@/components/map/frame";
import { placeMarks, spreadCoincident } from "@/components/map/marks";
import { CROPPED_FRAME, WORLD, tripMark } from "./fixtures";

/**
 * One case per defect an adversarial pass reproduced on the finished map. They
 * are gathered here rather than spread through the suite because they share a
 * property: **each one was green before.** The map rendered, the build exited 0,
 * and nothing was written to the console — the failure was always a map that
 * looked plausible and was wrong.
 *
 * Two came from a 20 000-configuration sweep of `frameAround`, one from an
 * accessibility audit that measured what the code only assumed.
 */

describe("a world box with no usable area", () => {
  /**
   * Measured before the guard: `{ width: 0, height: 0 }` with one point answered
   * `viewBox="0 NaN 0 NaN"`, and a `NaN` width answered `"NaN NaN NaN NaN"`.
   *
   * The symptom is what makes this worth a throw. A browser does not report an
   * unparseable `viewBox`: it ignores the attribute, falls back to the intrinsic
   * size, and renders an empty map with every marker piled into one corner. No
   * error, no warning, no failing build — the exact shape of failure the whole
   * module is written to avoid.
   */
  it.each([
    { label: "no area at all", world: { width: 0, height: 0 } },
    { label: "no width", world: { width: 0, height: 500 } },
    { label: "no height", world: { width: 960, height: 0 } },
    { label: "a negative box", world: { width: -960, height: -500 } },
  ])("refuses $label rather than answering a NaN viewBox", ({ world }) => {
    expect(() => frameAround([{ x: 10, y: 10 }], world)).toThrow(RangeError);
    expect(() => frameAround([], world)).toThrow(RangeError);
  });

  it.each([
    { label: "a NaN width", world: { width: Number.NaN, height: 500 } },
    { label: "an infinite width", world: { width: Number.POSITIVE_INFINITY, height: 500 } },
    { label: "a NaN height", world: { width: 960, height: Number.NaN } },
  ])("refuses $label, naming the value", ({ world }) => {
    expect(() => frameAround([{ x: 10, y: 10 }], world)).toThrow(TypeError);
  });

  /**
   * The control: the guard must not have made the real world box throw, which is
   * the one way this pair of tests could pass while breaking every page.
   */
  it("accepts the production world box", () => {
    expect(frameAround([], WORLD).viewBox).toBe("0 0 960 500");
  });
});

describe("markers that are close without being identical", () => {
  /**
   * `spreadCoincident` first grouped on the **exact equality** of the two rounded
   * percentages. Percentages carry two decimals, so that means agreeing to
   * 0.01 % — roughly 0.03 world units, four kilometres on a cropped frame.
   *
   * Charles-de-Gaulle and central Paris are further apart than that. They
   * produced different keys, were therefore judged not to overlap, were left
   * alone, and then rendered within a pixel of each other: the marker underneath
   * had a clickable area of zero, for a link the keyboard still reached. Found by
   * an accessibility audit; every existing case used identical points, so none of
   * them could see it.
   */
  it("spreads two markers a few kilometres apart, which exact equality missed", () => {
    const nearby = [
      tripMark({ slug: "paris-2024", point: { x: 800, y: 150 } }),
      tripMark({ slug: "roissy-2023", point: { x: 800.4, y: 150.2 } }),
    ];
    const placed = placeMarks(nearby, CROPPED_FRAME);

    // The control: exact equality really did see two distinct positions here.
    expect(placed[0]?.leftPercent).not.toBe(placed[1]?.leftPercent);
    expect(placed[0]?.topPercent).not.toBe(placed[1]?.topPercent);

    const spread = spreadCoincident(placed, CROPPED_FRAME);

    expect(Math.abs(Number(spread[0]?.topPercent) - Number(spread[1]?.topPercent))).toBeGreaterThan(
      2
    );
  });

  /**
   * `-0` is the reason grouping is done on a string key built from `Math.round`
   * rather than on a numeric pair. A point a hair outside the frame's left edge
   * gives `leftPercent === -0`, and `-0 !== 0` is false but `Object.is(-0, 0)` is
   * too — a `Map` keyed on the number pair would have split the two into separate
   * groups. Template interpolation prints both as `"0"`. Verified, not assumed.
   */
  it("groups a marker at -0 with one at 0", () => {
    const onEdge = tripMark({ slug: "on-edge", point: { x: CROPPED_FRAME.x, y: 150 } });
    const justOutside = tripMark({
      slug: "just-outside",
      point: { x: CROPPED_FRAME.x - 0.0001, y: 150 },
    });
    const placed = placeMarks([onEdge, justOutside], CROPPED_FRAME);

    expect(Object.is(placed[1]?.leftPercent, -0)).toBe(true);

    const spread = spreadCoincident(placed, CROPPED_FRAME);

    expect(spread[0]?.topPercent).not.toBe(spread[1]?.topPercent);
  });
});
