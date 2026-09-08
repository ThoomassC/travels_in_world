/**
 * How a served page names the map's drawing, now that it is no longer the only
 * `<svg>` inside the `<figure>`.
 *
 * **The change that made this file necessary.** A marker used to be a `<span>`
 * shaped by CSS into a disc. It is now an inline `<svg>` — the pennant of
 * `src/components/map/mark-art.ts`, one closed contour so that `paint-order`
 * gives it a single outline. Thirteen markers therefore put thirteen more
 * `<svg>` elements in the figure, and every `page.locator("figure svg")` in this
 * suite went from one element to fourteen. Playwright does not silently take the
 * first: it fails with `strict mode violation`, which is how eighteen E2E cases
 * reported one markup change.
 *
 * **Why a selector and not `.first()`.** `.first()` would have been one word and
 * would have hidden the interesting failure: on a page where the drawing stopped
 * rendering, the first `<svg>` in the figure is a *marker*, and a suite asserting
 * on a marker's `viewBox` would go green while the map was gone. This selector
 * names the drawing by what distinguishes it — it is the one `<svg>` that is not
 * inside a marker's list item — so the same page fails, which is the point.
 *
 * The markers live in `<ul> <li> <a> <svg>`; the drawing is a direct child of the
 * canvas, beside that list. `:not(li svg)` is the shortest true statement of that
 * difference, and it stays true if the overlay's wrapper elements change.
 */
/**
 * The drawing, relative to a `<figure>` locator the caller already holds — which
 * several cases do, because they assert on the figure first and then on what is
 * inside it.
 */
export const MAP_DRAWING_IN_FIGURE = "svg:not(li svg)";

/** The drawing, from the page. */
export const MAP_DRAWING = `figure ${MAP_DRAWING_IN_FIGURE}`;
