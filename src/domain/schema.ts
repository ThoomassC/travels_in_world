import { z } from "zod";
import {
  CoordinatesSchema,
  CountryCodeSchema,
  isPlainDate,
  PlainDateSchema,
  SlugSchema,
} from "./geo";
import type { PlainDate, Slug } from "./geo";
import { BLUR_DATA_URL_MAX_LENGTH, BLUR_DATA_URL_PATTERN, isDerivativeName } from "./photo";

/**
 * The content schemas. Everything in `src/content/**` is hand-written YAML, so
 * these are the only thing standing between a typo and a broken page — which is
 * why every object is *strict*: silently dropping `lattitude: 45.7` means the
 * coordinates a contributor thought they set are simply absent.
 */

/**
 * Chronological comparison that abstains instead of guessing.
 *
 * Two parts to this. String comparison is exactly right for `YYYY-MM-DD` — the
 * fields are fixed-width, zero-padded and ordered most-significant first, so
 * lexicographic order *is* chronological order. But it is only right for
 * *well-formed* dates, and Zod runs a refinement even when the leaf check on the
 * value has already failed: `"2024-04-22" < "2024-4-1"` is `true`, because `'0'`
 * sorts before `'4'`.
 *
 * Measured on a trip whose only fault was `startDate: "2024-4-1"`: eight issues,
 * of which six pointed away from the fault — five at healthy steps, one at the
 * end date. `validate:content` (TIW-9) prints these paths to a human, so a rule
 * that cannot know abstains, and the one real issue stays legible.
 */
function isBefore(earlier: PlainDate, later: PlainDate): boolean {
  return isPlainDate(earlier) && isPlainDate(later) && earlier < later;
}

/** Present but blank is the same as absent to a reader, and passes `.min(1)`. */
const NonBlankStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "Expected a non-blank string." });

export const PlaceSchema = z.strictObject({
  slug: SlugSchema,
  name: NonBlankStringSchema,
  countryCode: CountryCodeSchema,
  coordinates: CoordinatesSchema,
});

/**
 * **A place the journal has been to, with no journey attached** — the whole of
 * `content/places.yaml` (TIW-36).
 *
 * It exists because a trip cannot be written without dates, and the fourteen
 * places this ticket loads have none: a journey's dates are a fact about
 * somebody's life, and a 1st-of-January of convention would be rendered inside a
 * `<time>` and dated in an RSS feed as though it were one. So the entity that
 * carries no date is a different entity, not a `Trip` with holes in it —
 * `docs/lieux-visites.md` weighs that against the alternative and measures what
 * each one breaks.
 *
 * **`z.array(PlaceSchema)` and never a second declaration of the four fields.**
 * That single line is what the promotion story rests on: the YAML of a visited
 * place *is* an element of a trip's `places[]`, so the day a date is known the
 * edit is a move of contiguous lines, with the slug and the coordinates carried
 * over verbatim and nothing to geocode again. A copy of the fields would satisfy
 * every other rule while making that claim quietly false, which is why
 * `tests/domain/visited-place.test.ts` compares the two readings on the same
 * inputs rather than trusting this import.
 *
 * The three things it therefore refuses for free, through `strictObject`:
 * `startDate`, `endDate` and `publishedAt`. A field that *accepted* a date is a
 * field somebody eventually writes an invented one into.
 *
 * **Wrapped in an object rather than being the bare array.** `places:` at the top
 * level is the same key an author already reads in a `trip.yaml`, so the two
 * files look alike where they are alike; and a document root that is a mapping is
 * the only shape that can gain a sibling key later without changing what a
 * reader's eye is trained on.
 *
 * **An empty `places:` is accepted**, and that is a decision rather than laxity:
 * it is the resting state after the last place has been promoted into a trip.
 * "No file at all" is a different statement, and it is answered by the layer that
 * reads the disk, which is the only one that can tell the two apart.
 *
 * Uniqueness of a slug *between* this file and a trip's `places[]` is not here
 * and cannot be: this schema sees one file and knows nothing of the collection.
 * `src/content/loader.ts` refuses it and `src/content/validate.ts` reports it
 * with a line — the same division of labour `docs/adr/0001-domain-purity.md`
 * imposes and that trip slugs already follow.
 */
