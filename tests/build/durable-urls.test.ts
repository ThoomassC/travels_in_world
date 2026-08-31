import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The durable-address guard. Runs against `.next/` AFTER `npm run build`, like its
 * two neighbours — hence this suite's own config and `npm run test:build`.
 *
 * WHY IT EXISTS, and it is not the same reason as `prerender.test.ts`. Everything
 * it checks is a *string inside a prerendered document*, and every one of them
 * fails silently:
 *
 * - a page that forgets its own canonical **inherits the layout's**, which is the
 *   home page's URL. The page renders correctly, the build is green, and the page
 *   has asked a crawler to drop it in favour of the home page. Nothing in the route
 *   column, the manifest or the E2E suite can see that.
 * - `metadataBase` unset makes Next fall back to `http://localhost:3000` with a
 *   warning nobody reads in CI, and every canonical and every `og:image` on the site
 *   then names a machine no crawler can reach.
 * - `sitemap.xml` and the set of prerendered pages are produced by two different
 *   code paths, so they can disagree — a page absent from the sitemap, or worse, a
 *   URL advertised in it that carries `noindex`.
 *
 * The route list is READ FROM THE MANIFEST, never written down here, for the reason
 * `prerender.test.ts` records at length: a list derived from the artefact cannot
 * drift from the artefact, and TIW-24's trips arrive already covered.
 */

const NEXT_DIR = path.resolve(import.meta.dirname, "../../.next");
const APP_DIR = path.join(NEXT_DIR, "server/app");

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
  ) as { routes?: Record<string, unknown> };

  return Object.keys(manifest.routes ?? {}).sort();
}

const documentPath = (route: string) => path.join(APP_DIR, `${route.replace(/^\//, "")}.html`);

/**
 * The prerendered HTML documents a reader can land on — every manifest route with a
 * document on disk, minus Next's own internal pages.
 *
 * Derived rather than filtered by locale prefix: this suite has no `@/` alias
 * (`vitest.build.config.ts` sets none, on purpose — it reads artefacts, not source),
 * and hardcoding `/fr` would stop covering the routes of a second locale on the very
 * day one is added. `/_not-found` and `/_global-error` are excluded because they are
 * error states, and an error state must NOT claim to be the canonical address of
 * anything — which is itself asserted below.
 */
function readerFacingRoutes(): readonly string[] {
  return manifestRoutes().filter(
    (route) => !route.startsWith("/_") && existsSync(documentPath(route))
  );
}

const READER_FACING_ROUTES = readerFacingRoutes();

const documentHtml = (route: string) => readFileSync(documentPath(route), "utf8");

function canonicalOf(html: string): string | undefined {
  return /<link rel="canonical" href="([^"]+)"\s*\/?>/.exec(html)?.[1];
}

function metaContent(
  html: string,
  attribute: "property" | "name",
  key: string
): string | undefined {
  const pattern = new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"\\s*/?>`);

  return pattern.exec(html)?.[1];
}

describe("the guard has something to read", () => {
  it("derived at least the two reader-facing routes the project cannot lose", () => {
    /**
     * Guards the guard, in the shape `prerender.test.ts` uses. An empty list makes
     * every `describe.each` below generate zero tests and report success for having
     * read nothing — the exact failure mode this folder exists to refuse.
     */
    expect(
      READER_FACING_ROUTES.length,
      "No reader-facing prerendered route was derived from the manifest, so every assertion below ran on nothing."
    ).toBeGreaterThanOrEqual(2);
    expect(READER_FACING_ROUTES).toContain("/fr");
    expect(READER_FACING_ROUTES).toContain("/fr/voyages");
  });
});

