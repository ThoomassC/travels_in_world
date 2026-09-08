import { geoArea, geoMercator, geoPath } from "d3-geo";
import type { GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import RAW_TOPOLOGY from "world-atlas/countries-50m.json";
import { NUMERIC_BY_ALPHA2 } from "@/iso-3166";

/**
 * One country, drawn on its own, small enough to sit in a suggestion row.
 *
 * **Why this exists rather than a crop of the world map.** `./dataset.ts` projects
 * every country into one 960 × 500 world box; a 40 px tile of France taken from
 * that would be France at 1/24th of its size — four pixels of coastline. A tile is
 * a country *fitted to its own frame*, which is a different projection per
 * country, so the geometry has to be re-projected rather than cropped. That is
 * also why this module converts the TopoJSON a second time: the dataset keeps only
 * the `d` strings it produced, and a `d` cannot be re-projected.
 *
 * **Mercator and not the map's Natural Earth I.** Natural Earth is a *world*
 * projection: its meridians curve, which is right for a planisphere and shears a
 * single country visibly at this size — Norway leans. Mercator is conformal, so
 * a country keeps the outline a reader recognises, and its notorious flaw (an
 * area that grows towards the poles) does not exist inside one frame containing
 * one country.
 *
 * **What it costs: 3.3 KB for the five countries this carnet reaches**, as the
 * `d` strings this module emits — France 658 bytes, Greece 1403. The table under
 * {@link simplify} is how it got there from 23.6 KB, and why the answer was a
 * simplification rather than a coarser grid.
 *
 * Paid **once per document**: `search-index.tsx` emits one `<symbol>` per distinct
 * country and every row references it, so thirteen trips over five countries cost
 * five paths and not thirteen.
 */

/** The tile's box, in the units `./search-art.ts` mirrors. Square, 1 unit ≈ 1 px. */
export const TILE_BOX = 40;

/**
 * The margin the country is fitted inside.
 *
 * Three units, so a coastline never touches the tile's own border and the dot of a
 * place on the coast — Héraklion, Les Sables-d'Olonne — stays inside the drawing
 * rather than half-eaten by the edge.
 */
const TILE_PADDING = 3;

/**
 * The grid coordinates are snapped to. Half a CSS pixel at the size this renders:
 * see the table above for what the other values cost and buy.
 */
const QUANTUM = 0.5;

/**
 * A ring narrower and shorter than this is dropped.
 *
 * One and a half pixels. Greece has several hundred islands and Spain has the
 * Canaries; at this size each is a speck of noise indistinguishable from a stray
 * point, and together they were the larger half of the bytes. Stated rather than
 * hidden, because it *is* a loss: a country whose whole territory is small islands
 * would come out empty, and `countryTile` returns `undefined` for an empty path so
 * the caller draws no tile rather than an empty box.
 */
const MIN_RING = 1.5;

/**
 * How far a simplified outline may stray from the real one, in tile units — a
 * third of a CSS pixel at the size this renders. See {@link simplify}.
 */
const EPSILON = 0.35;

/**
 * How far outside the box a ring may stray before it is dropped entirely.
 *
 * **This is the other half of the mainland fit below, and without it the fit is
 * pointless.** France's 50m feature is not the hexagon: it carries French Guiana,
 * Réunion, Martinique, Mayotte. Fitting the *feature* put all of them in frame and
 * metropolitan France came out eight units wide — measured, and it is what the
 * first version of this module did. The fit is therefore computed on the largest
 * landmass alone, which leaves the others projected far off the box; they are
 * dropped here. Corsica, half a tile from Marseille, is kept — as are the Balearics
 * for Spain and Crete for Greece, which is the point of not simply drawing one ring.
 */
const RING_MARGIN = TILE_BOX;

export type TilePoint = {
  readonly x: number;
  readonly y: number;
};

export type CountryTile = {
  /** ISO 3166-1 alpha-2, uppercase. */
  readonly code: string;
  /** The outline, in a `0 0 40 40` box. Never empty — see {@link countryTile}. */
  readonly path: string;
  /** Where a coordinate lands in that same box, or `undefined` off the frame. */
  readonly place: (coordinates: { readonly lat: number; readonly lon: number }) => TilePoint;
};

/**
 * **Ramer–Douglas–Peucker**, on a ring already projected into the tile's box.
 *
 * The whole simplification, and the reason it is here rather than a coarser grid.
 * Quantising alone was the first version — snap every point to a half unit, drop
 * the ones that became identical — and it is a blunt instrument: along a straight
 * coast it keeps a point every half pixel although a single segment would draw the
 * same line. Measured on the five countries this carnet reaches, as emitted `d`:
 *
 * | simplification                   | FR   | ES   | GR   | BE   | CH   | total  |
 * | -------------------------------- | ---- | ---- | ---- | ---- | ---- | ------ |
 * | round to 0.1 only                | 7402 | 4764 | 8185 | 1502 | 1742 | 23.6 KB|
 * | quantise to 0.5, drop duplicates | 2381 | 1292 | 3932 | 1098 | 1220 |  9.9 KB|
 * | RDP ε 0.35, **then** quantise    |  658 |  301 | 1403 |  414 |  492 |  3.3 KB|
 *
 * Three times smaller than the grid alone, for a deviation nobody can see. That
 * is the whole argument for carrying thirty lines of Douglas–Peucker rather than
 * a coarser grid: a coarser grid buys the same bytes by making the coastline a
 * staircase, and this buys them by not writing the points a straight line does
 * not need.
 *
 * ε is in tile units, so **0.35 is a third of a CSS pixel** at the size this
 * renders: a deviation nobody can see on a 40 px drawing, on any display.
 *
 * Iterative rather than recursive: a 50m ring runs to thousands of points, and the
 * recursion depth of the textbook version is the ring's length in the worst case.
 */
function simplify(points: readonly (readonly [number, number])[], epsilon: number): readonly (readonly [number, number])[] {
  if (points.length < 3) {
    return points;
  }

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const segment = stack.pop();
    if (segment === undefined) {
      break;
    }
    const [from, to] = segment;
    const start = points[from] as readonly [number, number];
    const end = points[to] as readonly [number, number];

    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);

    let worst = -1;
    let worstIndex = -1;

    for (let index = from + 1; index < to; index += 1) {
      const point = points[index] as readonly [number, number];
      /*
        Distance to the *segment*, and to the start point when the segment has no
        length — which happens on a closed ring whose two ends coincide, and which
        a plain line-distance formula answers with a division by zero.
      */
      const distance =
        length === 0
          ? Math.hypot(point[0] - start[0], point[1] - start[1])
          : Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) /
            length;

      if (distance > worst) {
        worst = distance;
        worstIndex = index;
      }
    }

    if (worst > epsilon && worstIndex > 0) {
      keep[worstIndex] = true;
      stack.push([from, worstIndex], [worstIndex, to]);
    }
  }

  return points.filter((_point, index) => keep[index] === true);
}

