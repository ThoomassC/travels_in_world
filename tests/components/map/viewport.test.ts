import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX,
  MAX_ZOOM_WIDTH_FRACTION,
  TRIP_PARAM,
  VIEW_PARAM,
  ZOOM_STEP,
  boundsOf,
  clampViewport,
  exceedsDragThreshold,
  panViewport,
  pinchFactor,
  readMapState,
  serialiseViewport,
  writeMapState,
  zoomViewport,
  type Viewport,
} from "@/components/map/viewport";
import { frameAround } from "@/components/map/frame";

/**
 * The arithmetic of zoom, pan and URL state — the whole of what TIW-14 adds that
 * is worth a hundred cases rather than a browser.
 *
 * Separated from the client component for the reason `frame.ts` and `marks.ts`
 * are separated from `world-map.tsx`: the degenerate cases here decide whether
 * the map disappears (a `viewBox` of `NaN`), whether a reader can zoom past the
 * point of legibility, and whether a hand-edited URL can put the map in a state
 * no button can leave. None of that needs a DOM, and every one of them needs
 * more than one case.
 */

const WORLD = { width: 960, height: 500 };

/**
 * The bounds a real page produces: the frame `frameAround` hands the component,
 * whose aspect ratio the container is locked to. **Not the world's aspect** —
 * `frameAround` rounds width and height outwards independently, so the two
 * differ by up to 0.1 unit, and using the world's would drift every marker off
 * the country it names. That is the bug `boundsOf` exists to make impossible.
 */
const CROPPED = frameAround(
  [
    { x: 300, y: 120 },
    { x: 700, y: 300 },
  ],
  WORLD
);
const BOUNDS = boundsOf(CROPPED, WORLD);

/** The whole world, which is what an empty journal frames. */
const WORLD_BOUNDS = boundsOf(frameAround([], WORLD), WORLD);

const view = (x: number, y: number, width: number, height: number): Viewport => ({
  x,
  y,
  width,
  height,
});

/** Every viewport this module hands back must be renderable and inside the world. */
function expectInsideTheWorld(result: Viewport, aspect: number): void {
  for (const value of [result.x, result.y, result.width, result.height]) {
    expect(Number.isFinite(value)).toBe(true);
  }
  expect(result.width).toBeGreaterThan(0);
  expect(result.height).toBeGreaterThan(0);
  expect(result.x).toBeGreaterThanOrEqual(0);
  expect(result.y).toBeGreaterThanOrEqual(0);
  expect(result.x + result.width).toBeLessThanOrEqual(WORLD.width + 1e-9);
  expect(result.y + result.height).toBeLessThanOrEqual(WORLD.height + 1e-9);
  // The one invariant the container's locked `aspect-ratio` depends on.
  expect(result.width / result.height).toBeCloseTo(aspect, 9);
}

describe("boundsOf", () => {
  it("takes its aspect ratio from the frame, never from the world", () => {
    expect(BOUNDS.aspect).toBe(CROPPED.width / CROPPED.height);
  });

  it("and the frame's ratio really can differ from the world's", () => {
    /**
     * The assertion that makes the one above worth writing. `frameAround` rounds
     * width and height **outwards and independently**, so a frame is only exactly
     * 1.92 by arithmetic luck — the two cases where it is are the width floor
     * (288 / 150) and the branch that derives the width from the height. This
     * extent takes the other branch: measured, `viewBox="10 96.9 780 406.3"`,
     * whose ratio is 1.919764…
     *
     * A zoom that preserved the world's 1.92 from that frame would put the
     * `viewBox` and the container's locked `aspect-ratio` out of step, and
     * `preserveAspectRatio` would letterbox the drawing — sliding every marker,
     * positioned in percentages of the box, off the country it names.
     */
    const wide = frameAround(
      [
        { x: 100, y: 200 },
        { x: 700, y: 300 },
      ],
      WORLD
    );

    expect(wide.width / wide.height).not.toBe(WORLD.width / WORLD.height);
    expect(boundsOf(wide, WORLD).aspect).toBe(wide.width / wide.height);
  });

  it("floors the zoom at a legible fraction of the world", () => {
    expect(BOUNDS.minWidth).toBeCloseTo(WORLD.width * MAX_ZOOM_WIDTH_FRACTION, 9);
  });

  it("refuses a world with no area rather than answering NaN", () => {
    // Same posture as `frameAround`: a coordinate space with no area has no
    // partial result to salvage, and `viewBox="NaN NaN NaN NaN"` is a map that
    // vanishes without a word in the console.
    expect(() => boundsOf(CROPPED, { width: 0, height: 500 })).toThrow(RangeError);
    expect(() => boundsOf(CROPPED, { width: Number.NaN, height: 500 })).toThrow(TypeError);
  });

  it("refuses a frame with no area, which would make every aspect ratio NaN", () => {
    expect(() => boundsOf({ ...CROPPED, height: 0 }, WORLD)).toThrow(RangeError);
  });
});