export const VisitedPlacesSchema = z
  .strictObject({
    places: z.array(PlaceSchema),
  })
  .superRefine((file, ctx) => {
    /**
     * A slug is what a shared link is made of — the map's marker points at
     * `#lieu-<slug>` — so two places claiming one leave one of them unreachable
     * and the other's anchor ambiguous. Reported on the *second* declaration,
     * because that is the line to delete.
     *
     * A shared *name* is not a fault: « Valence » names a city in Spain and a
     * city in France, and both are in the fourteen this ticket loads.
     */
    const seen = new Set<Slug>();
    file.places.forEach((place, index) => {
      if (seen.has(place.slug)) {
        ctx.addIssue({
          code: "custom",
          path: ["places", index, "slug"],
          message: `Two visited places share the slug "${place.slug}": every link to one of them is ambiguous.`,
        });
      }
      seen.add(place.slug);
    });
  });

export type VisitedPlaces = z.infer<typeof VisitedPlacesSchema>;

/**
 * Closed on purpose: the map draws a different stroke per mode and the timeline
 * prints a different icon, so an unknown mode has no rendering at all. Adding
 * one is a deliberate decision that touches both renderers.
 */
export const TRANSPORT_MODES = ["plane", "train", "bus", "car", "boat", "bike", "foot"] as const;

export const TransportModeSchema = z.enum(TRANSPORT_MODES);

/**
 * Whether the récit is written — the journal's third publication state (TIW-18).
 *
 * `draft` answers "may this be seen at all". This answers a different question
 * the model had no room for: **the journey happened, and nobody has written it up
 * yet.** Before this field a trip had exactly two states, and `content/README.md`
 * said so — absent from the repository, or live and looking finished. An author
 * back from a trip had to choose between a country nobody knows they visited and
 * a page that promises a story it does not hold.
 *
 * An untold trip is a full citizen of the map and of the listings: its countries
 * are tinted, its entry carries its dates and its itinerary. What it does not have
 * is a **page** — `tripStaticParams` leaves it out, so nothing links to one.
 *
 * **An enum where `draft` is a boolean**, which is worth the two lines. In YAML
 * `story: unwritten` says what it means, where the boolean spelling is a double
 * negative (`storyWritten: false`) that an author has to decode every time. And an
 * enum's refusal *names the values it accepts*: `story: pending` — the likeliest
 * synonym there is — comes back with `written` and `unwritten` in the message,
 * where a boolean could only complain that it is not a boolean.
 *
 * `.default("written")` and never `.optional()`, for the reason written at length
 * on `draft`: the absent key has one unambiguous meaning, so no consumer has a
 * third "story unknown" state to handle. {@link Trip} therefore always carries the
 * field, and `hasStory` in `./trip.ts` is the one place that reads it.
 */
export const STORY_STATES = ["written", "unwritten"] as const;

export const StoryStateSchema = z.enum(STORY_STATES);

const StaySchema = z
  .strictObject({
    kind: z.literal("stay"),
    placeSlug: SlugSchema,
    startDate: PlainDateSchema,
    endDate: PlainDateSchema,
  })
  .refine((stay) => !isBefore(stay.endDate, stay.startDate), {
    message: "A stay cannot end before it starts.",
    path: ["endDate"],
  });

const MoveSchema = z
  .strictObject({
    kind: z.literal("move"),
    fromSlug: SlugSchema,
    toSlug: SlugSchema,
    mode: TransportModeSchema,
    date: PlainDateSchema,
  })
  /**
   * A move to the place it leaves from is wrong without any trip context, so it
   * is refused here. Distinct from the `drawableMoves` threshold, which is about
   * *coordinates*: two different places 95 m apart are a legitimate move that
   * simply must not be drawn.
   */
  .refine((move) => move.fromSlug !== move.toSlug, {
    message: "A move must leave from a different place than it arrives at.",
    path: ["toSlug"],
  });

/**
 * Discriminated, not permissive: a stay carrying `fromSlug` and `mode` is a
 * half-edited step, and accepting it would let the timeline show a stay while
 * the map draws a segment from the same entry. The discriminator also puts the
 * error on `kind` for an unknown one, instead of a pile of unrecognized-key
 * complaints from both branches.
 */
