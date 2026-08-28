import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The prerender guard. Runs against `.next/` AFTER `npm run build` — hence its
 * own config and its own script (`npm run test:build`), and hence its absence
 * from `npm run test`, which must stay build-free.
 *
 * Why it exists: the project's central invariant is that every route is
 * prerendered at build time, and that invariant breaks SILENTLY. Measured on
 * Next 16.3.1 — a single `await headers()` in the root layout, or an implicit
 * `getTranslations("ns")` outside the `[locale]` segment, and:
 *
 * - `npm run build` still exits 0;
 * - it still prints a reassuring `✓ Generating static pages (3/3)`;
 * - `.next/server/app/fr.html` is simply gone, and the prerender manifest drops
 *   to `['/_global-error']`;
 * - the HTML served afterwards is byte-identical, so no Playwright assertion on
 *   the rendered page can see the difference either.
 *
 * The route-status column of the build output is the human-readable version of
 * this check; the manifest is the machine-readable one. ESLint cannot catch it
 * (it is not a property of an import) and the E2E suite cannot either. This file
 * is the only automated line of defence. TIW-22 wires it into CI, after `build`.
 */

const NEXT_DIR = path.resolve(import.meta.dirname, "../../.next");
const APP_DIR = path.join(NEXT_DIR, "server/app");

/** Brotli at max quality: what a CDN actually ships, so what a budget must count. */
function brotliBytes(payload: Buffer): number {
  return brotliCompressSync(payload, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
}

const KB = 1024;

/**
 * Baselines measured on the socle build (2026-08), kept far enough above the
 * measurement to leave room for real work and low enough to catch a mistake:
 * a client-side map library or an icon set would blow straight through them.
 */
const HTML_BUDGET_BYTES = 100 * KB; // measured: 1.6 KB /fr, 1.1 KB /_not-found
const INITIAL_JS_BUDGET_BYTES = 150 * KB; // measured: 119.9 KB /fr, 111.1 KB /_not-found

beforeAll(() => {
  if (!existsSync(APP_DIR)) {
    throw new Error(
      `No build output at ${APP_DIR}. This suite asserts on the build artefacts: run \`npm run build\` first (\`npm run test:build\` does not build for you).`
    );
  }
});

describe("the build output stays prerendered", () => {
  it("lists /fr and /_not-found in the prerender manifest", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(path.join(NEXT_DIR, "prerender-manifest.json"), "utf8")
    );

    expect(manifest).toMatchObject({ routes: expect.any(Object) });
    const routes = Object.keys((manifest as { routes: Record<string, unknown> }).routes);

    // A route missing here was rendered on demand, whatever the build printed.
    expect(routes).toContain("/fr");
    expect(routes).toContain("/_not-found");
  });

  it("wrote the prerendered HTML files to disk", () => {
    expect(existsSync(path.join(APP_DIR, "fr.html"))).toBe(true);
    expect(existsSync(path.join(APP_DIR, "_not-found.html"))).toBe(true);
  });

  it("gives the 404 page a title", () => {
    const html = readFileSync(path.join(APP_DIR, "_not-found.html"), "utf8");

    // Without one the tab shows the raw URL; Next emits no default.
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });
});

/**
 * Every route that is prerendered, and therefore every route with a payload to
 * budget. This used to be `/fr` alone — and TIW-28 is what that cost: 12.4 KB
 * brotli of next-intl's client `Link` and its `use-intl` baggage sat in the
 * initial bundle of `/_not-found`, the one route nothing measured, while `/fr`
 * was reported clean. The `describe.each` below is that hole closed, and it is
 * not cosmetic.
 */
const PRERENDERED_ROUTES = ["fr", "_not-found"] as const;

const documentHtml = (route: string) => readFileSync(path.join(APP_DIR, `${route}.html`), "utf8");

/**
 * The `<script src>` chunks a browser fetches before the page is interactive,
 * each brotli-sized, keyed by src so a chunk listed twice is counted once.
 */
function initialChunks(route: string): { counted: Map<string, number>; excludedNoModule: number } {
  const scriptTags = [...documentHtml(route).matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  const counted = new Map<string, number>();
  let excludedNoModule = 0;

  for (const tag of scriptTags) {
    const src = /src="([^"]+)"/.exec(tag)?.[1];
    if (src === undefined || !src.startsWith("/_next/")) continue;

    const file = path.join(NEXT_DIR, src.replace("/_next/", ""));
    if (!existsSync(file)) continue;
    const bytes = brotliBytes(readFileSync(file));

    /**
     * Verified trap: the `noModule` chunk is the legacy fallback bundle, which
     * no browser supporting ES modules ever executes. Counting it inflates the
     * measurement by ~35 KB brotli — a third of the budget spent on bytes
     * nobody downloads.
     */
    if (/\bnoModule\b/.test(tag)) {
      excludedNoModule += bytes;
      continue;
    }
    counted.set(src, bytes);
  }

  return { counted, excludedNoModule };
}