describe("clampViewport", () => {
  it("leaves a viewport that is already inside the world untouched", () => {
    const result = clampViewport(view(300, 100, 400, 400 / BOUNDS.aspect), BOUNDS);

    expect(result.x).toBe(300);
    expect(result.y).toBe(100);
    expect(result.width).toBe(400);
    expectInsideTheWorld(result, BOUNDS.aspect);
  });

  it("derives the height from the width, so the container's locked ratio always holds", () => {
    // The height in is a lie; the height out is the only one the SVG may carry.
    const result = clampViewport(view(0, 0, 480, 999), BOUNDS);

    expect(result.height).toBeCloseTo(480 / BOUNDS.aspect, 9);
  });

  it("caps the zoom out at the world, never past its own edge", () => {
    const result = clampViewport(view(0, 0, 5000, 5000), BOUNDS);

    expect(result.width).toBeLessThanOrEqual(WORLD.width);
    expectInsideTheWorld(result, BOUNDS.aspect);
  });

  it("caps the zoom out by the world's HEIGHT too when the frame is taller than the world", () => {
    /**
     * The case a width-only cap gets wrong. A frame whose aspect is narrower
     * than the world's reaches the world's height before its width, and a
     * `width <= world.width` cap alone then answers a frame hanging below the
     * bottom edge — grey space under the map, or a marker pushed off it.
     */
    const tall = boundsOf({ viewBox: "", x: 0, y: 0, width: 200, height: 400 }, WORLD);
    const result = clampViewport(view(0, 0, 960, 960 / tall.aspect), tall);

    expect(result.height).toBeLessThanOrEqual(WORLD.height);
    expectInsideTheWorld(result, tall.aspect);
  });

  it("floors the zoom in, so no reader can reach a flat wash of one country", () => {
    const result = clampViewport(view(400, 200, 0.001, 0.001), BOUNDS);

    expect(result.width).toBeCloseTo(BOUNDS.minWidth, 9);
    expectInsideTheWorld(result, BOUNDS.aspect);
  });

  it("slides a frame that hangs off an edge back inside instead of showing void", () => {
    const result = clampViewport(view(900, 480, 400, 400 / BOUNDS.aspect), BOUNDS);

    expect(result.x + result.width).toBeCloseTo(WORLD.width, 9);
    expectInsideTheWorld(result, BOUNDS.aspect);
  });

  it("answers a renderable viewport for every non-finite input", () => {
    /**
     * Unreachable through a button, reachable through a hand-typed URL and
     * through a pointer event a browser reported oddly. A single `NaN` reaching
     * the `viewBox` blanks the drawing with nothing in the console, which is the
     * failure this whole module is shaped to refuse.
     */
    for (const broken of [
      view(Number.NaN, 0, 400, 200),
      view(0, Number.NaN, 400, 200),
      view(0, 0, Number.NaN, 200),
      view(0, 0, Number.POSITIVE_INFINITY, 200),
      view(0, 0, -400, 200),
      view(0, 0, 0, 200),
    ]) {
      expectInsideTheWorld(clampViewport(broken, BOUNDS), BOUNDS.aspect);
    }
  });
});

