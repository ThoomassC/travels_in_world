import type { CountryCode } from "@/domain/geo";
import { NUMERIC_BY_ALPHA2 } from "@/iso-3166";
import {
  DATASET_MODULE,
  DATASET_RESOLUTION,
  loadWorldDataset,
  RICHER_DATASET_MODULE,
} from "./dataset";
import { WORLD_VIEW_BOX } from "./projection";

/**
 * The join: the world's shapes on one side, the countries the content declares
 * on the other, matched on ISO 3166-1 numeric and never on a name.
 */

export type CountryShape = {
  /** ISO 3166-1 numeric, as the dataset writes it — `"392"`. */
  readonly id: string | null;
  /** ISO 3166-1 alpha-2: the key the content joins on. */
  readonly code: CountryCode | null;
  /** Localised when `code` exists; the dataset's English label otherwise. */
  readonly name: string;
  /** The `d` attribute of a `<path>`, projected and rounded to one decimal. */
  readonly path: string;
};

export type WorldGeometry = {
  readonly viewBox: string;
  readonly width: number;
  readonly height: number;
  /** Every country of the dataset, in dataset order: the background layer. */
  readonly countries: readonly CountryShape[];
  /**
   * The declared subset, sorted by localised name — and the *same objects* as in
   * `countries`, never copies. DOM order is tab order, which is the reason for
   * the sort; the shared identity is what lets the renderer emit each path once
   * and point at it with `<use href>` instead of repeating 30 KB of geometry.
   */
  readonly visited: readonly CountryShape[];
};

/**
 * ISO 3166-1 numeric → alpha-2, the direction the join needs.
 *
 * Built by inverting the hand-written table rather than by writing a second one:
 * a table and its inverse maintained side by side drift, and the drift is
 * invisible — one direction tints the right country, the other refuses it.
 * Numerics are unique across the table, so the inversion loses nothing.
 */
const ALPHA2_BY_NUMERIC: ReadonlyMap<string, string> = new Map(
  [...NUMERIC_BY_ALPHA2].map(([alpha2, numeric]) => [numeric, alpha2])
);

type LocalisedWorld = {
  readonly countries: readonly CountryShape[];
  readonly byCode: ReadonlyMap<string, CountryShape>;
};

/**
 * One entry per locale, for the whole process — an optimisation, and nothing
 * more than one.
 *
 * It saves re-deriving 177 localised names and a lookup index on every page of
 * the build, which is worth having. It is *not* what makes the referential
 * identity of `visited` work: `localisedWorld` fills `countries` and `byCode` in
 * the same `map()` pass over the same frozen objects, so `visited[i]` is an
 * element of `countries` within a single call whether or not anything is cached.
 * Verified by mutation — both caches disabled, `tests/map` green, the identity
 * assertions included.
 *
 * Stating that precisely matters: the earlier version of this comment claimed
 * the cache *guaranteed* the identity, which would have made removing the cache
 * look like a correctness regression instead of the performance trade-off it is.
 * Sharing is safe because every object reachable from an entry is frozen.
 *
 * Keyed on the locale string as given, because `"fr"` and `"fr-CA"` are
 * genuinely different names. The set of locales is fixed by `src/i18n/routing`,
 * so this cannot grow unbounded at build time.
 */
const localisedWorlds = new Map<string, LocalisedWorld>();

