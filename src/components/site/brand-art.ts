/**
 * The brand's geometry, and nothing else — no React, no Next, no CSS.
 *
 * **THIS FILE IS THE MARK.** Everything that draws the brand reads its numbers
 * from here: the header lock-up (`./site-brand.tsx`), the favicon
 * (`src/app/icon.svg`) and the two rasters committed under `src/app/` and
 * `public/`. Replacing the mark means replacing the strings below and
 * re-generating the two rasters — see the "Marque" section of the README.
 *
 * WHY THE PATH IS A CONSTANT AND NOT A FILE THE COMPONENT FETCHES. The header
 * mark has to be **inline** SVG: `<img src="/icon.svg">` renders in its own
 * document, where `--logo-ink` does not exist, so the mark could not follow the
 * visitor's theme. Inline SVG in a Server Component costs zero byte of
 * JavaScript and inherits the page's custom properties.
 *
 * WHY IT IS DUPLICATED INTO `src/app/icon.svg` ANYWAY. A favicon is fetched by
 * the browser as a separate document; it cannot be a React component and it must
 * not be a generated route (TIW-21 measured an `opengraph-image` route printing
 * `●` while writing no file to disk). So the geometry exists twice, in a source
 * of truth and in a static file — and the two drifting apart is exactly the kind
 * of break nothing would report. `tests/components/site/brand-art.test.ts`
 * refuses it: it reads `src/app/icon.svg` off the disk and compares its path
 * data with {@link BRAND_PLANE_PATH}, character for character.
 *
 * **THE MARK CHANGED ON 7 SEPTEMBER 2026, AND THE DRAWING CONSTRAINT THAT SHAPED
 * THE OLD ONE IS GONE WITH IT.** The previous mark was a banked aeroplane flying
 * at the head of a dotted trajectory, and its whole geometry argument was a
 * clearance: measured on the shared palette of `@thomascaron/ui`, ink against
 * accent is **1.56:1 in light and 1.45:1 in dark**, so the two could never share
 * an edge and 6.7 units of bare background had to sit between them.
 *
 * The owner supplied a new drawing — an aeroplane seen head-on, upright, with a
 * compass needle cut out of its fuselage — and it has **no accented part at
 * all**. One ink, one silhouette. The clearance problem does not arise, so the
 * trajectory and its three constants are deleted rather than kept unused. What
 * survives from the old argument is the pair of measurements the ink still owes:
 * `--logo-ink` reads 8.97:1 against the page in light and 10.28:1 in dark, and
 * `tests/styles/colour-contract.test.ts` recomputes both from the sheet.
 */

/**
 * The aeroplane, seen head-on and upright, drawn in {@link BRAND_PLANE_VIEWBOX}.
 *
 * **Two contours and `fill-rule: evenodd`, which is new and is the one thing to
 * know before touching this string.** The first contour is the airframe — nose,
 * wings, tailplane, one closed outline. The second is the needle: a mast with a
 * disc at its foot, crossed by a shallow arc, and it is a *hole*. Painted with
 * the non-zero rule instead, the needle fills solid and disappears.
 *
 * WHERE THE NUMBERS COME FROM, since this is the first mark in this repository
 * that was not authored here. The owner supplied a 1600 x 1200 PNG. The airframe
 * was traced, then **re-authored by hand** from the trace's own coordinates: the
 * tracer produced a left wingtip at x 0 and a right one at x 360.435, and a logo
 * that is 0.12 per cent asymmetric is a logo. Every straight edge below is exact,
 * both nose curves are the same two cubics mirrored, and the whole airframe is
 * symmetric about x 36 by construction rather than by measurement. The needle is
 * the traced contour, scaled by 1/5 — it came out symmetric about x 36 to within
 * 0.01, so there was nothing to correct.
 *
 * WHAT IT COSTS AT FAVICON SIZE, measured rather than asserted, because the mark
 * it replaces was chosen with that number on the table. Rasterised at 16 px this
 * cut inks **34.4 per cent** of the box with 44 of its 256 pixels past alpha 200,
 * against **14.6 per cent** and 22 pixels for the banked aeroplane. An upright
 * silhouette seen head-on is a far denser shape than a banked cruciform: the
 * favicon gets more than twice the ink it had.
 *
 * WHAT THE NEEDLE COSTS AT THAT SIZE, said rather than discovered: it is 2.4 units
 * wide in a 72-unit box, so at 16 px it is half a pixel and it **disappears**. The
 * mark degrades to a plain silhouette, which still reads as an aeroplane — the
 * needle returns at 32 px. That is a deliberate acceptance and not an oversight:
 * a second, simplified cut for small sizes would be a second logo, and this
 * repository has the drift test it has because two copies of one drawing is a
 * problem it already paid for once.
 */
