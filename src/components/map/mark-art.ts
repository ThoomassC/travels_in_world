/**
 * The marker's geometry, and nothing else — no React, no Next, no CSS.
 *
 * The same shape of module as `src/components/site/brand-art.ts`, and for the
 * same reason: a drawing whose numbers are settled somewhere a comment can argue
 * about them, rather than inlined in a component where the next reader finds a
 * path string and no story.
 *
 * **Why a pennant and not the dot it replaces.** The owner chose it from a sheet
 * of eight. What it buys over a disc is a *direction* — a marker with a mast has
 * a foot, and the foot is the place. A disc is centred on its point, which is
 * correct and says nothing; three discs in a row on the Atlantic coast were three
 * identical bubbles, and the owner read them as misplaced before anyone measured
 * whether they were.
 *
 * **What it costs, and it is not the bytes.** Thirteen inline SVGs are about
 * 2.6 KB of markup, which is noise beside the basemap. The real cost is
 * asymmetry: a pennant always flies to the same side, so two markers a few pixels
 * apart overlap differently depending on which is left. `spreadCoincident` is what
 * answers that, and it is a separate decision from this file.
 */

/**
 * The box the pennant is drawn in.
 *
 * Taller than wide, and **the foot of the mast is the origin of the placement**:
 * at (3, 23) in this box, which is what `world-map.module.css` translates onto the
 * projected point. Everything else hangs above and to the right of that.
 */
export const MARK_VIEWBOX = "0 0 18 26";

/** Where the mast meets the ground, in the box above. The CSS anchors on it. */
export const MARK_FOOT = Object.freeze({ x: 3, y: 23 });

/**
 * The pennant — mast and flag as **one closed path**, not two shapes.
 *
 * One path because of the outline: the ring that separates this marker from
 * whatever tint it lands on is painted with `paint-order: stroke`, which strokes
 * the outline before filling it. Two shapes would be two outlines, and the seam
 * where the flag meets the mast would show as a line across the middle of the
 * mark. One closed contour has one outline, and the join is invisible because it
 * does not exist.
 *
 * Read as a walk: up the left side of the mast from the foot, out along the top
 * of the flag to its tip, back to the mast, and down the right side. The corners
 * are squared here and rounded by `stroke-linejoin: round` in the stylesheet —
 * the stroke does the rounding, so the geometry stays five plain vertices and the
 * radius is a stylesheet decision rather than baked coordinates.
 */
export const MARK_PENNANT_PATH = "M1.9 23 V3.6 H4.3 L14.9 7.1 L4.3 10.6 V23 Z";
