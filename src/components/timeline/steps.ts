import { photosByPlace, viewerPhotos } from "@/components/photos/collection";
import type { GalleryPhoto } from "@/components/photos/collection";
import { daysBetween } from "@/domain/geo";
import type { PlainDate } from "@/domain/geo";
import type { Photo, Place, Step, TransportMode } from "@/domain/schema";
import { stepAnchors } from "./anchors";

/**
 * The steps as the timeline renders them: place slugs resolved to places, one
 * stable anchor each, nights counted.
 *
 * **Order is taken, never computed.** `TripSchema` already refuses a trip whose
 * steps run backwards — it is one of the rules `content/README.md` lists as
 * "each corresponds to a broken page" — so re-sorting here would achieve nothing
 * except hiding a content fault that the validator is meant to shout about. The
 * array order *is* the chronology; the suite asserts that what comes out is what
 * went in.
 *
 * **Why the whole `Place` and not the name.** The mini-map projects
 * `coordinates` and the timeline prints `name`, and both must be talking about
 * the same declaration. Looking a place up twice from a slug, in two components,
 * is how the marker ends up on a different city from the one the heading names.
 *
 * **Why the photos come through here.** A photo carrying `placeSlug` is shown
 * inside that place's stay rather than in the trip's gallery — where a reader
 * following the itinerary meets it. The attaching is arithmetic over the content,
 * so it belongs to this pure function and not to the JSX: `trip-timeline.tsx`
 * receives stays that already know their photos, and the rule below about a split
 * stay is a unit test rather than a paragraph nobody can run.
 */

export type TimelineStay = {
  readonly kind: "stay";
  readonly anchor: string;
  readonly place: Place;
  readonly startDate: PlainDate;
  readonly endDate: PlainDate;
  /** 0 for a day spent somewhere without sleeping there — a real case, and the
   * one that makes "nights" and "days" different numbers. */
  readonly nights: number;
  /**
   * The photos taken in this place, already numbered for the page's single
   * viewer. Empty for a stay whose place has none — and empty for the *second*
   * stay in a place the trip visited twice, see {@link timelineSteps}.
   */
  readonly photos: readonly GalleryPhoto[];
};

export type TimelineMove = {
  readonly kind: "move";
  readonly anchor: string;
  readonly from: Place;
  readonly to: Place;
  readonly mode: TransportMode;
  readonly date: PlainDate;
};

export type TimelineStep = TimelineStay | TimelineMove;

/**
 * Thrown rather than skipped, the same reasoning as `firstArrivalOf` in the
 * domain: `TripSchema` refuses a step naming an undeclared place, so this branch
 * means the value never went through the schema. Dropping the step would render
 * a trip with a hole in its itinerary and no indication that anything is
 * missing.
 */
function unknownPlace(slug: string): Error {
  return new Error(
    `A step references the place "${slug}", which is absent from places[]. Parse the trip with TripSchema before rendering it.`
  );
}

/** One shared empty array rather than a fresh one per photoless stay. */
const NO_PHOTOS: readonly GalleryPhoto[] = [];

/**
 * `photos` and `coverPhotoSrc` are optional so that a caller with an itinerary
 * and nothing else — the suite, and any future consumer that only needs the
 * chronology — is not forced to pass empty fields. `TripDetail` satisfies the
 * whole shape structurally.
 */
export function timelineSteps(trip: {
  readonly places: readonly Place[];
  readonly steps: readonly Step[];
  readonly photos?: readonly Photo[];
  readonly coverPhotoSrc?: string;
}): readonly TimelineStep[] {
  const bySlug = new Map(trip.places.map((place) => [place.slug, place]));
  const anchors = stepAnchors(trip.steps);
  /**
   * Numbered by `viewerPhotos`, which is the page's single derivation of the
   * viewer's array — so a photo's index inside a stay is the same integer the
   * trip's gallery would give it. Calling it here rather than receiving it as a
   * parameter keeps the numbering out of the component boundary: two callers
   * cannot hand over two different numberings.
   */
  const byPlace = photosByPlace(viewerPhotos(trip));
  /**
   * The places whose photos have already been handed to a stay.
   *
   * **A place can be stayed in twice** — a trip that leaves Tokyo for Kyoto and
   * comes back is a split stay, which `TripSchema` explicitly accepts. A photo
   * declares a *place*, not a date, so nothing in the content says which of the
   * two stays it belongs to. It goes to the FIRST, chronologically: that is the
   * reader's first encounter with the place, and it is the only choice that shows
   * each photo once. Spreading them over both would need a rule the content
   * cannot express, and repeating them in both would put the same image twice on
   * one page — the defect the cover exclusion exists for — and make the viewer's
   * position count larger than the number of photographs there are.
   */
  const served = new Set<string>();

  const place = (slug: string): Place => {
    const found = bySlug.get(slug);
    if (found === undefined) {
      throw unknownPlace(slug);
    }

    return found;
  };

  return trip.steps.map((step, index) => {
    // Index-aligned by construction: `stepAnchors` promises one anchor per step
    // in order, so this cannot be `undefined` for any index of `steps`.
    const anchor = anchors[index] as string;

    if (step.kind === "stay") {
      const photos = served.has(step.placeSlug)
        ? NO_PHOTOS
        : (byPlace.get(step.placeSlug) ?? NO_PHOTOS);
      served.add(step.placeSlug);

      return {
        kind: "stay",
        anchor,
        place: place(step.placeSlug),
        startDate: step.startDate,
        endDate: step.endDate,
        nights: daysBetween(step.startDate, step.endDate),
        photos,
      };
    }

    return {
      kind: "move",
      anchor,
      from: place(step.fromSlug),
      to: place(step.toSlug),
      mode: step.mode,
      date: step.date,
    };
  });
}
