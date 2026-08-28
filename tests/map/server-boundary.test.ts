import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryRoot } from "./support";

/**
 * The mechanical half of invariant 3 of `AGENTS.md`, for the map.
 *
 * The bet of this project is that the world geometry is computed at build time
 * and the browser receives none of the machinery: no d3, no topojson-client, and
 * above all not the 100 kB dataset. Nothing in the type system defends that. A
 * `'use client'` component that imports a map module ships every transitive
 * dependency of it into the client bundle, and the build stays green — the page
 * simply gets heavier, which is invisible without a bundle report.
 *
 * `import "server-only"` is what turns that into a build failure, and the split
 * this ticket settled on is deliberate and narrow: **exactly one** module carries
 * it, `src/map/index.ts`, the façade. Every other module under `src/map/**` is
 * plain TypeScript that a Node script and Vitest can import directly.
 *
 * Both halves of that sentence are load-bearing, and both are asserted below.
 * The "no other module carries it" half is not tidiness: the moment a second
 * module declares the guard, every static import in `tests/map/**` fails at
 * *resolution* — `server-only` is not a resolvable dependency of this repository,
 * it lives inside `node_modules/next/dist/compiled/` where only Next's bundler
 * aliases it. The whole map suite would go from green to "Failed to resolve
 * import", and the fix would look like it belonged in `vitest.config.ts` (a global
 * alias neutralising the guard for every suite in the repository) rather than in
 * the module that broke it.
 *
 * The `travels-in-world/map-entry-point` ESLint rule is the other half of the
 * boundary — it keeps `src/**` outside the map from bypassing the façade — and
 * `tests/lint/map-entry-point.test.ts` proves that rule actually refuses
 * something.
 */

const SERVER_ONLY_GUARD = 'import "server-only";';

const FACADE_RELATIVE_PATH = "src/map/index.ts";

/**
 * Production modules of `src/map/**`, read from disk. Co-located specs are
 * excluded: `vitest.config.ts` allows a spec beside the file it tests, and a spec
 * has no business declaring a server guard.
 */
function mapModules(): readonly string[] {
  const mapDir = path.join(repositoryRoot(), "src", "map");
  const entries = readdirSync(mapDir, { recursive: true, encoding: "utf8" });

  return entries
    .filter((entry) => /\.(ts|tsx|mts|cts)$/.test(entry))
    .filter((entry) => !/\.test\.(ts|tsx|mts|cts)$/.test(entry))
    .map((entry) => path.posix.join("src/map", entry.split(path.sep).join("/")))
    .sort();
}

function sourceOf(relativePath: string): string {
  return readFileSync(path.join(repositoryRoot(), relativePath), "utf8");
}

describe("the geometry dataset never reaches the client", () => {
  /**
   * `public/` is served verbatim, with no bundler and no guard in front of it. A
   * TopoJSON parked there — as a build artefact, or copied while debugging — is a
   * 100 kB public URL that no test, no lint rule and no bundle report mentions,
   * because nothing imports it.
   *
   * The directory does not exist at all today, which is the strongest form of the
   * guarantee. This case exists so that the day it appears, adding a geometry file
   * to it fails here instead of shipping.
   */
  it("parks no geometry file under public/", () => {
    const publicDir = path.join(repositoryRoot(), "public");
    const suspects = existsSync(publicDir) ? geometryFilesUnder(publicDir) : [];

    expect(suspects).toEqual([]);
  });
});

/**
 * Two independent signatures, because a geometry file need not be named like one
 * and need not be a `.json`: the name test catches `countries-110m.json` copied
 * verbatim, the content test catches the same data renamed to `world.json` or
 * `data.txt`. The read is capped rather than whole-file — the markers sit in the
 * first bytes of a TopoJSON, and `public/` may legitimately hold large assets.
 */
