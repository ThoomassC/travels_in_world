import type { CountryCode } from "./geo";

/**
 * Which continent a country sits on — the one fact the full trip listing needs
 * and that nothing in this codebase knew yet.
 *
 * **Why this is in the domain, when two neighbours refused exactly that.**
 * `CountryCodeSchema` (`./geo`) declines to check that a code *exists*, saying a
 * registry in the domain would be "a copy of the ISO list […] and date it", and
 * `src/iso-3166.ts` keeps its alpha-2 → numeric table out of the domain because
 * that table is what *refuses* content — it is read by the map's join and by
 * `src/content/validate.ts`, the two layers allowed to know the real world.
 * Neither argument reaches this table, and the difference is worth stating
 * because the next person will read those two comments before this one:
 *
 * - **it validates nothing.** {@link continentOf} is total: an unknown code
 *   answers `null` rather than throwing, and `buildCatalogue` has a group for
 *   exactly that. So this table rejects no trip — which is precisely what
 *   `CountryCodeSchema` refused to become;
 * - **it is tied to no dataset.** The map's table can only name countries
 *   `world-atlas` draws. A continent is a property of the country, not of one
 *   vintage of one dataset, which is why Kosovo has a row here and none there.
 *
 * **What the reader must NOT conclude from the first point, because an earlier
 * version of this comment said it and it was false.** It claimed the listing
 * "renders an unknown code under its own heading" — a *rendered* outcome. It does
 * not: `buildWorldGeometry` (`src/map/world.ts`) throws on any code outside the
 * 249 of ISO 3166-1, and the home page calls it, so a trip declaring one never
 * reaches a listing. What has changed since is *where* it is stopped. Measured
 * with a trip declaring `XK`, before TIW-29:
 *
 * ```
 * $ npm run validate:content →  1 voyage validé …, aucun problème.   (exit 0)
 * $ npm run build            →  Error occurred prerendering page "/fr".
 *                               Error: le code pays « XK » n'est pas un code
 *                               ISO 3166-1 alpha-2 …                 (exit 1)
 * ```
 *
 * That defect — a validator clearing what the build refuses, with the build's own
 * message sending the author back to the validator — was TIW-29's, and it is
 * fixed: `src/content/validate.ts` now refuses such a code, naming the file, the
 * line, the column and the field, and `prebuild` runs it before every
 * `npm run build`. So the code is stopped one layer earlier, and `XK` is refused
 * with a sentence that says *why* rather than accusing the author of a typo.
 *
 * The totality of {@link continentOf} is kept all the same, and so is the
 * listing's group: a pure function owes its caller an answer for every input of
 * its type, and the day the map learns to tolerate a code it cannot draw, the
 * listing must not be what breaks instead.
 *
 * What stays true of the neighbours' worry is the *dating*, and the answer is a
 * test rather than a promise: `tests/domain/continent.test.ts` checks this table
 * against the 249 alpha-2 codes `src/iso-3166.ts` carries, in both directions. It
 * lives in `tests/**` — outside `src/**`, so `domain-purity` does not apply — and
 * it goes red the day either list moves without the other.
 *
 * **The vocabulary is the UN M49 top-level regions**, not the seven-continent
 * model taught in French schools. One authority, so no boundary is drawn by
 * hand: `americas` is a single region, which is what spares this file from
 * deciding whether Panama, Trinidad or Mexico is northern or southern. The names
 * a reader sees come from the message catalogue, never from here — the domain
 * knows no locale (`docs/adr/0001-domain-purity.md`).
 */
export const CONTINENTS = [
  "africa",
  "americas",
  "antarctica",
  "asia",
  "europe",
  "oceania",
] as const;

export type Continent = (typeof CONTINENTS)[number];

/**
 * The five polar and sub-polar territories, gathered under `antarctica`, and the
 * only place this file knowingly parts from M49.
 *
 * M49 scatters them for statistical reasons that mean nothing under a heading in
 * a travel journal: South Georgia counts as South America, Heard and McDonald as
 * Australia and New Zealand, and the French Southern Territories carry Adélie
 * Land — a claim on the continent itself — while being filed away from it.
 * Grouping them is a reader's reading, and it is written here rather than left
 * implicit because it is the one row of this table a reviewer would otherwise
 * take for a mistake.
 */
const POLAR_TERRITORIES = ["AQ", "BV", "GS", "HM", "TF"] as const;

