import { geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import RAW_TOPOLOGY from "world-atlas/countries-110m.json";
import { z } from "zod";
import { createRoundingPathContext } from "./path-context";
import { worldProjection } from "./projection";

/**
 * The world's coastlines, turned into SVG paths once at build time.
 *
 * Nothing here ever reaches a browser: the bundler inlines the TopoJSON into
 * this server module, the geometry is projected while the page is prerendered,
 * and only the resulting `d` strings are handed to the renderer. Verified on a
 * real build — `grep -rl` over `.next/static` finds neither `d3-geo` nor
 * `topojson` nor `world-atlas`. That is criterion 1 of TIW-12, and it is why no
 * part of `world-atlas` is copied into `public/`.
 */

/**
 * **Why the 110m vintage is the default, and what it costs.**
 *
 * Measured on this repository, paths projected and rounded to one decimal,
 * brotli-compressed:
 *
 * | vintage | geometries | paths, brotli |
 * | ------- | ---------- | ------------- |
 * | 110m    | 177        | 30.1 KB       |
 * | 50m     | 241        | 182.5 KB      |
 *
 * A factor of six, on the single largest thing a page of this site ships.
 * `AGENTS.md` budgets 150 KB brotli of initial JS and 120 KB is already spent —
 * so the 50m vintage does not fit *and* the paths are not JS, meaning the true
 * page weight would grow past the budget without the budget noticing. 110m is
 * the default because a world map at the size this site draws it cannot resolve
 * more anyway.
 *
 * **What 110m does not contain.** No micro-state. Verified absent from 110m and
 * present in 50m: Singapore (702), Monaco (492), Malta (470), San Marino (674),
 * Liechtenstein (438), Andorra (020), Bahrain (048), Maldives (462). A trip to
 * Singapore is not an exotic scenario, so the failure for those codes is its own
 * message in `world.ts`, and it names the way out: `world-atlas` already ships
 * `countries-50m.json` and `countries-10m.json`, so switching vintage adds no
 * dependency — it adds ~152 KB brotli to every page. That is a budget decision,
 * not a checkbox, and the paths budget test caps them at 34 KB precisely so a
 * silent switch fails instead of shipping.
 *
 * Switching means editing the `import` at the top of this file *and* the
 * `DATASET_MODULE` constant below it, for the reason given there.
 */

/** The resolution, as the package names it — quoted in the error messages. */
export const DATASET_RESOLUTION = "110m";

/**
 * The next vintage up, named here so the failure for an absent country can point
 * at the exact specifier to swap in. Already shipped by the package: switching
 * costs bundle weight, not a dependency. Weights are in the table above.
 */
export const RICHER_DATASET_MODULE = "world-atlas/countries-50m.json";

/** The `objects` key holding one geometry per country. */
const COUNTRIES_OBJECT = "countries";

/**
 * **The dataset is a static `import`, and it has to be. Do not turn this back
 * into a file read.**
 *
 * This module was first written with `readFileSync(createRequire(import.meta.url).resolve(…))`
 * — the honest-looking form, and the one that does not survive a bundler,
 * because it asks a question at *runtime* that a bundler answers at *build
 * time*. Both of ours break, differently, which is what makes the failure hard
 * to recognise:
 *
 * - **Turbopack** (`next build`) replaces `require.resolve` with a stub that
 *   returns a *numeric module id*. `readFileSync(38788)` then treats `38788` as
 *   a file descriptor, and the prerender of `/fr` dies with
 *   `Error: EBADF: bad file descriptor, read` — an error naming neither the
 *   dataset nor this module.
 * - **webpack** (`next build --webpack`) fails earlier and more plainly:
 *   `Cannot find module 'world-atlas/countries-110m.json'`.
 *
 * A static import has neither problem: the specifier is resolved by the bundler
 * while it builds the graph, the JSON is inlined into this server module, and
 * there is no filesystem call left to go wrong. It also means one less way for
 * the dataset to be missing at runtime — it either compiles or it does not.
 *
 * The three arguments the earlier version made against this form were all weak,
 * and they are recorded here so they are not made again: the `tsc` cost of the
 * inferred JSON type is negligible with `skipLibCheck` and `resolveJsonModule`
 * (measured: no change in typecheck time); "keeping the dataset out of the
 * module graph" was never a goal, since a server module is exactly where it
 * belongs; and Turbopack, webpack and Vitest all read a `.json` specifier
 * without an import attribute — only bare Node ESM needs `with { type: "json" }`,
 * and nothing loads this module that way.
 *
 * **Why this was not caught the first time.** The build was green because
 * *nothing in `src/**` imported `@/map`*, so `dataset.ts` was never in the graph
 * `next build` walked. A green build over a module no page imports proves
 * nothing — the same trap invariant 1 of `AGENTS.md` describes for the prerender
 * guard. The proof is a page that actually calls `buildWorldGeometry` and a
 * prerender that completes.
 */

/**
 * The specifier above, repeated as data for the error messages.
 *
 * It cannot be derived from the import: an import specifier must be a literal,
 * so the bundler can resolve it before anything runs. The two therefore have to
 * be kept in step by hand — and the failure mode is mild, a correct build that
 * quotes the wrong filename in an error, which is why this is a comment and not
 * a runtime check.
 */
export const DATASET_MODULE = "world-atlas/countries-110m.json";

/**
 * **How deep the validation goes, and where it deliberately stops.**
 *
 * Only the skeleton this module reads is parsed: that `objects.countries` holds
 * a non-empty array of geometries, that each `id` is either absent or a
 * three-digit string, and that each `properties.name` is a non-blank string.
 *
 * The arc encoding — `arcs`, `transform`, the delta-encoded positions — is *not*
 * validated, and that is a measured choice rather than laziness. Describing 177
 * TopoJSON geometries in Zod means walking every coordinate of every ring, which
 * is tens of thousands of numbers parsed to prove something `topojson-client`
 * will fail on anyway, loudly, one line later. What Zod is here for is the
 * failure mode `topojson-client` does *not* produce: a vintage of the package
 * that renames a key or changes the id encoding, which otherwise surfaces as
 * `undefined` flowing into a join that silently matches nothing.
 *
 * So the guarantee is precise: if this parse passes, the two fields this module
 * joins on exist and have the right shape. It is not a guarantee that the
 * topology is well-formed.
 *
 * `looseObject`, not `strictObject`: the dataset legitimately carries keys this
 * module ignores (`arcs`, `type`, `bbox`), and rejecting them would turn every
 * upstream addition into a build failure for no benefit.
 */
const GeometrySkeletonSchema = z.looseObject({
  /**
   * Three digits as a *string*, which is how ISO 3166-1 numeric is written and
   * how `iso-3166.ts` stores it. `"20"` or `20` would both be a real code in
   * spirit and would silently join with nothing, so the shape is pinned rather
   * than coerced: this is the one field the whole join hangs on.
   */
  id: z
    .string()
    .regex(/^[0-9]{3}$/, "Expected a zero-padded three-digit ISO 3166-1 numeric code.")
    .optional(),
  properties: z.looseObject({
    name: z.string().refine((value) => value.trim().length > 0, {
      message: "Expected a non-blank country label.",
    }),
  }),
});

const DatasetSchema = z.looseObject({
  type: z.literal("Topology"),
  objects: z.looseObject({
    [COUNTRIES_OBJECT]: z.looseObject({
      type: z.literal("GeometryCollection"),
      geometries: z.array(GeometrySkeletonSchema).min(1),
    }),
  }),
});

/**
 * One country's drawable geometry, before anything localised is attached.
 *
 * `id` is `null` — never `undefined` — for the three geometries that carry no
 * identifier at all, so the absence is a value the join can test rather than a
 * missing property it might forget to check.
 */
type CountryGeometry = {
  readonly id: string | null;
  /**
   * The dataset's own English label. It is a Natural Earth *display* string —
   * `"N. Cyprus"`, `"Dem. Rep. Congo"`, `"Bosnia and Herz."` — abbreviated for a
   * map legend and normalised against no registry. It is kept only as the last
   * resort name for the three unidentified territories; it must never be joined
   * on (criterion 2).
   */
  readonly datasetName: string;
  readonly path: string;
};

export type WorldDataset = {
  /** Dataset order, which is the order the background layer is painted in. */
  readonly geometries: readonly CountryGeometry[];
};

/**
 * Projected once per process, as an optimisation and only as one.
 *
 * What it buys is real — projecting 177 geometries is the expensive half of this
 * module, and it is redone for nothing on every page of the build without it.
 * What it does *not* buy is any correctness property: `world.ts` derives its
 * shapes in a single pass over `geometries`, so the referential identity that
 * `visited` promises holds within one call whether or not this cache exists.
 * Verified by mutation — with both caches disabled, `tests/map` stays green,
 * identity assertions included.
 *
 * That distinction is worth keeping straight: a comment that promotes an
 * optimisation to an invariant is a comment that forbids a legitimate change.
 * Sharing is safe because everything reachable from the returned object is
 * frozen, so no consumer can alter what the next page reads.
 */
let cached: WorldDataset | undefined;

export function loadWorldDataset(): WorldDataset {
  cached ??= readWorldDataset();
  return cached;
}

function readWorldDataset(): WorldDataset {
  const parsed = DatasetSchema.safeParse(RAW_TOPOLOGY);

  if (!parsed.success) {
    throw new Error(
      `${DATASET_MODULE} is not the shape this build expects — the package vintage probably changed.\n${z.prettifyError(parsed.error)}`
    );
  }

  const skeletons = parsed.data.objects[COUNTRIES_OBJECT].geometries;

  /**
   * One cast, at the I/O boundary, and only after the parse above.
   *
   * `topojson-client` is typed against `topojson-specification`, whose
   * `Topology` describes the arc encoding this module deliberately does not
   * re-validate. `unknown` has to be crossed once for the library to be usable
   * at all; the parse is what makes it honest, and the two `type` discriminants
   * checked below are what a wrong shape trips on before any arc is read.
   */
  const topology = parsed.data as unknown as Topology;
  const countries: unknown = topology.objects[COUNTRIES_OBJECT];

  if (!isGeometryCollection(countries)) {
    throw new Error(`${DATASET_MODULE} has no "${COUNTRIES_OBJECT}" GeometryCollection to draw.`);
  }

  const converted = feature(topology, countries);

  if (converted.features.length !== skeletons.length) {
    throw new Error(
      `${DATASET_MODULE} converted to ${converted.features.length} features for ${skeletons.length} geometries — the two cannot be paired.`
    );
  }

  const context = createRoundingPathContext();
  const buildPath = geoPath(worldProjection, context);
  const geometries: CountryGeometry[] = [];
  /**
   * Local, and deliberately not part of `WorldDataset`. Its only reader is the
   * collision check below; publishing it on a memoised singleton would hand
   * every caller a *mutable* `Map` whose `.delete("392")` outlives the call and
   * silently un-draws Japan for the rest of the process.
   */
  const byNumericId = new Map<string, CountryGeometry>();

  for (const [index, skeleton] of skeletons.entries()) {
    const converted_ = converted.features[index];
    // Unreachable after the length check above; `noUncheckedIndexedAccess` wants
    // it said out loud, and saying it is cheaper than an assertion that lies.
    if (converted_ === undefined) {
      throw new Error(`${DATASET_MODULE} geometry ${index} converted to nothing.`);
    }

    // `geoPath` returns whatever the context's own `result` returns, and d3's
    // wrapper defines that as a no-op — so the path is read from the context.
    buildPath(converted_);
    const path = context.result();

    if (path === "") {
      throw new Error(
        `${DATASET_MODULE} geometry ${index} (${skeleton.properties.name}) projects to an empty path: it would render as nothing at all.`
      );
    }

    const geometry: CountryGeometry = Object.freeze({
      id: skeleton.id ?? null,
      datasetName: skeleton.properties.name,
      path,
    });
    geometries.push(geometry);

    if (geometry.id === null) {
      continue;
    }

    /**
     * Criterion 3 says a declared code must resolve to *exactly one* geometry.
     * The alpha-2 table already guarantees "at most one" on its side — one
     * numeric per code, checked there — and this is the other half: a vintage
     * that split a country into two entries sharing an id would otherwise make
     * the join pick whichever came last, silently.
     */
    const clash = byNumericId.get(geometry.id);
    if (clash !== undefined) {
      throw new Error(
        `${DATASET_MODULE} has two geometries for ISO 3166-1 numeric ${geometry.id} (${clash.datasetName} and ${geometry.datasetName}): a country code can only resolve to one shape.`
      );
    }
    byNumericId.set(geometry.id, geometry);
  }

  return Object.freeze({ geometries: Object.freeze(geometries) });
}

/**
 * Narrows the `Objects` index signature — which `noUncheckedIndexedAccess` hands
 * over as possibly `undefined`, and whose value type is a union of every
 * TopoJSON geometry — down to the one member `feature()` maps over.
 */
function isGeometryCollection(candidate: unknown): candidate is GeometryCollection {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "type" in candidate &&
    candidate.type === "GeometryCollection"
  );
}
