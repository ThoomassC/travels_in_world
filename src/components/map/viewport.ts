import type { Frame, WorldBox } from "./frame";

/**
 * The arithmetic of the interactive map: what the `viewBox` becomes when a
 * reader zooms, pans, pinches or reloads a shared address.
 *
 * **Pure, and free of React, of the DOM and of Next**, for the reason
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` gives for `frame.ts`: the
 * cases that decide whether this map is usable are degenerate ones — a factor of
 * zero, two fingers on one pixel, a hand-shortened URL — and they are worth a
 * hundred assertions in milliseconds rather than a browser each. The client
 * component (`./map-viewport.tsx`) holds the events and the DOM; everything it
 * computes is here.
 *
 * **Nothing here re-projects and nothing here re-draws.** A zoom is a narrower
 * `viewBox` over the very same 177 `<path>` elements the server rendered once, in
 * the fixed 960 × 500 box `src/map/**` owns. That is the same decision
 * `frameAround` records, extended from "the frame the build chose" to "the frame
 * the reader chose", and it is what keeps the drawing out of the client bundle
 * entirely.
 */

/**
 * A window on the projected world. Deliberately not `Frame`: a `Frame` carries a
 * formatted `viewBox` string, which is a rendering concern, and this type is
 * handed around a state setter dozens of times per pan gesture.
 */
export type Viewport = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Everything the four operations below need to keep their result renderable, in
 * one value computed once.
 *
 * **`aspect` comes from the frame and never from the world**, and that is the
 * subtle half. `frameAround` rounds width and height outwards *independently*,
 * so a cropped frame's ratio differs from the world's by up to 0.1 unit — and the
 * container's `aspect-ratio` is locked to the *frame's* numbers
 * (`world-map.tsx`). A zoom that preserved the world's ratio instead would make
 * `preserveAspectRatio` letterbox the SVG inside its box, and every marker —
 * positioned in percentages of the box rather than of the drawing — would slide
 * off the country it names. Same trap `frameAround`'s own note describes, one
 * level up.
 */
export type ViewportBounds = {
  readonly world: WorldBox;
  /** `width / height`, held by every viewport this module answers. */
  readonly aspect: number;
  /** The narrowest frame a reader may reach; see {@link MAX_ZOOM_WIDTH_FRACTION}. */
  readonly minWidth: number;
};

/**
 * How far in a reader may zoom, as a fraction of the world's width.
 *
 * 4 % of 960 units is about 38 units — some 14° of longitude, roughly a
 * metropolitan region and its coastline. Past that the 110m dataset has nothing
 * left to show: its shapes are simplified to about 10 km, so a tighter frame is a
 * flat wash with a straight line where a coast was, which is the failure
 * `MIN_FRAME_WIDTH_FRACTION` refuses for a single trip at build time. This is the
 * same judgement for the reader's own zooming, and it is why the floor is a
 * property of the *dataset* rather than a preference.
 */
export const MAX_ZOOM_WIDTH_FRACTION = 0.04;

/**
 * One button press, and one wheel notch.
 *
 * 1.5 rather than 2: from the whole world to the floor is then 8 presses, which
 * is a scale a reader can follow, where a doubling loses the map in 5.
 */
export const ZOOM_STEP = 1.5;

/**
 * How many notches the zoom slider offers between the whole world and the floor.
 *
 * The value is what an `<input type="range">` carries, so this is also the
 * keyboard vocabulary the reader gets, and the three figures below are the whole
 * of the choice:
 *
 * - **an arrow key moves one notch**, which on the logarithmic scale below is a
 *   factor of `25 ^ (1/100)` — about 3 %. Fine enough to settle on a coastline.
 * - **Page Up / Page Down move ten** in every engine (the UA step is
 *   `(max - min) / 10`), so a factor of about 1.38 — near enough to
 *   {@link ZOOM_STEP} that a reader who used the old buttons keeps their feel.
 * - **Home and End are the two ends**, so no one has to cross the range one press
 *   at a time.
 *
 * 100 and not 8 (the number of presses the three removed buttons took from the
 * world to the floor): a slider that answered 8 positions would be a set of
 * buttons wearing a track, and dragging it would jump. The continuity the owner
 * asked for is this number being large.
 */
