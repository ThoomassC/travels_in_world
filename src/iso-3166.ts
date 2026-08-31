/**
 * The 249 officially assigned ISO 3166-1 alpha-2 codes, each with its ISO 3166-1
 * numeric — the transcription of the standard, and this project's single answer
 * to "does a country bear this code?".
 *
 * **Why the table exists at all.** `world-atlas` keys its geometries on the
 * *numeric* code, and the content keys its places on the *alpha-2* code. Nothing
 * else joins the two: the dataset's `properties.name` is a Natural Earth display
 * label — `"N. Cyprus"`, `"Dem. Rep. Congo"`, `"Bosnia and Herz."` — abbreviated
 * for a map legend and normalised against no registry. Joining on it would be a
 * bug waiting for the first accented or abbreviated label, so criterion 2 of
 * TIW-12 forbids it outright.
 *
 * **Why it sits at the root of `src/`, and not in `src/map` where it was born nor
 * in `src/domain`.** It has two consumers, in two layers that cannot reach each
 * other, and TIW-29 is what made the second one appear:
 *
 * - `src/map/world.ts` needs the alpha-2 → numeric direction, to join the content
 *   to the geometry;
 * - `src/content/validate.ts` needs {@link isAssignedCountryCode}, because
 *   `npm run validate:content` used to clear a trip declaring `XK` that
 *   `next build` then refused mid-prerender — with a message sending the author
 *   back to `validate:content`, which cleared it again.
 *
 * The three ways of serving both were measured rather than argued:
 *
 * - **through the `@/map` façade**: impossible. The façade carries
 *   `import "server-only"` and the validator is a plain Node script. Measured, on
 *   a script importing `@/map` under
 *   `node --import ./scripts/runtime/register-typescript.mts`:
 *   `ERR_MODULE_NOT_FOUND: Cannot find package 'server-only'`. It fails at
 *   *resolution*, so no export of the façade can ever serve a script;
 * - **as a deep import of `@/map/iso-3166`**: refused, by design. Measured with
 *   ESLint on `src/content/validate.ts`: `'@/map/iso-3166' import is restricted
 *   from being used by a pattern` (`travels-in-world/map-entry-point`). Widening
 *   that rule for the validator opens the same door to every `src/**` module,
 *   `'use client'` components included;
 * - **as a second copy, with a test keeping the two in phase**: it works — the
 *   repository already runs that pattern between this table and
 *   `src/domain/continent.ts` — but a *third* transcription of 249 rows, when a
 *   shared module costs one file, is not a trade worth making. `src/map/world.ts`
 *   says the same of its own inverse table: "a table and its inverse maintained
 *   side by side drift, and the drift is invisible".
 *
 * So the table left the layer that used to be its only consumer, and kept every
 * one of its rows. Two consequences, both stated rather than discovered later:
 *
 * - **`src/domain/**` still cannot reach it**, which is what keeps
 *   `docs/adr/0001-domain-purity.md` and `CountryCodeSchema`'s refusal to know the
 *   list intact. Measured: a domain module importing `@/iso-3166` is refused by
 *   `travels-in-world/domain-purity`, whose forbidden list carries `@/*`. The
 *   domain validates the *shape* of a code; knowing the world is this module's
 *   job, and refusing content is `src/content`'s;
 * - **every other `src/**` module can now import it, where `@/map/iso-3166` was
 *   refused from a page.** A real widening, and accepted: what TIW-12's criterion
 *   2 protects is that nobody redoes the *join*, and the join needs the geometry —
 *   which stays behind the façade, behind `server-only`, and behind the ESLint ban
 *   on `world-atlas`, `d3-geo` and `topojson-client`. These numerics alone can
 *   draw nothing. They weigh under 4 KB raw, so the 150 KB brotli ceiling of
 *   `npm run test:build` is not at stake either.
 *
 * **Correctness.** A typo here does not fail: it tints the wrong country, or
 * quietly refuses a real one. Two independent checks were run against the table
 * as written, and both are cheap to re-run when a code is added:
 *
 * - every one of the 174 numeric ids in `countries-110m.json` is reached by
 *   exactly one alpha-2 of this table (177 geometries minus the 3 that carry no
 *   id at all: N. Cyprus, Somaliland, Kosovo — see `dataset.ts`);
 * - `new Intl.DisplayNames(["en"], { type: "region" }).of(alpha2)` returns a
 *   name, and not the code itself, for all 249 keys. ICU echoes the input back
 *   for a code it does not know, which is exactly how a mistyped alpha-2 shows
 *   up.
 *
 * Written sorted by alpha-2 so a missing or duplicated code is visible by
 * reading, and numerics are kept as the standard writes them — three digits,
 * zero-padded, as strings. `"020"` is not `20`: the dataset's ids are strings and
 * the join is a string comparison, so dropping the padding would silently match
 * nothing.
 */
