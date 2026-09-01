import type { Frame, Point } from "./frame";
import type { PlacedMark } from "./marks";

/**
 * Which markers a reader would take for one place, and what the trip panel
 * therefore has to list.
 *
 * **Why this is not `spreadCoincident`'s cell grid.** That grouping exists to
 * stop one marker burying another entirely, so its cell is one nudge wide — about
 * 15 world units on a cropped frame, four kilometres of ground. The panel's
 * question is a different one and its answer is measured in *pixels*: two 44 px
 * targets whose centres are less than one target apart overlap, so a reader
 * cannot have meant one of them in particular. That is a radius of roughly 4 % of
 * the rendered width, an order of magnitude wider than a spread cell, and it is
 * why Tokyo and Osaka — the pair that makes axe's `target-size` rule fire on this
 * map — belong to one zone while the spread leaves them alone.
 *
 * **The zones are computed once, at build time, on the frame the server
 * rendered.** They therefore do not re-cluster as the reader zooms in and the two
 * markers separate on screen. That is a deliberate trade and not an oversight: a
 * zone is a stable, prerendered, URL-addressable thing, which is what lets the
 * whole panel be server-rendered HTML and the client component stay an
 * interaction layer. Re-clustering in the browser would mean shipping the marker
 * list, the sort and the trip data to it — the drawing's own budget, spent on a
 * grouping a reader can already resolve by zooming and clicking the marker they
 * now see clearly.
 *
 * Pure, and free of React, of Next and of both façades, like the rest of this
 * folder.
 */

/**
 * How close two markers must be to belong to one zone, in percent of the frame's
 * width.
 *
 * This is a target width, not a taste. A marker's `<a>` is `2.75rem` — 44 px at
 * the root size, the WCAG 2.5.8 minimum — and the map is around 1100 px wide on a
 * desktop, so 4 % of it is one target. Two centres closer than that overlap, and
 * the acceptance criterion for that state is "all reachable", which is what the
 * panel provides.
 *
 * Wider would fold neighbouring cities that a reader can plainly distinguish into
 * one row-list; narrower would leave a buried marker whose panel names the wrong
 * trip. Both are worse than a panel with one row too many.
 */
export const ZONE_RADIUS_PERCENT = 4;

