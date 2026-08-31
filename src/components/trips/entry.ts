/**
 * What the listing reads of a trip, and nothing more.
 *
 * This is the same move `MapCountry` makes in `src/components/map/world-map.tsx`,
 * for the same reason and with the same consequence. The content façade's
 * `TripSummary` carries `tags` and a full `Place` for `firstArrival` — a slug and
 * a pair of coordinates included — none of which a card renders. Declaring what
 * is consumed rather than importing what exists means:
 *
 * - the whole layer renders under jsdom from a literal, with no disk, no YAML
 *   and no `server-only` module in the graph, which is what makes sixty trips a
 *   cheap test instead of a fixture directory;
 * - structural typing makes a real `TripSummary` assignable without a line of
 *   adaptation, and `src/app/[locale]/page.tsx` — one of the two places holding
 *   both types — is where a rename upstream fails `npm run typecheck`.
 *
 * There is no second declaration of the contract to drift from the first: this
 * type is deliberately a *subset*, never a copy.
 */
export type TripEntry = {
  /** The trip's slug: the React key, and the last segment of its URL. */
  readonly slug: string;
  readonly title: string;
  /** Calendar days, `YYYY-MM-DD`, never a `Date` — see `docs/adr/0001-domain-purity.md`. */
  readonly startDate: string;
  readonly endDate: string;
  /** Derived upstream by `durationOf`; never recomputed here. */
  readonly duration: { readonly nights: number; readonly days: number };
  /** Every country the itinerary touches, ascending by code. */
  readonly countryCodes: readonly string[];
  /** Absent for a trip with no photo yet — the card draws a placeholder then. */
  readonly coverPhotoSrc?: string;
  /**
   * Where the first step arrives. The listing reads its `countryCode` to file
   * the trip, and its `name` to say where the itinerary begins.
   */
  readonly firstArrival: { readonly name: string; readonly countryCode: string };
};
