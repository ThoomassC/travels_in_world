import type { StoryState } from "@/domain/schema";
import type { Frame, Point } from "./frame";

/**
 * A trip, reduced to what a marker on the world map needs, and placed inside a
 * {@link Frame}.
 *
 * This is deliberately *not* `TripSummary`. By the time a marker is rendered the
 * trip has already been through the projection, which is server-only code, so
 * what the component receives is no longer a trip: it is a label, a destination
 * and two numbers. Keeping that as its own type is what lets the whole rendering
 * layer be tested without `src/map/**`, without `src/content/**` and without
 * Next — and it means a new field on `TripSummary` cannot break the map.
 */
export type TripMark = {
  /** The trip's slug, used as the React key and nowhere else. */
  readonly slug: string;
  readonly title: string;
  /**
   * The trip's first calendar day, `YYYY-MM-DD` — never a `Date`, per
   * `docs/adr/0001-domain-purity.md`.
   *
   * Read by `zonesOf` and by nothing else: the trip panel lists the trips of one
   * zone **date descending**, which is an acceptance criterion of TIW-14. The
   * content façade already hands the markers in that order and this component
   * never re-sorts them, so the field looks redundant — and that is exactly why
   * it is here. A criterion satisfied by an upstream sort is a criterion nothing
   * in this layer would notice losing.
   */
  readonly startDate: string;
  /** The first place of the itinerary — the point the marker is anchored on. */
  readonly placeName: string;
  /** Already locale-prefixed by the page; the component never builds a URL. */
  readonly href: string;
  /** Projected into the world box, not geographic. */
  readonly point: Point;
  /**
   * Whether this marker is the journal's newest récit (TIW-19) — the first of the
   * badge's three placements.
   *
   * A boolean decided by the page, exactly like `href` and for exactly the same
   * reason: the derivation needs the build day *and* the whole collection, and
   * this layer renders from seven shapes under jsdom with neither
   * (`docs/adr/0003-carte-svg-inerte-et-balises-html.md`). Optional, because a
   * map with no fresh trip is the ordinary state of a journal.
   *
   * It changes two things in the rendering, and the second is the one that
   * matters: an animated halo — neutralised under `prefers-reduced-motion`, and
   * never the only channel — and the marker's **accessible name**, which gains
   * "— nouveau récit". A distinction carried by an animation does not exist for
   * the readers who cannot see it.
   */
  readonly isNew?: boolean;
  /**
   * Whether this trip's récit is written (TIW-18).
   *
   * **Required, unlike `isNew` right above**, and the asymmetry is the point. A
   * missing `isNew` means "not the newest récit", which is true of fifty-nine
   * markers out of sixty and harmless; a missing `story` would mean "has a page"
   * for a trip that does not, and the marker would point at a 404. Required, the
   * compiler asks the page — the only place that builds these — to say which it
   * is.
   *
   * It changes two things in the rendering and **neither of them is `href`**. The
   * destination is the page's decision, as it is for every marker (ADR 0003: this
   * layer constructs no URL): for an untold trip the page hands over the listing
   * entry of that trip, which certainly exists. What this layer does with the
   * field is the marker's **accessible name**, which gains "— récit à venir", and
   * a `data-story` attribute driving a hollow dot — a difference of *shape*, so
   * the state is not carried by colour alone.
   */
  readonly story: StoryState;
};

export type PlacedMark = {
  readonly mark: TripMark;
  /** Distance from the frame's left edge, in percent of its width. */
  readonly leftPercent: number;
  /** Distance from the frame's top edge, in percent of its height. */
  readonly topPercent: number;
};

/**
 * Two decimals, not one. A percentage is a fraction of the *rendered* width, so
 * its precision is not the frame's: at a 900 px render, 0.1 % is nearly a pixel
 * of visible drift between the marker and the coastline it names, while 0.01 %
 * is a tenth of one.
 */
const DECIMALS = 2;

const round = (value: number): number => Number(value.toFixed(DECIMALS));

/**
 * Where each marker sits inside the frame, as a percentage of it.
 *
 * Percentages rather than SVG user units, because the markers are HTML laid over
 * the SVG rather than shapes inside it. That is the only arrangement in which
 * the 44 px interaction target is genuinely independent of the drawn icon and of
 * the zoom: a `<circle r="6">` grows and shrinks with the `viewBox`, an `<a>`
 * sized in `rem` does not. It also keeps every country inert — the shapes are in
 * an `aria-hidden` SVG with no pointer events, so nothing that is not a trip can
 * be hovered, focused or clicked.
 *
 * A marker whose point is not finite is dropped, and so is any marker at all if
 * the frame has no usable area. Both are unreachable through {@link frameAround}
 * and a parsed trip; both would otherwise render `left: NaN%`, which the browser
 * ignores — stacking every faulty marker in the container's top-left corner,
 * pointing at the wrong country rather than at nothing.
 *
 * The frame guard tests **finiteness**, not just sign. `Infinity > 0` is `true`,
 * so a `> 0` test lets an infinite frame through and every division answers `0`:
 * sixty markers stack in the top-left corner, on a map that renders without a
 * word of complaint. `Number.isFinite` rejects `NaN`, both infinities and every
 * non-number in one call, which is the only reading of "has an area" that holds.
 */
