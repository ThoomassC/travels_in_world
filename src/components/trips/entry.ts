import type { StoryState } from "@/domain/schema";

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
  /**
   * The day the récit went online, which is **not** `endDate` (TIW-19).
   *
   * Read by two things and by nothing else: `freshestTrip`, which decides which
   * single card carries the badge, and the home banner, which prints it inside a
   * `<time>`. A card never formats it — knowing *that* a récit is new is the
   * card's job, knowing *when* is the banner's.
   */
  readonly publishedAt: string;
  /** Derived upstream by `durationOf`; never recomputed here. */
  readonly duration: { readonly nights: number; readonly days: number };
  /** Every country the itinerary touches, ascending by code. */
  readonly countryCodes: readonly string[];
  /** Absent for a trip with no photo yet — the card draws its fallback tile then. */
  readonly coverPhotoSrc?: string;
  /**
   * Where the first step arrives. The listing reads its `countryCode` to file
   * the trip, and its `name` to say where the itinerary begins.
   */
  readonly firstArrival: { readonly name: string; readonly countryCode: string };
  /**
   * Whether the récit is written (TIW-18) — `"written"` or `"unwritten"`.
   *
   * **Required, and typed as the domain's union rather than as a boolean.** A card
   * reads it to decide whether its title is a link *at all*: an untold trip has no
   * page, so `tripPath(slug)` would be a dead address. Required is what makes that
   * decision unmissable — a caller assembling a `TripEntry` cannot omit the field
   * and inherit "has a page" by default, which is the direction `hasStory` exists
   * to refuse.
   *
   * The type arrives through an `import type`, which TypeScript erases before any
   * module resolution: nothing of the domain enters this layer's runtime graph, so
   * the whole listing still renders under jsdom from a literal. Re-declaring
   * `"written" | "unwritten"` here would be a second copy of a contract to drift
   * from the first, which is the one thing this narrowing file refuses to do.
   */
  readonly story: StoryState;
};