export const ZOOM_SCALE_STEPS = 100;

/**
 * Where the zoom is taken from when nothing points at a place: the middle of what
 * the reader is looking at.
 *
 * Lives here rather than in the component because two callers need the same
 * anchor and they must not disagree — the slider (which has no pointer to zoom
 * towards) and the fallback of `anchorIn` in `./map-viewport.tsx` (which is what
 * a box of zero size answers).
 */
export const CENTRE = { x: 0.5, y: 0.5 } as const;

/**
 * How far a pointer may travel before an activation stops being a tap.
 *
 * This is the acceptance criterion "a drag ending on a marker does not open the
 * panel" reduced to a number. 8 CSS pixels is the usual platform figure — under
 * a finger's own jitter on a phone, well under the 44 px target, and far enough
 * that a deliberate drag can never be mistaken for a click.
 */
export const DRAG_THRESHOLD_PX = 8;

/**
 * The placeholder a server-resolved zoom sentence leaves for the live number.
 *
 * **Why a template with a hole in it rather than a translated string.** The
 * slider's `aria-valuetext` has to name a percentage that changes on every notch,
 * and the client component deliberately holds no translator: `useTranslations`
 * there costs 1.9 KB and leaks a chunk onto a route with no map on it, which
 * `MapViewportLabels` records as a measurement. Resolving one sentence per
 * reachable percentage on the server is not an option either — there are some two
 * thousand of them.
 *
 * So `world-map.tsx` resolves the sentence with this token where the number goes
 * (`t("zoomValue", { percent: ZOOM_VALUE_TOKEN })`) and `map-viewport.tsx`
 * substitutes. The translator keeps the whole sentence, word order and per-locale
 * spacing before the `%` included, which is the part a `"Zoom " + n + " %"`
 * concatenation would have thrown away.
 *
 * The token is the ICU argument's own name, so a catalogue that never resolved it
 * and a catalogue resolved with this value are the same string — there is no
 * second spelling to keep in step.
 *
 * **It lives HERE, in the pure module, and that is not filing.** It was declared
 * in `map-viewport.tsx` first, and the page threw on every render:
 *
 *     INVALID_MESSAGE: The message `zoomValue` in namespace `map` didn't
 *     resolve to a string. If you want to format rich text, use `t.rich`.
 *
 * A module carrying `'use client'` exports *client references* into a Server
 * Component, not its values — a string constant included. So `world-map.tsx` was
 * handing `t()` an opaque object, intl formatted it as a rich-text part, and the
 * result was an array. The error names the message and not the import, which is
 * the whole reason this paragraph is here rather than the lesson being learnt
 * twice. `tests/components/map/world-map.test.tsx` pins the substitution.
 */
export const ZOOM_VALUE_TOKEN = "{percent}";

/** The query parameter carrying the frame: `x,y,width`, one decimal each. */
export const VIEW_PARAM = "carte";

/** The query parameter carrying the selected trip's slug. */
export const TRIP_PARAM = "voyage";

/**
 * The shape a slug may have before it is matched against the markers in the DOM.
 *
 * **This is a security boundary and not a tidiness check.** The value comes from
 * a URL anybody can write, and it is compared against `data-trip` attributes. The
 * lookup in `./map-viewport.tsx` iterates the markers and compares strings — it
 * never builds a selector — so a crafted value cannot escape into one; this is
 * the second lock, on shape, and it is what keeps a nonsense address from
 * silently selecting nothing while the URL claims otherwise.
 *
 * The grammar is `SlugSchema`'s in `src/domain/schema.ts` (lowercase, digits,
 * single hyphens, no leading or trailing hyphen). Restated rather than imported:
 * `src/components/map/**` must render from a fixture with neither the domain nor
 * the content façade in its graph, which is what makes the whole layer testable
 * under jsdom. `tests/components/map/viewport.test.ts` pins the grammar against
 * the slugs the façade really produces.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Long enough for any real slug, short enough that a URL cannot carry a payload. */
