import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND_COMET_PATH,
  BRAND_LOCKUP_COMET_TRANSFORM,
  BRAND_LOCKUP_TRACK_PATH,
  BRAND_LOCKUP_VIEWBOX,
  BRAND_MARK_VIEWBOX,
} from "@/components/site/brand-art";

/**
 * THE GEOMETRY DRIFT GUARD.
 *
 * The mark exists in two places and cannot exist in one: the header renders it as
 * inline SVG from `src/components/site/brand-art.ts` — the only way it can inherit
 * `--logo-ink` from the page and follow the visitor's theme — and the browser
 * fetches `src/app/icon.svg` as a separate document, where a React constant is
 * unreachable.
 *
 * So the two copies can drift, and drift is invisible: the header would show the
 * new mark, the tab would show the old one, `next build` would be green and no
 * other test in this repository looks at both. Hence this file, which reads the
 * `.svg` off the disk and compares.
 *
 * Red here means one of the two was edited alone. The fix is never to relax the
 * assertion: re-generate the rasters too (`src/app/apple-icon.png`,
 * `public/opengraph-default.png`) — the README's "Marque" section lists the four
 * files that move together.
 */

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");
const ICON_PATH = path.join(REPOSITORY_ROOT, "src/app/icon.svg");
const icon = readFileSync(ICON_PATH, "utf8");

