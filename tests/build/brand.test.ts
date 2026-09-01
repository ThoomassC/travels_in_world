import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The brand, asserted on the BUILD OUTPUT — because that is the only place the
 * two things this ticket can break in silence are visible.
 *
 * 1. **The icon links.** They are emitted by Next's file convention
 *    (`src/app/icon.svg`, `src/app/apple-icon.png`) and by nothing this repository
 *    writes: no component renders them, no `generateMetadata` declares them. Delete
 *    or rename either file and `next build` exits 0, every unit test stays green,
 *    and the site simply has no favicon. Nothing else looks.
 *
 * 2. **The default share image.** `src/app/share.ts` names
 *    `/opengraph-default.png` as a string. Move or resize the file and the string
 *    still typechecks, the `og:image` still renders, and the card is broken on every
 *    platform — which is discovered by a human, on a link already sent.
 *
 * Runs against `.next/` and `public/` after `npm run build`, so it lives in
 * `vitest.build.config.ts` behind `npm run test:build`, next to the prerender guard
 * it borrows its route derivation from.
 */

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
const NEXT_DIR = path.join(REPOSITORY_ROOT, ".next");
const APP_DIR = path.join(NEXT_DIR, "server/app");

beforeAll(() => {
  if (!existsSync(APP_DIR)) {
    throw new Error(
      `No build output at ${APP_DIR}. This suite asserts on the build artefacts: run \`npm run build\` first (\`npm run test:build\` does not build for you).`
    );
  }
});

/**
 * Every prerendered route that produced an HTML document — derived from the
 * manifest, never written down, for the reason `./prerender.test.ts` gives at
 * length: a hardcoded list stops matching the site and reports success for routes
 * it no longer names.
 */
function documentRoutes(): string[] {
  const manifestPath = path.join(NEXT_DIR, "prerender-manifest.json");
  if (!existsSync(manifestPath)) return [];

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    routes?: Record<string, unknown>;
  };

  return Object.keys(manifest.routes ?? {})
    .sort()
    .filter((route) => existsSync(path.join(APP_DIR, `${route.replace(/^\//, "")}.html`)));
}

const DOCUMENT_ROUTES = documentRoutes();

const documentHtml = (route: string) =>
  readFileSync(path.join(APP_DIR, `${route.replace(/^\//, "")}.html`), "utf8");

/**
 * Next's own built-in 500 page, recognised by the marker it renders on `<html>`.
 *
 * MEASURED, and it is why this constant exists instead of the name being written
 * into a skip list. `/_global-error` is prerendered and does appear in the
 * manifest — `./prerender.test.ts` weighs it, correctly, because a browser really
 * downloads it. But it is not one of *our* documents: Next renders it from its own
 * component with its own `<head>`, and the app's metadata never runs for it. So it
 * carries no `<link rel="icon">`, and nothing this repository can write will change
 * that short of adding a `global-error.tsx`.
 *
 * Derived from the artefact rather than named, for the reason
 * `./prerender.test.ts` gives about its route list: a hardcoded exclusion is an
 * exclusion that quietly grows. The case below asserts that it excludes exactly
 * one route today, so a *real* document losing its icons cannot hide behind it.
 */
const NEXT_OWN_ERROR_MARKER = 'id="__next_error__"';

/** The documents this project actually renders — the ones an icon link belongs in. */
const OUR_DOCUMENT_ROUTES = DOCUMENT_ROUTES.filter(
  (route) => !documentHtml(route).includes(NEXT_OWN_ERROR_MARKER)
);

/** `<meta property="og:image" content="…">` — Next writes `property` for OG. */
function metaContent(html: string, attribute: string, name: string): string | undefined {
  const pattern = new RegExp(
    `<meta[^>]*\\b${attribute}="${name}"[^>]*\\bcontent="([^"]*)"|<meta[^>]*\\bcontent="([^"]*)"[^>]*\\b${attribute}="${name}"`
  );
  const match = pattern.exec(html);

  return match?.[1] ?? match?.[2];
}

