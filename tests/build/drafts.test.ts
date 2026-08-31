import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The draft guard. Runs against `.next/` AFTER `npm run build`, like its
 * neighbour `prerender.test.ts` — hence this suite's own config and its own
 * script (`npm run test:build`).
 *
 * Why it exists: `draft: true` is the only field in this project that decides
 * whether hand-written content is **published**, and it fails in the direction
 * that says nothing. A publication filter reading the wrong environment variable
 * puts an unfinished trip online with a green build, a green test suite and a
 * green validator — the trip is simply *there*, and nobody is told. The unit
 * suite proves the filter answers correctly when asked; only the build artefact
 * says what was actually written to disk for a CDN to serve.
 *
 * **This suite is empty today, and that is correct rather than useless.**
 * `content/trips/` holds nothing but a `.gitkeep` until TIW-24 lands the real
 * trips, so there is no draft to check and the sweep below passes over an empty
 * list. It starts biting on its own the day somebody writes `draft: true` — which
 * is exactly when the guard is needed and exactly when nobody would think to write
 * it. **Do not delete it as dead weight**; the case named "would catch a draft
 * that did get prerendered" is here to keep the mechanism honest in the meantime,
 * by proving the detection on a fabricated leak.
 *
 * The manifest is read the way `prerender.test.ts` reads it: the route-status
 * column of the build output is the human-readable version, the manifest is the
 * machine-readable one.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const NEXT_DIR = path.join(REPO_ROOT, ".next");
const CONTENT_DIR = path.join(REPO_ROOT, "content", "trips");

type DraftTrip = {
  /** The slug **declared in the file**, which is what a URL is built from. */
  readonly slug: string;
  readonly file: string;
};

/**
 * Every trip that declares `draft: true`, read straight from the YAML rather than
 * through `src/content/**`.
 *
 * Deliberately not through the loader: the loader is the thing under test here. It
 * is the module that decides what publishes, so asking it which trips are drafts
 * would make the guard agree with itself — a filter that answered "no drafts at
 * all" would pass this suite twice over.
 *
 * A file that does not parse, or that declares no slug, falls back to the
 * directory name instead of being skipped. A malformed trip fails the build long
 * before this suite runs, so the fallback is unreachable in practice; skipping
 * would be the one behaviour that could turn this guard silent, which is the
 * failure mode it exists to prevent.
 */
function draftTrips(): readonly DraftTrip[] {
  if (!existsSync(CONTENT_DIR)) {
    return [];
  }

  const found: DraftTrip[] = [];

  for (const entry of readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    // Dot-entries are ignored across the whole content pipeline (`.gitkeep`,
    // `.DS_Store`), and a trip is a directory containing a `trip.yaml`.
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const file = path.join(CONTENT_DIR, entry.name, "trip.yaml");
    if (!existsSync(file)) {
      continue;
    }

    let value: unknown;
    try {
      value = parse(readFileSync(file, "utf8"));
    } catch {
      value = undefined;
    }

    const declared =
      typeof value === "object" && value !== null
        ? { draft: Reflect.get(value, "draft"), slug: Reflect.get(value, "slug") }
        : { draft: undefined, slug: undefined };

    if (declared.draft !== true) {
      continue;
    }

    found.push({
      slug: typeof declared.slug === "string" && declared.slug !== "" ? declared.slug : entry.name,
      file,
    });
  }

  return found;
}

/** Every route the build committed to prerendering, static and dynamic alike. */
function prerenderedRoutes(): readonly string[] {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(NEXT_DIR, "prerender-manifest.json"), "utf8")
  );

  const keysOf = (field: string): readonly string[] => {
    const value =
      typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, field) : undefined;

    return typeof value === "object" && value !== null ? Object.keys(value) : [];
  };

  // Both maps: a draft leaking as a dynamic entry is leaking just the same.
  return [...keysOf("routes"), ...keysOf("dynamicRoutes")];
}

/**
 * The manifest entry of the trip detail route, found by its dynamic segment
 * rather than by a hard-coded path so a route rename fails loudly here instead of
 * silently emptying the assertion below.
 */
function tripRouteEntry(): Record<string, unknown> {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(NEXT_DIR, "prerender-manifest.json"), "utf8")
  );

  const dynamicRoutes =
    typeof manifest === "object" && manifest !== null
      ? Reflect.get(manifest, "dynamicRoutes")
      : undefined;

  if (typeof dynamicRoutes !== "object" || dynamicRoutes === null) {
    throw new Error(
      "prerender-manifest.json carries no `dynamicRoutes` map. Either the build did not run or the manifest changed shape — in both cases the assertion below would pass by reading nothing."
    );
  }

  const key = Object.keys(dynamicRoutes).find((route) => route.endsWith("/[slug]"));
  if (key === undefined) {
    throw new Error(
      `No dynamic route ending in /[slug] in the manifest, so the trip detail route was not found. Routes: ${Object.keys(dynamicRoutes).join(", ")}. If the route was renamed, rename it here too — do not delete this case.`
    );
  }

  const entry = Reflect.get(dynamicRoutes, key);

  return typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
}