describe.each(READER_FACING_ROUTES)("%s declares its own canonical address", (route) => {
  it("carries a canonical at all", () => {
    // Absent means inherited-or-nothing, and both are wrong: see the header.
    expect(canonicalOf(documentHtml(route))).toBeDefined();
  });

  it("names ITS OWN path and not another page's", () => {
    const canonical = canonicalOf(documentHtml(route));
    const url = new URL(canonical ?? "about:blank");

    /**
     * The assertion the whole file is for. A page that forgot `alternates.canonical`
     * inherits the locale layout's, which is `/fr` — so this comparison is what
     * catches "every page of the site says the home page is the real one".
     */
    expect(url.pathname, `${route} declares the canonical of ${url.pathname}`).toBe(route);
  });

  it("names a public origin and never localhost", () => {
    const url = new URL(canonicalOf(documentHtml(route)) ?? "about:blank");

    // `metadataBase` unset ⇒ Next writes `http://localhost:3000` with a warning
    // nobody reads in CI. This is the assertion that fails instead.
    expect(["http:", "https:"]).toContain(url.protocol);
    expect(url.hostname).not.toBe("localhost");
    expect(url.hostname).not.toBe("127.0.0.1");
  });

  it("says the same thing in og:url as in the canonical", () => {
    /**
     * Two fields, two code paths, one answer required. A crawler reads the
     * canonical; a link unfurler reads `og:url` — and a card pointing at a different
     * URL from the page it came from is how a share ends up on the wrong address.
     */
    const html = documentHtml(route);

    expect(metaContent(html, "property", "og:url")).toBe(canonicalOf(html));
  });

  it("carries the shared title, description and site name", () => {
    const html = documentHtml(route);

    // The criterion's first line: every page exposes a title and a description to a
    // messaging app, not just to a browser tab.
    expect(metaContent(html, "property", "og:title")).toBeTruthy();
    expect(metaContent(html, "property", "og:description")).toBeTruthy();
    expect(metaContent(html, "property", "og:site_name")).toBeTruthy();
    expect(metaContent(html, "property", "og:locale")).toMatch(/^[a-z]{2}(_[A-Z]{2})?$/);
    expect(metaContent(html, "name", "twitter:card")).toMatch(/^summary(_large_image)?$/);
  });
});

describe("the error pages claim no address", () => {
  it.each(["/_not-found", "/_global-error"])("%s declares no canonical", (route) => {
    if (!existsSync(documentPath(route))) {
      // `/_global-error` is not always written; the manifest is the authority and
      // `prerender.test.ts` owns whether it is there at all.
      return;
    }

    /**
     * A 404 that declared a canonical would offer a crawler an address for "the page
     * that does not exist" — and every mistyped URL on the site would consolidate
     * onto it.
     */
    expect(canonicalOf(documentHtml(route))).toBeUndefined();
  });

  it("gives the 404 a human title and two ways out, with no technical trace", () => {
    const html = documentHtml("/_not-found");

    // The criterion, asserted on the bytes: a title in words, a link to the map and
    // one to the listing, and nothing naming a status code.
    expect(/<title>[^<]+<\/title>/.exec(html)?.[0]).toBeDefined();
    expect(html).toContain('href="/fr"');
    expect(html).toContain('href="/fr/voyages"');
    expect(html).not.toMatch(/\b404\b/);
  });
});

/* ------------------------------------------------------------- robots.txt -- */

const robotsBody = () => readFileSync(path.join(APP_DIR, "robots.txt.body"), "utf8");

describe("robots.txt", () => {
  it("was prerendered to a file rather than left to a server function", () => {
    // A Route Handler stops being prerendered as soon as it reads a request-time
    // API; the `.body` on disk is the proof that this one does not.
    expect(existsSync(path.join(APP_DIR, "robots.txt.body"))).toBe(true);
  });

  it("invites crawlers and names the sitemap absolutely", () => {
    const body = robotsBody();
    const origin = new URL(canonicalOf(documentHtml("/fr")) ?? "about:blank").origin;

    expect(body).toMatch(/^User-Agent: \*$/m);
    expect(body).toMatch(/^Allow: \/$/m);
    // Same origin as every canonical: one source, `src/app/site-url.ts`.
    expect(body).toContain(`Sitemap: ${origin}/sitemap.xml`);
  });

  it("disallows nothing, the withdrawn addresses included", () => {
    /**
     * This looks backwards and it is not. A crawler forbidden to fetch a page can
     * never read the `noindex` on it, so a `Disallow` on a withdrawn URL would
     * *preserve* the stale listing it was meant to remove.
     */
    expect(robotsBody()).not.toMatch(/^Disallow: \//m);
  });
});

/* ------------------------------------------------------------ sitemap.xml -- */

const sitemapBody = () => readFileSync(path.join(APP_DIR, "sitemap.xml.body"), "utf8");

function sitemapLocations(xml: string): readonly string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? "");
}

