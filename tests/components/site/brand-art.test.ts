import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND_PLANE_PATH,
  BRAND_MARK_PLANE_TRANSFORM,
  BRAND_MARK_VIEWBOX,
} from "@/components/site/brand-art";
import { siteToken, type MeasuredTheme } from "../../styles/sheet";

/**
 * `--logo-ink` as the site's own sheet resolves it — the value the favicon has
 * to repeat, read from the one place that defines it rather than typed here.
 */
const logoInk = (theme: MeasuredTheme): string => siteToken(theme, "--logo-ink");

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
    // The `.plane` rule is the last thing inside the section: if the terminator
    // moved above it, the fill declaration would be parsed as markup.
    expect(icon.indexOf("fill: var(--logo-ink)")).toBeLessThan(icon.indexOf("]]" + ">"));
  });
});

describe("the favicon draws the same aeroplane as the header", () => {
  it("carries exactly one path, and it is BRAND_PLANE_PATH", () => {
    /**
     * Exactly one, which is the banked-aeroplane cut itself: a single connected
     * mass. A second path would mean the favicon had grown a detached element —
     * the thing the 16 px raster cannot keep, and the reason the trajectory lives
     * in the lock-up only.
     */
    expect(pathData(icon)).toEqual([BRAND_PLANE_PATH]);
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
     * The structure of the site's sheet, transcribed: light in `:root`, dark
     * behind `prefers-color-scheme`. Both literals are asserted, so a copy that
     * kept the media query and dropped its value — leaving the light ink on a
     * dark tab bar — fails here.
     *
     * **The two colours are RESOLVED from the sheet, not written down.** They
     * used to be `#0c2731` and `#eef7fa` typed into this file, which made three
     * copies of one value and left this test asserting that the favicon agreed
     * with the test rather than with the site: adopting the shared palette moved
     * the token and this assertion would have gone on passing on the old ink. A
     * favicon is a separate document and its literals are unavoidable; a *test*
     * repeating them is not.
     */
    expect(icon).toMatch(
      new RegExp(String.raw`:root\s*\{\s*--logo-ink:\s*${logoInk("light")};\s*\}`)
    );
    expect(icon).toMatch(
      new RegExp(
        String.raw`@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{\s*--logo-ink:\s*${logoInk(
          "dark-os"
        )};`
      )
    );
  });
});

describe("the square placements reuse the mark instead of redrawing it", () => {
  it("sets the aeroplane in the favicon's square with a transform", () => {
    /**
     * Two hand-placed copies of a logo are two logos, and the day one is nudged
     * the other stays put. The favicon therefore carries no coordinates of its
     * own for the aeroplane — only a `translate`/`scale` around the one path.
     *
     * **This assertion changed side on 7 September 2026.** It used to check the
     * header's transform, because the header drew the mark inside a wide lock-up
     * box alongside a trajectory. The trajectory is gone with the old mark, so the
     * header now draws the aeroplane in its own box with no transform at all, and
     * the square that needs one is the favicon's.
     */
    expect(BRAND_MARK_PLANE_TRANSFORM).toMatch(/^translate\(-?[\d.]+ -?[\d.]+\) scale\([\d.]+\)$/);

    const icon = readFileSync(ICON_PATH, "utf8");
    expect(icon).toContain(`transform="${BRAND_MARK_PLANE_TRANSFORM}"`);
  });

  it("keeps the whole aeroplane inside that square, with margin to spare", () => {
    /**
     * A transform that overflows its box clips the mark, and a favicon is the one
     * place nobody looks closely enough to notice. Checked arithmetically because
     * no rendered test in this suite can see a 48-unit box.
     *
     * The ordinates are taken over EVERY number of the path, control points
     * included. That can only over-state the drawing's extent — a Bézier stays
     * inside the convex hull of its control polygon — so a box this computes as
     * fitting really does fit.
     */
    const [, scale = "0"] = /scale\(([\d.]+)\)/.exec(BRAND_MARK_PLANE_TRANSFORM) ?? [];
    const [, translateX = "0", translateY = "0"] =
      /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(BRAND_MARK_PLANE_TRANSFORM) ?? [];

    const numbers = [...BRAND_PLANE_PATH.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) =>
      Number(match[0])
    );
    const abscissae = numbers.filter((_, index) => index % 2 === 0);
    const ordinates = numbers.filter((_, index) => index % 2 === 1);

    const place = (value: number, offset: string) => value * Number(scale) + Number(offset);
    const side = Number(BRAND_MARK_VIEWBOX.split(" ")[3]);

    expect(place(Math.min(...abscissae), translateX)).toBeGreaterThanOrEqual(0);
    expect(place(Math.max(...abscissae), translateX)).toBeLessThanOrEqual(side);
    expect(place(Math.min(...ordinates), translateY)).toBeGreaterThanOrEqual(0);
    expect(place(Math.max(...ordinates), translateY)).toBeLessThanOrEqual(side);

    // And it is set, not merely fitted: a mark filling its box edge to edge reads
    // as clipped on a tab bar that adds no padding of its own.
    expect(place(Math.max(...ordinates), translateY)).toBeLessThan(side - 2);
  });

  it("draws the header mark in the aeroplane's own box, with no transform", () => {
    /**
     * The other half of the same decision, and the reason it is asserted rather
     * than left to the component: a square viewBox in the header would spend a
     * fifth of the medallion on empty margin, and the temptation to reuse
     * {@link BRAND_MARK_VIEWBOX} there is exactly the kind of tidy-looking edit
     * that would do it.
     */
    const brand = readFileSync(
      path.join(REPOSITORY_ROOT, "src/components/site/site-brand.tsx"),
      "utf8"
    );

    expect(brand).toContain("viewBox={BRAND_PLANE_VIEWBOX}");
    expect(brand).not.toContain("BRAND_MARK_PLANE_TRANSFORM");
  });

  it("cuts the needle out rather than filling it, everywhere the mark is drawn", () => {
    /**
     * `fill-rule: evenodd` is the difference between a compass needle and a solid
     * fuselage, and it fails **silently**: the default non-zero rule paints the
     * second contour solid, no error, no warning, a mark that has simply lost its
     * only detail. Two files draw this path and both are checked, because getting
     * it right in one of them is how a favicon and a header stop matching.
     */
    const icon = readFileSync(ICON_PATH, "utf8");
    const brand = readFileSync(
      path.join(REPOSITORY_ROOT, "src/components/site/site-brand.tsx"),
      "utf8"
    );

    expect(icon).toContain('fill-rule="evenodd"');
    expect(brand).toContain('fillRule="evenodd"');

    // The rule only means something if there is a second contour to cut out.
    expect(BRAND_PLANE_PATH.match(/M /g) ?? []).toHaveLength(2);
  });
});