/** The markers a reader would take for one place, in the order the panel lists them. */
export type MapZone = {
  /**
   * The slug of the zone's most recent trip — stable between two builds of the
   * same content, readable in the DOM, and the value a marker's `data-zone`
   * carries.
   */
  readonly id: string;
  /** Date descending, then slug ascending. Never empty. */
  readonly marks: readonly PlacedMark[];
};

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
 * **It is deliberately applied after `spreadCoincident`.** The nudge that pulls
 * two trips off a shared city is a percentage of the frame; converted here it
 * becomes a fixed distance in world units, so it grows on screen as the reader
 * zooms and the pair genuinely separates. Keeping the percentages would have
 * pinned them exactly as overlapped at every zoom level — the defect
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` records as this ticket's to
 * fix.
 */
export function worldPointOf(placed: PlacedMark, frame: Frame): Point {
  return {
    x: round(frame.x + (placed.leftPercent / 100) * frame.width),
    y: round(frame.y + (placed.topPercent / 100) * frame.height),
  };
}

/**
 * Groups the markers into zones by **single linkage**: a marker joins a zone as
 * soon as it is within {@link ZONE_RADIUS_PERCENT} of any one of its members.
 *
 * Single rather than complete linkage because the question is what a reader's
 * finger covers, and three markers half a radius apart are one clump on screen
 * even though the outer two are a full radius apart. Cutting the chain would open
 * a panel listing two of the three trips visibly under the pointer. The accepted
 * cost runs the other way: a long enough chain of near-neighbours becomes one
 * large zone, which is a panel with more rows rather than a marker that answers
 * nothing.
 *
 * Deterministic in three ways, because a prerendered page must be byte-identical
 * between two builds of the same content: the zones come out in the order their
 * first marker arrived, the members are sorted by date then slug rather than left
 * in input order, and the id is derived from that sort.
 */
export function zonesOf(placed: readonly PlacedMark[], frame: Frame): readonly MapZone[] {
  if (placed.length === 0) {
    return [];
  }

  /**
   * A percentage of the height is not the same number of pixels as a percentage
   * of the width: the world's box is 1.92 times wider than it is tall. Comparing
   * the raw percentages would group vertical neighbours nearly twice as eagerly
   * as horizontal ones, for no reason a reader could guess.
   *
   * A frame with no area is unreachable — `frameAround` throws for a world
   * without one and `placeMarks` answers nothing for a frame without one — and
   * the fallback of 1 is what keeps every marker in a zone of its own rather than
   * in no zone at all, which would be a marker whose activation opens nothing.
   */
  const verticalScale =
    Number.isFinite(frame.width) && Number.isFinite(frame.height) && frame.height > 0
      ? frame.width / frame.height
      : 1;

  const withinRadius = (a: PlacedMark, b: PlacedMark): boolean => {
    const dx = a.leftPercent - b.leftPercent;
    const dy = (a.topPercent - b.topPercent) / verticalScale;

    // A non-finite distance answers `false` — `NaN <= r` is false — so a marker
    // the framing could not measure becomes a zone of its own instead of joining
    // every zone at once.
    return Math.hypot(dx, dy) <= ZONE_RADIUS_PERCENT;
  };

  /**
   * Union-find, keyed on the marker objects rather than on their indices.
   *
   * `noUncheckedIndexedAccess` is on in this repository, and an index-keyed
   * forest cannot be written without a non-null assertion on every step of the
   * walk — `src/**` carries none, so the identity of the entries is the key
   * instead. The entries are unique object references (`placeMarks` maps one per
   * trip), and `rank` is what keeps the tie-break honest: a merge always points
   * the later-arriving representative at the earlier one, so a zone's
   * representative is its first marker and the grouping below comes out in input
   * order.
   */
  const rank = new Map<PlacedMark, number>(placed.map((entry, index) => [entry, index]));
  const representative = new Map<PlacedMark, PlacedMark>(placed.map((entry) => [entry, entry]));

  const rootOf = (entry: PlacedMark): PlacedMark => {
    let current = entry;
    for (;;) {
      const next = representative.get(current);
      if (next === undefined || next === current) {
        return current;
      }
      current = next;
    }
  };

  placed.forEach((a, index) => {
    for (const b of placed.slice(index + 1)) {
      if (!withinRadius(a, b)) {
        continue;
      }
      const rootA = rootOf(a);
      const rootB = rootOf(b);
      if (rootA === rootB) {
        continue;
      }
      const earlier = (rank.get(rootA) ?? 0) <= (rank.get(rootB) ?? 0) ? rootA : rootB;
      const later = earlier === rootA ? rootB : rootA;
      representative.set(later, earlier);
    }
  });

  const groups = new Map<PlacedMark, PlacedMark[]>();
  for (const entry of placed) {
    const root = rootOf(entry);
    const group = groups.get(root);
    if (group === undefined) {
      groups.set(root, [entry]);
    } else {
      group.push(entry);
    }
  }

  /**
   * `flatMap` and not `map`, so the zone's id can be read off the sorted list
   * without a non-null assertion. A group is never empty — every one is created
   * with its first member — so nothing is ever dropped here.
   *
   * The comparator uses plain string comparison and **not** `localeCompare`:
   * `YYYY-MM-DD` is already lexicographically ordered, and a locale-sensitive
   * compare would make a prerendered page depend on the collation of the machine
   * that built it.
   */
  return [...groups.values()].flatMap((group) => {
    const marks = [...group].sort((a, b) => {
      if (a.mark.startDate !== b.mark.startDate) {
        return a.mark.startDate < b.mark.startDate ? 1 : -1;
      }
      if (a.mark.slug === b.mark.slug) {
        return 0;
      }
      return a.mark.slug < b.mark.slug ? -1 : 1;
    });
    const newest = marks[0];

    return newest === undefined ? [] : [{ id: newest.mark.slug, marks }];
  });
}
