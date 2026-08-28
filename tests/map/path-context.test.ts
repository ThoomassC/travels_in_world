import { describe, expect, it } from "vitest";
import { createRoundingPathContext, roundCoordinate } from "@/map/path-context";

/**
 * The number writer of the map, tested on its own.
 *
 * `src/map/path-context.ts` says its rounding is "testable on its own, without a
 * projection or a dataset in the way", and `src/map/index.ts` says the deep
 * modules stay un-re-exported precisely so "the rounding and the dataset reader
 * [are] testable in isolation". Until this file existed both sentences described
 * an intention: it was the only module of `src/map/**` with no test of its own,
 * and it is the one that writes every digit of the largest thing the page ships
 * — the `d` attributes of 177 countries, 30.1 KB brotli, which `AGENTS.md` caps
 * at 34 KB.
 *
 * **Why the context is driven directly and not through `geoPath`.** Two reasons,
 * and the second is the expensive one. First, this module *is* the unit: d3's
 * `PathContext` (`node_modules/d3-geo/src/path/context.js`) is a 40-line adapter
 * that forwards `moveTo`/`lineTo`/`closePath`/`arc`, so a fixture routed through
 * `geoPath` would be asserting on d3's stream plumbing as much as on the writer
 * below. Second, d3-geo follows the spherical winding convention: a GeoJSON
 * fixture whose exterior ring is wound the wrong way makes d3 draw the
 * *complement* of the polygon — the rest of the sphere — and the resulting path
 * is neither empty nor obviously wrong, it is simply enormous. That trap cost a
 * previous attempt at this file its whole session. The real `geoPath` route is
 * covered where it belongs, on real geometry, by `tests/map/dataset.test.ts` and
 * `tests/map/world.test.ts`.
 */

const TAU = Math.PI * 2;

/** One drawing, read back the way `src/map/dataset.ts` reads it. */
function draw(
  instructions: (context: ReturnType<typeof createRoundingPathContext>) => void
): string {
  const context = createRoundingPathContext();
  instructions(context);

  return context.result();
}

