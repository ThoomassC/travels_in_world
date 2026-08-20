/**
 * Input builders and one parse helper for the domain suite.
 *
 * Two deliberate choices here.
 *
 * 1. **Nothing is imported from `@/domain/**`.** Not even a type. These objects
 *    are *inputs* to a validator, and half the suite feeds it data that must be
 *    rejected — annotating them with `z.infer<typeof TripSchema>` would make
 *    the invalid cases unwritable without a cast, and a cast is exactly how a
 *    validation test stops testing validation. Only *parsed* values carry the
 *    domain types, and those come out of `.parse()` already typed.
 *
 * 2. **`attempt` describes a rejection instead of asserting one.** Zod's
 *    `safeParse` returns a discriminated union, so `result.error` is
 *    unreachable until the union is narrowed — and `expect(result.success)`
 *    does not narrow anything for TypeScript. Rather than an `if` in every
 *    test, `attempt` flattens the outcome into three plain fields the tests can
 *    assert on directly.
 *
 * The schema parameter is structural, not `z.ZodType`: it keeps this file
 * independent of Zod's generic variance, and it is the whole surface the suite
 * uses.
 */

type ParseIssue = { readonly message: string; readonly path: readonly PropertyKey[] };

type SafeParseResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: { readonly issues: readonly ParseIssue[] } };

export type SafeParser = { readonly safeParse: (data: unknown) => SafeParseResult };

export type ParseOutcome = {
  /** `false` means the schema rejected the input — what most tests assert on. */
  readonly accepted: boolean;
  /** Every issue message, joined. Asserted with `toContain` / `toMatch`, never compared whole. */
  readonly errors: string;
  /** Every issue path in dotted form (`steps.1.toSlug`), so a test can pin *where* the error lands. */
  readonly paths: readonly string[];
};

export function attempt(schema: SafeParser, input: unknown): ParseOutcome {
  const result = schema.safeParse(input);

  return result.success
    ? { accepted: true, errors: "", paths: [] }
    : {
        accepted: false,
        errors: result.error.issues.map((issue) => issue.message).join(" | "),
        // `String(...)` and not `join` alone: a Zod path segment is a
        // `PropertyKey`, and joining a symbol throws a TypeError.
        paths: result.error.issues.map((issue) => issue.path.map(String).join(".")),
      };
}

/**
 * The issue paths that land on `root` or below it. `paths.join(" ")` would also
 * match an issue on `unplaces.slug`; a test that claims "the error points at
 * `places`" has to mean the subtree.
 */
export function pathsUnder(outcome: ParseOutcome, root: string): readonly string[] {
  return outcome.paths.filter((path) => path === root || path.startsWith(`${root}.`));
}

/* ------------------------------------------------------------------ places -- */

export const TOKYO = {
  slug: "tokyo",
  name: "Tokyo",
  countryCode: "JP",
  coordinates: { lat: 35.6762, lon: 139.6503 },
};

export const KYOTO = {
  slug: "kyoto",
  name: "Kyoto",
  countryCode: "JP",
  coordinates: { lat: 35.0116, lon: 135.7681 },
};

export const BANGKOK = {
  slug: "bangkok",
  name: "Bangkok",
  countryCode: "TH",
  coordinates: { lat: 13.7563, lon: 100.5018 },
};

export const PARIS = {
  slug: "paris",
  name: "Paris",
  countryCode: "FR",
  coordinates: { lat: 48.8566, lon: 2.3522 },
};

export const LYON = {
  slug: "lyon",
  name: "Lyon",
  countryCode: "FR",
  coordinates: { lat: 45.764, lon: 4.8357 },
};

/**
 * ~95 m from {@link LYON} — a distinct place, at the same spot as far as a map
 * is concerned. The pair exists for the `drawableMoves` invariant.
 */
export const LYON_PART_DIEU = {
  slug: "lyon-part-dieu",
  name: "Lyon Part-Dieu",
  countryCode: "FR",
  coordinates: { lat: 45.7647, lon: 4.8364 },
};

/** ~8 km from {@link LYON}: short, but a real segment on the map. */
export const BRON = {
  slug: "bron",
  name: "Bron",
  countryCode: "FR",
  coordinates: { lat: 45.7333, lon: 4.9333 },
};

/* ------------------------------------------------------------------- steps -- */

export function stay(
  placeSlug: string,
  startDate: string,
  endDate: string
): Record<string, unknown> {
  return { kind: "stay", placeSlug, startDate, endDate };
}