export function buildWorldGeometry(options: {
  /**
   * An array or a `Set`, and deliberately not an `Iterable`.
   *
   * A bare `Iterable` accepts two things that fail silently. A generator or a
   * `Set#values()` iterator is drained by its first consumer, and a second call
   * here then sees nothing and returns `visited: []` — which is a legitimate
   * value ("no trips yet"), so nothing distinguishes it from a bug. Measured: the
   * same iterator passed twice gives `['ES','JP']` then `[]`, silently. And a
   * bare `string` is an `Iterable<string>`, so `visitedCountryCodes: "JP"`
   * typechecks and then iterates the characters `"J"` and `"P"`.
   *
   * Neither is caught by the element type, because `CountryCode` is exactly
   * `string` — `z.infer` of a `z.string().regex()`, not a branded type, for the
   * reasons `docs/adr/0001-domain-purity.md` gives. So the container is what has
   * to carry the constraint. Both accepted forms are re-readable and neither is
   * a `string`.
   */
  readonly visitedCountryCodes: ReadonlyArray<CountryCode> | ReadonlySet<CountryCode>;
  readonly locale: string;
}): WorldGeometry {
  const { countries, byCode } = localisedWorld(options.locale);
  const collator = collatorFor(options.locale);

  /**
   * Materialised before anything else. The signature already rules out the
   * single-pass iterators, and this makes the module independent of that
   * promise: whatever arrives is read exactly once, here.
   */
  const declared = [...options.visitedCountryCodes];
  const problems: string[] = [];
  const selected: CountryShape[] = [];
  const seen = new Set<string>();

  for (const code of declared) {
    // Several places of one trip share a country, and several trips share one
    // too: duplicates are the normal case, not a content error.
    if (seen.has(code)) {
      continue;
    }
    seen.add(code);

    const numeric = NUMERIC_BY_ALPHA2.get(code);

    if (numeric === undefined) {
      problems.push(unknownCodeProblem(code));
      continue;
    }

    const shape = byCode.get(code);

    if (shape === undefined) {
      problems.push(undrawableCodeProblem(code, numeric, options.locale));
      continue;
    }

    selected.push(shape);
  }

  /**
   * Criterion 3: this breaks the build. Every offending code is reported, not
   * just the first — an author with three bad codes should not need three builds
   * to see three lines. With a single problem the message *is* that one
   * sentence, so nothing is padded for the common case.
   */
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }

  /**
   * `Intl.Collator`, never `<`. In French `"É" < "E"` is `true` under raw string
   * comparison — code-unit order, where every accented letter sorts after `Z` —
   * so "Égypte" would land at the end of the list. DOM order is tab order here,
   * so that is not a cosmetic defect: it is a keyboard user walking the map in
   * an order that matches no label they can see.
   *
   * Ties keep the order the *codes* arrived in, not dataset order:
   * `Array.prototype.sort` is stable and `selected` was filled while iterating
   * `declared`. Deterministic for a given input, which is what the build needs,
   * but it is the caller's order — worth knowing before anyone relies on it.
   */
  const visited = [...selected].sort((left, right) => collator.compare(left.name, right.name));

  /**
   * Frozen, shallowly, because the comments above promise immutability and an
   * unfrozen return makes that a lie: `world.viewBox = "HACKED"` used to succeed.
   * Shallow is enough — `countries` and `visited` are already frozen arrays of
   * frozen shapes.
   */
  return Object.freeze({
    viewBox: WORLD_VIEW_BOX.value,
    width: WORLD_VIEW_BOX.width,
    height: WORLD_VIEW_BOX.height,
    countries,
    visited: Object.freeze(visited),
  });
}

function localisedWorld(locale: string): LocalisedWorld {
  const cached = localisedWorlds.get(locale);
  if (cached !== undefined) {
    return cached;
  }

  const dataset = loadWorldDataset();
  const regionNames = regionNamesFor(locale);
  const byCode = new Map<string, CountryShape>();

  const countries = dataset.geometries.map((geometry) => {
    /**
     * `null` rather than a build failure for an id the table does not know. The
     * shape is still drawn — it is part of the coastline — it is simply not
     * joinable, which is the same situation as the three unidentified
     * territories below. A new territory getting an ISO code upstream should
     * make the map slightly more complete, not fail the build.
     */
    const code = geometry.id === null ? null : (ALPHA2_BY_NUMERIC.get(geometry.id) ?? null);

    const shape: CountryShape = Object.freeze({
      id: geometry.id,
      code,
      name: code === null ? geometry.datasetName : localisedName(regionNames, code, geometry),
      path: geometry.path,
    });

    if (code !== null) {
      byCode.set(code, shape);
    }

    return shape;
  });

  const world: LocalisedWorld = Object.freeze({
    countries: Object.freeze(countries),
    byCode,
  });
  localisedWorlds.set(locale, world);

  return world;
}

/**
 * A country's name in the reader's language.
 *
 * The three geometries the dataset ships without an id — `"N. Cyprus"`,
 * `"Somaliland"`, `"Kosovo"` — never reach this: they have no code, so there is
 * nothing to ask ICU about, and they keep the dataset's English label. That is
 * deliberate and it is not a gap in the translation: no ISO 3166-1 code exists
 * for them, so no content can ever declare them, and they exist here only as
 * coastline in the background layer. Inventing French labels for three shapes
 * nobody can link to would be three strings to maintain for no reader.
 *
 * The fallback for a code ICU cannot name is the dataset label. `Intl.DisplayNames`
 * echoes the input back when it has no entry — a name of `"JP"` where "Japon"
 * belongs — and an English label is at least a word.
 */
function localisedName(
  regionNames: Intl.DisplayNames,
  code: string,
  geometry: { readonly datasetName: string }
): string {
  const display = regionNames.of(code);

  return display === undefined || display === code ? geometry.datasetName : display;
}

/**
 * The two failures below are kept apart because they tell the author two
 * genuinely different things, and the action differs. Both name the offending
 * code, and both are worded the way `src/content/validate.ts` words a finding:
 * what is wrong, where, and what to do about it.
 */

/**
 * Not a country code at all — a typo, or a code that never existed.
 *
 * Except when it is the right code in the wrong case. `"jp"` is not a typo the
 * author needs to look up: it is a casing slip, and telling them "no country
 * bears this code" is both false and a dead end. So the upper-cased form is
 * tried, and when *that* resolves the message says the one thing they need. This
 * is the same distinction `src/content/validate.ts` draws between a missing file
 * and a miscased one.
 */
