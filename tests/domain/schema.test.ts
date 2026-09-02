import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BLUR_DATA_URL_MAX_LENGTH } from "@/domain/photo";
import {
  BudgetSchema,
  PhotoSchema,
  PlaceSchema,
  StepSchema,
  TagSchema,
  TransportModeSchema,
  TRANSPORT_MODES,
  TripSchema,
} from "@/domain/schema";
import {
  attempt,
  BANGKOK,
  layoverTripInput,
  LYON_PART_DIEU,
  openEndedTripInput,
  PARIS,
  pathsUnder,
  KYOTO,
  KYOTO_PHOTO,
  LYON,
  minimalTripInput,
  move,
  stay,
  TOKYO,
  TOKYO_PHOTO,
  tripInput,
} from "./fixtures";

describe("TransportModeSchema", () => {
  /**
   * The list is closed because the map draws a different stroke per mode and
   * the timeline prints a different icon: an unknown mode has no rendering, so
   * it has to fail at validation time rather than at build time. Adding a mode
   * is a deliberate content decision — updating this expectation is the place
   * where that decision gets made.
   */
  it("is a closed, ordered list of modes the renderer knows how to draw", () => {
    expect(TRANSPORT_MODES).toEqual(["plane", "train", "bus", "car", "boat", "bike", "foot"]);
  });

  it.each([...TRANSPORT_MODES])("accepts the declared mode %s", (mode) => {
    expect(attempt(TransportModeSchema, mode).accepted).toBe(true);
  });

  it.each(["teleport", "Plane", "PLANE", "train ", "", "walking", null])(
    "rejects %o, which is not in the closed list",
    (candidate) => {
      expect(attempt(TransportModeSchema, candidate).accepted).toBe(false);
    }
  );
});

describe("PlaceSchema", () => {
  it("accepts a place with nothing but a slug, a name, a country and coordinates", () => {
    expect(attempt(PlaceSchema, LYON).accepted).toBe(true);
  });

  /**
   * The content is hand-written YAML, so a misspelled key is the most likely
   * mistake there is. Silently dropping it means the coordinates a contributor
   * thought they set are simply absent — hence strict objects.
   */
  it("rejects an unknown key instead of silently dropping it", () => {
    expect(attempt(PlaceSchema, { ...LYON, lattitude: 45.764 }).accepted).toBe(false);
  });

  it.each([
    { label: "an empty name", value: { ...LYON, name: "" } },
    { label: "a whitespace-only name", value: { ...LYON, name: "   " } },
  ])("rejects $label", ({ value }) => {
    expect(attempt(PlaceSchema, value).accepted).toBe(false);
  });

  /** Proves `PlaceSchema` composes the geo primitives rather than redeclaring them. */
  it.each([
    { label: "a non-slug slug", value: { ...LYON, slug: "Lyon" } },
    { label: "a three-letter country code", value: { ...LYON, countryCode: "FRA" } },
    { label: "failed-geocoding coordinates", value: { ...LYON, coordinates: { lat: 0, lon: 0 } } },
    { label: "an out-of-range latitude", value: { ...LYON, coordinates: { lat: 91, lon: 4.8 } } },
  ])("rejects $label", ({ value }) => {
    expect(attempt(PlaceSchema, value).accepted).toBe(false);
  });
});

