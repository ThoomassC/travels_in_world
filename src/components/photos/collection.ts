import type { Photo } from "@/domain/schema";
import type { PhotoView } from "./photo-figure";

/**
 * How a trip's photos are shared out between the three places that render them,
 * and the one numbering all three agree on.
 *
 * **Why the numbering is here and not in each renderer.** There is a single
 * viewer per page (see `photo-lightbox.tsx`), so every clickable photo has to
 * carry its position *in the viewer's own array* — the trip's gallery, a stay's
 * photos and the viewer itself must agree to the integer. Three loops each
 * counting from zero is how a reader clicks the fourth photo of a step and the
 * viewer opens the fourth photo of the trip.
 *
 * So {@link viewerPhotos} is the single derivation: it decides which photos the
 * viewer holds, in which order, and stamps each one with its index. Everything
 * downstream — {@link unplacedPhotos}, {@link photosByPlace} — only *filters*
 * that list, never renumbers it. Calling `viewerPhotos` twice on one trip is
 * cheap and cannot disagree with itself; recounting in a second place can.
 *
 * Pure data, no React: the page, the timeline and the suite all reach it, and
 * two of the three are not rendering anything.
 */

/** The extra field a photo carries once it is part of the page's viewer. */
export type ViewerPhoto = PhotoView & {
  /** 0-based position in {@link viewerPhotos}; what a trigger's `data-photo-index` says. */
  readonly index: number;
  /** Carried through from the content so the two partitions below can read it. */
  readonly placeSlug?: string;
};

/**
 * What a gallery item needs, and no more: the photo and the number its `<a>`
 * hands to the viewer. Narrower than {@link ViewerPhoto} on purpose — a gallery
 * has nothing to do with a place slug.
 */
export type GalleryPhoto = PhotoView & { readonly index: number };

type PhotoBearingTrip = {
  readonly photos?: readonly Photo[];
  readonly coverPhotoSrc?: string;
};

/**
 * Every photo the viewer holds, in the order the content declares them.
 *
 * **The cover is excluded, and that is the same decision the gallery already
 * made** — for the reason recorded on the trip page: `TripSchema` requires
 * `coverPhotoSrc` to be one of `photos[]`, so a list taken whole shows the
 * header's image a second time and a screen reader hears the same `alt` twice
 * with nothing to say the two are one photo. Excluding it here rather than in
 * each renderer is what keeps "photo 3 sur 11" counting the photos a reader can
 * actually open: the cover is not a trigger, because the header is the page's
 * opening and its LCP candidate, and putting a modal behind it costs a tab stop
 * before the reader has met the trip's summary.
 *
 * Declaration order, never sorted: it is the author's order, the same argument
 * `timelineSteps` makes about steps.
 */
export function viewerPhotos(trip: PhotoBearingTrip): readonly ViewerPhoto[] {
  return (trip.photos ?? [])
    .filter((photo) => photo.src !== trip.coverPhotoSrc)
    .map((photo, index) => ({ ...photo, index }));
}

/**
 * The trip's own gallery: the photos attached to no place.
 *
 * A photo that names a place is shown inside that place's step instead — where a
 * reader following the itinerary meets it — so showing it here as well would put
 * the same image twice on one page, which is the defect the cover exclusion
 * above exists for.
 */
export function unplacedPhotos(photos: readonly ViewerPhoto[]): readonly GalleryPhoto[] {
  return photos.filter((photo) => photo.placeSlug === undefined);
}

/**
 * The photos of each place, keyed by slug, in declaration order.
 *
 * `TripSchema` already refuses a `placeSlug` no declared place bears, so a key
 * here always names a real place; a place with no photo is simply absent from
 * the map rather than present with an empty array, so a caller reads
 * `?? EMPTY` once instead of testing `length` everywhere.
 */
export function photosByPlace(
  photos: readonly ViewerPhoto[]
): ReadonlyMap<string, readonly GalleryPhoto[]> {
  const byPlace = new Map<string, GalleryPhoto[]>();

  for (const photo of photos) {
    if (photo.placeSlug === undefined) {
      continue;
    }
    const existing = byPlace.get(photo.placeSlug);
    if (existing === undefined) {
      byPlace.set(photo.placeSlug, [photo]);
    } else {
      existing.push(photo);
    }
  }

  return byPlace;
}
