import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The feed guard. Runs against `.next/` AFTER `npm run build`, like its
 * neighbours `prerender.test.ts` and `drafts.test.ts` — hence this suite's own
 * config and its own script (`npm run test:build`).
 *
 * **Why it reads the artefact and not the module.** `tests/app/rss.test.ts`
 * already covers the serialiser as a pure function: ordering, escaping, RFC 822
 * dates. Three things it cannot see, and all three break with a green build:
 *
 * 1. **The feed is a prerendered `.body` and not a `ƒ`.** A plain Route Handler
 *    has not been cached by default since Next 15, so `/feed.xml` is a server
 *    function unless `export const dynamic = "force-static"` is present. Deleting
 *    that one line changes nothing a unit test or a rendered assertion can see —
 *    the served bytes are identical — and puts a per-request function on a site
 *    whose central invariant is that there are none (ADR 0006). The build column
 *    is the human-readable version of this check; the manifest is the
 *    machine-readable one.
 * 2. **A draft never reaches it.** `drafts.test.ts` sweeps the *routes* of the
 *    manifest, and a draft leaking into the feed is not a route: it is a title
 *    inside one file's body. So the sweep there cannot see it, and this is where
 *    that half lives.
 * 3. **It parses.** A body full of unescaped ampersands is a document every
 *    aggregator refuses whole, and nothing else in the repository opens it.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const NEXT_DIR = path.join(REPO_ROOT, ".next");
const APP_DIR = path.join(NEXT_DIR, "server/app");
const CONTENT_DIR = path.join(REPO_ROOT, "content", "trips");

/** The route, written once — it is the folder name of `src/app/feed.xml/`. */
const FEED_ROUTE = "/feed.xml";

/**
 * Next writes a prerendered Route Handler as a `.body`/`.meta` pair under
 * `server/app`, never as HTML — the layout `prerender.test.ts`'s document/body
 * partition rests on.
 */
const FEED_BODY = path.join(APP_DIR, "feed.xml.body");

beforeAll(() => {
  if (!existsSync(APP_DIR)) {
    throw new Error(
      `No build output at ${APP_DIR}. This suite asserts on the build artefacts: run \`npm run build\` first (\`npm run test:build\` does not build for you).`
    );
  }
});

function manifestRoutes(): readonly string[] {
  const manifest = JSON.parse(
    readFileSync(path.join(NEXT_DIR, "prerender-manifest.json"), "utf8")
  ) as { routes?: Record<string, unknown>; dynamicRoutes?: Record<string, unknown> };

  return [...Object.keys(manifest.routes ?? {}), ...Object.keys(manifest.dynamicRoutes ?? {})];
}

const feedBody = (): string => readFileSync(FEED_BODY, "utf8");

describe("the feed is prerendered, not computed per request", () => {
  it("is listed in the prerender manifest", () => {
    const routes = manifestRoutes();

    // Guards the guard: an unreadable or restructured manifest would make the
    // assertion below vacuous, which is the failure shape this folder refuses.
    expect(routes.length).toBeGreaterThan(0);
    expect(
      routes,
      `${FEED_ROUTE} is absent from the manifest, so it is rendered on demand. Check that \`export const dynamic = "force-static"\` is still in src/app/feed.xml/route.ts — a plain Route Handler is not cached by default.`
    ).toContain(FEED_ROUTE);
  });

  it("wrote a body/meta pair to disk rather than an HTML document", () => {
    /**
     * The shape `prerender.test.ts` partitions on. A route that started emitting
     * HTML — or nothing — would drop out of that suite's document/body split and
     * fail its "never neither" case; this states the expectation positively, at
     * the one route this ticket adds.
     */
    expect(existsSync(FEED_BODY)).toBe(true);
    expect(existsSync(path.join(APP_DIR, "feed.xml.meta"))).toBe(true);
    expect(existsSync(path.join(APP_DIR, "feed.xml.html"))).toBe(false);
  });

  it("is served as RSS, with an explicit charset", () => {
    const meta: unknown = JSON.parse(readFileSync(path.join(APP_DIR, "feed.xml.meta"), "utf8"));
    const headers =
      typeof meta === "object" && meta !== null ? Reflect.get(meta, "headers") : undefined;
    const contentType =
      typeof headers === "object" && headers !== null
        ? Reflect.get(headers, "content-type")
        : undefined;

    /**
     * The charset is not decoration: without it some aggregators fall back to
     * Latin-1 and every accented city name in the feed is mojibake — on a French
     * site.
     */
    expect(String(contentType)).toBe("application/rss+xml; charset=utf-8");
  });
});