describe("roundCoordinate", () => {
  /**
   * The contract in one row set: one decimal, kept as a *number*. `toFixed(1)`
   * would return a string and keep a trailing zero, so `123` would be written
   * `"123.0"` — two wasted bytes on every whole coordinate, on a payload whose
   * whole reason for being rounded is its weight.
   *
   * The two extremes are the corners of the world in this projection: d3's
   * `geoNaturalEarth1()` defaults place every point inside x ∈ [6.263, 953.737],
   * so those are the real magnitudes this function is asked to shorten.
   */
  it.each([
    { value: 123.456, expected: 123.5 },
    { value: 953.737, expected: 953.7 },
    { value: 8.314, expected: 8.3 },
    { value: 0.44, expected: 0.4 },
    { value: 0, expected: 0 },
    { value: 123, expected: 123 },
  ])("rounds $value to $expected", ({ value, expected }) => {
    expect(roundCoordinate(value)).toBe(expected);
  });

  /**
   * Negative coordinates are not an edge case here, they are half the map: the
   * `arc` endpoints below are negative for any point left of its centre, and a
   * sign dropped or a rounding that walked the wrong way would move a coastline
   * without failing anything.
   */
  it.each([
    { value: -123.456, expected: -123.5 },
    { value: -0.44, expected: -0.4 },
    { value: -953.737, expected: -953.7 },
  ])("rounds $value to $expected", ({ value, expected }) => {
    expect(roundCoordinate(value)).toBe(expected);
  });

  /**
   * The `+ 0` in the implementation, which looks like decoration and is not.
   * `Math.round(-0.04 * 10) / 10` is `-0`, and the source explains at length that
   * `-0` leaks out of a direct assertion on this function while never reaching a
   * path, since `String(-0)` is `"0"`.
   *
   * The `Object.is` lines are therefore belt and braces, not the load-bearing
   * ones — MEASURED, because the received wisdom here is wrong: Vitest's `toBe`
   * *is* `Object.is`-based for zeros too, and `expect(-0).toBe(0)` fails with
   * "expected -0 to be +0". The first line of each row is already a real
   * assertion. The two that follow are kept anyway because they say out loud
   * which zero is meant, and because they would survive a matcher whose
   * behaviour changed underneath them.
   *
   * `-0.05` is in the list for a second reason: `Math.round(-0.5)` is `-0`, so
   * that input reaches the same place from the tie-breaking branch rather than
   * from the truncating one.
   */
  it.each([-0.04, -0.004, -0.05, -0])("answers a positive zero for %o", (value) => {
    expect(roundCoordinate(value)).toBe(0);
    expect(Object.is(roundCoordinate(value), -0)).toBe(false);
    expect(Object.is(roundCoordinate(value), 0)).toBe(true);
  });

  /**
   * A KNOWN ASYMMETRY, DOCUMENTED RATHER THAN TREATED.
   *
   * `Math.round` breaks ties towards `+∞`, not away from zero: `1.25` goes up to
   * `1.3` while `-1.25` goes *towards zero*, to `-1.2`. A negative half therefore
   * lands 0.05 viewBox units from where its positive mirror does.
   *
   * That is half of one rounding step, on a rounding step this project chose on
   * purpose — the paths are already quantised to 0.1 to buy 15 KB brotli — and it
   * only ever applies to a coordinate that falls exactly on a half after the ×10.
   * Correcting it would mean a sign branch on every number of every path for a
   * displacement smaller than the quantisation already accepted. So these rows
   * are a record, not a complaint: they say what the function does today, and a
   * future change to away-from-zero rounding has to come and edit them
   * deliberately rather than slip through.
   */
  it.each([
    { value: 1.25, expected: 1.3 },
    { value: -1.25, expected: -1.2 },
    { value: 1.35, expected: 1.4 },
    { value: -1.35, expected: -1.3 },
    { value: 0.05, expected: 0.1 },
    { value: -0.05, expected: 0 },
  ])("breaks the tie at $value towards +infinity, giving $expected", ({ value, expected }) => {
    expect(roundCoordinate(value)).toBe(expected);
  });

  /**
   * Deliberately unguarded, and worth pinning as such. The finiteness check lives
   * one layer up, in `projectPoint`, which returns `null` rather than let a `NaN`
   * reach a path — an attribute the browser silently ignores, i.e. an invisible
   * marker with nothing logged. Adding a clamp *here* would move that decision
   * into a function whose callers cannot see it, so this row makes the split
   * explicit instead of leaving it to be re-litigated.
   */
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "passes %o through untouched, because the guard belongs to projectPoint",
    (value) => {
      expect(roundCoordinate(value)).toBe(value);
    }
  );
});

describe("the path a context accumulates", () => {
  it("writes the SVG commands with rounded coordinates", () => {
    const path = draw((context) => {
      context.moveTo(1.04, 2.06);
      context.lineTo(3.14159, 9.95);
      context.closePath();
    });

    expect(path).toBe("M1,2.1L3.1,10Z");
  });

  /**
   * The `-0` case again, one level up, where it would actually be visible: a
   * coordinate rounding to negative zero must not put a `-` in the `d`
   * attribute. `String(-0)` happens to be `"0"`, so this row would survive the
   * `+ 0` being deleted — measured, it does. It is here to state the requirement
   * at the level a reader cares about, the attribute; the rows above are the ones
   * that go red when the mechanism goes.
   */
  it("never writes a minus sign for a coordinate that rounds to zero", () => {
    const path = draw((context) => {
      context.moveTo(-0.04, -0.004);
      context.lineTo(-0.05, 1);
    });

    expect(path).toBe("M0,0L0,1");
    expect(path).not.toContain("-");
  });

  /**
   * Several sub-paths in one drawing, which is not an exotic case: 63 of the 177
   * countries are `MultiPolygon`, and d3 renders each ring by calling `moveTo`
   * again on the same context. The accumulation *is* the feature, which is why
   * the reset cannot live in `moveTo` or in `beginPath` — see below.
   */
  it("accumulates the sub-paths of one drawing, the way a MultiPolygon needs", () => {
    const path = draw((context) => {
      context.moveTo(0, 0);
      context.lineTo(1, 1);
      context.closePath();
      context.moveTo(5, 5);
      context.lineTo(6, 6);
      context.closePath();
    });

    expect(path).toBe("M0,0L1,1ZM5,5L6,6Z");
  });
});

