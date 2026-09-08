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

/**
 * How many photos a panel preview carries.
 *
 * **Three, and the next number is where the wall is.** A map panel's photos are
 * inlined in the home document — `PhotoFigure` writes a `srcset`, a `sizes` and
 * a base64 placeholder per photograph — so this constant multiplies by the
 * number of markers the page draws. The measured figures, so the next reader
 * does not have to rediscover them: `/fr` weighs **203.5 KiB brotli** against a
 * **240 KiB** ceiling (`tests/build/prerender.test.ts:93`), and one photo costs
 * **~160 to 260 bytes brotli** inside the document. The wall is therefore around
 * **196 photos** — about **65 trips at three photos each**, thirteen of which
 * exist today.
 *
 * Raising this to four moves that wall to ~49 trips. It is a budget decision,
 * not a taste one, and it is `npm run test:build` that will say so.
 */
export const PANEL_PHOTO_LIMIT = 3;

/**
 * The photos a trip's map panel shows: the cover first, then declaration order,
 * capped at {@link PANEL_PHOTO_LIMIT}.
 *
 * **The cover leads here, where {@link viewerPhotos} excludes it.** The two are
 * not in contradiction: the viewer excludes it because the trip page's header
 * has already shown that image, and a panel has no header image at all. Leaving
 * it out would drop the one photograph the author chose to stand for the trip
 * from the only three the reader is offered.
 *
 * **Built field by field, never `{ ...photo }`.** A panel is rendered once per
 * marker in the *home document*, and a spread would carry `placeSlug` — which
 * means nothing to a panel — plus whatever the content model grows next, into
 * that document for every trip on the map. The five fields below are exactly
 * what `PhotoFigure` reads.
 *
 * A `coverPhotoSrc` naming a file that is not in `photos[]` is ignored rather
 * than conjured: `TripSchema` forbids it, but this function takes a structural
 * shape and inventing a photo with no `alt` and no dimensions is the worse
 * failure of the two.
 */
export function panelPhotos(trip: PhotoBearingTrip): readonly PhotoView[] {
  const declared = trip.photos ?? [];
  const cover = declared.find((photo) => photo.src === trip.coverPhotoSrc);
  /* Filtered on `src` and not on object identity: `src` is the content's own
     primary key for a photo — the same key `PhotoGallery` uses for its React key
     — so promoting the cover cannot leave a second entry sharing its source
     behind, whatever `photos[]` was assembled from. */
  const ordered =
    cover === undefined
      ? declared
      : [cover, ...declared.filter((photo) => photo.src !== cover.src)];

  return ordered.slice(0, PANEL_PHOTO_LIMIT).map((photo) => ({
    src: photo.src,
    alt: photo.alt,
    width: photo.width,
    height: photo.height,
    blurDataUrl: photo.blurDataUrl,
  }));
}
