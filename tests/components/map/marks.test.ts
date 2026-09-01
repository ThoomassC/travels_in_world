import { describe, expect, it } from "vitest";
import type { Frame } from "@/components/map/frame";
import { placeMarks } from "@/components/map/marks";
import {
  CROPPED_FRAME,
  EUROPE_EXTENT,
  frameOf,
  manyTripMarks,
  tripMark,
  WORLD_FRAME,
} from "./fixtures";

/**
 * Turning a projected point into the two CSS percentages a marker is positioned
 * with. Three failure modes are worth a suite of their own.
 *
 * A percentage measured against the *world* instead of against the frame is
 * exactly right as long as the frame is the whole world — which is the only frame
 * the journal renders until it has trips — and wrong for every reader afterwards.
 *
 * `NaN` is worse than a wrong number: `left: NaN%` is a declaration the browser
 * discards, so the marker inherits `left: 0` and every faulty trip stacks in the
 * container's top-left corner, all of them pointing at the North Atlantic.
 *
 * And the order of the array is the order of the DOM, which is the order of the
 * tab stops. The content façade sorts by descending `startDate` then ascending
 * slug; a reordering here silently makes the keyboard path disagree with the list
 * of trips printed underneath the map.
 */

describe("placeMarks — the whole world in frame", () => {
  it("places a trip at the centre of the world at 50 % on both axes", () => {
    expect(placeMarks([tripMark({ point: { x: 480, y: 250 } })], WORLD_FRAME)).toEqual([
      { mark: tripMark({ point: { x: 480, y: 250 } }), leftPercent: 50, topPercent: 50 },
    ]);
  });

  it.each([
    { label: "the top-left corner", point: { x: 0, y: 0 }, leftPercent: 0, topPercent: 0 },
    {
      label: "the bottom-right corner",
      point: { x: 960, y: 500 },
      leftPercent: 100,
      topPercent: 100,
    },
    { label: "the top-right corner", point: { x: 960, y: 0 }, leftPercent: 100, topPercent: 0 },
    { label: "the bottom-left corner", point: { x: 0, y: 500 }, leftPercent: 0, topPercent: 100 },
  ])("places a trip on $label at $leftPercent % / $topPercent %", (testCase) => {
    const [placed] = placeMarks([tripMark({ point: testCase.point })], WORLD_FRAME);

    expect(placed?.leftPercent).toBe(testCase.leftPercent);
    expect(placed?.topPercent).toBe(testCase.topPercent);
  });
});

describe("placeMarks — a cropped frame", () => {
  /**
   * The same point, measured against a frame that is not the world. Against the
   * world it would be 83.33 % / 30 %; against its own frame it is dead centre.
   * The gap between the two numbers is 320 px at a 960 px render — the distance
   * from Tokyo to the middle of the Sea of Japan.
   */
  it("measures the percentages against the frame and not against the world", () => {
    const [placed] = placeMarks([tripMark({ point: { x: 800, y: 150 } })], CROPPED_FRAME);

    expect(placed?.leftPercent).toBe(50);
    expect(placed?.topPercent).toBe(50);
  });

  it.each([
    { label: "the frame's own origin", point: { x: 656, y: 75 }, leftPercent: 0, topPercent: 0 },
    {
      label: "the frame's far corner",
      point: { x: 944, y: 225 },
      leftPercent: 100,
      topPercent: 100,
    },
  ])("places a trip on $label at $leftPercent % / $topPercent %", (testCase) => {
    const [placed] = placeMarks([tripMark({ point: testCase.point })], CROPPED_FRAME);

    expect(placed?.leftPercent).toBe(testCase.leftPercent);
    expect(placed?.topPercent).toBe(testCase.topPercent);
  });

  /**
   * 15.2777… rounded to one decimal is 15.3, which is 0.02 % — nearly a fifth of
   * a pixel at a 900 px render — of drift between the marker's tip and the
   * coastline it names. Two decimals is a tenth of that.
   */
  it("keeps two decimals on a percentage that does not divide evenly", () => {
    const [placed] = placeMarks([tripMark({ point: { x: 700, y: 100 } })], CROPPED_FRAME);

    expect(placed?.leftPercent).toBe(15.28);
    expect(placed?.topPercent).toBe(16.67);
  });
});

describe("placeMarks — a trip outside the frame", () => {
  /**
   * Deliberately not dropped. The frame holds every trip it was computed from, so
   * a marker outside it can only come from a frame computed elsewhere — a caller
   * bug — and a percentage outside [0, 100] is the visible symptom: the marker is
   * clipped at the container's edge, where it can be seen and fixed. Silently
   * dropping it would leave a trip in the list with no marker and no explanation.
   */
  it("reports percentages outside 0–100 for a trip left of and above the frame", () => {
    const [placed] = placeMarks([tripMark({ point: { x: 600, y: 50 } })], CROPPED_FRAME);

    expect(placed?.leftPercent).toBe(-19.44);
    expect(placed?.topPercent).toBe(-16.67);
  });

  it("reports percentages outside 0–100 for a trip right of and below the frame", () => {
    const [placed] = placeMarks([tripMark({ point: { x: 1000, y: 300 } })], CROPPED_FRAME);

    expect(placed?.leftPercent).toBe(119.44);
    expect(placed?.topPercent).toBe(150);
  });

  it("keeps an out-of-frame trip in the result rather than dropping it", () => {
    const marks = [
      tripMark({ slug: "inside", point: { x: 800, y: 150 } }),
      tripMark({ slug: "outside", point: { x: 10, y: 480 } }),
    ];

    expect(placeMarks(marks, CROPPED_FRAME).map((placed) => placed.mark.slug)).toEqual([
      "inside",
      "outside",
    ]);
  });
});