export const StepSchema = z.discriminatedUnion("kind", [StaySchema, MoveSchema]);

export const BudgetSchema = z.strictObject({
  // Integer cents, never a float: `0.1 + 0.2` is the reason, and a total of
  // `4200.5` cents has no meaning to divide or to display.
  totalCents: z.int().min(0),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 currency code, such as "EUR".'),
  // `budgetPerPerson` divides by this: zero and 2.5 travellers must never reach it.
  travellers: z.int().min(1),
});

export const PhotoSchema = z.strictObject({
  /**
   * The original file, as a site-absolute URL path.
   *
   * Refused when it has the shape the pipeline gives its **own** output:
   * `tokyo-480.jpg` is precisely where `npm run index-photos` writes the 480 px
   * derivative of `tokyo.jpg`, so whichever is written last wins and the loser is
   * either the author's original or a page serving a JPEG under an `.avif` name.
   * The predicate matches the ladder's real widths and nothing else, so a date —
   * `2024-04-12.jpg`, the likeliest photo name there is — stays accepted.
   */
  src: z
    .string()
    .min(1)
    .refine((src) => !isDerivativeName(src), {
      message:
        "A photo source may not end in a hyphen followed by one of the derivative widths: that is the name `npm run index-photos` writes its own output to.",
    }),
  // Required and non-blank: an unlabelled gallery is unusable with a screen
  // reader, and the only moment anyone writes the alt text is the moment the
  // build refuses to go on without it. The empty string is the decorative-image
  // convention, and these photos *are* the content.
  alt: NonBlankStringSchema,
  // Both dimensions reserve the space in the layout; a missing one is a
  // guaranteed layout shift.
  width: z.int().min(1),
  height: z.int().min(1),
  /**
   * The preloading placeholder: a tiny WebP as a `data:` URI.
   *
   * **Required, like the dimensions, and for the same reason.** The three fields
   * are written together by one run of `npm run index-photos`, so an optional one
   * means a photo indexed before the field existed renders with no placeholder
   * while nothing anywhere says so. `content/README.md` documents it the way it
   * documents `coordinates` — machine-written, never typed by hand.
   *
   * **The shape is pinned, not just the presence**, because this value is
   * interpolated into an inline `style` attribute in the document:
   * `data:image/svg+xml` can carry script, and a raw `"` closes the attribute. So
   * the pattern admits base64-encoded WebP and nothing else. The length cap is
   * the other half — 200 photos on one page at 512 characters is ~100 KB of HTML,
   * the entire document budget spent on placeholders.
   */
  blurDataUrl: z
    .string()
    .max(BLUR_DATA_URL_MAX_LENGTH)
    .regex(
      BLUR_DATA_URL_PATTERN,
      'Expected a base64 WebP data URI, as written by `npm run index-photos` — "data:image/webp;base64,…".'
    ),
  /**
   * The place this photo was taken in, when it is worth saying.
   *
   * Optional on purpose: a photo with no place is the ordinary case and belongs
   * to the trip's gallery. One that names a place appears inside that place's
   * step in the timeline instead, which is where a reader following the itinerary
   * expects to meet it.
   *
   * Declared here rather than as a `photos:` list on each step, so that every
   * photo of a trip stays in the one array `index-photos` scans, `coverPhotoSrc`
   * points into, and the duplicate-source rule below reads. See {@link checkTrip}
   * for the other half: a slug no declared place bears is refused.
   */
  placeSlug: SlugSchema.optional(),
});

/**
 * A tag *is* a slug — it appears in a URL — so it is the same schema rather than
 * a second copy of the pattern that could drift from it.
 */
export const TagSchema = SlugSchema;

export type Place = z.infer<typeof PlaceSchema>;
export type TransportMode = z.infer<typeof TransportModeSchema>;
export type StoryState = z.infer<typeof StoryStateSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Budget = z.infer<typeof BudgetSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type Tag = z.infer<typeof TagSchema>;

/**
 * The places a step points at. A stay names one, a move names two — and the
 * second one is why a country reached only by plane still counts as visited.
 */
