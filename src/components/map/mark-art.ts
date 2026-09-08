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
 * A pin points **at the horizontal centre of its own box**, and that point is the
 * place. Symmetric, so the overlap of two neighbours no longer depends on their
 * order; and the tip is a genuine corner rather than the end of a stroke, so it
 * survives being drawn at twelve pixels.
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
 * The pin — **the map pin**: a teardrop with an eyelet, tapering to its point.
 *
 * The owner's third pass on this marker, and the request was *« utilise un icon
 * plus jolie ou fais plus réaliste »*. The two shapes before it were each right
 * about something and wrong as a drawing. A **pennant** hung entirely to one side
 * of its own anchor, so nothing in it said "here". A **rod with a ball on top**
 * pointed correctly, kept the head clear of the place, and looked like a
 * lollipop — a diagram of a marker rather than a marker.
 *
 * This is the shape every reader already knows, and knowing it is most of what
 * "plus joli" means at twenty pixels: there is no room to be original and be read.
 *
 * **The eyelet is what makes it a pin rather than a drop**, and it costs one extra
 * subpath. Filled solid, a teardrop at this size is a blob whose only feature is
 * its outline; the hole gives it an interior, and `paint-order: stroke` rings that
 * hole in the same ink as the silhouette, so it reads as a punched eyelet rather
 * than as a gap. It is also what carries the *told / still to come* distinction
 * without a second hue: the hollow variant inverts fill and stroke and the eyelet
 * inverts with it.
 *
 * The numbers, and each is a consequence rather than a taste:
 *
 * - **the head is r = 6 centred on (8, 8)**, and the point is at (8, 23) — the
 *   horizontal centre of the box, which is what makes the anchoring one vertical
 *   translation;
 * - **the flanks are the two tangents** from the point to that circle, computed
 *   rather than eyeballed: `√(15² − 6²)` gives the tangent length, and the contact
 *   points fall at (2.5, 10.4) and (13.5, 10.4). A tangent meets a circle with
 *   matching direction, so the straight flank flows into the arc with no visible
 *   join — which a hand-picked pair of endpoints does not;
 * - **the tip closes at 47°**, blunt enough that a 1.6-unit stroke does not swallow
 *   the corner and sharp enough to point;
 * - **the eyelet is r = 2.4**, two fifths of the head. Larger and the pin becomes a
 *   ring on a stalk; smaller and it fills in at the size this actually renders.
 *
 * **Two subpaths and `fill-rule: evenodd`**, which is a departure from the two
 * shapes before it — both were one contour precisely so that `paint-order: stroke`
 * would not draw a seam. Here the second contour is *supposed* to be outlined, so
 * the rule that forbade it does not apply. `src/components/site/brand-art.ts` uses
 * the same technique for the aeroplane's needle, and the stylesheet carries the
 * `fill-rule` for the same reason it does there.
 *
 * Symmetric about x = 8 by construction — which the pennant could not be, and
 * which is what stops two neighbouring markers from overlapping differently
 * depending on which one is on the left.
 */
export const MARK_PIN_PATH =
  "M8 23 L2.5 10.4 A6 6 0 1 1 13.5 10.4 Z M10.4 8 A2.4 2.4 0 1 1 5.6 8 A2.4 2.4 0 1 1 10.4 8 Z";
