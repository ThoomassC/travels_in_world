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
 * data with {@link BRAND_PLANE_PATH}, character for character.
 *
 * THE DRAWING CONSTRAINT THIS SHAPE ABSORBS. Measured on the shared palette of
 * `@thomascaron/ui`, ink against accent is **1.56:1 in light and 1.45:1 in
 * dark** — far below the 3:1 a graphical object needs. So no edge of this mark is
 * ever an ink/accent edge: the aeroplane is a single connected mass of
 * `--logo-ink`, the trajectory is a dotted rule of `--logo-accent`, and the two
 * are separated by ~6.7 units of bare background. Each reads against the page
 * (ink 8.97:1 light / 10.28:1 dark, accent 5.76:1 / 7.10:1), never against the
 * other. Merge them and the mark becomes one flat silhouette.
 *
 * The constraint got *tighter* with the shared palette, not looser: the two
 * colours were 1.99 apart in light and are 1.56 apart now, because the shared
 * accent is one teal in both themes instead of a dark teal and a bright cyan.
 * The clearance below is what absorbs it, and it is the reason this file has a
 * geometry argument at all. `tests/styles/colour-contract.test.ts` recomputes all
 * six numbers above from the sheet.
 */

/**
 * The favicon cut — a long-haul aeroplane seen from above, **banked 21° and
 * heading up-LEFT**. One closed path, one connected mass, and **no internal void
 * anywhere**: the fuselage, both wings and the tailplane are a single outline, so
 * nothing here depends on a gap surviving the rasteriser.
 *
 * **Both numbers in that sentence were wrong when this file was written, and the
 * correction is left visible on purpose.** The generator was told to rotate the
 * upright cut by -30°, so the header said 30° and "up and to the right". The
 * source cut was not upright: fitting a mirror axis to the twenty vertices gives
 * 69.0° from +x with a residual of 0.0012 — a rigid rotation, no shear — which is
 * **21.0° from the vertical**, and the highest point of the path sits at x 16.83
 * against a box centred on 23.75, so the nose is on the LEFT. A number derived
 * from an input rather than measured on the output is a number nobody checked.
 *
 * WHAT THAT LEAVES OPEN, stated rather than quietly lived with: in the lock-up the
 * trajectory rises from left to right, and this aeroplane noses up-left — it flies
 * against its own route. Mirroring the path horizontally would resolve it and cost
 * one regeneration of the two rasters. It has not been done because the mark
 * itself is under review, and the wrong time to nudge a drawing is while it is
 * being replaced.
 *
 * WHY IT IS TILTED, WHICH IS THE WHOLE DESIGN DECISION. An upright aeroplane is
 * the glyph every airport in the world already prints: it names the category and
 * not this carnet. Banked, the same silhouette stops being signage and becomes a
 * flight — and it is the angle that lets the mark sit at the head of the
 * trajectory below instead of hovering above it.
 *
 * WHAT THE TILT COSTS, measured rather than asserted, because it is the criterion
 * this repository has paid for twice. Rasterised at 16 px — tab-bar size — this
 * cut covers **14.6 %** of the box, against **28.8 %** for the welded comet it
 * replaces; 22 of its 256 pixels reach alpha 200 where the comet reached 64. A
 * banked aeroplane is a thin cruciform and no drawing of one is dense: the mark
 * is legible at 16 px and it is markedly lighter than what it replaces. The
 * margins below are what buy back the difference that could be bought — at the
 * comet's own L5 R6.5 the same shape covered only 10.7 %.
 *
 * Drawn in {@link BRAND_MARK_VIEWBOX}, bounding box 41.5 x 27.94 with margins
 * L3 R3.5 T10.03 B10.03. The vertical margins are equal because a wide silhouette
 * in a square box is symmetric top to bottom whatever it draws. The extra
 * half-unit on the right is what optical centring asks of a shape whose mass —
 * the swept wing and the tailplane — sits to the right of the fuselage, and it
 * survives the correction above: the NOSE points left, the WEIGHT is on the
 * right.
 *
 * The numbers come from a generator (the source cut, rotated -30° about its own
 * centre — which landed at 21° from the vertical because the source was not
 * upright — then fitted to those margins) and are frozen here as literals: a build
 * has no business recomputing a logo, and a literal is what the drift test can
 * compare against the `.svg` on disk.
 */
export const BRAND_PLANE_PATH =
  "M 16.83 10.03 L 20.32 14.1 L 23.77 21.27 L 43.36 18.84 L 44.5 21.79 L 26.48 27.94 L 27.5 31.41 L 32.21 31.61 L 32.83 33.22 L 28.12 34.41 L 26.9 36.27 L 24.76 35.71 L 20.46 37.97 L 19.83 36.35 L 23.2 33.05 L 21.64 29.8 L 4.14 37.29 L 3 34.33 L 19.19 23.02 L 16.96 15.39 Z";

/** The square the aeroplane is drawn in — the favicon, the apple icon, any solo use. */
export const BRAND_MARK_VIEWBOX = "0 0 48 48";

/**
 * The header lock-up's box: the same aeroplane, smaller and pushed up-right, with
 * the trajectory running below it. Wider than tall so the mark leads the wordmark
 * instead of towering over it.
 */
export const BRAND_LOCKUP_VIEWBOX = "0 0 38 32";

/**
 * The aeroplane inside the lock-up box — the SAME path string, moved and scaled by
 * a `<g transform>`.
 *
 * A transform and not a second set of coordinates, deliberately: two hand-placed
 * copies of a logo are two logos, and the day one is nudged the other stays put.
 * Scale 0.5663 puts the 41.5-unit-wide cut at 23.5 units, its right edge at 36.5,
 * its top at 2 and its lowest ink at 17.82.
 */
export const BRAND_LOCKUP_PLANE_TRANSFORM = "translate(11.3 -3.68) scale(0.5663)";

/**
 * The trajectory — the "filet" the mark flies at the head of, and the only
 * accented part of the brand.
 *
 * A **dotted** rule and not a solid one, for two reasons that happen to agree. It
 * is what a route looks like on a map, which is what this site is about; and each
 * dot is surrounded by background on every side, so the accent never has an edge
 * against the ink. Rendered with round caps and a zero-length dash, which is how
 * SVG spells "a row of dots".
 *
 * Its highest painted edge is at y 24.5 — the curve's minimum, 26 at the right
 * end, less half of {@link BRAND_LOCKUP_TRACK_WIDTH} — and the aeroplane's lowest
 * ink is at 17.82, so **6.68 units of bare background separate them**. That
 * clearance is the load-bearing number of this file: close it and the accent
 * starts sharing an edge with the ink, at 1.56:1.
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