export function referencedPlaceSlugs(step: Step): readonly Slug[] {
  return step.kind === "stay" ? [step.placeSlug] : [step.fromSlug, step.toSlug];
}

/**
 * The days a step occupies. A move happens on a single day, counted as both its
 * start and its end, which lets one comparison order stays and moves alike.
 */
type StepSpan = { readonly start: PlainDate; readonly end: PlainDate };

function stepSpan(step: Step): StepSpan {
  return step.kind === "stay"
    ? { start: step.startDate, end: step.endDate }
    : { start: step.date, end: step.date };
}

const TripFieldsSchema = z.strictObject({
  slug: SlugSchema,
  title: NonBlankStringSchema,
  startDate: PlainDateSchema,
  endDate: PlainDateSchema,
  // A trip with no place or no step is not a trip. Every cross-field rule below
  // is vacuously true on empty collections, so only this can reject it.
  places: z.array(PlaceSchema).min(1),
  steps: z.array(StepSchema).min(1),
  // Defaulted, not optional: the pages read `trip.photos.length` without a null
  // check, and a content file that omits the key means "none", not "unknown".
  photos: z.array(PhotoSchema).default([]),
  tags: z.array(TagSchema).default([]),
  coverPhotoSrc: z.string().min(1).optional(),
  budget: BudgetSchema.optional(),
  /**
   * **The day the récit went online — not the day the journey ended.**
   *
   * The distinction is the whole field. A journey of 2019 written up this morning
   * is news to a reader, and `endDate` would call it seven years old; a trip that
   * ended last week and is still being written is not published at all. Nothing
   * else in this schema records the second date, which is why it is stored rather
   * than derived (TIW-19).
   *
   * **Required, and that is the one decision here worth arguing.** Both ways out
   * were a guess about the field a reader is shown a claim about: defaulting to
   * `endDate` makes an old journey permanently un-announceable, and `.optional()`
   * makes a journal where nobody wrote the key announce nothing at all, silently
   * — this repository's least favourite failure. `draft` is defaulted because its
   * absence has one unambiguous meaning ("published"); the absence of a
   * publication date has none. `npm run new-trip` writes today's date into the
   * skeleton, so the field is never typed by hand — the same arrangement
   * `coordinates` has with `npm run geocode`.
   *
   * What consumes it: `src/domain/freshness.ts` (which trip is new, and for how
   * long) and `src/app/feed.xml/route.ts` (the feed's order and its `pubDate`).
   * Nothing displays it except the home page's banner, which prints it inside a
   * `<time>` — so a badge that has outlived its window still carries the date
   * that contradicts it. See `docs/fraicheur-au-prerendu.md`.
   */
  publishedAt: PlainDateSchema,
  /**
   * Publication state, last as it is in `content/README.md` — a contributor
   * reads the two in the same order, and the key belongs to no content block.
   *
   * `.default(false)`, not `.optional()`: the absent key means "published", so
   * there is no third "draft unknown" state for the loader to handle. With
   * `optional` the publication filter is `trip.draft === true` in one place and
   * `!trip.draft` in another, and the trip is eventually published by whichever
   * spelling loses.
   *
   * `z.boolean()` and not something looser, because `draft: "true"` between
   * quotes is a *string*, and every non-empty string is truthy in JavaScript:
   * accepted, `draft: "false"` would hide a published trip from production as
   * effectively as `draft: "true"`, and it would vanish from the map without a
   * word. Refusing the string is the only way that mistake is ever said out loud.
   */
  draft: z.boolean().default(false),
  /**
   * Whether the récit is written — see {@link StoryStateSchema} for the state
   * itself and for why it is an enum.
   *
   * Beside `draft` rather than anywhere else, because a contributor reads the two
   * as one question: *what of this trip is public today?* They are independent —
   * a trip may be both a draft and unwritten, which is the ordinary shape of a
   * journey just come back — and neither implies the other.
   *
   * **`publishedAt` stays required for an untold trip**, which reads as a
   * contradiction and is not. That field's own note calls it "the day the récit
   * went online"; on an untold trip it is the day the *entry* went online, and
   * making it optional here would hand `PlainDate | undefined` to every consumer
   * to express something none of them asks. The distinction is respected where it
   * is visible instead: `freshestTrip` never puts a "nouveau récit" badge on a
   * trip whose récit nobody can read.
   */
  story: StoryStateSchema.default("written"),
});