describe("zoomViewport", () => {
  it("shrinks the frame by the step on the way in and grows it on the way out", () => {
    const start = clampViewport(view(200, 100, 480, 0), BOUNDS);
    const zoomedIn = zoomViewport(start, ZOOM_STEP, { x: 0.5, y: 0.5 }, BOUNDS);
    const zoomedOut = zoomViewport(start, 1 / ZOOM_STEP, { x: 0.5, y: 0.5 }, BOUNDS);

    expect(zoomedIn.width).toBeCloseTo(480 / ZOOM_STEP, 9);
    expect(zoomedOut.width).toBeCloseTo(480 * ZOOM_STEP, 9);
  });

  it("keeps the centre still when the anchor is the centre", () => {
    const start = clampViewport(view(200, 100, 480, 0), BOUNDS);
    const result = zoomViewport(start, ZOOM_STEP, { x: 0.5, y: 0.5 }, BOUNDS);

    expect(result.x + result.width / 2).toBeCloseTo(start.x + start.width / 2, 6);
    expect(result.y + result.height / 2).toBeCloseTo(start.y + start.height / 2, 6);
  });

  it("keeps the point under the pointer still, which is what makes wheel zoom usable", () => {
    /**
     * The property that separates "zoom towards the pointer" from "zoom to the
     * centre and let the reader chase the map". Asserted as the world point the
     * anchor fraction resolves to, before and after.
     */
    const start = clampViewport(view(200, 100, 480, 0), BOUNDS);
    const anchor = { x: 0.25, y: 0.8 };
    const before = {
      x: start.x + anchor.x * start.width,
      y: start.y + anchor.y * start.height,
    };
    const result = zoomViewport(start, ZOOM_STEP, anchor, BOUNDS);

    expect(result.x + anchor.x * result.width).toBeCloseTo(before.x, 6);
    expect(result.y + anchor.y * result.height).toBeCloseTo(before.y, 6);
  });

  it("stops at the zoom-in floor however many times it is pressed", () => {
    let current = clampViewport(view(0, 0, 960, 0), BOUNDS);
    for (let press = 0; press < 40; press += 1) {
      current = zoomViewport(current, ZOOM_STEP, { x: 0.5, y: 0.5 }, BOUNDS);
      expectInsideTheWorld(current, BOUNDS.aspect);
    }

    expect(current.width).toBeCloseTo(BOUNDS.minWidth, 9);
  });

  it("stops at the world however many times it is pressed", () => {
    let current = clampViewport(view(400, 200, BOUNDS.minWidth, 0), BOUNDS);
    for (let press = 0; press < 40; press += 1) {
      current = zoomViewport(current, 1 / ZOOM_STEP, { x: 0.5, y: 0.5 }, BOUNDS);
      expectInsideTheWorld(current, BOUNDS.aspect);
    }

    expect(current.width).toBeCloseTo(Math.min(WORLD.width, WORLD.height * BOUNDS.aspect), 6);
  });

  it("treats a nonsense factor as no zoom rather than as a blank map", () => {
    const start = clampViewport(view(200, 100, 480, 0), BOUNDS);

    for (const factor of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = zoomViewport(start, factor, { x: 0.5, y: 0.5 }, BOUNDS);
      expectInsideTheWorld(result, BOUNDS.aspect);
    }
    expect(zoomViewport(start, Number.NaN, { x: 0.5, y: 0.5 }, BOUNDS).width).toBeCloseTo(480, 9);
  });

  it("clamps an anchor outside the frame instead of flinging the frame away", () => {
    const start = clampViewport(view(200, 100, 480, 0), BOUNDS);

    for (const anchor of [
      { x: -5, y: 0.5 },
      { x: 12, y: 0.5 },
      { x: 0.5, y: Number.NaN },
    ]) {
      expectInsideTheWorld(zoomViewport(start, ZOOM_STEP, anchor, BOUNDS), BOUNDS.aspect);
    }
  });

  it("still answers the world when the world itself is the frame", () => {
    // The production state today: `content/trips` is empty, so the frame is the
    // whole world and zooming out has nowhere to go.
    const start = clampViewport(view(0, 0, WORLD.width, 0), WORLD_BOUNDS);
    const result = zoomViewport(start, 1 / ZOOM_STEP, { x: 0.5, y: 0.5 }, WORLD_BOUNDS);

    expect(result.width).toBeCloseTo(WORLD.width, 6);
    expect(result.x).toBe(0);
  });
});

