import { afterEach, describe, expect, it, vi } from "vitest";
import { readMapSource, stripComments } from "./support";

/**
 * `src/map/dataset.ts`: the TopoJSON reader. Two very different kinds of guard
 * live here, and the file is ordered accordingly.
 *
 * First the source-text guard on *how* the dataset is reached, which is a
 * regression test for a real production break. Then the behaviour of the reader
 * itself, driven by substituting the dataset at its package boundary.
 */

const DATASET_SOURCE_PATH = "src/map/dataset.ts";

const DATASET_SPECIFIER = "world-atlas/countries-110m.json";

/**
 * A ring in raw degrees, big enough to project to a visible polygon. No
 * `transform` is declared on the topologies below, so `topojson-client` treats
 * arc coordinates as absolute — which keeps every fixture readable as longitude
 * and latitude rather than as delta-encoded integers.
 *
 * **Wound counter-clockwise, and it matters.** d3-geo reads a ring as a
 * *spherical* polygon, where orientation decides which side is the inside. The
 * clockwise spelling of this same box — `[0,0] [10,0] [10,10] [0,10]` — is the
 * complement: everything on earth *except* the box. Measured, it projects to a
 * 60-vertex path tracing the whole sphere outline, which is a perfectly valid
 * path and a fixture that proves nothing about drawing a country.
 */
const RING: readonly (readonly number[])[] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
  [0, 0],
];

/** A drawable country, id `"004"`, used as the valid baseline of every fixture. */
const ALPHA = { type: "Polygon", arcs: [[0]], id: "004", properties: { name: "Alpha" } };

function topology(geometries: readonly unknown[], arcs: readonly unknown[] = [RING]): unknown {
  return {
    type: "Topology",
    arcs,
    objects: { countries: { type: "GeometryCollection", geometries } },
  };
}

/**
 * Loads `dataset.ts` against a substituted dataset and returns what happened.
 *
 * **What is being replaced, and why that is legitimate.** The mock target is
 * `world-atlas/countries-110m.json` — a third-party data file, the system input
 * of this module, exactly the kind of boundary a test is allowed to control. No
 * module of this project is mocked: `dataset.ts`, `path-context.ts` and
 * `projection.ts` all run for real, and the paths below are produced by the real
 * `geoNaturalEarth1`.
 *
 * The alternative would have been to mutate `node_modules/world-atlas`, or to add
 * a seam to production code purely for the test. The first is not reversible in a
 * suite, the second is API surface nobody calls.
 *
 * `vi.resetModules()` is required rather than tidy: `dataset.ts` memoises the
 * parsed dataset in a module-level `cached`, so without a fresh module registry
 * the second fixture would silently read the first one's result and every case
 * after it would pass for the wrong reason.
 */
async function loadWith(raw: unknown): Promise<{ error: string | null; paths: string[] }> {
  vi.doMock(DATASET_SPECIFIER, () => ({ default: raw }));
  vi.resetModules();

  const { loadWorldDataset } = await import("@/map/dataset");

  try {
    const dataset = loadWorldDataset();
    return { error: null, paths: dataset.geometries.map((geometry) => geometry.path) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), paths: [] };
  }
}

/** The message of a load that must fail; fails the test loudly if it succeeded. */
async function failureOf(raw: unknown): Promise<string> {
  const { error } = await loadWith(raw);
  expect(error, "the dataset loaded successfully when it should have been refused").not.toBeNull();

  return error ?? "";
}

afterEach(() => {
  vi.doUnmock(DATASET_SPECIFIER);
  vi.resetModules();
});