const SLUG_MAX_LENGTH = 120;

/** One decimal, exactly like the `viewBox` these numbers are formatted into. */
const DECIMALS = 1;

const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Snaps a value that is not a number back to a usable one. */
const orElse = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

/**
 * The bounds a page's frame implies, validated once so the operations below can
 * be total.
 *
 * Throws for a world or a frame with no area, which is the posture `frameAround`
 * takes and for the same reason: there is no partial result to salvage, and every
 * value this module could answer instead would be a lie that renders as
 * `viewBox="NaN NaN NaN NaN"` — a map that disappears with a green build and
 * nothing in the console.
 */
export function boundsOf(frame: Frame, world: WorldBox): ViewportBounds {
  if (!(Number.isFinite(world.width) && Number.isFinite(world.height))) {
    throw new TypeError(
      `The world box must be two finite numbers; received ${world.width} × ${world.height}.`
    );
  }
  if (!(world.width > 0 && world.height > 0)) {
    throw new RangeError(
      `The world box must have an area; received ${world.width} × ${world.height}.`
    );
  }
  if (!(isFinitePositive(frame.width) && isFinitePositive(frame.height))) {
    throw new RangeError(
      `The frame must have an area to have an aspect ratio; received ${frame.width} × ${frame.height}.`
    );
  }

  return {
    world,
    aspect: frame.width / frame.height,
    minWidth: world.width * MAX_ZOOM_WIDTH_FRACTION,
  };
}

/** The two frame widths a reader can reach, and nothing in between. */
type ZoomRange = {
  /** Fully zoomed out: the whole world, or as much of it as the ratio allows. */
  readonly widest: number;
  /** Fully zoomed in: the legibility floor, unless the world is narrower still. */
  readonly narrowest: number;
};

/**
 * The two ends of the zoom, computed once and shared by everything that clamps or
 * scales a width.
 *
 * **The zoom-out cap reads both sides of the world.** A frame narrower than the
 * world reaches the world's *height* before its width, and a `width <= world.width`
 * cap alone would answer a frame hanging past the bottom edge — grey space under
 * the map, and a marker pushed off it.
 *
 * A world smaller than the zoom floor is not a state a page can reach, but the
 * floor must not win over the world if it ever were: the cap is the outer one, so
 * `narrowest` can never exceed `widest` and the range can never be inside out.
 */
function zoomRangeOf(bounds: ViewportBounds): ZoomRange {
  const widest = Math.min(bounds.world.width, bounds.world.height * bounds.aspect);

  return { widest, narrowest: Math.min(bounds.minWidth, widest) };
}

/**
 * The nearest renderable viewport inside the world, at the bounds' aspect ratio.
 *
 * Every export below funnels through this, so the component can never hand the
 * SVG a `viewBox` that is off the map, inside out, or unparseable — whatever a
 * pointer event, a wheel delta or a URL contained.
 *
 * **The height is derived, never trusted.** The container's `aspect-ratio` is
 * locked to the bounds' ratio, so any other height letterboxes the drawing and
 * slides every marker off its country.
 *
 * The two widths it clamps between are {@link zoomRangeOf}'s, which is also what
 * the slider's scale is laid out over: one definition, so a frame the reader can
 * drag to is by construction a frame this function will keep.
 */
export function clampViewport(view: Viewport, bounds: ViewportBounds): Viewport {
  const { world, aspect } = bounds;
  const { widest, narrowest } = zoomRangeOf(bounds);

  const width = clamp(orElse(view.width, widest), narrowest, widest);
  const height = width / aspect;

  return {
    x: clamp(orElse(view.x, 0), 0, world.width - width),
    y: clamp(orElse(view.y, 0), 0, world.height - height),
    width,
    height,
  };
}