function unknownCodeProblem(code: string): string {
  const upperCased = code.toUpperCase();

  if (upperCased !== code && NUMERIC_BY_ALPHA2.has(upperCased)) {
    return (
      `le code pays ${quoteCode(code)} n'est pas reconnu parce qu'il n'est pas en majuscules : ` +
      `écris-le ${quoteCode(upperCased)}. La norme ISO 3166-1 alpha-2 est en capitales, et ` +
      `« countryCode » est comparé caractère pour caractère.`
    );
  }

  return (
    `le code pays ${quoteCode(code)} n'est pas un code ISO 3166-1 alpha-2 : aucun pays ne le porte, ` +
    `et la carte n'a donc aucune forme à lui associer. ` +
    `Corrige le champ « countryCode » du lieu concerné dans content/, puis relance « npm run validate:content ».`
  );
}

/**
 * A real country the map cannot draw at this resolution. Very different news
 * from the above: nothing is misspelled, and the author has a budget decision to
 * make rather than a typo to fix — so the way out is spelled out, with its cost.
 */
function undrawableCodeProblem(code: string, numeric: string, locale: string): string {
  const label = regionNamesFor(locale).of(code) ?? code;

  return (
    `le pays ${quoteCode(label)} (code ${quoteCode(code)}, ISO 3166-1 numérique ${numeric}) existe, ` +
    `mais le fond de carte ${quoteCode(DATASET_MODULE)} en résolution ${DATASET_RESOLUTION} ne le contient pas : ` +
    `aucun micro-État n'y figure — ni Singapour, ni Monaco, ni Malte, ni Saint-Marin. ` +
    `Trois issues : rattache le lieu à un pays que la carte sait dessiner, retire-le du contenu, ` +
    `ou fais passer src/map/dataset.ts sur ${quoteCode(RICHER_DATASET_MODULE)}, déjà livré par le paquet et qui contient ce pays. ` +
    `Cette dernière option porte les tracés de 30 Ko à environ 180 Ko brotli (mesuré, voir le commentaire de src/map/dataset.ts) : ` +
    `c'est une décision de budget, et le plafond de 34 Ko du test de poids la refusera tant qu'il n'est pas relevé sciemment.`
  );
}

/**
 * The two `Intl` constructors, with a failure an author can act on.
 *
 * Both throw `RangeError: Invalid language tag: <tag>` on a malformed locale, and
 * measured, all four of `""`, `"  "`, `"en_US"` (underscore instead of hyphen —
 * the single likeliest mistake) and `"999"` do exactly that. The raw error names
 * neither `buildWorldGeometry` nor the map, and it surfaces in the middle of a
 * `next build` prerender where nothing points back here. Re-thrown with the
 * origin and the received tag named, `cause` kept so the original is not lost.
 *
 * **What is deliberately not guarded**: a *well-formed* tag ICU has no data for.
 * `"zz"` and `"xx-YY"` construct fine and return English labels, because ICU
 * falls back to the root locale. That is the right behaviour — an English name is
 * a name — and it is not reachable from the application anyway: the locale comes
 * from the `[locale]` segment, and `src/i18n/routing.ts` declares only `fr`
 * today. Worth writing down rather than defending against, so that a future
 * locale added to `routing.ts` without ICU data is understood as "names come out
 * English" and not as a bug in this module.
 */
function regionNamesFor(locale: string): Intl.DisplayNames {
  try {
    return new Intl.DisplayNames([locale], { type: "region" });
  } catch (cause) {
    throw new Error(localeProblem(locale, "les noms de pays"), { cause });
  }
}

function collatorFor(locale: string): Intl.Collator {
  try {
    return new Intl.Collator(locale);
  } catch (cause) {
    throw new Error(localeProblem(locale, "le tri des pays visités"), { cause });
  }
}

function localeProblem(locale: string, what: string): string {
  return (
    `buildWorldGeometry a reçu la locale ${quoteCode(locale)}, qu'Intl refuse : ` +
    `ce n'est pas une étiquette de langue BCP 47, et la carte ne peut donc pas produire ${what}. ` +
    `Attends-toi à une étiquette comme « fr » ou « fr-CA » — un tiret, jamais un souligné. ` +
    `Les locales du site sont déclarées dans src/i18n/routing.ts.`
  );
}

/**
 * A code as it is quoted in a message. Bounded and stripped of control
 * characters for the same reason `escapeControls` exists in
 * `src/content/finding.ts`: the value comes from a hand-written file and is
 * printed to a terminal, where an escape sequence can erase the very report the
 * author is meant to read. Reimplemented in four lines rather than imported,
 * because `src/map` must not depend on `src/content`.
 */
function quoteCode(value: string): string {
  const points = [...value].filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0x20 && codePoint !== 0x7f && !(codePoint >= 0x80 && codePoint <= 0x9f);
  });

  return `« ${points.length <= 40 ? points.join("") : `${points.slice(0, 40).join("")}…`} »`;
}
