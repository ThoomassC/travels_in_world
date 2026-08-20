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
const HTML_BUDGET_BYTES = 100 * KB; // measured: 1.5 KB brotli for /fr
const INITIAL_JS_BUDGET_BYTES = 150 * KB; // measured: 120.2 KB brotli

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

describe("the /fr payload stays within budget", () => {
  const html = () => readFileSync(path.join(APP_DIR, "fr.html"), "utf8");

  it("keeps the document under the HTML budget", () => {
    const bytes = brotliBytes(Buffer.from(html(), "utf8"));

    expect(bytes).toBeLessThan(HTML_BUDGET_BYTES);
  });

  it("keeps the initial JavaScript under budget, legacy chunk excluded", () => {
    const scriptTags = [...html().matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
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

    const total = [...counted.values()].reduce((sum, bytes) => sum + bytes, 0);

    // Guards the guard: if Next stops emitting the legacy chunk this reminds us
    // the exclusion is now dead code rather than letting it rot silently.
    expect(excludedNoModule).toBeGreaterThan(0);
    expect(counted.size).toBeGreaterThan(0);
    expect(total).toBeLessThan(INITIAL_JS_BUDGET_BYTES);
  });
});
