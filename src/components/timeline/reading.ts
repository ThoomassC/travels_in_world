import type { Place } from "@/domain/schema";

/**
 * How many words this page puts in front of a reader — the input to
 * `estimateReadingMinutes`.
 *
 * **Read this before trusting the number it produces.** The current content
 * model has no prose in it at all. `StaySchema` is
 * `{ kind, placeSlug, startDate, endDate }` and it is a `strictObject`, so a
 * `text:` key in a `trip.yaml` is not merely unread — it is a validation error.
 * `collection.ts` opens exactly one file per trip (`TRIP_FILE_NAME =
 * "trip.yaml"`), so there is no `.md`/`.mdx` sidecar either, and
 * `content/README.md`, which is the authoring contract, documents no body field.
 *
 * So what is counted below is everything there *is* to count: the trip's title
 * and the names of the places it crosses. For a real trip that is a couple of
 * dozen words, which lands every published trip on the one-minute floor.
 *
 * That is the honest answer rather than a flattering one. The alternatives were
 * both worse: inventing a per-step reading cost would print a confident number
 * derived from nothing, and omitting the figure would drop an acceptance
 * criterion silently. **The line to change when prose exists is marked below**,
 * and it is one line — which is the property this module is shaped to have.
 */

/**
 * Words separated by any run of whitespace, with the ends trimmed so an empty or
 * blank string counts zero rather than one.
 *
 * Deliberately not a `\b`-based or punctuation-aware count: this feeds a
 * "roughly N minutes" estimate, and the difference between counting "c'est-à-dire"
 * as one word or three is far below the precision the figure claims.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();

  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

export function tripWordCount(trip: {
  readonly title: string;
  readonly places: readonly Place[];
}): number {
  const texts = [
    trip.title,
    ...trip.places.map((place) => place.name),
    // ← When a step gains a prose field, spread its text in here. Nothing else
    //   in the reading-time path has to change: `estimateReadingMinutes` is a
    //   plain words-to-minutes conversion and the page already renders whatever
    //   this returns.
  ];

  return texts.reduce((total, text) => total + countWords(text), 0);
}
