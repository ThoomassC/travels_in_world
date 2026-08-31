/**
 * The brand's geometry, and nothing else — no React, no Next, no CSS.
 *
 * **THIS FILE IS THE MARK.** Everything that draws the brand reads its numbers
 * from here: the header lock-up (`./site-brand.tsx`), the favicon
 * (`src/app/icon.svg`) and the two rasters committed under `src/app/` and
 * `public/`. Replacing the mark means replacing the strings below and
 * re-generating the three rasters — see the "Marque" section of the README.
 *
 * WHY THE PATH IS A CONSTANT AND NOT A FILE THE COMPONENT FETCHES. The header
 * mark has to be **inline** SVG: `<img src="/icon.svg">` renders in its own
 * document, where `--logo-ink` and `--logo-accent` do not exist, so the mark
 * could not follow the visitor's theme. Inline SVG in a Server Component costs
 * zero byte of JavaScript and inherits the page's custom properties.
 *
 * WHY IT IS DUPLICATED INTO `src/app/icon.svg` ANYWAY. A favicon is fetched by
 * the browser as a separate document; it cannot be a React component and it must
 * not be a generated route (TIW-21 measured an `opengraph-image` route printing
 * `●` while writing no file to disk). So the geometry exists twice, in a source
 * of truth and in a static file — and the two drifting apart is exactly the kind
 * of break nothing would report. `tests/components/site/brand-art.test.ts`
 * refuses it: it reads `src/app/icon.svg` off the disk and compares its path
 * data with {@link BRAND_COMET_PATH}, character for character.
 *
 * THE DRAWING CONSTRAINT THIS SHAPE ABSORBS. Measured on the palette of
 * `src/styles/tokens.css`, ink against accent is **1.99:1 in light and 1.35:1 in
 * dark** — far below the 3:1 a graphical object needs. So no edge of this mark is
 * ever an ink/accent edge: the comet is a single connected mass of `--logo-ink`,
 * the trajectory is a dotted rule of `--logo-accent`, and the two are separated
 * by ~7 units of bare background. Each reads against the page
 * (ink 10.54:1 light / 16.73:1 dark, accent 5.30:1 / 12.40:1), never against the
 * other. Merge them and the mark becomes one flat silhouette.
 */

/**
 * The favicon cut — "welded comet". One closed path, one connected mass, and
 * **no internal void anywhere**: the two tail edges are the tangents from the tip
 * to the head disc, so the join is seamless by construction rather than by
 * eyeballing. That is the property the 16 px raster needs; a mark whose reading
 * depends on a one-pixel gap becomes a smudge at tab-bar size.
 *
 * Drawn in {@link BRAND_MARK_VIEWBOX} and optically centred, not geometrically:
 * the bounding box is 36.5 x 37 with margins L5 R6.5 T6 B5, because the mass sits
 * up-right and even margins would read as top-right-heavy.
 *
 * The numbers come from a generator (head disc at (29.5, 18) r 12, tip at (5, 43),
 * tail bowed 5 units along the normal) and are frozen here as literals: a build
 * has no business recomputing a logo, and a literal is what the drift test can
 * compare against the `.svg` on disk.
 */
export const BRAND_COMET_PATH =
  "M5 43 Q16.26 32.41 34.67 28.83 A12 12 0 1 0 18.57 13.05 Q8.21 24.52 5 43 Z";

/** The square the comet is drawn in — the favicon, the apple icon, any solo use. */
export const BRAND_MARK_VIEWBOX = "0 0 48 48";

/**
 * The header lock-up's box: the same comet, smaller and pushed up-right, with the
 * trajectory running below it. Wider than tall so the mark leads the wordmark
 * instead of towering over it.
 */
export const BRAND_LOCKUP_VIEWBOX = "0 0 38 32";

/**
 * The comet inside the lock-up box — the SAME path string, moved and scaled by a
 * `<g transform>`.
 *
 * A transform and not a second set of coordinates, deliberately: two hand-placed
 * copies of a logo are two logos, and the day one is nudged the other stays put.
 * Scale 0.595 puts the 37-unit-tall comet at 22 units, its right edge at 36.5 and
 * its top at 1.
 */
export const BRAND_LOCKUP_COMET_TRANSFORM = "translate(11.8 -2.6) scale(0.595)";

/**
 * The trajectory — the "filet" the mark is named for, and the only accented part
 * of the brand.
 *
 * A **dotted** rule and not a solid one, for two reasons that happen to agree. It
 * is what a route looks like on a map, which is what this site is about; and each
 * dot is surrounded by background on every side, so the accent never has an edge
 * against the ink. Rendered with round caps and a zero-length dash, which is how
 * SVG spells "a row of dots".
 *
 * It passes ~7 units below the comet's tail at the closest point. That clearance
 * is the load-bearing number of this file: close it and the accent starts sharing
 * an edge with the ink, at 1.99:1.
 */
export const BRAND_LOCKUP_TRACK_PATH = "M2 30 Q19 31 36 26";
export const BRAND_LOCKUP_TRACK_WIDTH = 3;

/**
 * `0.1 6`: a dash short enough that the round cap on each end closes into a disc,
 * then six units of nothing. At the 32 px the header renders the mark, that is a
 * 3 px dot every 6 px — the smallest dot that still reads as a dot rather than as
 * noise, which is why `--brand-mark-size` in the stylesheet has a floor.
 */
export const BRAND_LOCKUP_TRACK_DASH = "0.1 6";