export function placeMarks(marks: readonly TripMark[], frame: Frame): readonly PlacedMark[] {
  const measurable =
    Number.isFinite(frame.x) &&
    Number.isFinite(frame.y) &&
    Number.isFinite(frame.width) &&
    Number.isFinite(frame.height) &&
    frame.width > 0 &&
    frame.height > 0;

  if (!measurable) {
    return [];
  }

  return marks
    .filter(({ point }) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((mark) => ({
      mark,
      leftPercent: round(((mark.point.x - frame.x) / frame.width) * 100),
      topPercent: round(((mark.point.y - frame.y) / frame.height) * 100),
    }));
}

/**
 * How far a coincident marker is pushed off the shared point, in percent of the
 * frame's width.
 *
 * Small on purpose. This is an *unreachability* fix, not a legibility one: two
 * trips leaving from the same city are one of the likeliest shapes this journal
 * will hold, and two `<a>` at identical coordinates means the one underneath
 * answers no click at all. A 1.6 % nudge exposes a crescent of each marker
 * without moving any of them off the country it names.
 */
const SPREAD_RADIUS_PERCENT = 1.6;

/** Where the first marker of a group goes: straight up, so a pair reads as a pair. */
const SPREAD_START_RADIANS = -Math.PI / 2;

/**
 * Pushes markers that landed on the very same spot onto a small deterministic
 * circle around it.
 *
 * **This is a mitigation and not a fix, and the difference matters.** Fully
 * separating two 44 px targets would require knowing the map's rendered width,
 * which is fluid and unknown at build time: an offset expressed in percent
 * cannot promise a distance in pixels. What this buys is that every marker has
 * *some* exposed area for a pointer, instead of one being wholly buried. Each
 * `<a>` is still 44 px in its own right, and the keyboard never had the problem —
 * both links are in the tab order whatever they overlap. Real separation needs
 * clustering at low zoom, which belongs to TIW-14.
 *
 * Deterministic in three ways, because a prerendered page must be
 * byte-identical between two builds of the same content: grouping is on the
 * rounded percentages already computed, the order inside a group is the input
 * order (so the content façade's sort decides), and the angles are fixed
 * divisions of the circle rather than anything drawn from a generator.
 *
 * The vertical component is scaled by the frame's aspect ratio. A percentage of
 * the height is not the same number of pixels as a percentage of the width, so
 * without it the "circle" is an ellipse flattened by the same 1.92 factor as the
 * map — and a pair of markers separates almost twice as much horizontally as
 * vertically for no reason a reader could guess.
 */
export function spreadCoincident(
  placed: readonly PlacedMark[],
  frame: Frame
): readonly PlacedMark[] {
  const verticalScale = frame.width / frame.height;

  /**
   * Grouping is on a **cell**, not on equality of the two percentages.
   *
   * Exact equality was the first version and it missed the likeliest case of
   * all. Percentages are rounded to two decimals, so two markers collide only if
   * they agree to 0.01 % — about 0.03 world units, four kilometres on a cropped
   * frame. Charles-de-Gaulle and central Paris are further apart than that: they
   * produced *different* keys, were therefore left alone, and then overlapped
   * within a pixel of each other. The buried marker had no clickable area at all
   * — the very defect this function exists to prevent.
   *
   * The cell is one spread radius wide and, vertically, the same distance on
   * screen, so it is square where the reader looks rather than in percent.
   *
   * Known and accepted limit of any bucketing: two markers on either side of a
   * cell boundary are still not grouped. That is a strictly smaller hole than
   * exact equality — from four kilometres to at worst one cell — and closing it
   * properly means clustering by distance at a known zoom level, which is
   * TIW-14's job.
   */
  const cellOf = (entry: PlacedMark): string => {
    const column = Math.round(entry.leftPercent / SPREAD_RADIUS_PERCENT);
    const row = Math.round(entry.topPercent / (SPREAD_RADIUS_PERCENT * verticalScale));

    return `${column}|${row}`;
  };

  const groups = new Map<string, PlacedMark[]>();
  for (const entry of placed) {
    const key = cellOf(entry);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [entry]);
    } else {
      group.push(entry);
    }
  }

  // Nothing overlaps: return the very same array, so the common case allocates
  // nothing and the identity is preserved for a caller that compares.
  if (groups.size === placed.length) {
    return placed;
  }

  const offsets = new Map<PlacedMark, PlacedMark>();

  for (const group of groups.values()) {
    if (group.length === 1) {
      continue;
    }
    group.forEach((entry, index) => {
      const angle = SPREAD_START_RADIANS + (index * 2 * Math.PI) / group.length;
      offsets.set(entry, {
        mark: entry.mark,
        leftPercent: round(entry.leftPercent + SPREAD_RADIUS_PERCENT * Math.cos(angle)),
        topPercent: round(
          entry.topPercent + SPREAD_RADIUS_PERCENT * verticalScale * Math.sin(angle)
        ),
      });
    });
  }

  return placed.map((entry) => offsets.get(entry) ?? entry);
}