/**
 * Zooms by `factor` (above 1 = closer) while holding still the point under
 * `anchor`, a pair of fractions of the current frame — `{ x: 0.5, y: 0.5 }` for
 * the buttons, the pointer's position for the wheel and the pinch's centroid for
 * two fingers.
 *
 * Holding the anchor is what separates a usable wheel zoom from one where the
 * reader chases the map across the screen after every notch. It is applied
 * *after* the width has been clamped, so the anchor still holds on the press that
 * hits the floor.
 */
export function zoomViewport(
  view: Viewport,
  factor: number,
  anchor: { readonly x: number; readonly y: number },
  bounds: ViewportBounds
): Viewport {
  const current = clampViewport(view, bounds);
  // A factor of 0, of Infinity or of NaN is one frame away from a blank map, and
  // a wheel event reporting one is a browser quirk rather than an intent.
  const safeFactor = isFinitePositive(factor) ? factor : 1;
  const zoomed = clampViewport({ ...current, width: current.width / safeFactor }, bounds);

  const fx = clamp(orElse(anchor.x, 0.5), 0, 1);
  const fy = clamp(orElse(anchor.y, 0.5), 0, 1);

  return clampViewport(
    {
      x: current.x + fx * current.width - fx * zoomed.width,
      y: current.y + fy * current.height - fy * zoomed.height,
      width: zoomed.width,
      height: zoomed.height,
    },
    bounds
  );
}

/* --- The zoom slider's scale. ------------------------------------------------

   Three functions and one shared decision: **the notch is logarithmic in the
   frame's width, never linear.** On the production world the scale spans a factor
   of 25 — 960 units down to 38.4 — and the arithmetic of the two layouts is not
   close:

     linear        9.2 units a notch, everywhere. That is 1 % of the frame at the
                   bottom of the scale and 24 % of it at the top, so the map
                   barely stirs for the first half of the travel and then jumps a
                   quarter of its width per arrow key at the end. Notch 50 is
                   499 units: still most of the world.
     logarithmic   3.3 % a notch, everywhere. Notch 50 is 192 units — a continent
                   — and the last notch is as fine as the first.

   A constant *ratio* per notch is what "zoomer proprement" means for a control
   that is dragged rather than pressed: the map has to move at the same apparent
   speed wherever the thumb is.

   The three are exact inverses of one another, which is the property the slider
   depends on: the value is derived from the viewport on every render, so a notch
   that did not read back as itself would make the thumb crawl or stick while a
   reader dragged it. `tests/components/map/viewport.test.ts` walks all 101 in
   both directions. ---------------------------------------------------------- */

/** `log(narrowest / widest)`, the whole span of the scale. Negative, or 0. */
const zoomSpanOf = (range: ZoomRange): number => Math.log(range.narrowest / range.widest);

/**
 * The frame width a notch stands for — 0 is the whole world, {@link
 * ZOOM_SCALE_STEPS} is the legibility floor.
 *
 * Total, like everything else here: a notch that is not a number, or one off
 * either end, answers the nearest end rather than a width no `viewBox` can carry.
 */
export function widthAtZoomNotch(notch: number, bounds: ViewportBounds): number {
  const range = zoomRangeOf(bounds);
  const fraction = clamp(orElse(notch, 0), 0, ZOOM_SCALE_STEPS) / ZOOM_SCALE_STEPS;

  return range.widest * Math.exp(zoomSpanOf(range) * fraction);
}

/**
 * Which notch a viewport is at — the other direction, and the one that makes the
 * slider a *view* of the frame rather than a second copy of it.
 *
 * This is what keeps the control honest when the zoom came from somewhere else: a
 * wheel notch, a pinch, a shared `?carte=` address and a drag all change `width`,
 * and the thumb follows because it is computed from it. There is no slider state
 * to fall out of step.
 *
 * Rounded to a whole notch, because that is what the `<input>` carries. The
 * rounding is also what absorbs the last bit of floating-point error on the way
 * back through {@link zoomToNotch}.
 */