describe("StepSchema", () => {
  it("accepts a minimal stay and a minimal move", () => {
    expect(attempt(StepSchema, stay("lyon", "2024-06-01", "2024-06-04")).accepted).toBe(true);
    expect(attempt(StepSchema, move("lyon", "paris", "train", "2024-06-04")).accepted).toBe(true);
  });

  /**
   * The error has to land on `kind`, not on a pile of "unrecognized key"
   * complaints from both branches: `validate:content` prints the path, and a
   * contributor who typed `kind: flight` needs to be told the kind is wrong.
   */
  it("rejects an unknown kind, and points the error at the discriminator", () => {
    const outcome = attempt(StepSchema, { kind: "flight", fromSlug: "lyon", toSlug: "paris" });

    expect(outcome.accepted).toBe(false);
    expect(outcome.paths).toContain("kind");
  });

  it("rejects a step with no kind at all", () => {
    expect(
      attempt(StepSchema, { placeSlug: "lyon", startDate: "2024-06-01", endDate: "2024-06-04" })
        .accepted
    ).toBe(false);
  });

  /**
   * The union is discriminated, not permissive: a stay carrying `fromSlug` and
   * `mode` is a half-edited step, and accepting it would let the timeline show
   * a stay while the map draws a segment from the same entry.
   */
  it("rejects a stay carrying the fields of a move", () => {
    const hybrid = {
      ...stay("lyon", "2024-06-01", "2024-06-04"),
      fromSlug: "paris",
      mode: "train",
    };

    expect(attempt(StepSchema, hybrid).accepted).toBe(false);
  });

  it("rejects a move carrying the fields of a stay", () => {
    const hybrid = { ...move("lyon", "paris", "train", "2024-06-04"), placeSlug: "lyon" };

    expect(attempt(StepSchema, hybrid).accepted).toBe(false);
  });

  it("rejects a stay whose endDate precedes its startDate", () => {
    expect(attempt(StepSchema, stay("lyon", "2024-06-04", "2024-06-01")).accepted).toBe(false);
  });

  it("accepts a stay of a single day, where endDate equals startDate", () => {
    expect(attempt(StepSchema, stay("lyon", "2024-06-01", "2024-06-01")).accepted).toBe(true);
  });

  /**
   * A move from a place to itself. Rejected here, at the step, because it needs
   * no trip context to be wrong — and distinct from the `drawableMoves`
   * invariant, which is about *coordinates*: two different places 200 m apart
   * are a legitimate move that simply must not be drawn.
   */
  it("rejects a move whose origin and destination are the same place", () => {
    expect(attempt(StepSchema, move("lyon", "lyon", "foot", "2024-06-01")).accepted).toBe(false);
  });

  it("rejects a move whose transport mode is outside the closed list", () => {
    expect(attempt(StepSchema, move("lyon", "paris", "teleport", "2024-06-04")).accepted).toBe(
      false
    );
  });

  it.each([
    {
      label: "a stay without an endDate",
      value: { kind: "stay", placeSlug: "lyon", startDate: "2024-06-01" },
    },
    {
      label: "a stay without a place",
      value: { kind: "stay", startDate: "2024-06-01", endDate: "2024-06-04" },
    },
    {
      label: "a move without a date",
      value: { kind: "move", fromSlug: "lyon", toSlug: "paris", mode: "train" },
    },
    {
      label: "a move without a mode",
      value: { kind: "move", fromSlug: "lyon", toSlug: "paris", date: "2024-06-04" },
    },
    {
      label: "a move without a destination",
      value: { kind: "move", fromSlug: "lyon", mode: "train", date: "2024-06-04" },
    },
  ])("rejects $label", ({ value }) => {
    expect(attempt(StepSchema, value).accepted).toBe(false);
  });
});

describe("BudgetSchema", () => {
  const budget = { totalCents: 420000, currency: "EUR", travellers: 2 };

  it("accepts a whole number of cents", () => {
    expect(attempt(BudgetSchema, budget).accepted).toBe(true);
  });

  /**
   * Money is integer cents, never a float: `0.1 + 0.2` is the canonical reason,
   * and a total written as `4200.5` cents has no meaning to divide or display.
   */
  it.each([420000.5, 0.1, -0.0001])("rejects the fractional amount %o", (totalCents) => {
    expect(attempt(BudgetSchema, { ...budget, totalCents }).accepted).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(attempt(BudgetSchema, { ...budget, totalCents: -1 }).accepted).toBe(false);
  });

  it("accepts a total of zero, which is not the same as an absent budget", () => {
    expect(attempt(BudgetSchema, { ...budget, totalCents: 0 }).accepted).toBe(true);
  });

  /** `budgetPerPerson` divides by this number; zero and 2.5 travellers must never reach it. */
  it.each([0, -1, 2.5])("rejects %o travellers", (travellers) => {
    expect(attempt(BudgetSchema, { ...budget, travellers }).accepted).toBe(false);
  });

  it.each(["eur", "EURO", "€", "", "E"])("rejects the currency %o", (currency) => {
    expect(attempt(BudgetSchema, { ...budget, currency }).accepted).toBe(false);
  });

  it.each(["EUR", "JPY", "THB"])("accepts the currency %s", (currency) => {
    expect(attempt(BudgetSchema, { ...budget, currency }).accepted).toBe(true);
  });
});