describe("the dataset is reached by static import, never by a file read", () => {
  /**
   * THE REGRESSION GUARD FOR A BREAK THAT SHIPPED. Do not weaken it.
   *
   * `dataset.ts` was first written as
   * `readFileSync(createRequire(import.meta.url).resolve(DATASET_MODULE), "utf8")`
   * — the form that looks careful, and the form no bundler survives, because it
   * asks at *runtime* a question the bundler answered at *build time*. The two
   * bundlers of this project fail differently, which is what made it hard to
   * recognise:
   *
   * - **Turbopack** (`next build`) stubs `require.resolve` to return a *numeric
   *   module id*, so `readFileSync(38788)` treats 38788 as a **file descriptor**:
   *   `Error: EBADF: bad file descriptor, read`, then
   *   `⨯ Next.js build worker exited with code: 1`. The error names neither the
   *   dataset nor the module.
   * - **webpack** (`next build --webpack`) fails plainly:
   *   `Cannot find module 'world-atlas/countries-110m.json'`.
   *
   * **Why the suite could not see it, and the lesson that outlives this test.**
   * Vitest was green throughout: Vite leaves `createRequire` alone, so under
   * Vitest the file read genuinely works. And `next build` was green too — for a
   * worse reason. *Nothing in `src/**` imported `@/map`*, so `dataset.ts` was
   * never in the graph the build walked. **A green build over a module no page
   * imports proves nothing.** That is the same trap invariant 1 of `AGENTS.md`
   * describes for the prerender guard, and it is why this guard reads source text
   * instead of waiting for a build to complain.
   *
   * **What this test is and is not.** It is a text assertion, in the same family
   * as the `server-only` guards in `server-boundary.test.ts`, and its limits are
   * accepted deliberately: real falsification needs a `next build` with a page
   * that calls `buildWorldGeometry`, which cannot live in a build-free unit suite.
   * What it does buy is that the specific construct which broke production cannot
   * come back without turning a test red.
   */
  it.each(["createRequire", "require.resolve", "readFileSync", "node:fs", "node:module"])(
    "does not use %s to reach the dataset",
    (forbidden) => {
      const code = stripComments(readMapSource(DATASET_SOURCE_PATH));

      expect(code).not.toContain(forbidden);
    }
  );

  /**
   * The control that stops the cases above from passing over a mangled haystack.
   * A `stripComments` that ate the whole file — or a renamed source path — would
   * satisfy every "does not contain" assertion perfectly.
   */
  it("strips comments without eating the code", () => {
    const source = readMapSource(DATASET_SOURCE_PATH);
    const code = stripComments(source);

    expect(code).toContain("export function loadWorldDataset");
    expect(code).toContain("DatasetSchema");
    // The comments are the bulk of this file; the code is a real fraction of it.
    expect(code.length).toBeGreaterThan(1000);
    expect(code.length).toBeLessThan(source.length);
  });

  /** The positive half: the dataset arrives as a compile-time resolved import. */
  it("imports the dataset statically", () => {
    const code = stripComments(readMapSource(DATASET_SOURCE_PATH));

    expect(code).toMatch(
      new RegExp(`import\\s+\\w+\\s+from\\s+["']${DATASET_SPECIFIER.replace("/", "\\/")}["']`)
    );
  });

  /**
   * And the explanation stays. This is the one assertion here that reads the
   * source *with* its comments, because the comment is load-bearing: without the
   * two measured error signatures written down, "resolve the dataset at runtime
   * so it is not in the module graph" reads like a reasonable refactor. It was
   * tried, and it broke the build in a way that named nothing.
   */
  it("keeps the two measured failure signatures written down", () => {
    const source = readMapSource(DATASET_SOURCE_PATH);

    expect(source).toContain("EBADF");
    expect(source).toContain("Cannot find module");
  });
});

describe("a dataset whose shape the build does not recognise", () => {
  /**
   * The failure mode this parse exists for: a `world-atlas` release that renames
   * a key or changes the id encoding. Without the parse it does not fail — it
   * produces `undefined` flowing into a join that matches nothing, i.e. a map
   * where no country is ever marked visited and no error is raised.
   *
   * Every row is a different way the vintage could drift, and each asserts that
   * the message names the dataset *and* points at the offending path, because
   * "the shape changed" without a location is a message that starts a bisect.
   */
  it.each([
    {
      label: "a topology whose type is not Topology",
      raw: { ...(topology([ALPHA]) as object), type: "Nope" },
      at: "at type",
    },
    {
      label: "a topology with no countries object",
      raw: { type: "Topology", arcs: [], objects: { land: {} } },
      at: "at objects.countries",
    },
    {
      label: "a countries collection with no geometries at all",
      raw: topology([]),
      at: "at objects.countries.geometries",
    },
    {
      label: "an id that is not zero-padded to three digits",
      raw: topology([{ ...ALPHA, id: "04" }]),
      at: "at objects.countries.geometries[0].id",
    },
    {
      label: "an id encoded as a number instead of a string",
      raw: topology([{ ...ALPHA, id: 4 }]),
      at: "at objects.countries.geometries[0].id",
    },
    {
      label: "a country label that is blank",
      raw: topology([{ ...ALPHA, properties: { name: "  " } }]),
      at: "at objects.countries.geometries[0].properties.name",
    },
  ])("refuses $label, and says where", async ({ raw, at }) => {
    const message = await failureOf(raw);

    expect(message).toContain(DATASET_SPECIFIER);
    expect(message).toContain("the package vintage probably changed");
    expect(message).toContain(at);
  });

  /**
   * `"04"` and `4` are the two spellings that would be a real ISO 3166-1 code *in
   * spirit* and join with nothing in practice, since the table stores zero-padded
   * strings. They get their own case because they are the only rows above whose
   * failure is about a value rather than a missing key — and because a schema
   * relaxed to `z.coerce.string()` would let both through while every other row
   * here stayed red.
   */
  it("explains what a well-formed id looks like", async () => {
    expect(await failureOf(topology([{ ...ALPHA, id: "04" }]))).toContain(
      "zero-padded three-digit"
    );
  });
});