describe("placeMarks — a point that could not be projected", () => {
  it.each([
    { label: "a NaN longitude", point: { x: Number.NaN, y: 250 } },
    { label: "a NaN latitude", point: { x: 480, y: Number.NaN } },
    { label: "an infinite longitude", point: { x: Number.POSITIVE_INFINITY, y: 250 } },
    { label: "an infinite latitude", point: { x: 480, y: Number.NEGATIVE_INFINITY } },
  ])("drops a trip with $label", (testCase) => {
    expect(placeMarks([tripMark({ point: testCase.point })], WORLD_FRAME)).toEqual([]);
  });

  /**
   * The mixed case is the one that matters: dropping the bad marker must not
   * disturb the good ones, and must not shift the order of what is left.
   */
  it("drops the unplaceable trips and leaves the others in their original order", () => {
    const marks = [
      tripMark({ slug: "japon-2024", point: { x: 800, y: 150 } }),
      tripMark({ slug: "nulle-part", point: { x: Number.NaN, y: 150 } }),
      tripMark({ slug: "perou-2023", point: { x: 300, y: 320 } }),
      tripMark({ slug: "ailleurs", point: { x: 400, y: Number.POSITIVE_INFINITY } }),
    ];
    const placed = placeMarks(marks, WORLD_FRAME);

    expect(placed.map((entry) => entry.mark.slug)).toEqual(["japon-2024", "perou-2023"]);
    expect(placed.map((entry) => entry.leftPercent)).toEqual([83.33, 31.25]);
    expect(placed.map((entry) => entry.topPercent)).toEqual([30, 64]);
  });
});

describe("placeMarks — a frame with no area", () => {
  /**
   * Unreachable through `frameAround`, which floors the frame at 30 % of the
   * world — but a division by a frame with no area returns `Infinity` or `NaN`,
   * and both render as a heap of markers in the corner rather than as nothing at
   * all. An empty result is the only outcome a reader can interpret.
   */
  it.each([
    { label: "a width of zero", frame: frameOf(0, 0, 0, 500) },
    { label: "a height of zero", frame: frameOf(0, 0, 960, 0) },
    { label: "a negative width", frame: frameOf(0, 0, -960, 500) },
    { label: "a negative height", frame: frameOf(0, 0, 960, -500) },
    { label: "a NaN width", frame: frameOf(0, 0, Number.NaN, 500) },
    { label: "a NaN height", frame: frameOf(0, 0, 960, Number.NaN) },
    { label: "an infinite width", frame: frameOf(0, 0, Number.POSITIVE_INFINITY, 500) },
    { label: "an infinite height", frame: frameOf(0, 0, 960, Number.POSITIVE_INFINITY) },
    {
      label: "a negatively infinite width",
      frame: frameOf(0, 0, Number.NEGATIVE_INFINITY, 500),
    },
  ])("places nothing in a frame with $label", (testCase: { readonly frame: Frame }) => {
    expect(placeMarks([tripMark()], testCase.frame)).toEqual([]);
  });
});

describe("placeMarks — the volumetries the acceptance criterion names", () => {
  it("places nothing for no trip", () => {
    expect(placeMarks([], WORLD_FRAME)).toEqual([]);
  });

  it("places one trip for one trip", () => {
    expect(placeMarks([tripMark()], CROPPED_FRAME)).toHaveLength(1);
  });

  /**
   * 60 trips is the upper volumetry of the criterion. What is asserted is the
   * order, because it is the only property of the array a reader depends on: it
   * is the order in which the keyboard reaches the trips.
   */
  it("places 60 trips in the order they were given", () => {
    const marks = manyTripMarks(60, EUROPE_EXTENT);
    const placed = placeMarks(marks, WORLD_FRAME);

    expect(placed).toHaveLength(60);
    expect(placed.map((entry) => entry.mark.slug)).toEqual(marks.map((mark) => mark.slug));
  });

  it("keeps every one of the 60 percentages inside the frame it was measured in", () => {
    const placed = placeMarks(manyTripMarks(60, EUROPE_EXTENT), WORLD_FRAME);

    expect(placed.filter((entry) => entry.leftPercent < 0 || entry.leftPercent > 100)).toEqual([]);
    expect(placed.filter((entry) => entry.topPercent < 0 || entry.topPercent > 100)).toEqual([]);
  });
});

describe("placeMarks — what it does to the trip it carries", () => {
  /**
   * By reference, not by copy. The component uses `mark.slug` as its React key and
   * the object identity as the memo boundary; a fresh object on every render turns
   * a zoom change into 60 remounts, which loses the focus ring mid-keyboard walk.
   */
  it("carries the very object it was given, without copying it", () => {
    const mark = tripMark();

    expect(placeMarks([mark], WORLD_FRAME)[0]?.mark).toBe(mark);
  });

  it("adds no field to the trip and removes none", () => {
    const placed = placeMarks([tripMark()], WORLD_FRAME);

    expect(Object.keys(placed[0]?.mark ?? {}).sort()).toEqual([
      "href",
      "placeName",
      "point",
      "slug",
      "startDate",
      "title",
    ]);
    expect(Object.keys(placed[0] ?? {}).sort()).toEqual(["leftPercent", "mark", "topPercent"]);
  });
});
