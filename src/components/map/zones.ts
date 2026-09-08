import type { Frame, Point } from "./frame";
import type { PlacedMark } from "./marks";

/**
 * Which markers a reader's finger would cover along with the one they aimed at.
 *
 * **This module used to partition, and it no longer does — that is the whole of
 * the change.** A panel used to belong to a *zone*, so the markers had to be cut
 * into groups, and the grouping was single linkage: a marker joined a zone as
 * soon as it came within the radius of any ONE of its members. Chaining was the
 * point of that choice and it was also its cost. Measured on this repository's
 * own content at 1440 px, clicking Paris opened « Les 6 voyages à cet endroit »
 * with Gand-Bruges at the top — six trips in one list where only two pairs
 * actually overlap, and a heading naming the zone's most recent trip rather than
 * the one the reader clicked. The owner's report is the specification: « quand je
 * clique sur un voyage je veux le descriptif avec les photos du voyage, pas les
 * autres voyages du pays ».
 *
 * A panel belongs to **one trip**, keyed on its slug, so there is no partition
 * left to compute. The one question that survives is what a finger covers, and
 * that question is **pairwise**: A overlapping B and B overlapping C says nothing
 * about A and C. {@link overlappingMarks} answers it directly — one entry per
 * marker, listing the markers it really overlaps — and the panel renders them as
 * a secondary block under « Aussi à cet endroit » rather than as its subject.
 *
 * **Why the overlap has to be answered at all.** The measured pairs on this
 * content, at 1440 px with 44x44 px targets, are real: annecy/geneve 44x24 px,
 * paris/rouen 30x36, roses/barcelone 33x31, noirmoutier/les-sables-d-olonne
 * 39x19, la-rochelle/les-sables-d-olonne 16x39, gand-bruges/paris 29x13, and
 * eight more. A reader at a pointer cannot always hit the marker they meant, so
 * every overlapping trip has to be reachable from whichever panel did open.
 *
 * **Why this is not `spreadCoincident`'s cell grid.** That grouping exists to
 * stop one marker burying another entirely, so its cell is one nudge wide — about
 * 15 world units on a cropped frame, four kilometres of ground. The question here
 * is a different one and its answer is measured in *pixels*: two 44 px targets
 * whose centres are less than one target apart overlap. That is a radius of
 * roughly 4 % of the rendered width, an order of magnitude wider than a spread
 * cell.
 *
 * **The overlaps are computed once, at build time, on the frame the server
 * rendered.** They therefore do not change as the reader zooms in and two markers
 * separate on screen. That is a deliberate trade and not an oversight: a panel is
 * a stable, prerendered, URL-addressable thing, which is what lets its whole body
 * be server-rendered HTML and the client component stay an interaction layer.
 * Recomputing in the browser would mean shipping the marker list, the distances
 * and the trip data to it — the drawing's own budget, spent on a grouping a reader
 * can already resolve by zooming and clicking the marker they now see clearly.
 *
 * Pure, and free of React, of Next and of both facades, like the rest of this
 * folder.
 */

/**
 * How close two markers must be for one to be listed in the other's panel, in
 * percent of the frame's width.
 *
 * This is a target width, not a taste. A marker's `<a>` is `2.75rem` — 44 px at
 * the root size, the WCAG 2.5.8 minimum — and the map is around 1100 px wide on a
 * desktop, so 4 % of it is one target. Two centres closer than that overlap, and
 * the reader cannot have meant one of them in particular.
 *
 * Wider would put neighbouring cities a reader can plainly distinguish in each
 * other's panels; narrower would leave a buried marker with no way to the trip
 * underneath it. Both are worse than a panel with one row too many in its
 * secondary block.
 *
 * Renamed from `ZONE_RADIUS_PERCENT` with the zones: the number and its argument
 * are unchanged, the word "zone" no longer names anything in this file.
 */
export const OVERLAP_RADIUS_PERCENT = 4;

/** Two decimals, like the percentages this inverts. */
const round = (value: number): number => Number(value.toFixed(2));

/**
 * Where a placed marker sits in the **projected world**, which is the coordinate
 * space the `viewBox` lives in.
 *
 * `placeMarks` answers percentages of one particular frame; a marker whose
 * position must survive the reader re-framing the map has to be expressed in the
 * space the frame is cut out of. So the component emits these two numbers as
 * custom properties and CSS re-derives the percentage from the *live* frame:
 *
 *     left: calc((var(--mark-x) - var(--frame-x)) / var(--frame-w) * 100%)
 *
 * which is this function's own formula, run by the browser on four numbers the
 * client component updates. That is the whole mechanism by which zooming moves
 * sixty markers without React re-rendering one of them, and without the 177
 * `<path>` elements ever reaching the client bundle.
 *
 * **What it converts is the marker's true position, and that is a correction.**
 * `spreadCoincident` used to fold its overlap nudge into the percentages before
 * this ran, on the reasoning that the conversion would then turn the nudge into a
 * world distance that "grows on screen as the reader zooms". It does grow — into
 * a marker 150 km from the town it names, which is what a reader of the journal
 * reported seeing on Annecy, Genève, Rouen, La Rochelle and Les Sables-d'Olonne.
 * The nudge is now a screen offset carried beside the position (`PlacedMark.nudge`,
 * in rem) and applied by the stylesheet, so nothing this function reads has ever
 * been moved off its coordinates.
 */