/**
 * Sorted by alpha-2 inside each region, the way `src/iso-3166.ts` is sorted:
 * a duplicated or missing code is then visible by reading, and the coverage test
 * catches whatever reading misses.
 *
 * Four rows are politically arguable and all four follow M49 rather than
 * intuition, so that the rule is one rule and not a series of preferences:
 * **Cyprus and Turkey are Asia** (Western Asia), **Armenia, Azerbaijan and
 * Georgia are Asia**, **Russia is Europe** (Eastern Europe) while **Kazakhstan is
 * Asia**, and **Greenland is the Americas** (Northern America) despite being
 * Danish. `IO` — the Chagos Archipelago, which M49 assigns to no region at all —
 * is filed with Southern Asia, its nearest neighbour being the Maldives.
 *
 * `XK` is here and is NOT one of the 249: Kosovo's code is user-assigned, not
 * officially allocated, so `src/iso-3166.ts` does not carry it and the map cannot
 * draw it.
 *
 * The row is a *continent* answer and nothing more. It does not make a trip to
 * Kosovo publishable: since TIW-29, `npm run validate:content` refuses `XK` by
 * name — with the file, the line and the reason — and `buildWorldGeometry` still
 * throws on it behind that. The row is here so that the day the map tolerates an
 * undrawable code, this table already has the answer instead of being the next
 * thing to fix.
 */
const CONTINENT_BY_COUNTRY_RECORD = {
  // --- Africa -------------------------------------------------------------
  AO: "africa",
  BF: "africa",
  BI: "africa",
  BJ: "africa",
  BW: "africa",
  CD: "africa",
  CF: "africa",
  CG: "africa",
  CI: "africa",
  CM: "africa",
  CV: "africa",
  DJ: "africa",
  DZ: "africa",
  EG: "africa",
  EH: "africa",
  ER: "africa",
  ET: "africa",
  GA: "africa",
  GH: "africa",
  GM: "africa",
  GN: "africa",
  GQ: "africa",
  GW: "africa",
  KE: "africa",
  KM: "africa",
  LR: "africa",
  LS: "africa",
  LY: "africa",
  MA: "africa",
  MG: "africa",
  ML: "africa",
  MR: "africa",
  MU: "africa",
  MW: "africa",
  MZ: "africa",
  NA: "africa",
  NE: "africa",
  NG: "africa",
  RE: "africa",
  RW: "africa",
  SC: "africa",
  SD: "africa",
  SH: "africa",
  SL: "africa",
  SN: "africa",
  SO: "africa",
  SS: "africa",
  ST: "africa",
  SZ: "africa",
  TD: "africa",
  TG: "africa",
  TN: "africa",
  TZ: "africa",
  UG: "africa",
  YT: "africa",
  ZA: "africa",
  ZM: "africa",
  ZW: "africa",

  // --- Americas -----------------------------------------------------------
  AG: "americas",
  AI: "americas",
  AR: "americas",
  AW: "americas",
  BB: "americas",
  BL: "americas",
  BM: "americas",
  BO: "americas",
  BQ: "americas",
  BR: "americas",
  BS: "americas",
  BZ: "americas",
  CA: "americas",
  CL: "americas",
  CO: "americas",
  CR: "americas",
  CU: "americas",
  CW: "americas",
  DM: "americas",
  DO: "americas",
  EC: "americas",
  FK: "americas",
  GD: "americas",
  GF: "americas",
  GL: "americas",
  GP: "americas",
  GT: "americas",
  GY: "americas",
  HN: "americas",
  HT: "americas",
  JM: "americas",
  KN: "americas",
  KY: "americas",
  LC: "americas",
  MF: "americas",
  MQ: "americas",
  MS: "americas",
  MX: "americas",
  NI: "americas",
  PA: "americas",
  PE: "americas",
  PM: "americas",
  PR: "americas",
  PY: "americas",
  SR: "americas",
  SV: "americas",
  SX: "americas",
  TC: "americas",
  TT: "americas",
  US: "americas",
  UY: "americas",
  VC: "americas",
  VE: "americas",
  VG: "americas",
  VI: "americas",

  // --- Antarctica and the sub-antarctic territories ------------------------
  AQ: "antarctica",
  BV: "antarctica",
  GS: "antarctica",
  HM: "antarctica",
  TF: "antarctica",

  // --- Asia ----------------------------------------------------------------
  AE: "asia",
  AF: "asia",
  AM: "asia",
  AZ: "asia",
  BD: "asia",
  BH: "asia",
  BN: "asia",
  BT: "asia",
  CN: "asia",
  CY: "asia",
  GE: "asia",
  HK: "asia",
  ID: "asia",
  IL: "asia",
  IN: "asia",
  IO: "asia",
  IQ: "asia",
  IR: "asia",
  JO: "asia",
  JP: "asia",
  KG: "asia",
  KH: "asia",
  KP: "asia",
  KR: "asia",
  KW: "asia",
  KZ: "asia",
  LA: "asia",
  LB: "asia",
  LK: "asia",
  MM: "asia",
  MN: "asia",
  MO: "asia",
  MV: "asia",
  MY: "asia",
  NP: "asia",
  OM: "asia",
  PH: "asia",
  PK: "asia",
  PS: "asia",
  QA: "asia",
  SA: "asia",
  SG: "asia",
  SY: "asia",
  TH: "asia",
  TJ: "asia",
  TL: "asia",
  TM: "asia",
  TR: "asia",
  TW: "asia",
  UZ: "asia",
  VN: "asia",
  YE: "asia",

  // --- Europe --------------------------------------------------------------
  AD: "europe",
  AL: "europe",
  AT: "europe",
  AX: "europe",
  BA: "europe",
  BE: "europe",
  BG: "europe",
  BY: "europe",
  CH: "europe",
  CZ: "europe",
  DE: "europe",
  DK: "europe",
  EE: "europe",
  ES: "europe",
  FI: "europe",
  FO: "europe",
  FR: "europe",
  GB: "europe",
  GG: "europe",
  GI: "europe",
  GR: "europe",
  HR: "europe",
  HU: "europe",
  IE: "europe",
  IM: "europe",
  IS: "europe",
  IT: "europe",
  JE: "europe",
  LI: "europe",
  LT: "europe",
  LU: "europe",
  LV: "europe",
  MC: "europe",
  MD: "europe",
  ME: "europe",
  MK: "europe",
  MT: "europe",
  NL: "europe",
  NO: "europe",
  PL: "europe",
  PT: "europe",
  RO: "europe",
  RS: "europe",
  RU: "europe",
  SE: "europe",
  SI: "europe",
  SJ: "europe",
  SK: "europe",
  SM: "europe",
  UA: "europe",
  VA: "europe",
  /** User-assigned, deliberately: see the note above. */
  XK: "europe",

  // --- Oceania -------------------------------------------------------------
  AS: "oceania",
  AU: "oceania",
  CC: "oceania",
  CK: "oceania",
  CX: "oceania",
  FJ: "oceania",
  FM: "oceania",
  GU: "oceania",
  KI: "oceania",
  MH: "oceania",
  MP: "oceania",
  NC: "oceania",
  NF: "oceania",
  NR: "oceania",
  NU: "oceania",
  NZ: "oceania",
  PF: "oceania",
  PG: "oceania",
  PN: "oceania",
  PW: "oceania",
  SB: "oceania",
  TK: "oceania",
  TO: "oceania",
  TV: "oceania",
  UM: "oceania",
  VU: "oceania",
  WF: "oceania",
  WS: "oceania",
} as const satisfies Record<string, Continent>;