export const BRAND_PLANE_PATH =
  "M 36 0 C 34.9 0 34.05 0.25 33 0.65 C 31.03 1.53 29.11 3.6 27.71 6.39 C 25.61 10.53 24 19.16 24 26.23 L 24 28 L 0 56 L 0 64 L 24 56 L 28 80 L 20 92 L 20 100 L 36 92 L 52 100 L 52 92 L 44 80 L 48 56 L 72 64 L 72 56 L 48 28 L 48 26.23 C 48 19.16 46.39 10.53 44.29 6.39 C 42.89 3.6 40.97 1.53 39 0.65 C 37.95 0.25 37.1 0 36 0 Z M 35.2 15.2 C 34.81 15.59 34.8 15.87 34.8 22.8 C 34.8 26.76 34.73 30 34.65 30 C 34.57 30 33.94 29.86 33.25 29.7 C 31.83 29.36 30.35 28.67 29.45 27.91 C 29.12 27.63 28.76 27.4 28.66 27.4 C 28.56 27.4 28.21 27.68 27.89 28.02 L 27.3 28.64 28.13 29.37 C 29.49 30.59 31.32 31.35 34.25 31.9 L 34.8 32.01 34.8 36.42 L 34.8 40.84 33.91 41.7 C 32.46 43.11 32.42 44.82 33.8 46.2 C 35.13 47.53 36.87 47.53 38.2 46.2 C 39.58 44.82 39.54 43.11 38.09 41.7 L 37.2 40.84 37.2 36.42 L 37.2 32.01 37.75 31.9 C 40.68 31.35 42.51 30.59 43.87 29.37 L 44.7 28.64 44.11 28.02 C 43.79 27.68 43.44 27.4 43.34 27.4 C 43.24 27.4 42.88 27.63 42.55 27.91 C 41.65 28.67 40.17 29.36 38.75 29.7 C 38.06 29.86 37.43 30 37.35 30 C 37.27 30 37.2 26.76 37.2 22.8 C 37.2 15.87 37.19 15.59 36.8 15.2 C 36.58 14.98 36.22 14.8 36 14.8 C 35.78 14.8 35.42 14.98 35.2 15.2 Z";

/**
 * The box the aeroplane is drawn in: taller than wide, 0.72 : 1, which is the
 * source drawing's own proportion. Its edges are the silhouette's — wingtips at
 * x 0 and x 72, nose at y 0, tail at y 100 — so a placement can reason about the
 * mark's bounds without re-deriving them from the path.
 */
export const BRAND_PLANE_VIEWBOX = "0 0 72 100";

/**
 * The square the aeroplane is set into for the favicon, the apple icon and any
 * other solo use. A favicon is square whatever it draws.
 */
export const BRAND_MARK_VIEWBOX = "0 0 48 48";

/**
 * The aeroplane inside that square — the SAME path string, moved and scaled by a
 * `<g transform>`.
 *
 * A transform and not a second set of coordinates, deliberately: two hand-placed
 * copies of a logo are two logos, and the day one is nudged the other stays put.
 * Scale 0.42 puts the 100-unit-tall cut at 42 units with 3 units of margin above
 * and below, and 30.24 units wide centred at x 8.88 — margins the eye reads as
 * equal because the silhouette is symmetric left to right.
 *
 * The header does NOT use this transform: it draws the aeroplane in its own
 * {@link BRAND_PLANE_VIEWBOX} and lets the medallion be the round plate. A square
 * box there would have wasted a fifth of the disc on empty margin.
 */
export const BRAND_MARK_PLANE_TRANSFORM = "translate(8.88 3) scale(0.42)";
