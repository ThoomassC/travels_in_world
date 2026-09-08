/**
 * The one piece of arithmetic the map needs from the content: which countries
 * hold nothing but unwritten journeys, so the drawing can tint them apart.
 *
 * **This module used to hold a second function, and its removal is the story of
 * the file.** `tallyVisitedCountries` counted the trips reaching each country and
 * fed « Les pays visités », the list under the map that joined the drawing's
 * countries to the marker's cities. The owner removed that block from the map tab
 * on 7 September 2026; the inventory it carried now lives on the Pays and Villes
 * tabs, which are pages of their own. `src/app/[locale]/page.tsx` records what
 * that costs and the WCAG 1.4.1 debt it opens at the first published récit.
 *
 * What survived is the part the *drawing* needs rather than the part a reader
 * read. It stays pure — no React, no Next, neither façade — for the reason
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` gives for `frame.ts`: the
 * degenerate cases are worth a dozen cheap cases rather than a dozen renders.
 */

import type { StoryState } from "@/domain/schema";
import { hasStory } from "@/domain/trip";

/**
 * What this module reads of a trip, and nothing more. Structurally a subset of
 * `TripSummary`, so the content façade's value is assignable without a line of
 * adaptation — and narrower than it, so `src/app/[locale]/page.tsx`, the one place
 * holding both, is where a rename upstream fails `npm run typecheck`.
 */
export type CountingTrip = {
  /** The content façade's primary key, and the address of the trip's own page. */
  readonly slug: string;
  /** Every country the trip reaches, not just the one its marker names. */
  readonly countryCodes: readonly string[];
  /**
   * Whether the récit is written (TIW-18).
   *
   * The one field {@link untoldOnlyCountryCodes} actually decides on: a country
   * every one of whose trips is unwritten is the country the drawing tints in the
   * distinct state.
   *
   * Required, like everywhere this field appears: a caller that could omit it
   * would inherit "has a page" by default, which is the fail-open direction
   * `hasStory` exists to refuse.
   */
  readonly story: StoryState;
};

/**
 * **The countries the drawing tints in the distinct "récit à venir" state**
 * (TIW-18): those every one of whose trips is untold.
 *
 * **"Every", not "any", and that is the whole rule.** A country holding one
 * written récit and one untold journey has something to read, so marking it as
 * forthcoming would tell the reader there is nothing there while a récit sits one
 * click away. The distinct state means *nothing here is written yet*, which one
 * told trip is enough to falsify.
 *
 * **Codes and not shapes, which is what keeps `@/map` out of this.** The map
 * component already receives its tinted subset from the geometry façade; handed
 * this set, it partitions that subset itself. The alternative — a third bucket
 * returned by `buildWorldGeometry` — would have meant either changing the
 * façade's signature or projecting the world twice per build, for a distinction
 * that is entirely a property of the content.
 *
 * A trip's state reaches **every** country it crosses: a journey through Morocco
 * and Mauritania is unwritten in both.
 */
export function untoldOnlyCountryCodes(trips: readonly CountingTrip[]): ReadonlySet<string> {
  const untold = new Set<string>();
  const told = new Set<string>();

  for (const trip of trips) {
    // The target set is chosen once per trip rather than per code, so a trip
    // cannot land in both for two of its own countries.
    const destination = hasStory(trip) ? told : untold;
    for (const code of trip.countryCodes) {
      destination.add(code);
    }
  }

  // Subtracted afterwards, and not skipped during the walk: the told trip of a
  // country may arrive *after* its untold one — the façade orders by `startDate`,
  // which has nothing to do with either.
  for (const code of told) {
    untold.delete(code);
  }

  return untold;
}
