import { roundCoordinate } from "./path-context";
import type { ProjectedPoint } from "./projection";

/**
 * **Where a country's own note is hung** — one point, provably inside the shape.
 *
 * TIW-39 gives a third state to the map (« à venir ») and puts an HTML element
 * over each country in it, carrying the words in the overlay where every other
 * interactive thing on this map lives. That element needs a single anchor, and
 * the two cheap answers are both wrong on real geography — measured on the 50m
 * basemap this site ships:
 *
 * | candidate                     | Croatie          | Portugal              |
 * | ----------------------------- | ---------------- | --------------------- |
 * | centre of the bounding box    | in Bosnia        | in the Atlantic       |
 * | area-weighted centroid        | in Bosnia        | in the Atlantic       |
 * | pole of inaccessibility       | in Croatia       | in Portugal           |
 *
 * Croatia is a boomerang, so its middle is not in it; Portugal's shape includes
 * the Azores and Madeira, so an average of everything is pulled 600 km out to
 * sea. A note drawn on a neighbour is worse than no note: it labels the wrong
 * country, in words, with confidence. So the anchor is the **pole of
 * inaccessibility** — the interior point furthest from any edge — which is what
 * map-labelling libraries compute and the one definition that is inside the shape
 * by construction rather than by luck.
 *
 * **Why it reads the `d` string rather than the GeoJSON.** `src/map/dataset.ts`
 * projects each country once and keeps only the finished path; the feature is
 * gone by the time anything downstream knows which countries are wished for.
 * Re-projecting to recover it would mean either a second pass over 240
 * geometries or widening `CountryGeometry` for every one of them, to serve a
 * handful. The path is already in the exact coordinate space the overlay needs —
 * the projected 960 × 500 world — so parsing it back is both the cheapest and the
 * most direct route. The vocabulary is tiny and fixed: `createRoundingPathContext`
 * writes `M`, `L` and `Z`, and nothing else.
 *
 * Pure, and free of d3: it is arithmetic over numbers, so the degenerate cases
 * are worth a dozen cheap unit cases rather than a dozen renders. Nothing here
 * imports the façade, so `tests/map/anchor.test.ts` runs it under plain Vitest.
 */

/** A closed ring, in projected world units, in the order the path wrote it. */
export type Ring = readonly ProjectedPoint[];

/**
 * Exactly the vocabulary `createRoundingPathContext` emits, anchored end to end.
 *
 * Anchored on purpose: a partial match would silently read the first half of a
 * path it does not understand and answer an anchor for a shape it never saw.
 * `Z` closes; the closing segment is implicit and is never stored, so a ring's
 * last point is not its first.
 */