/**
 * THE RESET SEMANTICS, WHICH LIVE IN `result()` AND NOT IN `beginPath()`.
 *
 * Counter-intuitive, and verified in d3 rather than assumed:
 * `node_modules/d3-geo/src/path/context.js` calls `moveTo`, `lineTo`, `closePath`
 * and `arc` — and `beginPath` **nowhere**, in the whole package. Its own `result`
 * is `noop`, because a canvas context has nothing to hand back.
 *
 * So the buffer of this module is cleared by the one method d3 does not care
 * about, and `src/map/dataset.ts` depends on that: it creates **one** context and
 * reuses it for all 177 countries, calling `buildPath(feature)` then
 * `context.result()` each time round the loop. Every case below is that loop,
 * driven by hand.
 */
describe("the reset semantics of result()", () => {
  /**
   * The production loop, twice round. If `result()` stopped clearing, country
   * number two would be drawn with country number one's outline welded in front
   * of it: a valid `d` attribute, a wrong map, and nothing to notice it — the
   * failure mode this whole file exists for.
   */
  it("hands back one drawing and clears the buffer for the next", () => {
    const context = createRoundingPathContext();

    context.moveTo(0, 0);
    context.lineTo(1, 1);
    const first = context.result();

    context.moveTo(5, 5);
    context.lineTo(6, 6);
    const second = context.result();

    expect(first).toBe("M0,0L1,1");
    expect(second).toBe("M5,5L6,6");
  });

  /**
   * What the leak looks like when it happens, pinned deliberately. This is the
   * shape of `dataset.ts` skipping its `context.result()` — an early `continue`
   * added to the loop, say — and it is *not* an error condition the context can
   * detect: concatenation is the same behaviour a `MultiPolygon` relies on. The
   * row is here so the cost of forgetting is written down rather than discovered
   * on a map where one country wears another's coastline.
   */
  it("concatenates two drawings when result() is not called between them", () => {
    const context = createRoundingPathContext();

    context.moveTo(0, 0);
    context.lineTo(1, 1);
    context.moveTo(5, 5);
    context.lineTo(6, 6);

    expect(context.result()).toBe("M0,0L1,1M5,5L6,6");
  });

  /**
   * Called twice in a row, the second answer must be empty rather than a repeat.
   * A `result()` that returned the buffer without clearing it would pass the
   * first case above and fail here, which is exactly the split this row buys.
   */
  it("answers an empty string on a second consecutive call", () => {
    const context = createRoundingPathContext();

    context.moveTo(1, 1);

    expect(context.result()).toBe("M1,1");
    expect(context.result()).toBe("");
  });

  /**
   * A fresh context, read before anything is drawn. `dataset.ts` treats `""` as
   * "this geometry produced no path" and throws on it, so an empty buffer has to
   * answer `""` and not `undefined` — the difference between a build that stops
   * and a country silently missing from the map.
   */
  it("answers an empty string before anything is drawn", () => {
    expect(createRoundingPathContext().result()).toBe("");
  });

  /**
   * `beginPath` is dead code as far as d3 is concerned — grepping the whole of
   * `d3-geo` for it returns nothing — and the implementation keeps it honest
   * anyway, "for a caller that does drive it". That claim had no test; this is
   * it. A `beginPath` left as a no-op would make this context quietly unusable
   * for any caller that follows the canvas contract.
   */
  it("discards what was drawn before beginPath, for a caller that does drive it", () => {
    const path = draw((context) => {
      context.moveTo(9, 9);
      context.lineTo(8, 8);
      context.beginPath();
      context.moveTo(1, 1);
    });

    expect(path).toBe("M1,1");
  });
});