export function zoomNotchOf(view: Viewport, bounds: ViewportBounds): number {
  const range = zoomRangeOf(bounds);
  const span = zoomSpanOf(range);

  // A world no wider than the zoom floor has one reachable width, so every notch
  // is the same frame; answering 0 puts the thumb at an end rather than at NaN.
  if (span === 0) {
    return 0;
  }

  const { width } = clampViewport(view, bounds);

  return Math.round(clamp(Math.log(width / range.widest) / span, 0, 1) * ZOOM_SCALE_STEPS);
}

/**
 * The viewport a notch asks for, **zoomed from the middle of what the reader is
 * looking at** — exactly where the three removed buttons zoomed from.
 *
 * Through `zoomViewport` and not by writing the width directly, so the anchor
 * arithmetic that keeps the centre still exists once. A slider that changed the
 * width without holding a point would slide the map out from under the reader on
 * every pixel of the drag, which is the failure that anchor was written for.
 */
export function zoomToNotch(view: Viewport, notch: number, bounds: ViewportBounds): Viewport {
  const current = clampViewport(view, bounds);

  return zoomViewport(current, current.width / widthAtZoomNotch(notch, bounds), CENTRE, bounds);
}

/**
 * The zoom as a percentage a reader can hear — 100 % is the whole world, 2500 %
 * is the floor on the production world.
 *
 * For `aria-valuetext`, and it is the reason that attribute is set at all: the
 * notch is an implementation detail, and a screen reader announcing "37" for a
 * map would be reading out the scale rather than the zoom. A percentage is the
 * unit every image viewer and every browser already zooms in.
 *
 * A whole number, deliberately: the alternative carries a decimal separator,
 * which is locale-specific, and this component has no translator (see
 * `MapViewportLabels`).
 */
export function zoomPercentOf(view: Viewport, bounds: ViewportBounds): number {
  const { widest } = zoomRangeOf(bounds);
  const { width } = clampViewport(view, bounds);

  return Math.round((widest / width) * 100);
}

/**
 * Pans by a pointer movement expressed as a fraction of the *rendered* map — the
 * only unit available to a layer that never learns the map's pixel size.
 *
 * The frame moves **against** the pointer: dragging right reveals what lies to
 * the west, because the reader is moving the paper and not the window. A fraction
 * of the frame rather than of the world is what makes the same drag pan less when
 * zoomed in, which is the behaviour every map has.
 */
export function panViewport(
  view: Viewport,
  pointer: { readonly x: number; readonly y: number },
  bounds: ViewportBounds
): Viewport {
  const current = clampViewport(view, bounds);

  return clampViewport(
    {
      ...current,
      x: current.x - orElse(pointer.x, 0) * current.width,
      y: current.y - orElse(pointer.y, 0) * current.height,
    },
    bounds
  );
}

/**
 * The zoom factor of a pinch, from the distance between two fingers then and now.
 *
 * Answers 1 — no zoom — for anything a browser cannot have meant. Two fingers on
 * the same pixel is a real event and `to / 0` is `Infinity`: one frame of that
 * and the map is pinned at its zoom floor with nothing on screen to say why.
 */
export function pinchFactor(from: number, to: number): number {
  return isFinitePositive(from) && isFinitePositive(to) ? to / from : 1;
}

/**
 * Whether a pointer travelled far enough for its release to be a drag rather than
 * an activation — the acceptance criterion "a drag ending on a marker does not
 * open the panel".
 *
 * The **diagonal**, not each axis: 6 px each way is 8.5 px of travel and is
 * plainly a drag, though neither axis passes the threshold on its own.
 *
 * A delta that is not a number counts as a tap. That is the safe direction: a
 * suppressed activation is a marker that answers nothing, which is worse than a
 * panel opening after a movement nobody noticed.
 */