describe("a dataset that parses but cannot be drawn", () => {
  /**
   * A geometry that projects to nothing. `MultiPolygon` with no rings passes the
   * skeleton parse — it has an id and a name — and yields an empty `d`, which SVG
   * renders as absolutely nothing: no error, no shape, a hole in the coastline.
   * The only way to notice without this guard is to look at the picture.
   */
  it("refuses a geometry that projects to an empty path, and names it", async () => {
    const message = await failureOf(
      topology([{ type: "MultiPolygon", arcs: [], id: "008", properties: { name: "Void" } }])
    );

    expect(message).toContain("empty path");
    expect(message).toContain("Void");
    expect(message).toContain("geometry 0");
  });

  /**
   * THE OTHER HALF OF ACCEPTANCE CRITERION 3, and it was covered by nothing.
   *
   * The criterion is that a declared code resolves to *exactly one* geometry.
   * `iso-3166.test.ts` proves the "at most one" on the table's side — one numeric
   * per alpha-2. This is the dataset's side: a vintage that split a country into
   * two entries sharing an id. Without the check the join takes whichever came
   * last, silently, and the map shades half a country.
   *
   * The message has to name both labels, because the actionable question is
   * *which two* entries collided.
   */
  it("refuses two geometries sharing one numeric id, and names both", async () => {
    const message = await failureOf(topology([ALPHA, { ...ALPHA, properties: { name: "Beta" } }]));

    expect(message).toContain("004");
    expect(message).toContain("Alpha");
    expect(message).toContain("Beta");
    expect(message).toContain("can only resolve to one shape");
  });
});

describe("the controls that keep the fixtures above honest", () => {
  /**
   * Without this, a fixture builder that produced garbage would make every
   * "refuses" case above pass for the wrong reason — the load would fail on the
   * fixture, not on the defect the case is about.
   */
  it("loads a minimal well-formed topology and draws it", async () => {
    const { error, paths } = await loadWith(topology([ALPHA]));

    expect(error).toBeNull();
    expect(paths).toHaveLength(1);
    // A closed box, drawn through the real projection: four corners and a `Z`.
    // Pinned exactly rather than by a shape regex, because the value is what
    // proves the fixture's winding is the interior of the box and not its
    // complement — the complement is also a valid path, just a useless fixture.
    expect(paths[0]).toBe("M480,250L480,219.2L506.5,219.2L506.6,250Z");
  });

  /**
   * A geometry with no `id` is the normal case for three entries of the real
   * dataset, so it must not be mistaken for a defect — and it must not collide
   * with another id-less entry either, which is what the duplicate check would do
   * if it keyed on `null`.
   */
  it("accepts several geometries carrying no id at all", async () => {
    const { error, paths } = await loadWith(
      topology([
        { type: "Polygon", arcs: [[0]], properties: { name: "Nowhere" } },
        { type: "Polygon", arcs: [[0]], properties: { name: "Elsewhere" } },
      ])
    );

    expect(error).toBeNull();
    expect(paths).toHaveLength(2);
  });

  /**
   * Proves the substitution is really in force. If `vi.doMock` silently stopped
   * applying, every fixture above would be loading the real 177-geometry dataset
   * — where none of the defects exist — and every "refuses" case would fail
   * rather than pass, but this one says so in one line instead of six.
   */
  it("is really reading the substituted dataset and not the real one", async () => {
    const { paths } = await loadWith(topology([ALPHA]));

    expect(paths).toHaveLength(1);
  });
});