/**
 * `arc()`, THE BRANCH NOTHING IN THIS REPOSITORY EXECUTES.
 *
 * d3 reaches `arc` from exactly one place: `PathContext.point`, third case,
 * which draws a `Point`/`MultiPoint` as a circle of `pointRadius` — and it always
 * emits `moveTo(x + radius, y)` first (read in
 * `node_modules/d3-geo/src/path/context.js`). The world-atlas 110m vintage holds
 * `Polygon` and `MultiPolygon` only, so no build has ever run a line of it.
 *
 * It stays implemented rather than becoming a `throw`, because a `throw` would be
 * a mine for the day a `Point` geometry does turn up — TIW-13 lays trip markers
 * over this map. Sixty lines of flag arithmetic with no caller and no test is the
 * other way to lose it, so this block is the caller.
 *
 * **Why the output looks truncated.** These strings start with `A`, and an SVG
 * `d` attribute may not: the grammar requires a moveto first. That is correct
 * here — d3 puts the `M` in front, and the composition test below is the one that
 * shows the whole, valid attribute. Read in isolation, an `A…` result is not a
 * bug report.
 *
 * The semantics are canvas', not SVG's: the sweep runs from `startAngle` towards
 * `endAngle` in the requested direction, a delta of a full turn or more is a
 * whole circle, and the direction — not the angles — decides which way round.
 */