/**
 * Read through a `ReadonlyMap` and never by indexing the literal above.
 *
 * The reason is the one `findTrip` gives in `src/content/loader.ts`: a country
 * code reaches this function from parsed content, and `record["constructor"]`
 * on a plain object answers with a function rather than `undefined`. A `Map`
 * has no prototype chain to walk into, so `"__proto__"` is simply a key it does
 * not have — and `POLAR_TERRITORIES` above is the reminder that this table is
 * data, not a namespace.
 */
const CONTINENT_BY_COUNTRY: ReadonlyMap<string, Continent> = new Map(
  Object.entries(CONTINENT_BY_COUNTRY_RECORD)
);

/**
 * The continent a country sits on, or `null` when this table has never heard of
 * the code.
 *
 * **`null` rather than a throw or a default continent**, and this is the whole
 * reason the table is allowed to live in the domain. `CountryCodeSchema`
 * validates the *shape* of a code and not its existence, on purpose, so `"ZZ"`
 * is a value this function can legitimately be handed — the layer that refuses it
 * is `src/content/validate.ts`, not the domain. Folding it into a continent would
 * file a trip under a heading that is simply false; `null` says "not placed", and
 * `buildCatalogue` has a group for exactly that.
 *
 * A throw here would be wrong for a reason that is about this function and not
 * about the screen: a total function is the contract a pure domain owes its
 * callers, and there is more than one caller. What is **not** a reason — the
 * earlier wording of this paragraph said it was — is that throwing "would crash
 * the listing". The listing is unreachable for such a code anyway: the validator
 * refuses it before the build, and the map throws on it behind that. The note at
 * the top of this file has the measurement.
 *
 * Case-sensitive, deliberately: `CountryCodeSchema` accepts uppercase only, so a
 * lowercase code never came through it, and quietly upper-casing here would hide
 * the one place where that could be noticed.
 */
export function continentOf(code: CountryCode): Continent | null {
  return CONTINENT_BY_COUNTRY.get(code) ?? null;
}

/** The codes this table places, for the coverage test and for nothing else. */
export function placedCountryCodes(): readonly string[] {
  return [...CONTINENT_BY_COUNTRY.keys()];
}

/** Exposed for the same test: the deliberate additions to the official 249. */
export const CODES_OUTSIDE_ISO_3166 = ["XK"] as const;

/** Exposed for the same test, so the deviation above is asserted and not merely written. */
export const POLAR_TERRITORY_CODES: readonly string[] = POLAR_TERRITORIES;