const NUMERIC_BY_ALPHA2_RECORD = {
  AD: "020",
  AE: "784",
  AF: "004",
  AG: "028",
  AI: "660",
  AL: "008",
  AM: "051",
  AO: "024",
  AQ: "010",
  AR: "032",
  AS: "016",
  AT: "040",
  AU: "036",
  AW: "533",
  AX: "248",
  AZ: "031",
  BA: "070",
  BB: "052",
  BD: "050",
  BE: "056",
  BF: "854",
  BG: "100",
  BH: "048",
  BI: "108",
  BJ: "204",
  BL: "652",
  BM: "060",
  BN: "096",
  BO: "068",
  BQ: "535",
  BR: "076",
  BS: "044",
  BT: "064",
  BV: "074",
  BW: "072",
  BY: "112",
  BZ: "084",
  CA: "124",
  CC: "166",
  CD: "180",
  CF: "140",
  CG: "178",
  CH: "756",
  CI: "384",
  CK: "184",
  CL: "152",
  CM: "120",
  CN: "156",
  CO: "170",
  CR: "188",
  CU: "192",
  CV: "132",
  CW: "531",
  CX: "162",
  CY: "196",
  CZ: "203",
  DE: "276",
  DJ: "262",
  DK: "208",
  DM: "212",
  DO: "214",
  DZ: "012",
  EC: "218",
  EE: "233",
  EG: "818",
  EH: "732",
  ER: "232",
  ES: "724",
  ET: "231",
  FI: "246",
  FJ: "242",
  FK: "238",
  FM: "583",
  FO: "234",
  FR: "250",
  GA: "266",
  GB: "826",
  GD: "308",
  GE: "268",
  GF: "254",
  GG: "831",
  GH: "288",
  GI: "292",
  GL: "304",
  GM: "270",
  GN: "324",
  GP: "312",
  GQ: "226",
  GR: "300",
  GS: "239",
  GT: "320",
  GU: "316",
  GW: "624",
  GY: "328",
  HK: "344",
  HM: "334",
  HN: "340",
  HR: "191",
  HT: "332",
  HU: "348",
  ID: "360",
  IE: "372",
  IL: "376",
  IM: "833",
  IN: "356",
  IO: "086",
  IQ: "368",
  IR: "364",
  IS: "352",
  IT: "380",
  JE: "832",
  JM: "388",
  JO: "400",
  JP: "392",
  KE: "404",
  KG: "417",
  KH: "116",
  KI: "296",
  KM: "174",
  KN: "659",
  KP: "408",
  KR: "410",
  KW: "414",
  KY: "136",
  KZ: "398",
  LA: "418",
  LB: "422",
  LC: "662",
  LI: "438",
  LK: "144",
  LR: "430",
  LS: "426",
  LT: "440",
  LU: "442",
  LV: "428",
  LY: "434",
  MA: "504",
  MC: "492",
  MD: "498",
  ME: "499",
  MF: "663",
  MG: "450",
  MH: "584",
  MK: "807",
  ML: "466",
  MM: "104",
  MN: "496",
  MO: "446",
  MP: "580",
  MQ: "474",
  MR: "478",
  MS: "500",
  MT: "470",
  MU: "480",
  MV: "462",
  MW: "454",
  MX: "484",
  MY: "458",
  MZ: "508",
  NA: "516",
  NC: "540",
  NE: "562",
  NF: "574",
  NG: "566",
  NI: "558",
  NL: "528",
  NO: "578",
  NP: "524",
  NR: "520",
  NU: "570",
  NZ: "554",
  OM: "512",
  PA: "591",
  PE: "604",
  PF: "258",
  PG: "598",
  PH: "608",
  PK: "586",
  PL: "616",
  PM: "666",
  PN: "612",
  PR: "630",
  PS: "275",
  PT: "620",
  PW: "585",
  PY: "600",
  QA: "634",
  RE: "638",
  RO: "642",
  RS: "688",
  RU: "643",
  RW: "646",
  SA: "682",
  SB: "090",
  SC: "690",
  SD: "729",
  SE: "752",
  SG: "702",
  SH: "654",
  SI: "705",
  SJ: "744",
  SK: "703",
  SL: "694",
  SM: "674",
  SN: "686",
  SO: "706",
  SR: "740",
  SS: "728",
  ST: "678",
  SV: "222",
  SX: "534",
  SY: "760",
  SZ: "748",
  TC: "796",
  TD: "148",
  TF: "260",
  TG: "768",
  TH: "764",
  TJ: "762",
  TK: "772",
  TL: "626",
  TM: "795",
  TN: "788",
  TO: "776",
  TR: "792",
  TT: "780",
  TV: "798",
  TW: "158",
  TZ: "834",
  UA: "804",
  UG: "800",
  UM: "581",
  US: "840",
  UY: "858",
  UZ: "860",
  VA: "336",
  VC: "670",
  VE: "862",
  VG: "092",
  VI: "850",
  VN: "704",
  VU: "548",
  WF: "876",
  WS: "882",
  YE: "887",
  YT: "175",
  ZA: "710",
  ZM: "894",
  ZW: "716",
} as const;