describe("panViewport", () => {
  it("moves the frame against the pointer, so the map follows the hand", () => {
    // Dragging right (positive dx) must reveal what is to the LEFT: the window
    // slides left over the world. The opposite sign is the single most common
    // bug of a pan implementation and it is invisible to a type checker.
    const start = clampViewport(view(300, 150, 400, 0), BOUNDS);
    const result = panViewport(start, { x: 0.25, y: 0 }, BOUNDS);

    expect(result.x).toBeCloseTo(300 - 0.25 * 400, 9);
  });

  it("moves by a fraction of the frame, so the same drag pans less when zoomed in", () => {
    const wide = clampViewport(view(300, 150, 800, 0), BOUNDS);
    const tight = clampViewport(view(300, 150, 200, 0), BOUNDS);

    const wideShift = wide.x - panViewport(wide, { x: 0.1, y: 0 }, BOUNDS).x;
    const tightShift = tight.x - panViewport(tight, { x: 0.1, y: 0 }, BOUNDS).x;

    expect(wideShift).toBeGreaterThan(tightShift);
  });

  it("cannot be dragged off the world", () => {
    const start = clampViewport(view(0, 0, 400, 0), BOUNDS);

    for (const pointer of [
      { x: 50, y: 50 },
      { x: -50, y: -50 },
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY },
    ]) {
      expectInsideTheWorld(panViewport(start, pointer, BOUNDS), BOUNDS.aspect);
    }
  });

  it("keeps the width, so a pan is never a zoom", () => {
    const start = clampViewport(view(300, 150, 400, 0), BOUNDS);

    expect(panViewport(start, { x: 0.3, y: -0.2 }, BOUNDS).width).toBeCloseTo(start.width, 9);
  });
});

describe("pinchFactor", () => {
  it("is the ratio of the two finger distances", () => {
    expect(pinchFactor(100, 200)).toBeCloseTo(2, 9);
    expect(pinchFactor(200, 100)).toBeCloseTo(0.5, 9);
  });

  it("answers 1 for every distance a browser cannot have measured", () => {
    // Two fingers on the same pixel is a real event, and `to / 0` is `Infinity`:
    // one frame of that and the map is at its zoom floor with no way back.
    for (const [from, to] of [
      [0, 100],
      [100, 0],
      [Number.NaN, 100],
      [100, Number.NaN],
      [-10, 100],
    ] as const) {
      expect(pinchFactor(from, to)).toBe(1);
    }
  });
});

describe("exceedsDragThreshold", () => {
  it("calls a still pointer a tap", () => {
    expect(exceedsDragThreshold(0, 0)).toBe(false);
    expect(exceedsDragThreshold(3, 3)).toBe(false);
  });

  it("calls a real drag a drag, in every direction", () => {
    for (const [dx, dy] of [
      [DRAG_THRESHOLD_PX + 1, 0],
      [0, DRAG_THRESHOLD_PX + 1],
      [-DRAG_THRESHOLD_PX - 1, 0],
      [0, -DRAG_THRESHOLD_PX - 1],
    ] as const) {
      expect(exceedsDragThreshold(dx, dy)).toBe(true);
    }
  });

  it("measures the diagonal and not each axis, so a slanted drag is one drag", () => {
    // 6 px each way is 8.49 px of travel: a drag, though neither axis passes 8.
    expect(exceedsDragThreshold(6, 6)).toBe(true);
    expect(exceedsDragThreshold(6, 0)).toBe(false);
  });

  it("treats a delta it cannot measure as a tap, so the link still works", () => {
    // The safe direction: a suppressed activation is a marker that answers
    // nothing, which is worse than a panel opening after a tiny drag.
    expect(exceedsDragThreshold(Number.NaN, Number.NaN)).toBe(false);
  });
});

