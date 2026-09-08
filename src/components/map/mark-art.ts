/**
 * The marker's geometry, and nothing else — no React, no Next, no CSS.
 *
 * The same shape of module as `src/components/site/brand-art.ts`, and for the
 * same reason: a drawing whose numbers are settled somewhere a comment can argue
 * about them, rather than inlined in a component where the next reader finds a
 * path string and no story.
 *
 * **A PIN, AND IT REPLACED A PENNANT BECAUSE THE PENNANT WAS NOT PRECISE.** The
 * owner read it off the map: *« les balises actuelles ne sont pas précises, tu
 * peux utiliser un ping plus pointu ? »* — and the criticism is exact. A pennant
 * is a mast with a flag: its contact with the ground is the *end of a vertical
 * line*, two units wide, and everything else about the shape hangs to one side of
 * it. Nothing in the drawing says "here" — the eye reads the flag, which is the
 * part that is not the place. Worse, it is asymmetric, so two markers a few pixels
 * apart overlap differently depending on which is on the left.
 *
 * A pin tapers to **one point**, at the horizontal centre of its own box, and the
 * point is the place. Symmetric, so the overlap of two neighbours no longer
 * depends on their order; and the tip is a genuine corner rather than the end of a
 * stroke, so it survives being drawn at twelve pixels.
 *
 * **What it kept from the pennant.** One closed contour, for the outline: the ring
 * that separates a marker from whatever tint it lands on is painted with
 * `paint-order: stroke`, which strokes before it fills. Two shapes would be two
 * outlines and the seam would show as a line across the middle of the mark. And
 * the hollow variant for a récit still to come — a difference of *shape*, not of
 * hue.
 */

/**
 * The box the pin is drawn in.
 *
 * Taller than wide, and **the tip is the origin of the placement**: at (8, 23) in
 * this box — the horizontal centre — which is what `world-map.module.css`
 * translates onto the projected point. Everything else hangs straight above it.
 */
export const MARK_VIEWBOX = "0 0 16 24";

/**
 * Where the pin touches the ground, in the box above. The CSS anchors on it.
 *
 * **`x` is half the box's width, and that equality is the whole improvement over
 * the pennant it replaces**, whose foot sat at x = 3 of an 18-unit box. A marker
 * anchored off its own centre line hangs to one side of the place it names, and
 * `tests/map/anchor.test.ts` is not what catches that — the eye is.
 */
export const MARK_TIP = Object.freeze({ x: 8, y: 23 });

/**
 * The pin — head and taper as **one closed path**, not a circle plus a triangle.
 *
 * Read as a walk: from the tip, up the left flank to the widest point of the head,
 * over the head, and back down the right flank to the tip.
 *
 * The two flanks are cubics rather than straight lines, and each control point is
 * doing one job. The first — (6.4, 19.6) from the tip — sets the **tip angle**:
 * about 50° between the two flanks, which is sharp enough to point and blunt
 * enough to survive a 2.2-unit stroke without the outline swallowing the corner.
 * The second — (2.5, 12.5) — is directly below the head's widest point, which
 * makes the tangent vertical there and the join with the arc invisible.
 *
 * The head is a true semicircle: centre (8, 7.5), radius 5.5, so the chord from
 * (2.5, 7.5) to (13.5, 7.5) is exactly the diameter.
 *
 * Symmetric about x = 8 by construction — the right flank's controls are the
 * left's mirrored — which is what the pennant could not be.
 */
export const MARK_PIN_PATH =
  "M8 23 C6.4 19.6 2.5 12.5 2.5 7.5 A5.5 5.5 0 1 1 13.5 7.5 C13.5 12.5 9.6 19.6 8 23 Z";