/** The `d` of every `<path>` in the file, in document order. */
function pathData(svg: string): (string | undefined)[] {
  return [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((match) => match[1]);
}

describe("the favicon is a document a browser can parse", () => {
  it("is well-formed XML", () => {
    /**
     * PROVEN BY A REAL FAILURE, on this very branch, before this test existed.
     *
     * An XML comment may not contain two consecutive hyphens. The first version of
     * `icon.svg` documented itself in an XML comment that mentioned `--logo-ink`,
     * which made the file malformed — and the failure mode is the worst one this
     * repository knows. Inline in a page, HTML's lenient parser renders the mark
     * anyway. Fetched as a favicon or through an `<img>`, the browser parses it as
     * XML, hits a fatal error and draws nothing: `next build` exits 0, every other
     * test stays green, the icon links are all present in the HTML, and the site
     * simply has no icon.
     *
     * Measured in Chromium against `next start`: nine `<img src="/icon.svg">`, all
     * with `naturalWidth === 0`. Nothing else in this repository looks — the build
     * test in `tests/build/brand.test.ts` asserts the `<link>` exists, not that
     * what it points at can be decoded.
     *
     * The fix was to move the prose into a CSS comment inside `<style>`, where
     * `--` is legal. Red here means it came back.
     */
    const parsed = new DOMParser().parseFromString(icon, "image/svg+xml");
    const error = parsed.querySelector("parsererror");

    expect(error?.textContent ?? null, `icon.svg is not well-formed XML`).toBeNull();
    expect(parsed.documentElement.nodeName).toBe("svg");
  });

  it("keeps every hyphen pair out of its XML comments", () => {
    /**
     * The assertion above catches a malformed file; this one names the cause, so
     * that a red line points at the actual edit instead of at "XML is unhappy".
     */
    const xmlComments = [...icon.matchAll(/<!--([\s\S]*?)-->/g)].map((match) => match[1] ?? "");

    for (const comment of xmlComments) {
      expect(comment, "an XML comment in icon.svg contains `--`").not.toContain("--");
    }
  });

  it("closes its CDATA section exactly once, and at the end", () => {
    /**
     * THE ASSERTION THAT ACTUALLY CAUGHT THE THIRD BREAK, and the reason it reads
     * the raw text instead of trusting the parser above.
     *
     * The stylesheet is wrapped in CDATA because in XML — unlike HTML — `<style>`
     * is not a raw text element, so a bare `<` in a CSS comment (`<img>`, say) ends
     * the file with "unexpected close tag". The trap that follows is that the
     * terminator is three ordinary characters: writing them anywhere in the prose
     * closes the section early, and libxml2 answers "Sequence ']]>' not allowed in
     * content".
     *
     * Measured: jsdom's `DOMParser` ACCEPTED that document while `xmllint` and
     * Chromium both refused it — nine `<img src="/icon.svg">` with
     * `naturalWidth === 0` against `next start`. So the case above would have gone
     * green on a file no browser can draw. Counting the delimiters in the bytes
     * depends on no implementation at all.
     */
    const opens = icon.split("<![CDATA[").length - 1;
    const closes = icon.split("]]" + ">").length - 1;

    expect(opens, "icon.svg should open exactly one CDATA section").toBe(1);
    expect(closes, "a CDATA terminator was written more than once — check the prose").toBe(1);
    expect(icon.indexOf("]]" + ">")).toBeGreaterThan(icon.indexOf("<![CDATA["));
    // The `.comet` rule is the last thing inside the section: if the terminator
    // moved above it, the fill declaration would be parsed as markup.
    expect(icon.indexOf("fill: var(--logo-ink)")).toBeLessThan(icon.indexOf("]]" + ">"));
  });
});

describe("the favicon draws the same comet as the header", () => {
  it("carries exactly one path, and it is BRAND_COMET_PATH", () => {
    /**
     * Exactly one, which is the "welded comet" cut itself: a single connected
     * mass. A second path would mean the favicon had grown a detached element —
     * the thing the 16 px raster cannot keep, and the reason the trajectory lives
     * in the lock-up only.
     */
    expect(pathData(icon)).toEqual([BRAND_COMET_PATH]);
  });

  it("is drawn in the same box", () => {
    // A matching path in a different `viewBox` is a different mark: the numbers
    // only mean anything relative to the square they were placed in.
    expect(icon).toContain(`viewBox="${BRAND_MARK_VIEWBOX}"`);
  });
});

describe("the favicon names no unconditioned colour", () => {
  it("paints through --logo-ink rather than a literal fill", () => {
    /**
     * The acceptance criterion, on the one file that cannot inherit the page's
     * tokens. A `fill="#0c2731"` here would be a mark frozen to the light theme,
     * invisible on a dark tab bar — and nothing about the build would say so.
     */
    expect(icon).toContain("fill: var(--logo-ink)");
    expect(icon).not.toMatch(/<path[^>]*\bfill="/);
  });

  it("declares both theme values, dark behind the media query", () => {
    /**
     * The structure of `src/styles/tokens.css`, transcribed: light in `:root`,
     * dark behind `prefers-color-scheme`. Both literals are asserted, so a copy
     * that kept the media query and dropped its value — leaving the light ink on
     * a dark tab bar — fails here.
     */
    expect(icon).toMatch(/:root\s*\{\s*--logo-ink:\s*#0c2731;\s*\}/);
    expect(icon).toMatch(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{\s*--logo-ink:\s*#eef7fa;/
    );
  });
});

describe("the lock-up reuses the mark instead of redrawing it", () => {
  it("places the same path with a transform", () => {
    /**
     * Two hand-placed copies of a logo are two logos, and the day one is nudged
     * the other stays put. The lock-up therefore carries no coordinates of its
     * own for the comet — only a `translate`/`scale`.
     */
    expect(BRAND_LOCKUP_COMET_TRANSFORM).toMatch(
      /^translate\(-?[\d.]+ -?[\d.]+\) scale\([\d.]+\)$/
    );
  });

  it("keeps the trajectory clear of the comet's ink", () => {
    /**
     * The load-bearing number of this mark, checked arithmetically because no
     * rendered test can see it: ink against accent measures 1.99:1 in light and
     * 1.35:1 in dark, so the two must never share an edge.
     *
     * The comet's lowest point in the lock-up box is its tail tip — the first
     * coordinate of `BRAND_COMET_PATH`, put through the lock-up transform. The
     * trajectory's own start is `BRAND_LOCKUP_TRACK_PATH`'s first coordinate.
     * Below ~5 units of clearance in a 32-unit box the accent starts touching the
     * ink at header size, and the mark collapses into one flat silhouette.
     */
    const [, scale] = /scale\(([\d.]+)\)/.exec(BRAND_LOCKUP_COMET_TRANSFORM) ?? [];
    const [, , translateY] =
      /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(BRAND_LOCKUP_COMET_TRANSFORM) ?? [];
    const [, tipY] = /^M[\d.]+ ([\d.]+)/.exec(BRAND_COMET_PATH) ?? [];
    const [, trackY] = /^M[\d.]+ ([\d.]+)/.exec(BRAND_LOCKUP_TRACK_PATH) ?? [];

    const cometTip = Number(tipY) * Number(scale) + Number(translateY);
    const clearance = Number(trackY) - cometTip;

    expect(clearance).toBeGreaterThan(5);
    // …and inside the box, so the clearance is not bought by pushing the
    // trajectory off the bottom edge where it would be clipped.
    const boxHeight = Number(BRAND_LOCKUP_VIEWBOX.split(" ")[3]);
    expect(Number(trackY)).toBeLessThan(boxHeight);
  });
});
