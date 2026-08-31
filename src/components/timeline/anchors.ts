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
  const used = new Map<string, number>();

  return steps.map((step) => {
    const base = baseAnchor(step);
    const previous = used.get(base) ?? 0;
    const occurrence = previous + 1;
    used.set(base, occurrence);

    return occurrence === 1 ? base : `${base}-${occurrence}`;
  });
}