export function worldPointOf(placed: PlacedMark, frame: Frame): Point {
  return {
    x: round(frame.x + (placed.leftPercent / 100) * frame.width),
    y: round(frame.y + (placed.topPercent / 100) * frame.height),
  };
}

/**
 * For each mark, the marks a reader's finger would cover along with it —
 * measured pairwise, never chained.
 *
 * Keyed on `mark.slug`, which is the content facade's primary key for a trip and
 * the value a marker's `data-trip` already carries. A marker with no neighbour is
 * **absent from the map**, not present with an empty list: `get` then answers
 * `undefined`, the caller writes `?? []`, and « Aussi à cet endroit » cannot be
 * rendered as a heading over nothing by a call site that forgot to check a
 * length.
 *
 * Deterministic in two ways, because a prerendered page must be byte-identical
 * between two builds of the same content: a list is sorted nearest-first, and two
 * neighbours at the very same distance are ordered by slug ascending rather than
 * left in input order.
 */
export function overlappingMarks(
  placed: readonly PlacedMark[],
  frame: Frame
): ReadonlyMap<string, readonly PlacedMark[]> {
  const overlaps = new Map<string, readonly PlacedMark[]>();

  if (placed.length === 0) {
    return overlaps;
  }

  /**
   * A percentage of the height is not the same number of pixels as a percentage
   * of the width: the world's box is 1.92 times wider than it is tall. Comparing
   * the raw percentages would pair vertical neighbours nearly twice as eagerly
   * as horizontal ones, for no reason a reader could guess.
   *
   * A frame with no area is unreachable — `frameAround` throws for a world
   * without one and `placeMarks` answers nothing for a frame without one — and
   * the fallback of 1 is what keeps the function answering a distance at all
   * rather than dividing by zero and making every marker everyone's neighbour.
   */
  const verticalScale =
    Number.isFinite(frame.width) && Number.isFinite(frame.height) && frame.height > 0
      ? frame.width / frame.height
      : 1;

  const distanceBetween = (a: PlacedMark, b: PlacedMark): number => {
    const dx = a.leftPercent - b.leftPercent;
    const dy = (a.topPercent - b.topPercent) / verticalScale;

    return Math.hypot(dx, dy);
  };

  /**
   * The slug and not the object reference decides self-exclusion, because the
   * slug is what the answer is keyed on: a marker must never appear in its own
   * list, and distance zero passes every threshold.
   *
   * **What this does NOT survive**, said plainly rather than claimed the other
   * way round: two `PlacedMark`s sharing a slug. The map keyed on the slug would
   * keep only the last one's list, and every other list would carry the pair
   * twice. `placeMarks` produces one entry per trip and the trip's slug is the
   * content façade's primary key, so the case is unreachable — which is why it is
   * documented rather than guarded.
   */
  for (const entry of placed) {
    const neighbours: { readonly entry: PlacedMark; readonly distance: number }[] = [];

    for (const other of placed) {
      if (other.mark.slug === entry.mark.slug) {
        continue;
      }

      const distance = distanceBetween(entry, other);

      // A non-finite distance answers `false` — `NaN <= r` is false — so a marker
      // the framing could not measure is nobody's neighbour rather than
      // everybody's.
      if (!(distance <= OVERLAP_RADIUS_PERCENT)) {
        continue;
      }

      neighbours.push({ entry: other, distance });
    }

    if (neighbours.length === 0) {
      continue;
    }

    /**
     * Nearest first, so the panel's first row is the marker the reader's finger
     * was most likely on. The tie-break uses plain string comparison and **not**
     * `localeCompare`: a locale-sensitive compare would make a prerendered page
     * depend on the collation of the machine that built it.
     */
    neighbours.sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      if (left.entry.mark.slug === right.entry.mark.slug) {
        return 0;
      }
      return left.entry.mark.slug < right.entry.mark.slug ? -1 : 1;
    });

    overlaps.set(
      entry.mark.slug,
      neighbours.map((neighbour) => neighbour.entry)
    );
  }

  return overlaps;
}