describe("arc()", () => {
  /**
   * A full turn, which no single SVG `A` command can express: start and end
   * points coincide and the arc degenerates to nothing drawn. Hence two
   * half-turns, each flagged large-arc.
   */
  it("splits a full turn into two half-turn arcs", () => {
    expect(draw((context) => context.arc(0, 0, 5, 0, TAU))).toBe("A5,5 0 1,1 -5,0A5,5 0 1,1 5,0");
  });

  /**
   * The whole thing as d3 actually drives it — `moveTo(x + radius, y)` then
   * `arc(x, y, radius, 0, tau)` with d3's default `pointRadius` of 4.5 — which is
   * the only form that ever reaches an attribute. This is where the `M` comes
   * from, and the reason the rows around it are allowed to look headless.
   */
  it("produces a complete, valid attribute once d3's moveTo is in front", () => {
    const path = draw((context) => {
      context.moveTo(10 + 4.5, 20);
      context.arc(10, 20, 4.5, 0, TAU);
    });

    expect(path).toBe("M14.5,20A4.5,4.5 0 1,1 5.5,20A4.5,4.5 0 1,1 14.5,20");
    expect(path.startsWith("M")).toBe(true);
  });

  /**
   * The flag arithmetic, one row per decision it can make. The large-arc flag is
   * `|delta| > π` and the sweep flag is the sign of `delta` *after* normalisation
   * — which is what makes the third and fourth rows interesting: they are the
   * same pair of angles as the first and second, requested the other way round,
   * and the normalisation turns "a quarter anticlockwise" into three quarters of
   * a turn. Reading the flags off the angles instead of off the normalised delta
   * gives the mirror image of the intended arc, silently.
   *
   * The exactly-half row pins the boundary: `>` and not `>=`, so π itself carries
   * large-arc 0. Both flags describe the same semicircle there, which is why it
   * is a documented choice rather than a defect.
   */
  it.each([
    {
      label: "a quarter clockwise",
      end: Math.PI / 2,
      anticlockwise: false,
      expected: "A5,5 0 0,1 0,5",
    },
    {
      label: "three quarters clockwise",
      end: Math.PI * 1.5,
      anticlockwise: false,
      expected: "A5,5 0 1,1 0,-5",
    },
    {
      label: "the same quarter anticlockwise",
      end: Math.PI / 2,
      anticlockwise: true,
      expected: "A5,5 0 1,0 0,5",
    },
    {
      label: "a quarter given as a negative angle, clockwise",
      end: -Math.PI / 2,
      anticlockwise: false,
      expected: "A5,5 0 1,1 0,-5",
    },
    {
      label: "a quarter given as a negative angle, anticlockwise",
      end: -Math.PI / 2,
      anticlockwise: true,
      expected: "A5,5 0 0,0 0,-5",
    },
    {
      label: "exactly half a turn clockwise",
      end: Math.PI,
      anticlockwise: false,
      expected: "A5,5 0 0,1 -5,0",
    },
  ])("draws $label as $expected", ({ end, anticlockwise, expected }) => {
    expect(draw((context) => context.arc(0, 0, 5, 0, end, anticlockwise))).toBe(expected);
  });

  /**
   * A sweep of more than a turn is a turn — canvas clamps, it does not wind twice
   * — and the clamp has to survive both signs and both directions. Without it the
   * `delta / 2` split would place the intermediate point somewhere arbitrary and
   * the circle would come out as a wedge.
   */
  it.each([
    {
      label: "four turns clockwise",
      end: TAU * 2,
      anticlockwise: false,
      expected: "A5,5 0 1,1 -5,0A5,5 0 1,1 5,0",
    },
    {
      label: "four turns given negatively, clockwise",
      end: -TAU * 2,
      anticlockwise: false,
      expected: "A5,5 0 1,1 -5,0A5,5 0 1,1 5,0",
    },
    {
      label: "a turn anticlockwise",
      end: TAU,
      anticlockwise: true,
      expected: "A5,5 0 1,0 -5,0A5,5 0 1,0 5,0",
    },
  ])("clamps $label to a single circle", ({ end, anticlockwise, expected }) => {
    expect(draw((context) => context.arc(0, 0, 5, 0, end, anticlockwise))).toBe(expected);
  });

  /**
   * Start angle and end angle equal: the arc has nowhere to go. It writes a
   * degenerate `A` back to its own start point, which paints nothing — the same
   * outcome a canvas gives for a zero sweep. Pinned because the alternative, an
   * accidental clamp to a full circle, would put a stray disc on the map.
   */
  it("writes a degenerate arc, painting nothing, when the two angles are equal", () => {
    expect(draw((context) => context.arc(0, 0, 5, 0, 0))).toBe("A5,5 0 0,0 5,0");
  });

  /**
   * The radius and the computed endpoint go through the same rounding as every
   * other number in a path — they are not exempt for being generated rather than
   * projected. The endpoint is computed from the *unrounded* radius and rounded
   * afterwards, which is the order that keeps a circle a circle.
   */
  it("rounds the radius and the endpoint it computes", () => {
    expect(draw((context) => context.arc(0, 0, 4.567, 0, Math.PI / 2))).toBe(
      "A4.6,4.6 0 0,1 0,4.6"
    );
  });

  /**
   * An arc away from the origin, with the centre added back into both
   * coordinates. A centre dropped from one of the two — the classic slip in this
   * arithmetic — leaves the first case passing, since its centre is `0,0`.
   */
  it("offsets the arc by its centre", () => {
    expect(draw((context) => context.arc(10, 20, 4.5, 0, Math.PI, true))).toBe(
      "A4.5,4.5 0 0,0 5.5,20"
    );
  });

  /**
   * `arc` shares the buffer with the rest of the drawing rather than replacing
   * it, and `result()` clears it the same way. A `Point` and a `Polygon` in one
   * `FeatureCollection` go through one context, in one d3 stream.
   */
  it("appends to the buffer and is cleared by result() like anything else", () => {
    const context = createRoundingPathContext();

    context.moveTo(0, 0);
    context.arc(0, 0, 5, 0, Math.PI);

    expect(context.result()).toBe("M0,0A5,5 0 0,1 -5,0");
    expect(context.result()).toBe("");
  });
});