describe("the map state in the URL", () => {
  const state = (view: Viewport | null, trip: string | null) => ({ view, trip });

  it("round-trips a viewport through the query string", () => {
    const start = clampViewport(view(177.3, 12.5, 480, 0), BOUNDS);
    const search = writeMapState("", state(start, null));
    const read = readMapState(search, BOUNDS);

    expect(read.view).not.toBeNull();
    expect(read.view?.x).toBeCloseTo(start.x, 1);
    expect(read.view?.y).toBeCloseTo(start.y, 1);
    expect(read.view?.width).toBeCloseTo(start.width, 1);
  });

  it("writes three numbers and a slug, and nothing else", () => {
    const start = clampViewport(view(200, 100, 480, 0), BOUNDS);
    const search = writeMapState("", state(start, "japon-2024"));

    expect(search.startsWith("?")).toBe(true);
    const params = new URLSearchParams(search);
    expect(params.get(VIEW_PARAM)?.split(",")).toHaveLength(3);
    expect(params.get(TRIP_PARAM)).toBe("japon-2024");
    expect([...params.keys()].sort()).toEqual([VIEW_PARAM, TRIP_PARAM].sort());
  });

  it("drops each parameter when its half of the state is absent", () => {
    expect(writeMapState("", state(null, null))).toBe("");
    expect(writeMapState("?voyage=japon-2024", state(null, null))).toBe("");
    expect(
      new URLSearchParams(writeMapState("", state(null, "islande-2022"))).get(VIEW_PARAM)
    ).toBe(null);
  });

  it("leaves a parameter it does not own alone", () => {
    // The map is not the only thing that may ever put something in this URL.
    const search = writeMapState("?utm_source=lettre", state(null, "japon-2024"));

    expect(new URLSearchParams(search).get("utm_source")).toBe("lettre");
  });

  it("omits the viewport when it is the frame the server already rendered", () => {
    /**
     * The URL must stay clean until the reader actually moves the map: a `?carte=`
     * appearing on a first hover, or on a panel opening, is a shareable address
     * that pins a state nobody chose.
     */
    const initial = clampViewport(CROPPED, BOUNDS);
    const search = writeMapState("", { view: initial, trip: "japon-2024", initial });

    expect(new URLSearchParams(search).get(VIEW_PARAM)).toBe(null);
    expect(new URLSearchParams(search).get(TRIP_PARAM)).toBe("japon-2024");
  });

  it("reads nothing out of a URL that carries nothing", () => {
    expect(readMapState("", BOUNDS)).toEqual(state(null, null));
    expect(readMapState("?", BOUNDS)).toEqual(state(null, null));
    expect(readMapState("?other=1", BOUNDS)).toEqual(state(null, null));
  });

  it("refuses every malformed viewport instead of rendering a broken viewBox", () => {
    for (const raw of [
      "",
      "1,2",
      "1,2,3,4",
      "a,b,c",
      "NaN,0,400",
      "0,0,Infinity",
      "0,0,-400",
      "0,0,0",
      ",,",
      "1;2;3",
    ]) {
      expect(readMapState(`?${VIEW_PARAM}=${encodeURIComponent(raw)}`, BOUNDS).view).toBeNull();
    }
  });

  it("clamps a viewport that is well formed but out of range", () => {
    // A hand-shortened URL, or one from a build whose framing floor has moved.
    const read = readMapState(`?${VIEW_PARAM}=-900,-900,20000`, BOUNDS);

    expect(read.view).not.toBeNull();
    expectInsideTheWorld(read.view as Viewport, BOUNDS.aspect);
  });

  it("refuses a trip parameter that is not shaped like a slug", () => {
    /**
     * This value ends up matched against `data-trip` attributes, so a reader who
     * can put arbitrary text in it is a reader who can put arbitrary text into a
     * selector. The lookup itself iterates and compares strings rather than
     * building a selector, so this is the second of two locks; the first is
     * shape.
     */
    for (const raw of [
      '"]',
      "a b",
      "../trips",
      "<script>",
      "UPPER",
      "trailing-",
      "-leading",
      "double--dash",
      "a".repeat(200),
      "",
    ]) {
      expect(
        readMapState(`?${TRIP_PARAM}=${encodeURIComponent(raw)}`, BOUNDS).trip,
        `"${raw}" must not be read back as a slug`
      ).toBeNull();
    }
  });

  it("accepts the slugs the content façade really produces", () => {
    for (const raw of ["japon-2024", "perou-bolivie-2023", "islande-2022", "a", "a1-b2"]) {
      expect(readMapState(`?${TRIP_PARAM}=${raw}`, BOUNDS).trip).toBe(raw);
    }
  });

  it("serialises to one decimal, like the viewBox the same numbers render", () => {
    expect(serialiseViewport(view(177.34, 0, 764.449, 0))).toBe("177.3,0,764.4");
  });
});