/**
 * The table as a `Map`, which is what every consumer wants: `.get()` on a
 * runtime string cannot be expressed on the record above without widening its
 * key type, and a `Map` cannot be added to by accident the way a plain object
 * can through its prototype (`NUMERIC_BY_ALPHA2_RECORD["constructor"]` answers
 * something; `map.get("constructor")` answers `undefined`).
 */
export const NUMERIC_BY_ALPHA2: ReadonlyMap<string, string> = new Map(
  Object.entries(NUMERIC_BY_ALPHA2_RECORD)
);

/**
 * Whether ISO 3166-1 assigns this alpha-2 code to a country.
 *
 * The question `CountryCodeSchema` deliberately declines to answer and
 * `src/content/validate.ts` has to: a code of the right *shape* that the registry
 * does not assign is content the map cannot draw, and `buildWorldGeometry` throws
 * on it in the middle of a prerender.
 *
 * **Case-sensitive, deliberately**, and this is the one design decision of the
 * function. ISO 3166-1 alpha-2 is written in capitals, `CountryCodeSchema` accepts
 * `/^[A-Z]{2}$/` only, and the validator runs this *after* that shape check — so a
 * lowercase code has already been reported, in the one message that can tell an
 * author "you wrote `jp`, write `JP`". Upper-casing here would answer `true` for
 * `"jp"` and quietly delete that distinction. `src/map/world.ts` draws the same
 * line, in the other direction: it upper-cases only to *word* the failure.
 *
 * Reads through the `Map` and never by indexing the record, for the reason
 * `src/domain/continent.ts` gives about its own table: the code arrives from
 * parsed YAML, and `record["constructor"]` answers with a function where
 * `map.get("constructor")` answers `undefined`. So `countryCode: constructor`
 * would have been an assigned country.
 */
export function isAssignedCountryCode(code: string): boolean {
  return NUMERIC_BY_ALPHA2.has(code);
}
