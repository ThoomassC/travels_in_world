/**
 * The entry point of the map's *presentation* layer — the counterpart of `@/map`
 * for the components, and the specifier a page imports.
 *
 * **Why it exists, and it is not a taste for barrel files.** `eslint.config.js`
 * guards the geometry façade with two patterns, `"@/map/\*"` and `"**\/map/\*"`.
 * The second one covers the relative spellings of `src/map` — `"../../map/world"`
 * is the same module to the bundler as `"@/map/world"` — and
 * `no-restricted-imports` compares specifier *strings* without ever resolving a
 * path, so it cannot tell those apart from `"@/components/map/world-map"`.
 * Measured, the first time a page imported the map component at all:
 *
 *     src/app/[locale]/page.tsx
 *       5:1  error  '@/components/map/marks' import is restricted…
 *       6:1  error  '@/components/map/world-map' import is restricted…
 *
 * That is a false positive of a rule this project must not weaken:
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` states that the map layer
 * imports neither façade and that `src/app/[locale]/page.tsx` is the one caller —
 * so the architecture *requires* the import the pattern refuses. A specifier with
 * nothing after `map/` matches neither pattern, exactly as `"@/map"` itself does
 * not, which is what makes this file the fix that touches no guard.
 *
 * **It is a re-export list and nothing else**, in the shape `src/content/trips.ts`
 * and `src/map/index.ts` already use here. It carries no `server-only`: this layer
 * is deliberately free of both façades so the whole map renders under jsdom from a
 * seven-shape fixture, and a guard would end that.
 *
 * The alternative was narrowing `"**\/map/\*"` with a negation. It is the more
 * direct fix and it was refused for this ticket: that pattern is one of the two
 * halves of a boundary whose regressions this repository has paid for twice, and
 * re-proving a negated glob over the twenty-one measured spellings in
 * `tests/lint/map-entry-point.test.ts` is TIW-14's work, not a listing ticket's.
 */

export { WorldMap } from "./world-map";
export type { MapCountry, WorldMapProps } from "./world-map";
export type { TripMark } from "./marks";
export { VisitedCountries } from "./visited-countries";
export type { VisitedCountriesProps } from "./visited-countries";
export type { CountingTrip, CountryLabels, VisitedCountryTally } from "./countries";
/**
 * A **value** export, unlike everything above it, and the only one on this list.
 *
 * `untoldOnlyCountryCodes` (TIW-18) is arithmetic over the content — which
 * countries hold nothing but untold journeys — and it is the home page that runs
 * it, because the page is the one file holding both façades and therefore the one
 * that can partition the geometry's tinted subset with the answer. Exported from
 * here rather than imported deeply for the reason this whole file exists: a
 * `@/components/map/countries` specifier is what the geometry façade's guard
 * refuses by string comparison.
 */
export { untoldOnlyCountryCodes } from "./countries";
