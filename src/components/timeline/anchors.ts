import type { Step } from "@/domain/schema";

/**
 * The `id` a step's heading carries, and therefore the link a reader copies.
 *
 * **Why not the array index.** `#etape-3` is one line shorter and it is wrong:
 * the index is a property of the array, not of the step. An author who inserts a
 * forgotten flight at the top of the trip re-points every link ever shared, in
 * silence — no build error, no redirect, no way for the reader who saved it to
 * know. These anchors are derived from *content* instead, so a step keeps its
 * identity however the array around it moves. The suite pins that property
 * directly: inserting two steps at the front must leave the rest untouched.
 *
 * **Why the date is in there.** The other tempting scheme, `#etape-tokyo`, dies
 * on the trip that returns to a city — and returning to a city is normal, not
 * exotic. The date separates the two stays, and it is as stable as the place
 * slug is: both are content, and correcting either is a content edit whose
 * consequences an author can see.
 *
 * **Why no escaping is needed.** `SlugSchema` admits `[a-z0-9]` joined by single
 * hyphens and `PlainDateSchema` admits `YYYY-MM-DD`, so every anchor below is
 * already a legal URL fragment. That is asserted rather than assumed: a fragment
 * needing percent-encoding survives a paste into a browser bar and not into most
 * chat clients, which would quietly cost the "copyable" half of the criterion the
 * day `SlugSchema` widens.
 *
 * French words on purpose. The anchor is the visible half of a shared URL, and
 * the site it belongs to is French.
 */
const STAY_PREFIX = "etape";
const MOVE_PREFIX = "trajet";

/**
 * Date-plus-place is very nearly a key for a step, and "very nearly" is the
 * whole reason this function takes the *whole list* rather than one step:
 * nothing in `TripSchema` forbids two identical moves on a single day (two
 * ferry crossings, an out-and-back), and a repeated `id` makes every duplicate
 * after the first unreachable — the browser jumps to the first and stops.
 *
 * So uniqueness is settled here, over the list, and the first occurrence keeps
 * the bare anchor. That ordering matters: it means adding a *second* identical
 * step never changes the anchor of the one that was already there and already
 * shared.
 */
function baseAnchor(step: Step): string {
  return step.kind === "stay"
    ? `${STAY_PREFIX}-${step.startDate}-${step.placeSlug}`
    : `${MOVE_PREFIX}-${step.date}-${step.fromSlug}-${step.toSlug}`;
}

/**
 * One anchor per step, in order and index-aligned with `steps`.
 *
 * The alignment is part of the contract: the timeline renders headings and
 * anchors in parallel, so a result that dropped or reordered an entry would
 * label a heading with another step's identity — a wrong link rather than a
 * missing one.
 */
export function stepAnchors(steps: readonly Step[]): readonly string[] {
  /**
   * The set holds the anchors **actually emitted**, not the bases they were
   * derived from — and the difference is a bug that shipped once.
   *
   * Counting occurrences per base looks equivalent and is not, because a
   * disambiguating suffix can collide with another step's *base*. Measured on a
   * real production build, with a trip whose content `TripSchema` and
   * `npm run validate:content` both accept:
   *
   *     places: lyon-2 (Lyon 2e), lyon
   *     steps:  stay lyon-2 · move lyon-2 → lyon · stay lyon · stay lyon
   *
   *     h3 ids: etape-2024-04-12-lyon-2        ← the stay in Lyon 2e
   *             trajet-2024-04-12-lyon-2-lyon
   *             etape-2024-04-12-lyon
   *             etape-2024-04-12-lyon-2        ← the second stay in Lyon, "-2"
   *     duplicates: etape-2024-04-12-lyon-2
   *
   * Two identical `id` in one document: the `#` link of the fourth step jumps to
   * the first, and React sees a duplicate key. Slugs ending in a digit are not
   * contrived — `lyon-2`, `paris-2`, `bordeaux-3` are how one names an
   * arrondissement, a second station or a second hotel, and `SlugSchema` admits
   * them.
   *
   * Hence: try the base, then `-2`, `-3`… and take the first spelling nobody
   * holds. The loop terminates because each attempt is longer than the last, so
   * the candidate eventually leaves the finite set of anchors already emitted.
   * The first occurrence still keeps the bare anchor, which is what makes adding
   * a second identical step leave the already-shared link alone.
   */
  const emitted = new Set<string>();

  return steps.map((step) => {
    const base = baseAnchor(step);

    let candidate = base;
    for (let occurrence = 2; emitted.has(candidate); occurrence += 1) {
      candidate = `${base}-${occurrence}`;
    }

    emitted.add(candidate);

    return candidate;
  });
}
