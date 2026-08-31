import { daysBetween } from "@/domain/geo";
import type { PlainDate } from "@/domain/geo";
import type { Place, Step, TransportMode } from "@/domain/schema";
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

export function timelineSteps(trip: {
  readonly places: readonly Place[];
  readonly steps: readonly Step[];
}): readonly TimelineStep[] {
  const bySlug = new Map(trip.places.map((place) => [place.slug, place]));
  const anchors = stepAnchors(trip.steps);

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
      return {
        kind: "stay",
        anchor,
        place: place(step.placeSlug),
        startDate: step.startDate,
        endDate: step.endDate,
        nights: daysBetween(step.startDate, step.endDate),
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