describe("PhotoSchema", () => {
  it("accepts a photo with a source, an alt text and both dimensions", () => {
    expect(attempt(PhotoSchema, TOKYO_PHOTO).accepted).toBe(true);
  });

  /**
   * A gallery of unlabelled images is unusable with a screen reader, and the
   * only moment anyone will write the alt text is the moment the build refuses
   * to go on without it. An empty string is the decorative-image convention and
   * is wrong here: these photos *are* the content.
   */
  it.each([
    { label: "no alt at all", value: { src: TOKYO_PHOTO.src, width: 1600, height: 1067 } },
    { label: "an empty alt", value: { ...TOKYO_PHOTO, alt: "" } },
    { label: "a whitespace-only alt", value: { ...TOKYO_PHOTO, alt: "   " } },
  ])("rejects a photo with $label", ({ value }) => {
    expect(attempt(PhotoSchema, value).accepted).toBe(false);
  });

  /**
   * Dimensions are required and positive because they are what reserves the
   * space in the layout; a zero or missing one is a guaranteed layout shift.
   */
  it.each([
    { label: "a zero width", value: { ...TOKYO_PHOTO, width: 0 } },
    { label: "a zero height", value: { ...TOKYO_PHOTO, height: 0 } },
    { label: "a negative height", value: { ...TOKYO_PHOTO, height: -10 } },
    { label: "a fractional width", value: { ...TOKYO_PHOTO, width: 1600.5 } },
    { label: "no width", value: { src: TOKYO_PHOTO.src, alt: TOKYO_PHOTO.alt, height: 1067 } },
  ])("rejects $label", ({ value }) => {
    expect(attempt(PhotoSchema, value).accepted).toBe(false);
  });

  it("rejects an empty source", () => {
    expect(attempt(PhotoSchema, { ...TOKYO_PHOTO, src: "" }).accepted).toBe(false);
  });

  /**
   * The placeholder is required for the same reason the dimensions are: the three
   * are written together by `npm run index-photos`, so an optional one means a
   * photo indexed before the field existed renders with no placeholder and
   * nothing anywhere says so. `content/README.md` documents it exactly as it
   * documents `coordinates` — machine-written, never typed by hand.
   *
   * The shape is pinned, not just the presence, and the two rows that matter are
   * the SVG one and the quote one. This value is interpolated into an inline
   * `style` attribute on the page: `image/svg+xml` can carry script, and a raw
   * `"` closes the attribute. Refusing anything but base64-encoded WebP is what
   * makes the render site unable to be surprised.
   */
  it.each([
    { label: "an empty blurDataUrl", value: "" },
    { label: "a bare URL instead of a data URI", value: "/photos/japon-2024/tokyo-16.webp" },
    { label: "a JPEG data URI", value: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
    {
      label: "an SVG data URI, which can carry script",
      value: "data:image/svg+xml;base64,PHN2Zz4=",
    },
    {
      label: "base64 holding a quote that would escape a style attribute",
      value: 'data:image/webp;base64,AA"AA',
    },
    { label: "a data URI longer than the cap", value: `data:image/webp;base64,${"A".repeat(600)}` },
  ])("rejects a photo with $label", ({ value }) => {
    expect(attempt(PhotoSchema, { ...TOKYO_PHOTO, blurDataUrl: value }).accepted).toBe(false);
  });

  it("rejects a photo with no blurDataUrl at all", () => {
    const { blurDataUrl: _dropped, ...withoutPlaceholder } = TOKYO_PHOTO;

    expect(attempt(PhotoSchema, withoutPlaceholder).accepted).toBe(false);
  });

  it("accepts a blurDataUrl exactly at the cap, and refuses the next character", () => {
    const prefix = "data:image/webp;base64,";
    const atCap = `${prefix}${"A".repeat(BLUR_DATA_URL_MAX_LENGTH - prefix.length)}`;

    expect(atCap).toHaveLength(BLUR_DATA_URL_MAX_LENGTH);
    expect(attempt(PhotoSchema, { ...TOKYO_PHOTO, blurDataUrl: atCap }).accepted).toBe(true);
    expect(attempt(PhotoSchema, { ...TOKYO_PHOTO, blurDataUrl: `${atCap}A` }).accepted).toBe(false);
  });

  /**
   * The attachment field, which is what lets a photo appear inside the step it
   * belongs to instead of only in the trip's gallery. Optional: a photo with no
   * place is the ordinary case, and it stays in the gallery.
   */
  it("accepts a photo attached to a place", () => {
    expect(attempt(PhotoSchema, { ...TOKYO_PHOTO, placeSlug: "tokyo" }).accepted).toBe(true);
  });

  it.each(["Tokyo", "tokyo ", "", "tokyo--nord", "tokyo_nord"])(
    "rejects the placeSlug %o, which is not a slug",
    (placeSlug) => {
      expect(attempt(PhotoSchema, { ...TOKYO_PHOTO, placeSlug }).accepted).toBe(false);
    }
  );

  /**
   * The name collision `isDerivativeName` exists for, refused where every other
   * content rule lives. `tokyo-480.jpg` is exactly the file `index-photos` writes
   * the 480 px derivative of `tokyo.jpg` to: whichever is written last wins, and
   * the loser is either the author's original or a page serving a JPEG under an
   * `.avif` name.
   */
  it.each(["/photos/japon-2024/tokyo-480.jpg", "/photos/japon-2024/tokyo-1440.png"])(
    "rejects the source %s, which is a name the pipeline writes",
    (src) => {
      expect(attempt(PhotoSchema, { ...TOKYO_PHOTO, src }).accepted).toBe(false);
    }
  );

  it.each(["/photos/japon-2024/2024-04-12.jpg", "/photos/japon-2024/tokyo-tour.jpg"])(
    "still accepts the ordinary source %s",
    (src) => {
      expect(attempt(PhotoSchema, { ...TOKYO_PHOTO, src }).accepted).toBe(true);
    }
  );
});

/**
 * The cross-field half of the attachment: a `placeSlug` naming a place the trip
 * does not declare. `PhotoSchema` alone cannot see it — it is handed one photo,
 * and `places[]` is a sibling — so it belongs in `checkTrip`, beside the
 * identical rule for a step's place reference.
 *
 * Left unchecked, the page filters the gallery by a slug nothing matches: the
 * photo disappears from the gallery, appears in no step, and the trip renders
 * green with one photo fewer than the author wrote.
 */
describe("a photo attached to a place the trip does not declare", () => {
  it("is rejected, and the message names the slug and the field", () => {
    const outcome = attempt(
      TripSchema,
      tripInput({
        photos: [{ ...TOKYO_PHOTO, placeSlug: "osaka" }, KYOTO_PHOTO],
      })
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("osaka");
    expect(pathsUnder(outcome, "photos.0.placeSlug")).toEqual(["photos.0.placeSlug"]);
  });

  it("is accepted when the slug is one of the trip's places", () => {
    expect(
      attempt(
        TripSchema,
        tripInput({ photos: [{ ...TOKYO_PHOTO, placeSlug: "tokyo" }, KYOTO_PHOTO] })
      ).accepted
    ).toBe(true);
  });
});

describe("TagSchema", () => {
  it.each(["Road Trip", "road trip", "Asie", "road_trip", "été", ""])(
    "rejects the tag %o, which would not survive a URL",
    (candidate) => {
      expect(attempt(TagSchema, candidate).accepted).toBe(false);
    }
  );

  it.each(["asie", "road-trip", "train"])("accepts the tag %s", (candidate) => {
    expect(attempt(TagSchema, candidate).accepted).toBe(true);
  });
});

describe("TripSchema", () => {
  it("rejects a trip whose endDate precedes its startDate", () => {
    const outcome = attempt(TripSchema, tripInput({ endDate: "2024-04-11" }));

    expect(outcome.accepted).toBe(false);
    expect(outcome.paths).toContain("endDate");
  });

  /** A trip that starts and ends the same day is a real trip, not a data error. */
  it("accepts a trip whose endDate equals its startDate", () => {
    const oneDay = minimalTripInput({
      startDate: "2024-06-01",
      endDate: "2024-06-01",
      steps: [stay("lyon", "2024-06-01", "2024-06-01")],
    });

    expect(attempt(TripSchema, oneDay).accepted).toBe(true);
  });

  /**
   * The referential invariant, and the one worth a good message: a step points
   * at a place by slug, so a renamed place leaves a dangling reference that
   * would otherwise crash the map renderer with `undefined.coordinates`.
   */
  it("rejects a stay pointing at a place absent from places[], and names the unknown place", () => {
    const outcome = attempt(
      TripSchema,
      tripInput({
        places: [TOKYO],
        steps: [
          stay("tokyo", "2024-04-12", "2024-04-16"),
          stay("kyoto", "2024-04-16", "2024-04-22"),
        ],
      })
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("kyoto");
    expect(pathsUnder(outcome, "steps").length).toBeGreaterThan(0);
  });

  it("rejects a move pointing at a place absent from places[], and names the unknown place", () => {
    const outcome = attempt(
      TripSchema,
      tripInput({
        places: [TOKYO],
        steps: [
          stay("tokyo", "2024-04-12", "2024-04-20"),
          move("tokyo", "osaka", "train", "2024-04-20"),
        ],
      })
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("osaka");
    expect(pathsUnder(outcome, "steps").length).toBeGreaterThan(0);
  });

  /**
   * Two places sharing a slug make every step referencing it ambiguous, and the
   * duplicate is invisible in a long YAML file.
   */
  it("rejects two places sharing the same slug, and names the duplicate", () => {
    const outcome = attempt(
      TripSchema,
      tripInput({
        places: [TOKYO, KYOTO, BANGKOK, { ...KYOTO, slug: "tokyo", name: "Tokyo (bis)" }],
      })
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("tokyo");
    expect(pathsUnder(outcome, "places").length).toBeGreaterThan(0);
  });

  it("rejects a coverPhotoSrc that is not one of the trip's photos, and names it", () => {
    const outcome = attempt(
      TripSchema,
      tripInput({ coverPhotoSrc: "/photos/japon-2024/absente.jpg" })
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("/photos/japon-2024/absente.jpg");
  });

  it("rejects a coverPhotoSrc on a trip that has no photos", () => {
    const outcome = attempt(
      TripSchema,
      minimalTripInput({ coverPhotoSrc: "/photos/week-end-a-lyon/cover.jpg" })
    );

    expect(outcome.accepted).toBe(false);
  });

  it("accepts a coverPhotoSrc taken from photos[]", () => {
    expect(attempt(TripSchema, tripInput({ coverPhotoSrc: KYOTO_PHOTO.src })).accepted).toBe(true);
  });

  it("rejects a trip slug that is not a slug", () => {
    expect(attempt(TripSchema, tripInput({ slug: "Japon 2024" })).accepted).toBe(false);
  });

  /**
   * The guard against a schema that grew too strict. Everything optional is
   * omitted here, and the parsed value must still be usable without a null
   * check on the collections — hence the empty-array defaults.
   */
  it("accepts a minimal trip: one place, one stay, no photo, no budget", () => {
    const trip = TripSchema.parse(minimalTripInput());

    expect(trip.places).toHaveLength(1);
    expect(trip.steps).toHaveLength(1);
    expect(trip.photos).toEqual([]);
    expect(trip.tags).toEqual([]);
    expect(trip.budget).toBeUndefined();
    expect(trip.coverPhotoSrc).toBeUndefined();
  });

  it("accepts the reference trip with photos, a cover, a budget and tags", () => {
    const trip = TripSchema.parse(tripInput());

    expect(trip.steps).toHaveLength(5);
    expect(trip.photos).toHaveLength(2);
    expect(trip.coverPhotoSrc).toBe(TOKYO_PHOTO.src);
    expect(trip.tags).toEqual(["asie", "train"]);
  });
});

/**
 * Itinerary continuity. The trip page is a chronological timeline and the map
 * traces the steps in order: unordered steps do not produce a debatable story,
 * they produce a story where the timeline and the map contradict each other.
 * These are the invariants that make that impossible.
 */
describe("TripSchema — itinerary continuity", () => {
  /**
   * The counterpart of the dangling-reference rule, and what makes the two
   * derivations agree: a place nothing references is not a visited country, it
   * is a leftover in a hand-written YAML file.
   */
  it("rejects a declared place that no step references, and names the orphan", () => {
    const outcome = attempt(TripSchema, tripInput({ places: [TOKYO, KYOTO, BANGKOK, LYON] }));

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("lyon");
    expect(pathsUnder(outcome, "places").length).toBeGreaterThan(0);
  });

  /**
   * The empty/empty case comes first because it is the only discriminating one:
   * with neither a place nor a step, no reference, orphan, order or containment
   * rule has anything to say, so only a non-empty requirement can reject it.
   * Measured — with `places: []` alone, the dangling-reference rule fires and the
   * test would pass even without `.min(1)`.
   */
  it("rejects a trip with no place or no step", () => {
    expect(attempt(TripSchema, minimalTripInput({ places: [], steps: [] })).accepted).toBe(false);
    expect(attempt(TripSchema, minimalTripInput({ places: [] })).accepted).toBe(false);
    expect(attempt(TripSchema, minimalTripInput({ steps: [] })).accepted).toBe(false);
  });

  it("rejects a step dated before the step that precedes it, and names both dates", () => {
    const outcome = attempt(
      TripSchema,
      tripInput({
        places: [TOKYO, KYOTO],
        steps: [
          stay("tokyo", "2024-04-12", "2024-04-16"),
          move("tokyo", "kyoto", "train", "2024-04-15"),
          stay("kyoto", "2024-04-16", "2024-04-20"),
        ],
      })
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("2024-04-16");
    expect(outcome.errors).toContain("2024-04-15");
    expect(pathsUnder(outcome, "steps").length).toBeGreaterThan(0);
  });

  it("rejects two stays that overlap in time", () => {
    const outcome = attempt(
      TripSchema,
      tripInput({
        places: [TOKYO, KYOTO],
        steps: [
          stay("tokyo", "2024-04-12", "2024-04-16"),
          stay("kyoto", "2024-04-14", "2024-04-20"),
        ],
      })
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("2024-04-16");
    expect(outcome.errors).toContain("2024-04-14");
  });

  /**
   * The order is non-strict on purpose: leaving on the day a stay ends is the
   * normal case, not an anomaly. A rule written with `<` instead of `<=` rejects
   * every well-formed trip in the corpus — including the reference fixture.
   */
  it("accepts consecutive steps sharing a boundary date", () => {
    const sameDay = minimalTripInput({
      startDate: "2024-06-01",
      endDate: "2024-06-05",
      places: [LYON, PARIS],
      steps: [
        stay("lyon", "2024-06-01", "2024-06-03"),
        move("lyon", "paris", "train", "2024-06-03"),
        stay("paris", "2024-06-03", "2024-06-05"),
      ],
    });

    expect(attempt(TripSchema, sameDay).accepted).toBe(true);
  });

  it.each([
    {
      label: "a stay from another year entirely",
      value: tripInput({
        places: [TOKYO],
        steps: [stay("tokyo", "2019-04-12", "2019-04-16")],
      }),
    },
    {
      label: "a stay that ends after the trip does",
      value: tripInput({
        places: [TOKYO],
        steps: [stay("tokyo", "2024-04-12", "2024-04-25")],
      }),
    },
    {
      label: "a move dated before the trip starts",
      value: tripInput({
        places: [TOKYO, KYOTO],
        steps: [
          move("tokyo", "kyoto", "train", "2024-04-10"),
          stay("kyoto", "2024-04-12", "2024-04-20"),
        ],
      }),
    },
  ])("rejects $label", ({ value }) => {
    const outcome = attempt(TripSchema, value);

    expect(outcome.accepted).toBe(false);
    expect(pathsUnder(outcome, "steps").length).toBeGreaterThan(0);
  });

  it("accepts a step flush against both ends of the trip", () => {
    const flush = tripInput({
      places: [TOKYO],
      steps: [stay("tokyo", "2024-04-12", "2024-04-22")],
    });

    expect(attempt(TripSchema, flush).accepted).toBe(true);
  });

  it("rejects a move that does not leave from the preceding stay, and names both places", () => {
    const outcome = attempt(
      TripSchema,
      tripInput({
        places: [TOKYO, KYOTO, BANGKOK],
        steps: [
          stay("tokyo", "2024-04-12", "2024-04-16"),
          move("kyoto", "bangkok", "plane", "2024-04-16"),
          stay("bangkok", "2024-04-16", "2024-04-20"),
        ],
      })
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("tokyo");
    expect(outcome.errors).toContain("kyoto");
    expect(pathsUnder(outcome, "steps").length).toBeGreaterThan(0);
  });

  it("rejects a move that does not arrive at the following stay, and names both places", () => {
    const outcome = attempt(
      TripSchema,
      tripInput({
        places: [TOKYO, KYOTO, BANGKOK],
        steps: [
          stay("tokyo", "2024-04-12", "2024-04-16"),
          move("tokyo", "kyoto", "train", "2024-04-16"),
          stay("bangkok", "2024-04-16", "2024-04-20"),
        ],
      })
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("kyoto");
    expect(outcome.errors).toContain("bangkok");
    expect(pathsUnder(outcome, "steps").length).toBeGreaterThan(0);
  });

  /**
   * The rule bites only where the neighbouring stay exists. A trip abroad opens
   * on "Paris → Tokyo, plane" with no stay declared at home, and closes the same
   * way; a rule demanding a stay on both sides of every move would reject the
   * most ordinary trip in the corpus.
   */
  it("accepts a trip that opens and closes on a move, with no stay on the outside", () => {
    expect(attempt(TripSchema, openEndedTripInput()).accepted).toBe(true);
  });

  it("accepts two moves back to back, which is what a layover is", () => {
    expect(attempt(TripSchema, layoverTripInput()).accepted).toBe(true);
  });

  it("rejects a move from a place to itself", () => {
    const selfMove = minimalTripInput({
      steps: [stay("lyon", "2024-06-01", "2024-06-02"), move("lyon", "lyon", "foot", "2024-06-02")],
    });

    expect(attempt(TripSchema, selfMove).accepted).toBe(false);
  });

  /**
   * And the line between the two degenerate-move rules: same *slug* is refused
   * by the schema, same *spot* is not. Lyon centre and Lyon Part-Dieu are 95 m
   * apart and both real; only the map declines to draw between them.
   */
  it("accepts a move between two distinct places at almost the same spot", () => {
    const shortHop = minimalTripInput({
      endDate: "2024-06-03",
      places: [LYON, LYON_PART_DIEU],
      steps: [
        stay("lyon", "2024-06-01", "2024-06-02"),
        move("lyon", "lyon-part-dieu", "foot", "2024-06-02"),
        stay("lyon-part-dieu", "2024-06-02", "2024-06-03"),
      ],
    });

    expect(attempt(TripSchema, shortHop).accepted).toBe(true);
  });
});

/**
 * `draft` — the field the whole of TIW-11 turns on. It is what makes "write a
 * trip over several sittings" possible: without it a trip has exactly two states,
 * absent from the repository or live and half-written, and nothing in between.
 *
 * The schema's share of that promise is narrow and load-bearing: the key parses
 * to a **boolean**, and its absence parses to `false` rather than to `undefined`.
 * Whether a draft is then hidden is the loader's business
 * (`tests/content/loader.test.ts`).
 */
describe("TripSchema — draft", () => {
  /**
   * `.default(false)`, not `.optional()`. The difference is not cosmetic: with
   * `optional` the loader has a third state to handle — "draft unknown" — and the
   * publication filter becomes `trip.draft === true` in one place and
   * `!trip.draft` in another, which is how a draft eventually gets published by
   * whichever spelling loses.
   */
  it("parses an absent draft key to false, not to undefined", () => {
    const trip = TripSchema.parse(minimalTripInput());

    expect(trip.draft).toBe(false);
    expect("draft" in trip).toBe(true);
  });

  it.each([
    { label: "a trip marked as a draft", value: true },
    { label: "a trip explicitly published", value: false },
  ])("accepts $label and keeps the boolean it was given", ({ value }) => {
    const trip = TripSchema.parse(minimalTripInput({ draft: value }));

    expect(trip.draft).toBe(value);
  });

  /**
   * `draft: "true"` between quotes is the mistake with real consequences: it is a
   * *string*, and every non-empty string is truthy in JavaScript. Accepted, it
   * would make `draft: "false"` hide the trip from production as effectively as
   * `draft: "true"` — a published trip vanishing from the site without a word.
   * `content/README.md` states the rule; this is what makes it mechanical.
   */
  it.each([
    { label: "the string true", value: "true" },
    { label: "the string false", value: "false" },
    { label: "the string yes", value: "yes" },
    { label: "the number one", value: 1 },
    { label: "the number zero", value: 0 },
    { label: "null", value: null },
  ])("rejects $label, and points the error at draft", ({ value }) => {
    const outcome = attempt(TripSchema, minimalTripInput({ draft: value }));

    expect(outcome.accepted).toBe(false);
    expect(pathsUnder(outcome, "draft")).toEqual(["draft"]);
  });
});

/**
 * `publishedAt` — the day the récit went online, and the only input of the "new"
 * badge (TIW-19).
 *
 * It is **required**, which is the decision worth pinning in a test rather than
 * in a comment. Every alternative is a guess about the one field the reader is
 * shown a claim about: defaulting it to `endDate` makes a 2019 journey written up
 * today permanently old, and making it optional means a journal where nobody ever
 * wrote the key announces nothing, in silence. This repository's rule for a field
 * whose absence has no unambiguous meaning is to refuse the file and name it —
 * the same call `alt` and `blurDataUrl` already carry.
 */
describe("TripSchema — publishedAt", () => {
  it("refuses a trip that does not say when it was published", () => {
    const { publishedAt: _omitted, ...withoutIt } = minimalTripInput();
    const outcome = attempt(TripSchema, withoutIt);

    expect(outcome.accepted).toBe(false);
    expect(pathsUnder(outcome, "publishedAt")).toEqual(["publishedAt"]);
  });

  it("keeps the calendar day it was given, as a string", () => {
    const trip = TripSchema.parse(minimalTripInput({ publishedAt: "2026-02-14" }));

    expect(trip.publishedAt).toBe("2026-02-14");
  });

  /**
   * The same day rules as every other date in this schema — `PlainDateSchema`,
   * never a second pattern. `2026-02-30` is the row that matters: it passes any
   * regex over `YYYY-MM-DD` and is not a day, and a freshness window computed
   * from it would be off by two.
   */
  it.each(["2026-2-14", "14/02/2026", "2026-02-30", "hier", "", "2026-02-14T00:00:00Z"])(
    "rejects %o, and blames no field but publishedAt",
    (value) => {
      const outcome = attempt(TripSchema, minimalTripInput({ publishedAt: value }));

      expect(outcome.accepted).toBe(false);
      /**
       * The set, not the list: a value failing both the pattern and the
       * calendar check reports two issues on the same path, and `2026-02-30`
       * reports one. What matters is that every issue lands here — a rule
       * pointing at a healthy field is the failure `isBefore` exists to avoid.
       */
      expect([...new Set(outcome.paths)]).toEqual(["publishedAt"]);
      expect(pathsUnder(outcome, "publishedAt").length).toBeGreaterThan(0);
    }
  );

  /**
   * **A récit cannot be published before its journey began.** This is the one
   * cross-field rule the field earns, and it is narrow on purpose: publishing
   * *during* a trip is live-blogging and stays valid, publishing years afterwards
   * is the ordinary case and is the whole reason this field is not `endDate`.
   * Only "before the departure" is impossible — and it is exactly the shape a
   * date copy-pasted from `startDate`'s neighbour takes.
   */
  it("refuses a publication dated before the trip started", () => {
    const outcome = attempt(
      TripSchema,
      minimalTripInput({
        startDate: "2024-06-01",
        endDate: "2024-06-02",
        publishedAt: "2024-05-31",
      })
    );

    expect(outcome.accepted).toBe(false);
    expect(pathsUnder(outcome, "publishedAt")).toEqual(["publishedAt"]);
    expect(outcome.errors).toContain("2024-05-31");
  });

  it.each([
    { label: "the very day of departure", publishedAt: "2024-06-01" },
    { label: "during the trip", publishedAt: "2024-06-02" },
    { label: "years afterwards, which is the ordinary case", publishedAt: "2026-08-30" },
  ])("accepts a publication $label", ({ publishedAt }) => {
    const outcome = attempt(
      TripSchema,
      minimalTripInput({ startDate: "2024-06-01", endDate: "2024-06-02", publishedAt })
    );

    expect(outcome.errors).toBe("");
    expect(outcome.accepted).toBe(true);
  });

  /**
   * The rule abstains when the start date is not a day, for the reason `isBefore`
   * records at the top of `src/domain/schema.ts`: Zod runs a refinement even when
   * the leaf check has already failed, and `"2024-4-1"` compares nonsensically.
   * One fault must report one issue, on the field that carries it.
   */
  it("stays silent about publishedAt when startDate is the malformed field", () => {
    const outcome = attempt(
      TripSchema,
      minimalTripInput({ startDate: "2024-6-1", publishedAt: "2024-05-31" })
    );

    expect(outcome.accepted).toBe(false);
    expect(pathsUnder(outcome, "publishedAt")).toEqual([]);
  });
});

/**
 * The documented example, read from `content/README.md` rather than copied here.
 *
 * Copying it is the version that rots: the README is what a contributor writes
 * their first `trip.yaml` from, and an example the schema has quietly stopped
 * accepting is worse than no example — it sends someone to debug their own file
 * for a fault that is in the documentation. Parsed from the file, the two cannot
 * drift apart without this test saying so.
 */
describe("the complete trip.yaml documented in content/README.md", () => {
  const readme = readFileSync(path.join(process.cwd(), "content", "README.md"), "utf8");

  /** The first fenced YAML block: the complete example, `draft` key included. */
  const firstYamlBlock = (markdown: string): string => {
    const match = /```yaml\n([\s\S]*?)```/.exec(markdown);
    const block = match?.[1];
    if (block === undefined) {
      throw new Error("content/README.md no longer holds a fenced YAML example");
    }

    return block;
  };

  const example: unknown = parse(firstYamlBlock(readme));

  it("is accepted as written", () => {
    const outcome = attempt(TripSchema, example);

    expect(outcome.errors).toBe("");
    expect(outcome.accepted).toBe(true);
  });

  /**
   * The documented default and the real default are the same value, checked
   * against each other rather than each asserted alone.
   *
   * This case used to expect `true`, because the example ended on `draft: true`
   * — and that was the trap it should have caught. The complete example is what
   * a contributor copies for their first trip: they replace the values, the
   * validation passes, the build passes, and the trip is nowhere online with
   * nothing said about it. Exactly the silent failure the field exists to make
   * visible. `draft: false` is written in the example on purpose, so copying it
   * publishes; this asserts the two never drift apart again.
   */
  it("declares the draft key the README documents, and publishes by default", () => {
    const trip = TripSchema.parse(example);

    expect(trip.draft).toBe(false);
    expect(trip.slug).toBe("japon-2024");
  });

  /**
   * The key is written in the example, not merely defaulted into the parsed
   * value: a contributor who copies it can see the field exists and flip it.
   * Reading the parsed trip alone cannot tell the two apart, since `.default()`
   * fills the key in either case.
   */
  it("writes the draft key in the example rather than relying on the default", () => {
    expect(firstYamlBlock(readme)).toMatch(/^draft: false\b/m);
  });
});
