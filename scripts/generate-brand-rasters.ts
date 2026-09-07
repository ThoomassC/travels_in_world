import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import {
  BRAND_MARK_PLANE_TRANSFORM,
  BRAND_MARK_VIEWBOX,
  BRAND_PLANE_PATH,
  BRAND_PLANE_VIEWBOX,
} from "@/components/site/brand-art";

/**
 * Redraws the two committed rasters of the brand — `src/app/apple-icon.png` and
 * `public/opengraph-default.png` — from the one geometry in
 * `src/components/site/brand-art.ts`.
 *
 * **WHY THIS FILE EXISTS AT ALL, and it is the interesting part.** Both PNGs were
 * made by hand. The README said "régénérer les deux PNG" and named no command,
 * `docs/adr/0013` said the mark is made of committed files and did not say how
 * they are cut, and the drift test could compare the favicon's path with the
 * constant but had nothing to compare a raster against. So the geometry had one
 * source of truth and the rasters had none: replacing the mark meant reopening an
 * editor and hoping. Measured the first time it happened — on 7 September 2026,
 * when the owner supplied a new drawing — that is a step nobody can repeat.
 *
 * A PNG cannot be generated at build time in this project (invariant 1: the CDN
 * serves committed bytes, and TIW-21 measured an `opengraph-image` route printing
 * a green column while writing no file). So the answer is a command that rewrites
 * the files and a diff that shows what changed.
 *
 * **WHY IT DOES NOT LIVE IN `npm test`.** It writes binaries. A guard that
 * rewrites the artefact it is guarding cannot fail, and a suite that touches
 * `public/` on every run is a suite that makes `git status` useless. What checks
 * the rasters is `tests/build/brand.test.ts`, which reads their headers.
 *
 * Run it with `npm run brand:rasters`, then commit the two files with the change
 * that motivated them.
 */

/** Repository root, from `scripts/`. */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The two literals this file is allowed to hold, and the reason is the same one
 * `src/app/icon.svg` gives for its own pair: **a PNG follows no theme.** It is
 * composited by iOS onto an unknown wallpaper and by a social card onto an unknown
 * feed, so it carries one appearance and it has to be the light one.
 *
 * They are `--logo-ink` and `--logo-bg` resolved out of the shared palette of
 * `@thomascaron/ui` in the light theme — the same two values
 * `tests/components/site/brand-art.test.ts` resolves from the sheet to check the
 * favicon's copies. This file is not under that test: the check that matters here
 * is visual, and it is the diff of the two PNGs.
 */
const INK = "#193940";
const PLATE = "#f2e9d6";

/** The apple icon's own square, in pixels. iOS asks for 180. */
const APPLE_SIZE = 180;

/**
 * The share card, and the two numbers that may not move: `src/app/share.ts`
 * declares `og:image:width` and `og:image:height` as 1200 x 630, and
 * `tests/build/brand.test.ts` reads them back out of the PNG's own header. A card
 * whose declared size lies re-flows in the reader's feed after it loads.
 */
const SHARE_WIDTH = 1200;
const SHARE_HEIGHT = 630;

/**
 * The aeroplane, alone, set in its square.
 *
 * `fill-rule="evenodd"` for the reason `brand-art.ts` gives: the second contour of
 * the path is the compass needle and it is a hole. Under the default rule it fills
 * solid, silently, and the icon loses its only detail — which at 180 px is the
 * detail a reader actually sees.
 */
function squareMark(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRAND_MARK_VIEWBOX}" width="${APPLE_SIZE}" height="${APPLE_SIZE}">
  <rect width="48" height="48" fill="${PLATE}"/>
  <g transform="${BRAND_MARK_PLANE_TRANSFORM}">
    <path fill="${INK}" fill-rule="evenodd" d="${BRAND_PLANE_PATH}"/>
  </g>
</svg>`;
}

/**
 * The share card: the aeroplane over the wordmark, on the plate.
 *
 * **The wordmark is real text rendered by the rasteriser, and that is a known
 * fragility rather than an oversight.** sharp resolves `font-family` against the
 * fonts installed on the machine that runs this command, so a card cut on a
 * different machine can come out in a different face. The alternative — shipping a
 * font file to convert to outlines — is a dependency and a licence question for
 * one image. The mitigation is that the output is *committed*: whatever this
 * produced is what every reader gets, and the diff is where a wrong face is seen.
 *
 * The row of dots the previous card carried is gone with the trajectory it drew.
 * The mark has no accented part any more; a decorative dotted rule under it would
 * be the only place in the brand where one survived.
 */
function shareCard(): string {
  const planeHeight = 220;
  const planeWidth = planeHeight * 0.72;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" viewBox="0 0 ${SHARE_WIDTH} ${SHARE_HEIGHT}">
  <rect width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" fill="${PLATE}"/>
  <g transform="translate(${(SHARE_WIDTH - planeWidth) / 2} 110) scale(${planeHeight / 100})">
    <path fill="${INK}" fill-rule="evenodd" d="${BRAND_PLANE_PATH}"/>
  </g>
  <text x="${SHARE_WIDTH / 2}" y="470" fill="${INK}" text-anchor="middle"
        font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="84" font-weight="700">Travels in World</text>
</svg>`;
}

async function main(): Promise<void> {
  const apple = path.join(ROOT, "src/app/apple-icon.png");
  const share = path.join(ROOT, "public/opengraph-default.png");

  writeFileSync(apple, await sharp(Buffer.from(squareMark())).png().toBuffer());
  writeFileSync(share, await sharp(Buffer.from(shareCard())).png().toBuffer());

  // The plane's own box is printed rather than merely imported, so a reader of the
  // output can see which geometry was cut without opening another file.
  process.stdout.write(
    `Marque redessinée depuis ${BRAND_PLANE_VIEWBOX} :\n` +
      `  src/app/apple-icon.png        ${APPLE_SIZE} × ${APPLE_SIZE}\n` +
      `  public/opengraph-default.png  ${SHARE_WIDTH} × ${SHARE_HEIGHT}\n`
  );
}

await main();