/**
 * A path context that buffers each ring, simplifies it, snaps what survives to the
 * half-unit grid, and refuses a ring too small or too far away to draw.
 *
 * **Written here rather than reusing `./path-context.ts`**, which rounds and
 * nothing else. Rounding alone leaves 23.6 KB for these five countries, because a
 * 50m coastline emits dozens of points inside one pixel of this tile and rounding
 * them writes the same pair dozens of times. The saving is in the *dropping*, and
 * the world map has no use for it: at 960 units wide, its points genuinely differ.
 */
function tileContext(): {
  readonly moveTo: (x: number, y: number) => void;
  readonly lineTo: (x: number, y: number) => void;
  readonly closePath: () => void;
  readonly beginPath: () => void;
  readonly arc: () => void;
  readonly rect: () => void;
  readonly result: () => string;
} {
  let out = "";
  let points: [number, number][] = [];

  const snap = (value: number): number => Math.round(value / QUANTUM) * QUANTUM;

  const flush = (): void => {
    if (points.length >= 3) {
      const kept = simplify(points, EPSILON);

      let drawn = "";
      let lastX = Number.NaN;
      let lastY = Number.NaN;
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let commands = 0;

      for (const [x, y] of kept) {
        const nextX = snap(x);
        const nextY = snap(y);
        if (nextX === lastX && nextY === lastY) {
          continue;
        }
        drawn += `${commands === 0 ? "M" : "L"}${nextX},${nextY}`;
        commands += 1;
        lastX = nextX;
        lastY = nextY;
        minX = Math.min(minX, nextX);
        maxX = Math.max(maxX, nextX);
        minY = Math.min(minY, nextY);
        maxY = Math.max(maxY, nextY);
      }

      /*
        Three ways a ring fails to make it into the tile.

        Fewer than three commands: the smallest thing that can enclose an area, and
        below it a ring is a line — which `fill` paints as nothing anyway.

        Smaller than {@link MIN_RING}: a speck, and there are hundreds of them.

        Entirely off the box: an overseas territory, left far outside by the fit.
        Judged on the ring's own bounds and not by clipping the coordinates,
        because a clip would flatten Guiana against the frame's edge and draw a
        strip of coastline belonging to no visible coast.
      */
      const visible =
        maxX > -RING_MARGIN &&
        minX < TILE_BOX + RING_MARGIN &&
        maxY > -RING_MARGIN &&
        minY < TILE_BOX + RING_MARGIN;

      if (commands >= 3 && visible && (maxX - minX >= MIN_RING || maxY - minY >= MIN_RING)) {
        out += `${drawn}Z`;
      }
    }

    points = [];
  };

  return {
    beginPath(): void {
      out = "";
      points = [];
    },
    moveTo(x: number, y: number): void {
      flush();
      points.push([x, y]);
    },
    lineTo(x: number, y: number): void {
      points.push([x, y]);
    },
    /** d3 calls this at the end of every ring; the flush is where a ring is judged. */
    closePath(): void {
      flush();
    },
    /** d3's `PathContext` requires both; a country outline never calls either. */
    arc(): void {},
    rect(): void {},
    result(): string {
      flush();
      const done = out;
      out = "";
      return done;
    },
  };
}