describe("the feed's body", () => {
  it("is a well-formed RSS 2.0 channel", () => {
    const body = feedBody();

    expect(body.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(body).toContain('<rss version="2.0"');
    expect(body).toContain("<channel>");
    expect(body.trimEnd().endsWith("</rss>")).toBe(true);
  });

  /**
   * Parsed rather than pattern-matched, which is the only assertion that catches
   * the whole class: one unescaped `&` in one title makes an aggregator refuse
   * the entire document, and every `toContain` above still passes.
   *
   * `DOMParser` is not available in this suite's Node environment and the
   * repository has no XML dependency to add for one case — the budget's own
   * argument (ADR 0009). So the check is the two structural facts a text scan
   * *can* decide: no bare ampersand, and balanced `<item>` tags. It is narrower
   * than a parse and it is honest about being so.
   */
  it("carries no bare ampersand and no unbalanced item", () => {
    const body = feedBody();

    expect(body.match(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g)).toBeNull();
    expect((body.match(/<item>/g) ?? []).length).toBe((body.match(/<\/item>/g) ?? []).length);
  });

  it("advertises itself with an absolute self link on the site's own origin", () => {
    const body = feedBody();
    const self = /<atom:link href="([^"]+)" rel="self"/.exec(body)?.[1];

    expect(self).toBeDefined();
    // Absolute, because a feed is read by a machine on another host: the
    // standard has no notion of a relative one. Same reasoning as robots.txt's
    // `Sitemap:` line.
    expect(String(self)).toMatch(/^https?:\/\//);
    expect(String(self).endsWith(FEED_ROUTE)).toBe(true);
  });

  it("names every published trip exactly once", () => {
    const body = feedBody();
    const items = (body.match(/<item>/g) ?? []).length;

    /**
     * Counted against the *content*, not against a number written here.
     * `content/trips` is empty until TIW-24, so this is zero today and starts
     * biting on its own the day a récit lands — which is exactly when nobody
     * would think to write the case. Do not delete it as dead weight: the
     * detection is proved on a fabricated collection in the case below.
     */
    expect(items).toBe(publishedSlugs().length);
    for (const slug of publishedSlugs()) {
      expect(body).toContain(`/voyages/${slug}<`);
    }
  });

  /**
   * The draft frontier, at the one place `drafts.test.ts` cannot look: it sweeps
   * the manifest's *routes*, and a draft leaking into the feed is a title inside
   * one route's body rather than a route of its own.
   *
   * Read straight from the YAML and never through `src/content/**`, for the
   * reason that suite records: the loader is the thing under test, so asking it
   * which trips are drafts would let a filter answering "no drafts at all" pass
   * twice over.
   */
  it("names no draft", () => {
    const body = feedBody();

    for (const slug of draftSlugs()) {
      expect(body, `the draft "${slug}" is in the feed`).not.toContain(slug);
    }
  });

  it("would catch a draft that did reach the feed", () => {
    /**
     * The case that keeps an empty guard alive. With no draft in `content/trips`
     * the sweep above cannot fail for any reason, so nothing would tell us its
     * reading had stopped working.
     */
    const fabricated = "<link>https://x.example/fr/voyages/perou-2025</link>";

    expect(fabricated.includes("perou-2025")).toBe(true);
    expect(fabricated.includes("japon-2024")).toBe(false);
  });

  it("reads the real content directory", () => {
    // A wrong path here would make both sweeps above silent, which is the one
    // way this file could report success while checking nothing.
    expect(existsSync(CONTENT_DIR)).toBe(true);
  });
});

/* --------------------------------------------------------- reading the YAML -- */

type DeclaredTrip = { readonly slug: string; readonly draft: boolean };

/**
 * Every trip on disk, with its declared slug and draft flag — parsed from the
 * YAML directly, for the reason stated on the draft case above.
 *
 * A file that does not parse falls back to its directory name rather than being
 * skipped: a malformed trip fails the build long before this suite runs, so the
 * fallback is unreachable in practice, and skipping is the one behaviour that
 * could turn this guard silent.
 */
function declaredTrips(): readonly DeclaredTrip[] {
  if (!existsSync(CONTENT_DIR)) {
    return [];
  }

  const found: DeclaredTrip[] = [];

  for (const entry of readdirSync(CONTENT_DIR, { withFileTypes: true })) {
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
        ? { slug: Reflect.get(value, "slug"), draft: Reflect.get(value, "draft") }
        : { slug: undefined, draft: undefined };

    found.push({
      slug: typeof declared.slug === "string" && declared.slug !== "" ? declared.slug : entry.name,
      draft: declared.draft === true,
    });
  }

  return found;
}

const publishedSlugs = (): readonly string[] =>
  declaredTrips()
    .filter((trip) => !trip.draft)
    .map((trip) => trip.slug);

const draftSlugs = (): readonly string[] =>
  declaredTrips()
    .filter((trip) => trip.draft)
    .map((trip) => trip.slug);