/**
 * The slugs that appear as a **path segment** of a prerendered route.
 *
 * Segment-wise, and not `route.includes(slug)`, for two reasons that pull in
 * opposite directions: a substring match would flag `/fr/japon-2024-photos` for a
 * draft called `japon-2024`, and it would also depend on a route shape nobody has
 * chosen yet. The trip page arrives with TIW-24; whether its URL reads
 * `/fr/voyages/<slug>` or `/fr/trips/<slug>`, the slug is a segment of it, so this
 * predicate survives that decision.
 *
 * Pure, and separated from the two readers above, so the mechanism can be tested
 * on a fabricated leak while the real collection holds no draft.
 */
function leakedSlugs(slugs: readonly string[], routes: readonly string[]): readonly string[] {
  return slugs.filter((slug) => routes.some((route) => route.split("/").includes(slug)));
}

beforeAll(() => {
  if (!existsSync(NEXT_DIR)) {
    throw new Error(
      `No build output at ${NEXT_DIR}. This suite asserts on the build artefacts: run \`npm run build\` first (\`npm run test:build\` does not build for you).`
    );
  }
});

describe("a draft trip is absent from the build output", () => {
  const drafts = draftTrips();

  it("keeps every declared draft slug out of the prerender manifest", () => {
    const routes = prerenderedRoutes();

    /**
     * Guards the guard: an unreadable or restructured manifest would make the
     * sweep below vacuously green, which is the shape of failure this whole
     * `tests/build/` folder exists to refuse.
     */
    expect(routes.length).toBeGreaterThan(0);

    const leaked = leakedSlugs(
      drafts.map((draft) => draft.slug),
      routes
    );

    // Named in the failure message: the point is to say *which* draft went online.
    expect(leaked, `drafts declared in ${CONTENT_DIR} yet prerendered`).toEqual([]);
  });

  /**
   * The case that keeps an empty guard alive. With no draft in `content/trips/`
   * the sweep above cannot fail for any reason, so nothing would tell us that its
   * predicate had stopped working — a `split("/")` turned into a `startsWith`, a
   * manifest field renamed. This one asserts the detection itself, on a route list
   * written here.
   */
  it("would catch a draft that did get prerendered", () => {
    const routes = ["/fr", "/_not-found", "/fr/voyages/perou-2025", "/fr/voyages/japon-2024-bis"];

    expect(leakedSlugs(["perou-2025"], routes)).toEqual(["perou-2025"]);
    // Not a substring match: a published trip whose slug merely contains a
    // draft's must not be reported, and the other way round.
    expect(leakedSlugs(["japon-2024"], routes)).toEqual([]);
  });

  /**
   * **`dynamicParams = false` on the trip route, read off the artefact.**
   *
   * This is the other half of the draft frontier, and until now no test held it:
   * `grep -rn "dynamicParams" tests/` answered nothing, so the line could be
   * deleted with the whole suite green. The sweep above cannot see it either — it
   * looks for a draft slug as a route *segment*, and the dynamic key
   * `/[locale]/voyages/[slug]` contains no slug at all.
   *
   * Why the flag is load-bearing rather than a performance setting, measured
   * during the TIW-11 audit: without it, a slug absent from
   * `generateStaticParams` is **rendered on demand**. The draft's `trip.yaml` is
   * traced into the server function's bundle, `process.env.TIW_DRAFTS` survives as
   * a *runtime* read, and the publish/hide decision is taken per request — the
   * URL answered 200 with the draft, and removing the variable did not unpublish
   * at once because the ISR cache served it one more time.
   *
   * What the manifest says, and it is a clean two-state signal:
   *
   *   with    `dynamicParams = false` -> { fallback: false }
   *   without it                      -> { fallback: null, compute: "blocking" }
   *
   * So `fallback === false` is the artefact-level spelling of the flag, and the
   * absence of `compute` is the artefact-level spelling of "no per-request
   * function". Both are asserted: the two together cannot be satisfied by a
   * manifest that merely changed shape.
   */
  it("keeps the trip route closed to slugs it did not prerender", () => {
    const entry = tripRouteEntry();

    expect(entry.fallback).toBe(false);
    expect(entry).not.toHaveProperty("compute");
  });

  /**
   * And the reading half, which the case above cannot see: that `draftTrips()`
   * still finds a `draft: true` on disk. It asserts nothing about the count —
   * zero is the right answer today — only that the collection was read where the
   * trips actually live, so a wrong path cannot make this suite silent.
   */
  it("reads the real content directory", () => {
    expect(existsSync(CONTENT_DIR)).toBe(true);
    expect(drafts.every((draft) => draft.file.startsWith(CONTENT_DIR))).toBe(true);
  });
});