/**
 * Pure, and separated from the readers above, so the cross-check can be exercised on
 * a fabricated disagreement while the real build has none. Same posture as
 * `leakedSlugs` in `drafts.test.ts`, and for the same reason: with `content/trips/`
 * empty, the real comparison below cannot fail for any reason, so nothing would tell
 * us it had stopped comparing.
 */
export function sitemapDisagreements(
  locations: readonly string[],
  indexableRoutes: readonly string[],
  noindexRoutes: readonly string[]
): { readonly missing: readonly string[]; readonly advertisedNoindex: readonly string[] } {
  const paths = new Set(locations.map((location) => new URL(location).pathname));

  return {
    missing: indexableRoutes.filter((route) => !paths.has(route)),
    advertisedNoindex: noindexRoutes.filter((route) => paths.has(route)),
  };
}

describe("sitemap.xml", () => {
  it("was prerendered to a file rather than left to a server function", () => {
    expect(existsSync(path.join(APP_DIR, "sitemap.xml.body"))).toBe(true);
  });

  it("is a well-formed urlset with at least the two index pages", () => {
    const locations = sitemapLocations(sitemapBody());

    expect(sitemapBody()).toContain("http://www.sitemaps.org/schemas/sitemap/0.9");
    expect(locations.length).toBeGreaterThanOrEqual(2);
  });

  it("advertises absolute URLs on the same origin as the canonicals", () => {
    const origin = new URL(canonicalOf(documentHtml("/fr")) ?? "about:blank").origin;

    for (const location of sitemapLocations(sitemapBody())) {
      expect(location.startsWith(origin)).toBe(true);
    }
  });

  it("agrees with the set of prerendered pages, in both directions", () => {
    const noindexRoutes = READER_FACING_ROUTES.filter((route) =>
      /<meta name="robots" content="[^"]*noindex/.test(documentHtml(route))
    );
    const indexableRoutes = READER_FACING_ROUTES.filter((route) => !noindexRoutes.includes(route));

    const { missing, advertisedNoindex } = sitemapDisagreements(
      sitemapLocations(sitemapBody()),
      indexableRoutes,
      noindexRoutes
    );

    // A page nobody advertises is a page nobody finds.
    expect(missing, "prerendered pages absent from sitemap.xml").toEqual([]);
    // And the other direction: a withdrawn story asking to be de-indexed while the
    // sitemap asks for it to be crawled says two things at once.
    expect(advertisedNoindex, "noindex pages advertised in sitemap.xml").toEqual([]);
  });

  it("lists no URL that has no prerendered page", () => {
    /**
     * The half that catches a draft or a withdrawn slug leaking into the sitemap:
     * both are absent from the manifest, so a `<loc>` naming one has no route to
     * match. `tests/build/drafts.test.ts` owns the same question from the content
     * side; this one owns it from the sitemap's.
     */
    const routes = new Set(READER_FACING_ROUTES);
    const orphans = sitemapLocations(sitemapBody())
      .map((location) => new URL(location).pathname)
      .filter((pathname) => !routes.has(pathname));

    expect(orphans, "sitemap.xml advertises URLs that were not prerendered").toEqual([]);
  });

  it("would catch a disagreement in either direction", () => {
    /**
     * The case that keeps the cross-check alive while the real build cannot fail it.
     * It asserts the predicate itself, on a list written here.
     */
    const locations = ["https://carnet.example/fr", "https://carnet.example/fr/voyages/maroc-2022"];

    expect(
      sitemapDisagreements(locations, ["/fr", "/fr/voyages"], ["/fr/voyages/maroc-2022"])
    ).toEqual({
      missing: ["/fr/voyages"],
      advertisedNoindex: ["/fr/voyages/maroc-2022"],
    });
  });
});