export function move(
  fromSlug: string,
  toSlug: string,
  mode: string,
  date: string
): Record<string, unknown> {
  return { kind: "move", fromSlug, toSlug, mode, date };
}

/* ------------------------------------------------------------------- trips -- */

export const TOKYO_PHOTO = {
  src: "/photos/japon-2024/tokyo.jpg",
  alt: "Une ruelle de Shinjuku sous la pluie",
  width: 1600,
  height: 1067,
};

export const KYOTO_PHOTO = {
  src: "/photos/japon-2024/kyoto.jpg",
  alt: "Le chemin des philosophes au petit matin",
  width: 1600,
  height: 900,
};

/**
 * The reference trip: three places, five steps, photos, a cover, a budget and
 * tags. Every optional branch of `TripSchema` is exercised by this one object,
 * and `overrides` lets a test replace any field — including with something
 * invalid.
 */
export function tripInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "japon-2024",
    title: "Japon, printemps 2024",
    startDate: "2024-04-12",
    endDate: "2024-04-22",
    places: [TOKYO, KYOTO, BANGKOK],
    steps: [
      stay("tokyo", "2024-04-12", "2024-04-16"),
      move("tokyo", "kyoto", "train", "2024-04-16"),
      stay("kyoto", "2024-04-16", "2024-04-20"),
      move("kyoto", "bangkok", "plane", "2024-04-20"),
      stay("bangkok", "2024-04-20", "2024-04-22"),
    ],
    photos: [TOKYO_PHOTO, KYOTO_PHOTO],
    coverPhotoSrc: TOKYO_PHOTO.src,
    budget: { totalCents: 420000, currency: "EUR", travellers: 2 },
    tags: ["asie", "train"],
    ...overrides,
  };
}

/**
 * The smallest thing that still deserves to be called a trip: one place, one
 * stay, no photo, no cover, no budget, no tag. Its acceptance is what keeps
 * `TripSchema` from quietly demanding the full set.
 */
export function minimalTripInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "week-end-a-lyon",
    title: "Un week-end à Lyon",
    startDate: "2024-06-01",
    endDate: "2024-06-02",
    places: [LYON],
    steps: [stay("lyon", "2024-06-01", "2024-06-02")],
    ...overrides,
  };
}

/**
 * Places declared JP, TH, FR — on purpose, so that alphabetical order and
 * declaration order disagree and `visitedCountryCodes` cannot satisfy both.
 */
export function multiCountryTripInput(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    slug: "tour-du-monde-2023",
    title: "Tour du monde",
    startDate: "2023-01-05",
    endDate: "2023-02-10",
    places: [TOKYO, BANGKOK, PARIS, KYOTO],
    steps: [
      stay("tokyo", "2023-01-05", "2023-01-15"),
      move("tokyo", "kyoto", "train", "2023-01-15"),
      stay("kyoto", "2023-01-15", "2023-01-25"),
      move("kyoto", "bangkok", "plane", "2023-01-25"),
      stay("bangkok", "2023-01-25", "2023-02-01"),
      move("bangkok", "paris", "plane", "2023-02-01"),
      stay("paris", "2023-02-01", "2023-02-10"),
    ],
    ...overrides,
  };
}

/**
 * Begins and ends with a `move`, with no stay declared before the first flight
 * or after the last one — the normal shape of a trip abroad. The connection rule
 * must not demand a neighbouring stay that does not exist.
 *
 * Note that `paris` is reachable only through the two moves: it is the fixture
 * that tells `visitedCountryCodes` apart from a version reading stays only.
 */
export function openEndedTripInput(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    slug: "tokyo-2024",
    title: "Tokyo",
    startDate: "2024-04-10",
    endDate: "2024-04-22",
    places: [PARIS, TOKYO],
    steps: [
      move("paris", "tokyo", "plane", "2024-04-10"),
      stay("tokyo", "2024-04-10", "2024-04-20"),
      move("tokyo", "paris", "plane", "2024-04-20"),
    ],
    ...overrides,
  };
}

/**
 * Two moves back to back — a layover in Bangkok, no stay in between. Nothing
 * constrains one move against the next, so this has to be accepted.
 */
export function layoverTripInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "escale-bangkok",
    title: "Escale à Bangkok",
    startDate: "2024-04-10",
    endDate: "2024-04-20",
    places: [PARIS, BANGKOK, TOKYO],
    steps: [
      move("paris", "bangkok", "plane", "2024-04-10"),
      move("bangkok", "tokyo", "plane", "2024-04-11"),
      stay("tokyo", "2024-04-11", "2024-04-20"),
    ],
    ...overrides,
  };
}