type TripFields = z.infer<typeof TripFieldsSchema>;

type TripIssues = z.core.$RefinementCtx<TripFields>;

/**
 * The itinerary is the one place where a content file can be internally
 * consistent field by field and still describe an impossible journey. Each rule
 * below reports on the path of the *offending* entry: `validate:content` prints
 * that path, and "somewhere in steps" is not a usable error message.
 *
 * Every rule runs on every parse, so a file with three mistakes reports three.
 */
function checkTrip(trip: TripFields, ctx: TripIssues): void {
  if (isBefore(trip.endDate, trip.startDate)) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: `The trip ends on ${trip.endDate}, before it starts on ${trip.startDate}.`,
    });
  }

  /**
   * A récit published before its journey began.
   *
   * Deliberately the *only* rule tying `publishedAt` to the itinerary, and
   * deliberately not `publishedAt >= endDate`: writing while travelling is
   * legitimate, and writing years afterwards is the ordinary case this field
   * exists for. Publishing before the departure is the one reading that cannot
   * mean anything — and it is the shape a date copy-pasted from `startDate`'s
   * neighbouring line takes.
   *
   * `isBefore` and not `<`: it abstains when either day is malformed, so a
   * `startDate: "2024-6-1"` reports one issue on `startDate` instead of two, one
   * of which points at a healthy field.
   */
  if (isBefore(trip.publishedAt, trip.startDate)) {
    ctx.addIssue({
      code: "custom",
      path: ["publishedAt"],
      message: `The story is dated ${trip.publishedAt}, before the trip starts on ${trip.startDate}.`,
    });
  }

  // A tag rendered twice is a duplicated chip in the filter bar; two photos
  // sharing a `src` are the same image twice in the gallery, and they make
  // `coverPhotoSrc` match two entries.
  const seenTags = new Set<Tag>();
  trip.tags.forEach((tag, index) => {
    if (seenTags.has(tag)) {
      ctx.addIssue({
        code: "custom",
        path: ["tags", index],
        message: `The tag "${tag}" is listed twice.`,
      });
    }
    seenTags.add(tag);
  });

  const seenPhotoSources = new Set<string>();
  trip.photos.forEach((photo, index) => {
    if (seenPhotoSources.has(photo.src)) {
      ctx.addIssue({
        code: "custom",
        path: ["photos", index, "src"],
        message: `Two photos share the source "${photo.src}".`,
      });
    }
    seenPhotoSources.add(photo.src);
  });

  const declaredSlugs = new Set<Slug>();
  trip.places.forEach((place, index) => {
    if (declaredSlugs.has(place.slug)) {
      ctx.addIssue({
        code: "custom",
        path: ["places", index, "slug"],
        message: `Two places share the slug "${place.slug}": every step referencing it is ambiguous.`,
      });
    }
    declaredSlugs.add(place.slug);
  });

  /**
   * A photo attached to a place the trip does not declare.
   *
   * The same class of fault as a step pointing at an undeclared place, and it has
   * to be caught here for the same reason: `PhotoSchema` is handed one photo and
   * cannot see `places[]`. Left unchecked it is *silent* rather than loud — the
   * page groups the gallery by place, so the photo is filtered out of the gallery,
   * appears in no step, and the trip renders green with one photo fewer than the
   * author wrote. A dangling step at least throws in the renderer.
   *
   * Reported on `photos[i].placeSlug` and not on `places`: the slug is the thing
   * to fix, and it is the field an author can find.
   */
  trip.photos.forEach((photo, index) => {
    if (photo.placeSlug !== undefined && !declaredSlugs.has(photo.placeSlug)) {
      ctx.addIssue({
        code: "custom",
        path: ["photos", index, "placeSlug"],
        message: `The photo is attached to the place "${photo.placeSlug}", which is absent from places[].`,
      });
    }
  });

  // A step points at a place by slug, so a renamed place leaves a dangling
  // reference — and the map renderer meets it as `undefined.coordinates`.
  const referencedSlugs = new Set<Slug>();
  trip.steps.forEach((step, index) => {
    for (const slug of referencedPlaceSlugs(step)) {
      referencedSlugs.add(slug);
      if (!declaredSlugs.has(slug)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index],
          message: `Step ${index} references the place "${slug}", which is absent from places[].`,
        });
      }
    }
  });

  // The counterpart, and what keeps the derivations honest: a place nothing
  // references is not a visited country, it is a leftover in a YAML file.
  trip.places.forEach((place, index) => {
    if (!referencedSlugs.has(place.slug)) {
      ctx.addIssue({
        code: "custom",
        path: ["places", index],
        message: `The place "${place.slug}" is declared but no step references it.`,
      });
    }
  });

  let previousSpan: StepSpan | undefined;
  trip.steps.forEach((step, index) => {
    const span = stepSpan(step);

    // Non-strict: leaving on the day a stay ends is the normal case, not an
    // anomaly, so the constraint is `end(previous) <= start(current)`.
    if (previousSpan !== undefined && isBefore(span.start, previousSpan.end)) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", index],
        message: `Step ${index} starts on ${span.start}, before the previous step ends on ${previousSpan.end}.`,
      });
    }

    // A move's two bounds are the same day; report it once.
    for (const date of new Set([span.start, span.end])) {
      if (isBefore(date, trip.startDate) || isBefore(trip.endDate, date)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index],
          message: `Step ${index} is dated ${date}, outside the trip's ${trip.startDate} … ${trip.endDate} range.`,
        });
      }
    }

    // A step whose own dates never validated cannot anchor the next comparison
    // either: it would report the *following* step for a fault that is here.
    previousSpan = isPlainDate(span.end) ? span : undefined;
  });

  /**
   * Continuity of the route, taken one adjacent pair at a time. Reading pairs
   * rather than moves is what closes the gap a move-centric loop cannot see: it
   * can only check the moves that *are* declared, never the one that is missing.
   *
   * The three cases below are the ones that carry information. The fourth,
   * move → move, is a layover and constrains nothing; and a trip that opens or
   * closes on a move has no pair on that side, which is why "Paris → Tokyo,
   * plane" with no stay declared at home stays valid.
   */
  trip.steps.forEach((step, index) => {
    const next = trip.steps[index + 1];
    if (next === undefined) {
      return;
    }
    const nextIndex = index + 1;

    if (step.kind === "stay" && next.kind === "move" && step.placeSlug !== next.fromSlug) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", nextIndex, "fromSlug"],
        message: `Step ${nextIndex} leaves from "${next.fromSlug}" while the preceding stay is in "${step.placeSlug}".`,
      });
    }

    if (step.kind === "move" && next.kind === "stay" && step.toSlug !== next.placeSlug) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", index, "toSlug"],
        message: `Step ${index} arrives in "${step.toSlug}" while the following stay is in "${next.placeSlug}".`,
      });
    }

    /**
     * Two stays in different places, with no move between them: the journey
     * itself is missing. Deleting a line is the likeliest edit there is, and
     * every other rule is satisfied afterwards — the dates still line up, both
     * places are still declared and referenced. The trip page would announce
     * two countries, the timeline would show two stays, and the map would lose
     * its stroke without a word.
     *
     * Same place twice is a split stay, not a gap, and stays valid.
     */
    if (step.kind === "stay" && next.kind === "stay" && step.placeSlug !== next.placeSlug) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", nextIndex, "placeSlug"],
        message: `Step ${nextIndex} stays in "${next.placeSlug}" while the previous step stays in "${step.placeSlug}": the move between them is missing.`,
      });
    }
  });

  if (
    trip.coverPhotoSrc !== undefined &&
    !trip.photos.some((photo) => photo.src === trip.coverPhotoSrc)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["coverPhotoSrc"],
      message: `The cover photo "${trip.coverPhotoSrc}" is not one of the trip's photos.`,
    });
  }
}

export const TripSchema = TripFieldsSchema.superRefine(checkTrip);

export type Trip = z.infer<typeof TripSchema>;