function geometryFilesUnder(directory: string): readonly string[] {
  const entries = readdirSync(directory, { recursive: true, encoding: "utf8" });

  return entries
    .map((entry) => ({ entry, absolute: path.join(directory, entry) }))
    .filter(({ absolute }) => statSync(absolute).isFile())
    .filter(({ entry, absolute }) => {
      if (/countries-\d+m\.json$/.test(entry)) {
        return true;
      }
      const head = readFileSync(absolute, "utf8").slice(0, 4096);
      return head.includes('"Topology"') || head.includes("topojson");
    })
    .map(({ entry }) => entry)
    .sort();
}

describe("the server guard sits on the façade and nowhere else", () => {
  /**
   * The control that keeps the two cases below from passing over an empty folder.
   * A `readdirSync` that answered `[]` — a renamed directory, a typo in the path —
   * would satisfy "no other module carries the guard" perfectly.
   */
  it("finds the map modules it is supposed to be checking", () => {
    const modules = mapModules();

    expect(modules).toContain(FACADE_RELATIVE_PATH);
    expect(modules.length).toBeGreaterThan(1);
  });

  /**
   * The façade is the only module `src/app/**` may import, so it is the only place
   * the guard can do its job. Drop it here and the whole boundary becomes
   * documentary: nothing fails, and a client component pulls the dataset in.
   */
  it("declares the guard on src/map/index.ts", () => {
    expect(sourceOf(FACADE_RELATIVE_PATH)).toContain(SERVER_ONLY_GUARD);
  });

  /**
   * And nowhere else — the half whose violation is the trap this ticket walked
   * into and out of. The failure names the offending files, because "expected 0 to
   * be 1" sends its reader through seven modules by hand.
   */
  it("declares the guard on no other module of src/map", () => {
    const alsoGuarded = mapModules()
      .filter((relativePath) => relativePath !== FACADE_RELATIVE_PATH)
      .filter((relativePath) => sourceOf(relativePath).includes("server-only"));

    expect(alsoGuarded).toEqual([]);
  });
});

describe("the guard actually bites", () => {
  /**
   * Proved, not assumed. The two cases above read the *text* of a file, which
   * would still pass if `server-only` became a no-op — an alias in a config, a
   * stub committed by mistake, a dependency that resolves to an empty module.
   * This case executes the import instead.
   *
   * `await import(...)` and not a static import, deliberately: a static
   * `import "@/map/index"` is resolved when this file is transformed, so it would
   * take the whole test file down with an unhandled resolution error rather than
   * producing a failure — there would be nothing left to assert with. The dynamic
   * form defers resolution to the moment the promise is created, which is what
   * makes the rejection observable.
   *
   * What is asserted is the *reason*: the rejection has to name `server-only`. A
   * bare `rejects.toThrow()` would be green while the façade did not exist at all,
   * or was renamed, or had a syntax error — three ways to pass without a guard.
   *
   * This case is coupled to "declares the guard on src/map/index.ts" above and
   * neither stands alone: remove the guard and this one flips green (nothing left
   * to reject), so the text assertion is what keeps it honest. Read them as one
   * test in two halves.
   */
  it("refuses to load the façade outside a server context", async () => {
    await expect(import("@/map/index")).rejects.toThrow(/server-only/);
  });

  /**
   * The counterpart, and the reason the split exists in the first place: the
   * modules behind the façade must stay importable by a plain Node consumer — this
   * suite, and `npm run validate:content`-style scripts. If this starts failing,
   * a guard has spread past the façade and `tests/map/**` is about to be "fixed"
   * with a global alias.
   */
  it("still loads the modules behind the façade", async () => {
    await expect(import("@/map/world")).resolves.toHaveProperty("buildWorldGeometry");
    await expect(import("@/map/projection")).resolves.toHaveProperty("projectPoint");
    await expect(import("@/map/iso-3166")).resolves.toHaveProperty("NUMERIC_BY_ALPHA2");
  });
});
