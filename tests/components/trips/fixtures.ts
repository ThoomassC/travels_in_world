import type { TripEntry } from "@/components/trips/entry";

/**
 * Trip entries for the listing suite, built by hand rather than parsed.
 *
 * `TripEntry` is the *narrowed* shape the listing consumes — the same posture
 * `tests/components/map/fixtures.ts` takes towards `CountryShape`, and the reason
 * is the one `docs/adr/0003-carte-svg-inerte-et-balises-html.md` records: the
 * whole layer is renderable from a literal, with no disk, no YAML and no content
 * façade, which is what makes sixty trips a cheap test instead of a fixture
 * directory. `src/app/[locale]/page.tsx` is where a real `TripSummary` meets this
 * type, and structural typing is what makes the two agree without adaptation.
 *
 * Dates are already what the content façade hands over: descending by
 * `startDate`, ties broken by `slug`. Nothing here re-sorts, because the code
 * under test must not either.
 */
export function tripEntry(overrides: Partial<TripEntry> = {}): TripEntry {
  return {
    slug: "japon-2024",
    title: "Japon, printemps 2024",
    startDate: "2024-04-12",
    endDate: "2024-04-22",
    duration: { nights: 10, days: 11 },
    countryCodes: ["JP"],
    coverPhotoSrc: "/photos/japon-2024/tokyo.jpg",
    firstArrival: { name: "Tokyo", countryCode: "JP" },
    ...overrides,
  };
}

/**
 * A trip filed in `countryCode`, distinguishable from its neighbours by slug and
 * title alone. `startDate` descends with the index so a list built by mapping
 * over an array is already in the façade's order.
 */
export function tripIn(countryCode: string, index: number): TripEntry {
  const year = 2024 - index;

  return tripEntry({
    slug: `voyage-${countryCode.toLowerCase()}-${index}`,
    title: `Voyage ${countryCode} ${index}`,
    startDate: `${year}-06-01`,
    endDate: `${year}-06-08`,
    duration: { nights: 7, days: 8 },
    countryCodes: [countryCode],
    firstArrival: { name: `Ville ${index}`, countryCode },
  });
}

/**
 * Sixty trips over twelve countries and five continents, in the façade's order.
 * The count is the acceptance criterion's own upper bound, and the spread is
 * what makes "grouped, then ordered" a real question rather than a single-row
 * table.
 */
export const SIXTY_TRIPS: readonly TripEntry[] = Array.from({ length: 60 }, (_, index) => {
  const countries = ["FR", "JP", "PE", "MA", "NZ", "IT", "TH", "CL", "ZA", "AU", "ES", "VN"];
  const country = countries[index % countries.length] ?? "FR";

  return tripIn(country, index);
});

/**
 * Labels that are NOT localised: each name is the code itself, so a test asserts
 * on ordering rules and never on ICU's French collation. The one test that does
 * care about real names says so and builds its own.
 */
export const CODE_LABELS = {
  continentName: (continent: string | null): string => continent ?? "unplaced",
  countryName: (code: string): string => code,
  compare: (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0),
};