describe("the icon metadata reaches every document", () => {
  it("derived the routes to check", () => {
    // Guards the guard: an unreadable manifest would make `it.each` below generate
    // no test at all, and this file would report success by running nothing.
    expect(OUR_DOCUMENT_ROUTES.length).toBeGreaterThanOrEqual(2);
    expect(OUR_DOCUMENT_ROUTES).toContain("/fr");
    expect(OUR_DOCUMENT_ROUTES).toContain("/_not-found");
  });

  it("excludes Next's own error document, and only that one", () => {
    /**
     * The exclusion is derived from a marker in the HTML, so this is what keeps it
     * from widening: the day a document of ours stops carrying icon links, it must
     * fail the case below rather than drop out of the list. Measured on this build:
     * `['/_global-error']`.
     */
    const excluded = DOCUMENT_ROUTES.filter((route) => !OUR_DOCUMENT_ROUTES.includes(route));

    expect(excluded).toEqual(["/_global-error"]);
  });

  it.each(OUR_DOCUMENT_ROUTES)("%s links the favicon and the apple icon", (route) => {
    const html = documentHtml(route);

    /**
     * `/_not-found` is in this list on purpose. It sits OUTSIDE the `[locale]`
     * segment, so anything declared in `src/app/[locale]/layout.tsx` never reaches
     * it — which is exactly why the icons are left to the file convention at the
     * `src/app/` level instead of being written into that layout's `metadata`.
     * Declaring `icons` there would cover `/fr` and quietly leave the 404 bare.
     */
    expect(html, `${route} carries no <link rel="icon">`).toMatch(
      /<link[^>]*rel="icon"[^>]*href="\/icon\.svg/
    );
    expect(html, `${route} carries no apple-touch-icon`).toMatch(
      /<link[^>]*rel="apple-touch-icon"[^>]*href="\/apple-icon\.png/
    );
  });

  it("copied both icon files into the served output", () => {
    /**
     * The links above could point at a 404. Next serves a static metadata file
     * from `.next/server/app/<name>/route.js` plus a copy of the bytes; the
     * simplest artefact-level check that the file was really picked up is that the
     * route directory exists.
     */
    for (const name of ["icon.svg", "apple-icon.png"]) {
      const bare = name.replace(/\.[^.]+$/, "");
      expect(
        readdirSync(APP_DIR).some((entry) => entry === bare || entry.startsWith(`${bare}.`)),
        `${name} produced no route under ${APP_DIR}`
      ).toBe(true);
    }
  });
});

describe("the default share image", () => {
  const file = path.join(REPOSITORY_ROOT, "public/opengraph-default.png");

  it("is on disk where src/app/share.ts says it is", () => {
    // The path in `share.ts` is a string: nothing typechecks it against the
    // filesystem, and a broken `og:image` shows up as a card with no picture.
    expect(existsSync(file), `${file} is missing`).toBe(true);
  });

  it("is really 1200 x 630", () => {
    /**
     * Read from the PNG header rather than trusted: `og:image:width` and
     * `og:image:height` are what let a platform reserve the card's box before the
     * bytes arrive, so a replacement of a different size makes those two tags lie
     * and the card reflows once it loads.
     *
     * IHDR is the first chunk of every PNG — width and height are two big-endian
     * 32-bit integers at offsets 16 and 20.
     */
    const bytes = readFileSync(file);

    expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });

  it.each(OUR_DOCUMENT_ROUTES.filter((route) => route.startsWith("/fr")))(
    "%s unfurls with an absolute og:image",
    (route) => {
      const html = documentHtml(route);

      /**
       * Absolute, and that is the whole reason to assert it here rather than in a
       * unit test: `share.ts` hands Next a site-relative `/opengraph-default.png`
       * and `metadataBase` resolves it. A platform fetching the card is on another
       * host — a relative `og:image` is simply not fetchable, and the failure is
       * invisible from inside the site.
       */
      const image = metaContent(html, "property", "og:image");

      expect(image, `${route} has no og:image`).toBeDefined();
      expect(image).toMatch(/^https?:\/\/[^/]+\/opengraph-default\.png$/);

      // The dimensions travel with it, or the card reflows when the bytes land.
      expect(metaContent(html, "property", "og:image:width")).toBe("1200");
      expect(metaContent(html, "property", "og:image:height")).toBe("630");
      // An image with no alt text is an image a screen reader cannot report.
      expect(metaContent(html, "property", "og:image:alt")).toBe("Travels in World");
    }
  );

  it("is not claimed by the 404, which has no share card at all", () => {
    /**
     * `src/app/not-found.tsx` builds its metadata by hand — it cannot call
     * `shareMetadata`, which needs a locale and a path that a 404 does not have.
     * So it carries no `og:image`, and that is correct: a page that says "this
     * address does not exist" has nothing to unfurl. Pinned so that a future
     * "let's share-card everything" change is a decision.
     */
    expect(metaContent(documentHtml("/_not-found"), "property", "og:image")).toBeUndefined();
  });
});