describe.each(PRERENDERED_ROUTES)("the /%s payload stays within budget", (route) => {
  it("keeps the document under the HTML budget", () => {
    const bytes = brotliBytes(Buffer.from(documentHtml(route), "utf8"));

    expect(bytes).toBeLessThan(HTML_BUDGET_BYTES);
  });

  it("keeps the initial JavaScript under budget, legacy chunk excluded", () => {
    const { counted, excludedNoModule } = initialChunks(route);
    const total = [...counted.values()].reduce((sum, bytes) => sum + bytes, 0);

    // Guards the guard: if Next stops emitting the legacy chunk this reminds us
    // the exclusion is now dead code rather than letting it rot silently.
    expect(excludedNoModule).toBeGreaterThan(0);
    expect(counted.size).toBeGreaterThan(0);
    expect(total).toBeLessThan(INITIAL_JS_BUDGET_BYTES);
  });
});

/**
 * THE TIW-28 GUARD, and the reason it fingerprints bytes instead of counting
 * them.
 *
 * next-intl builds `getPathname` and its *client* `Link` inside one
 * `createNavigation(routing)` call, in a module that imports the `"use client"`
 * `BaseLink` at the top level. So a Server Component that renders a plain
 * `<a href>` and imports `getPathname` from `@/i18n/navigation` registers a
 * client reference for its route, and ships the `Link` runtime to a page carrying
 * no client link at all. Measured on `/fr`, same href either way: 119.9 KB /
 * 6 chunks without, 123.7 KB / 8 chunks with — 3.8 KB and two chunks. On
 * `/_not-found` it was 12.4 KB, the `Link` dragging `use-intl` with it.
 *
 * A budget cannot catch that, and this is the interesting part: 123.7 KB passes
 * the 150 KB ceiling comfortably, which is exactly why it went unnoticed through
 * two milestones. Tightening the ceiling to ~121 KB would catch it *and* refuse
 * the next 3 KB of legitimate work — and a guard that blocks real work gets
 * raised by the next person in a hurry, then guards nothing. So this one asserts
 * on the *identity* of the bytes: next-intl's client `Link` must not appear in
 * any initial chunk of any prerendered route. `src/i18n/pathname.ts` is what
 * keeps it out; this is what notices when it comes back.
 */
const BASE_LINK_SOURCE = path.resolve(
  import.meta.dirname,
  "../../node_modules/next-intl/dist/esm/production/navigation/shared/BaseLink.js"
);

/**
 * Property names from the destructuring in next-intl's `BaseLink` /
 * `LocaleChangingLink`. Property names survive minification — a mangler cannot
 * rename them without changing the object's shape — which is what makes them a
 * usable fingerprint inside a production chunk.
 */
const BASE_LINK_MARKERS = ["curLocale", "linkRef", "localeCookie"] as const;

describe("next-intl's client Link stays out of the initial bundle", () => {
  /**
   * Guards the guard, in the shape the `noModule` assertion above uses. Without
   * it, a next-intl release that renamed one of these properties — or moved the
   * file — would silently turn the assertion below into three greps that can
   * never match, and this suite would report success for the absence of a string
   * that no longer exists. Red here means "re-read `src/i18n/pathname.ts`
   * against the new packaging, then re-pick the markers" — never "delete this".
   */
  it("fingerprints a BaseLink that is really there", () => {
    expect(
      existsSync(BASE_LINK_SOURCE),
      `next-intl no longer ships ${BASE_LINK_SOURCE}, and the markers below are pinned to that file.`
    ).toBe(true);

    const source = readFileSync(BASE_LINK_SOURCE, "utf8");

    for (const marker of BASE_LINK_MARKERS) {
      expect(source, `"${marker}" is no longer a property of next-intl's BaseLink.`).toContain(
        marker
      );
    }
  });

  it.each(PRERENDERED_ROUTES)("/%s ships no chunk carrying it", (route) => {
    const { counted } = initialChunks(route);
    const carriers: string[] = [];

    for (const src of counted.keys()) {
      const code = readFileSync(path.join(NEXT_DIR, src.replace("/_next/", "")), "utf8");
      /**
       * All three markers, not any one of them: `localeCookie` on its own also
       * travels in the routing config that `NextIntlClientProvider` legitimately
       * puts in `/fr`'s bundle. The three together are `BaseLink` and nothing
       * else — verified against a build with and without the import.
       */
      if (BASE_LINK_MARKERS.every((marker) => code.includes(marker))) {
        carriers.push(src);
      }
    }

    expect(
      carriers,
      `These initial chunks of /${route} carry next-intl's client Link. Something server-rendered imported \`getPathname\`, \`Link\`, \`redirect\`, \`usePathname\` or \`useRouter\` from "@/i18n/navigation". To build an href for a plain <a>, use \`localePathname\` from "@/i18n/pathname" instead — see docs/adr/0005-getpathname-sans-le-link-client.md.`
    ).toEqual([]);
  });
});