export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
}

/** Trims the `.0` a fixed-decimal format leaves on every whole number. */
const format = (value: number): string => value.toFixed(DECIMALS).replace(/\.0$/, "");

/**
 * `x,y,width` — three numbers, one decimal each, and never the height, which is
 * derived from the bounds' aspect ratio on the way back in. Writing four would
 * let a URL disagree with the container's locked ratio.
 */
export function serialiseViewport(view: Viewport): string {
  return `${format(view.x)},${format(view.y)},${format(view.width)}`;
}

/** What the URL can say about the map. Both halves are independent. */
export type MapState = {
  readonly view: Viewport | null;
  readonly trip: string | null;
  /**
   * The frame the server already rendered. A `view` equal to it is written as no
   * parameter at all, so the address stays clean until the reader actually moves
   * the map — a `?carte=` appearing on a first hover would be a shareable link
   * pinning a state nobody chose.
   */
  readonly initial?: Viewport;
};

const samePlace = (a: Viewport, b: Viewport): boolean =>
  serialiseViewport(a) === serialiseViewport(b);

/**
 * The map's state as a query string, preserving every parameter the map does not
 * own.
 *
 * A query string and **not** a fragment, and the choice is load-bearing for
 * invariant 1 of `AGENTS.md`. Both are invisible to the prerender — neither
 * creates a route and neither reads a request header — but `/fr` already promises
 * `#voyage-<slug>` as the anchor of a marker's `<li>` (the trip page links back
 * to it), and reusing the fragment for state would have made one syntax mean two
 * things and scrolled the page on every selection. The frame's three numbers
 * would not have fitted beside it either.
 */
export function writeMapState(search: string, state: MapState): string {
  const params = new URLSearchParams(search);

  if (
    state.view === null ||
    (state.initial !== undefined && samePlace(state.view, state.initial))
  ) {
    params.delete(VIEW_PARAM);
  } else {
    params.set(VIEW_PARAM, serialiseViewport(state.view));
  }

  if (state.trip === null) {
    params.delete(TRIP_PARAM);
  } else {
    params.set(TRIP_PARAM, state.trip);
  }

  const query = params.toString();

  return query === "" ? "" : `?${query}`;
}

/**
 * What a URL says about the map, or `null` for each half it does not say
 * *usably*.
 *
 * Every rejection below is a state that would otherwise render: a `viewBox` of
 * `NaN` blanks the drawing with nothing in the console, and a trip parameter that
 * is not a slug is untrusted text on its way to a DOM lookup. A well-formed
 * viewport that is merely out of range is **clamped** rather than refused — a
 * shortened URL, or one shared from a build whose framing floor has since moved,
 * should still show a map.
 */
export function readMapState(search: string, bounds: ViewportBounds): MapState {
  const params = new URLSearchParams(search);

  return {
    view: readViewport(params.get(VIEW_PARAM), bounds),
    trip: readTrip(params.get(TRIP_PARAM)),
  };
}

function readViewport(raw: string | null, bounds: ViewportBounds): Viewport | null {
  if (raw === null) {
    return null;
  }

  const parts = raw.split(",");
  if (parts.length !== 3) {
    return null;
  }

  // `Number("")` is 0 and `Number(" 1 ")` is 1, so the emptiness test is not
  // redundant: ",," would otherwise parse as a viewport at the origin.
  const [x, y, width] = parts.map((part) => (part.trim() === "" ? Number.NaN : Number(part)));
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !isFinitePositive(width)
  ) {
    return null;
  }

  return clampViewport({ x, y, width, height: width / bounds.aspect }, bounds);
}

function readTrip(raw: string | null): string | null {
  if (raw === null || raw.length === 0 || raw.length > SLUG_MAX_LENGTH) {
    return null;
  }

  return SLUG_PATTERN.test(raw) ? raw : null;
}