const topology = RAW_TOPOLOGY as unknown as Topology<{ countries: GeometryCollection }>;

/**
 * Converted once per process, for the reason `./dataset.ts` memoises its own pass:
 * the conversion is the expensive half, and every locale of every page would
 * otherwise redo it.
 */
let featuresByNumeric: Map<string, GeoPermissibleObjects> | undefined;

function featureFor(numeric: string): GeoPermissibleObjects | undefined {
  if (featuresByNumeric === undefined) {
    const collection = feature(topology, topology.objects.countries);
    featuresByNumeric = new Map(
      collection.features.map((shape) => [String(shape.id), shape as GeoPermissibleObjects])
    );
  }

  return featuresByNumeric.get(numeric);
}

/** Every outer ring of a Polygon or MultiPolygon, in dataset order. */
function outerRingsOf(shape: GeoPermissibleObjects): readonly number[][][] {
  const geometry = (shape as { geometry?: { type: string; coordinates: unknown } }).geometry;
  if (geometry === undefined) {
    return [];
  }

  if (geometry.type === "Polygon") {
    const ring = (geometry.coordinates as number[][][])[0];
    return ring === undefined ? [] : [ring];
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][])
      .map((polygon) => polygon[0])
      .filter((ring): ring is number[][] => ring !== undefined);
  }

  return [];
}

const asPolygons = (rings: readonly number[][][]): GeoPermissibleObjects =>
  ({
    type: "MultiPolygon",
    coordinates: rings.map((ring) => [ring]),
  }) as unknown as GeoPermissibleObjects;