const RING = /M(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)((?:L-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?)*)Z/g;
const VERTEX = /L(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;

/**
 * The rings of a projected country path, or **nothing at all** if the string
 * holds one character this module does not understand.
 *
 * The all-or-nothing answer is the point. A country whose path carried an arc or
 * a cubic would otherwise yield a partial outline, and a partial outline gives a
 * plausible anchor for a shape that does not exist. Answering `[]` makes the
 * caller decide, which — for the one caller there is — means no note rather than
 * a wrong one.
 */
export function ringsOfPath(path: string): readonly Ring[] {
  const rings: Ring[] = [];
  let consumed = 0;

  RING.lastIndex = 0;
  for (let match = RING.exec(path); match !== null; match = RING.exec(path)) {
    // Anything between two rings — or before the first — is a command this
    // module does not read, so the whole path is refused below.
    if (match.index !== consumed) {
      return [];
    }
    consumed = match.index + match[0].length;

    const points: ProjectedPoint[] = [{ x: Number(match[1]), y: Number(match[2]) }];
    const rest = match[3] ?? "";

    VERTEX.lastIndex = 0;
    for (let vertex = VERTEX.exec(rest); vertex !== null; vertex = VERTEX.exec(rest)) {
      points.push({ x: Number(vertex[1]), y: Number(vertex[2]) });
    }

    rings.push(points);
  }

  return consumed === path.length ? rings : [];
}

/**
 * How fine the search gets, as a fraction of the largest ring's longest side.
 *
 * The result only has to be *comfortably* inside a country and stable between two
 * builds — it is where a 44 px note hangs, not a survey mark. Four rounds of
 * eight-by-eight refinement narrow the cell to (1/8)⁴ of the first one, which is
 * far below the tenth of a viewBox unit every coordinate is rounded to anyway, so
 * the extra precision would be rounded away.
 */
const GRID = 24;
const REFINEMENTS = 4;
const REFINEMENT_GRID = 8;

/**
 * The point of a country the note is drawn on: inside the shape, as far from any
 * edge as this search can find.
 *
 * `null` when the path holds no ring with an area — an unreadable path, or a
 * degenerate one. The caller renders no note rather than one at `(0, 0)`, which
 * is the north-west corner of the Atlantic.
 *
 * **The search area is the largest ring; the containment test is every ring.**
 * Those are two different questions and conflating them is what puts Portugal in
 * the sea. The largest ring says *where to look* — the mainland rather than an
 * archipelago — while whether a candidate is really in the country is an even-odd
 * count over all the rings at once, which is also what makes a hole a hole:
 * Lesotho sits inside South Africa as a second ring, and an even-odd test refuses
 * every point in it without needing to know which rings are holes.
 */
export function labelAnchorOf(path: string): ProjectedPoint | null {
  const rings = ringsOfPath(path);
  const largest = largestRing(rings);

  if (largest === null) {
    return null;
  }

  const box = boundingBox(largest);
  let best: { readonly point: ProjectedPoint; readonly clearance: number } | null = null;
  let cell = Math.max(box.width, box.height) / GRID;

  for (let round = 0; round <= REFINEMENTS; round += 1) {
    const area: Box =
      best === null
        ? box
        : {
            x: best.point.x - cell,
            y: best.point.y - cell,
            width: cell * 2,
            height: cell * 2,
          };
    const steps = round === 0 ? GRID : REFINEMENT_GRID;

    for (let column = 0; column <= steps; column += 1) {
      for (let row = 0; row <= steps; row += 1) {
        const candidate: ProjectedPoint = {
          x: area.x + (area.width * column) / steps,
          y: area.y + (area.height * row) / steps,
        };

        if (!isInside(rings, candidate)) {
          continue;
        }

        const clearance = distanceToEdges(rings, candidate);
        if (best === null || clearance > best.clearance) {
          best = { point: candidate, clearance };
        }
      }
    }

    // The next round searches a box of ±`cell` around the winner, in
    // `REFINEMENT_GRID` steps, so its own cell is that box divided by the grid.
    cell = (cell * 2) / REFINEMENT_GRID;
  }

  /**
   * Rounded exactly like a path coordinate, and for the same reason: the number
   * is written into the served HTML as a custom property, so two builds of the
   * same content have to agree on it to the byte. `roundCoordinate` is the one
   * place that decides how many decimals a world unit carries.
   */
  return best === null
    ? null
    : { x: roundCoordinate(best.point.x), y: roundCoordinate(best.point.y) };
}

/** The ring enclosing the most area, ignoring winding — `null` if none does. */
function largestRing(rings: readonly Ring[]): Ring | null {
  let best: Ring | null = null;
  let bestArea = 0;

  for (const ring of rings) {
    const area = Math.abs(signedArea(ring));
    if (area > bestArea) {
      best = ring;
      bestArea = area;
    }
  }

  return best;
}

/** The shoelace formula, on the implicitly closed ring. */
function signedArea(ring: Ring): number {
  let total = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    if (a === undefined || b === undefined) {
      continue;
    }
    total += a.x * b.y - b.x * a.y;
  }

  return total / 2;
}

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

function boundingBox(ring: Ring): Box {
  const xs = ring.map((point) => point.x);
  const ys = ring.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/**
 * Even-odd containment over every ring at once, which is what makes holes free:
 * a point inside both South Africa's outline and Lesotho's crosses two boundaries
 * and comes out even, therefore outside.
 */
function isInside(rings: readonly Ring[], point: ProjectedPoint): boolean {
  let crossings = 0;

  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (a === undefined || b === undefined) {
        continue;
      }
      if (a.y > point.y !== b.y > point.y) {
        const crossX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (crossX > point.x) {
          crossings += 1;
        }
      }
    }
  }

  return crossings % 2 === 1;
}

/** The distance from a point to the nearest edge of any ring. */
function distanceToEdges(rings: readonly Ring[], point: ProjectedPoint): number {
  let nearest = Number.POSITIVE_INFINITY;

  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (a === undefined || b === undefined) {
        continue;
      }
      nearest = Math.min(nearest, distanceToSegment(point, a, b));
    }
  }

  return nearest;
}

function distanceToSegment(
  point: ProjectedPoint,
  a: ProjectedPoint,
  b: ProjectedPoint
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  // A zero-length edge is a repeated vertex, which the dataset does produce at
  // the seams of merged geometries: fall back to the distance to the point.
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));

  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}