/**
 * **WHAT THE TILE IS FITTED TO, IN TWO PASSES — and one pass is not enough, which
 * cost two rounds of measurement to establish.**
 *
 * Fitting the *whole feature* was the first version and it is plainly wrong:
 * France's 50m feature carries French Guiana, Réunion, Martinique and Mayotte, so
 * an extent covering all four left metropolitan France **eight units wide** in a
 * forty-unit box, with Rouen and Corsica 3.8 units apart. Nobody would call that a
 * map of France.
 *
 * Fitting the **largest landmass alone** fixes the frame and breaks the contents:
 * everything else is then projected wherever it falls, and *some of it belongs* —
 * Corsica came out at 40.5, half a pixel past the frame and clipped by the
 * viewport; Crete fell right off Greece's tile, taking Héraklion with it, which is
 * the one place in the carnet that country holds.
 *
 * So: fit to the mainland, ask that projection which other rings land anywhere
 * near the box, and re-fit to the mainland **and those**. Corsica and the
 * Balearics and Crete are in; Guiana and the Canaries are a box-width away and
 * stay out. One extra projection per country, at build time, once.
 *
 * Largest by **spherical area** and not by bounding box: a bounding box makes an
 * archipelago strung across an ocean the biggest thing a country owns, which for
 * Greece would have picked the Aegean over the mainland.
 */
function fittedProjection(shape: GeoPermissibleObjects): ReturnType<typeof geoMercator> {
  const extent: [[number, number], [number, number]] = [
    [TILE_PADDING, TILE_PADDING],
    [TILE_BOX - TILE_PADDING, TILE_BOX - TILE_PADDING],
  ];

  const rings = outerRingsOf(shape).filter((ring) => ring.length >= 4);

  if (rings.length === 0) {
    return geoMercator().fitExtent(extent, shape);
  }

  let mainland = rings[0] as number[][];
  let bestArea = -1;
  for (const ring of rings) {
    const area = geoArea({ type: "Polygon", coordinates: [ring] });
    if (area > bestArea) {
      bestArea = area;
      mainland = ring;
    }
  }

  const first = geoMercator().fitExtent(extent, asPolygons([mainland]));

  const near = rings.filter((ring) =>
    ring.some((position) => {
      const projected = first([position[0] as number, position[1] as number]);
      if (projected === null) {
        return false;
      }
      const [x, y] = projected;
      return (
        x > -RING_MARGIN && x < TILE_BOX + RING_MARGIN && y > -RING_MARGIN && y < TILE_BOX + RING_MARGIN
      );
    })
  );

  return geoMercator().fitExtent(extent, asPolygons(near.length === 0 ? [mainland] : near));
}

const cache = new Map<string, CountryTile | undefined>();

/**
 * The tile for one country, or `undefined` when the dataset has nothing to draw.
 *
 * `undefined` rather than a throw, and the asymmetry with `buildWorldGeometry` is
 * deliberate: a country missing from the *world map* is a hole a reader sees, and
 * the build should stop. A country missing from a *suggestion's vignette* costs
 * that row its 40 px drawing and nothing else — the row still says where the trip
 * went, in words. Failing the build over an ornament would be the wrong trade, and
 * the caller renders no tile.
 */
export function countryTile(code: string): CountryTile | undefined {
  const upper = code.toUpperCase();
  const cached = cache.get(upper);
  if (cached !== undefined || cache.has(upper)) {
    return cached;
  }

  const numeric = NUMERIC_BY_ALPHA2.get(upper);
  const shape = numeric === undefined ? undefined : featureFor(numeric);

  if (shape === undefined) {
    cache.set(upper, undefined);
    return undefined;
  }

  const projection = fittedProjection(shape);

  const context = tileContext();
  // `geoPath` hands back whatever the context's `result` returns, and d3 types that
  // as `void`; the path is read from the context. Same shape as `./dataset.ts`.
  geoPath(projection, context)(shape);
  const path = context.result();

  const tile: CountryTile | undefined =
    path === ""
      ? undefined
      : {
          code: upper,
          path,
          place: ({ lat, lon }) => {
            const projected = projection([lon, lat]);

            /*
              `null` is unreachable for a Mercator fitted to a country and asked
              for a point inside it, but it is in the signature and a coordinate
              typo could reach it. The tile's centre is the honest answer: a dot
              in the middle of the country is wrong by a few pixels, and an
              exception here would take down a page over an ornament.
            */
            const [x, y] = projected ?? [TILE_BOX / 2, TILE_BOX / 2];

            return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
          },
        };

  cache.set(upper, tile);

  return tile;
}
