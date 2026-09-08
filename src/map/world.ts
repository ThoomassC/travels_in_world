import {
  BASEMAP_VINTAGE,
  DRAWABLE_COUNTRY_CODES,
  FINER_BASEMAP_VINTAGES,
  FINER_VINTAGE_COUNTRY_CODES,
  REGENERATE_COMMAND,
} from "@/basemap-coverage";
import type { CountryCode } from "@/domain/geo";
import { NUMERIC_BY_ALPHA2 } from "@/iso-3166";
import {
  DATASET_MODULE,
  DATASET_RESOLUTION,
  loadWorldDataset,
  RICHER_DATASET_MODULE,
} from "./dataset";
import { labelAnchorOf } from "./anchor";
import { WORLD_VIEW_BOX } from "./projection";
import type { ProjectedPoint } from "./projection";

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
  /**
   * The countries the journal *wants* to reach — TIW-39's third tint, « à venir ».
   *
   * Sorted by localised name like `visited`, disjoint from it by construction
   * (the build throws on an overlap), and **richer than a `CountryShape`**: it
   * carries an anchor. That is the one thing this bucket needs and the other two
   * do not — a wished country has no trip, so nothing else on the map says where
   * it is, and the note that names it has to hang on a point.
   *
   * The shapes are therefore *copies* rather than the shared objects `visited`
   * returns. Nothing here is drawn twice from two places, so there is no `<use>`
   * to share an identity with; and a handful of extra objects for a handful of
   * countries is not the 30 KB the visited layer's sharing is about.
   */
  readonly wished: readonly WishedCountry[];
};

/** A country in the « à venir » state, and where its note hangs. */
export type WishedCountry = CountryShape & {
  /**
   * A point in the projected world, **inside the shape**, where the map hangs
   * this country's note. `src/map/anchor.ts` says why it is not the centroid: the
   * centroid of Croatia is in Bosnia and the centroid of Portugal is in the
   * Atlantic.
   */
  readonly anchor: ProjectedPoint;
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
  /**
   * The countries the journal wants to reach — TIW-39, `content/wishlist.yaml`.
   *
   * Same container rule as above, and same reason. Optional, because a journal
   * with no wishlist is the ordinary case and every fixture in this repository is
   * one; an absent list must produce an empty bucket and **no empty `<g>`** in the
   * document, which is what the component's own guard is for.
   */
  readonly wishedCountryCodes?: ReadonlyArray<CountryCode> | ReadonlySet<CountryCode>;
  readonly locale: string;
}): WorldGeometry {
  const { countries, byCode } = localisedWorld(options.locale);
  const collator = collatorFor(options.locale);

  /**
   * Materialised before anything else. The signature already rules out the
   * single-pass iterators, and this makes the module independent of that
   * promise: whatever arrives is read exactly once, here.
   */
  const declaredVisited = resolveCodes([...options.visitedCountryCodes], byCode, {
    unknown: unknownCodeProblem,
    undrawable: (code, numeric) => undrawableCodeProblem(code, numeric, options.locale),
  });
  const declaredWished = resolveCodes([...(options.wishedCountryCodes ?? [])], byCode, {
    unknown: wishedUnknownCodeProblem,
    undrawable: (code, numeric) => wishedUndrawableCodeProblem(code, numeric, options.locale),
  });

  const problems = [
    ...declaredVisited.problems,
    ...declaredWished.problems,
    /**
     * **The two lists must not name the same country**, and this refuses rather
     * than resolves.
     *
     * The three tinted layers are painted one over the other and are handed to the
     * renderer disjoint (see `WorldMapProps`): a country in two of them is drawn
     * twice, the later paint hiding the earlier, so the drawing would silently show
     * one state while the content declared two. "Visited wins" and "wished wins" are
     * both defensible, which is precisely why this is not the layer that gets to
     * choose — the person who wrote the two files is.
     */
    ...overlapProblems(declaredVisited.shapes, declaredWished.shapes),
  ];

  /**
   * Criterion 3: this breaks the build. Every offending code is reported, not
   * just the first — an author with three bad codes should not need three builds
   * to see three lines. With a single problem the message *is* that one
   * sentence, so nothing is padded for the common case.
   */
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }

  const selected = declaredVisited.shapes;

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
   * The wished bucket, sorted the same way and for the same reason, then given
   * the one thing a `CountryShape` does not carry: the point its note hangs on.
   *
   * `flatMap` and not `map`: `labelAnchorOf` answers `null` for a path with no
   * area, which no shipped geometry produces — `loadWorldDataset` already refuses
   * an empty path — but which a future vintage could. A country dropped from the
   * bucket loses its tint and its note together, which is coherent; a country kept
   * with an anchor of `(0, 0)` would be labelled in the north Atlantic.
   */
  const wished = [...declaredWished.shapes]
    .sort((left, right) => collator.compare(left.name, right.name))
    .flatMap((shape) => {
      const anchor = labelAnchorOf(shape.path);

      return anchor === null ? [] : [Object.freeze({ ...shape, anchor })];
    });

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
    wished: Object.freeze(wished),
  });
}

/**
 * One declared list, resolved against the geometry — the loop `visited` used to
 * hold inline, extracted when TIW-39 gave it a second caller.
 *
 * It reports *every* problem instead of throwing on the first, because the caller
 * merges the two lists' problems into one message: an author with a bad trip code
 * and a bad wishlist code should see both, not the first and then the other after
 * a second build.
 *
 * The wording is a parameter and not a flag. Both lists refuse the same two
 * things, and a message that named neither the file nor the fix would send its
 * reader grepping thirteen `trip.yaml` files for a code written in
 * `wishlist.yaml` — the shape of dead end TIW-29 spent a ticket removing.
 */
function resolveCodes(
  declared: readonly CountryCode[],
  byCode: ReadonlyMap<string, CountryShape>,
  wording: {
    readonly unknown: (code: string) => string;
    readonly undrawable: (code: string, numeric: string) => string;
  }
): { readonly shapes: readonly CountryShape[]; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const shapes: CountryShape[] = [];
  const seen = new Set<string>();

  for (const code of declared) {
    // Several places of one trip share a country, and several trips share one
    // too: duplicates are the normal case, not a content error. The wishlist has
    // its own reason — a file edited by hand over months.
    if (seen.has(code)) {
      continue;
    }
    seen.add(code);

    const numeric = NUMERIC_BY_ALPHA2.get(code);

    if (numeric === undefined) {
      problems.push(wording.unknown(code));
      continue;
    }

    const shape = byCode.get(code);

    if (shape === undefined) {
      problems.push(wording.undrawable(code, numeric));
      continue;
    }

    shapes.push(shape);
  }

  return { shapes, problems };
}

/** Countries claimed by both lists at once, named one per line. */
function overlapProblems(
  visited: readonly CountryShape[],
  wished: readonly CountryShape[]
): readonly string[] {
  const visitedCodes = new Set(visited.flatMap((shape) => (shape.code === null ? [] : [shape.code])));

  return wished.flatMap((shape) =>
    shape.code === null || !visitedCodes.has(shape.code)
      ? []
      : [
          `${quoteCode(shape.name)} (code ${quoteCode(shape.code)}) est à la fois un pays visité — un voyage de content/trips/ y passe — ` +
            `et un pays souhaité, déclaré dans ${quoteCode(WISHLIST_DISPLAY_PATH)}. ` +
            `La carte peint une forme une fois : les deux teintes se recouvriraient et une seule serait visible, ` +
            `sans que rien ne dise laquelle. Retire ce pays de ${quoteCode(WISHLIST_DISPLAY_PATH)} — il est déjà visité. ${bypassNote()}`,
        ]
  );
}

/**
 * The file the wishlist's messages name. A literal and not an import from
 * `src/content/**`: `src/map` must not depend on the content layer (the same
 * reason `quoteCode` below is four lines here rather than an import), and the
 * path is what the *reader* has to open, not a value anything resolves.
 */
const WISHLIST_DISPLAY_PATH = "content/wishlist.yaml";

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

  assertCoverageMatchesDataset(byCode);

  const world: LocalisedWorld = Object.freeze({
    countries: Object.freeze(countries),
    byCode,
  });
  localisedWorlds.set(locale, world);

  return world;
}

/**
 * The verdict of the coverage comparison, computed at most once: `undefined`
 * until it has run, `null` once it has run clean, the message otherwise.
 *
 * **The memo holds the verdict, never merely the fact that the check ran.** The
 * first version of this stored a boolean and returned early on the second call,
 * which meant a stale artefact failed the first page of the build and then
 * cleared every page after it — a guard that stops guarding once it has fired.
 * Caught by its own test, which asserted twice on the same call and saw the
 * second assertion pass.
 *
 * Kept out of the two caches above deliberately: both are documented as
 * optimisations that may be removed, and a correctness check that quietly stops
 * running when someone deletes a `Map` is a failure mode this repository has
 * already paid for twice.
 */
let coverageVerdict: string | null | undefined;

/**
 * The build-time half of the freshness guard on `src/basemap-coverage.ts`.
 *
 * That file is generated, committed, and read by `src/content/validate.ts` to
 * refuse a country the map cannot draw *before* the build. It is the only way the
 * content layer can know that answer — `travels-in-world/map-entry-point` keeps
 * `world-atlas`, `d3-*` and `topojson-*` out of every module of `src/**` outside
 * `src/map/**`, and the `@/map` façade is unresolvable from the plain Node the
 * validator runs on. See the header of the generated file.
 *
 * The cost of a generated answer is that it can go stale, and a stale list is
 * worse than none: it would refuse content that draws perfectly, or clear content
 * the prerender then dies on. `tests/map/basemap-coverage.test.ts` recomputes it
 * from the packaged TopoJSON on every `npm test`, which is the fast signal. This
 * is the other one, and it is here because **this** module is the only place that
 * holds the shapes the site is actually about to draw.
 *
 * Thrown, not warned. A `console.warn` in the middle of a prerender is a line
 * nobody reads in a log nobody keeps, and the whole point of TIW-30 is that the
 * silent version of this fault already cost a ticket.
 */
function assertCoverageMatchesDataset(byCode: ReadonlyMap<string, CountryShape>): void {
  coverageVerdict ??= coverageProblem(byCode) ?? null;

  if (coverageVerdict !== null) {
    throw new Error(coverageVerdict);
  }
}

/** The comparison itself, `undefined` when the artefact still describes the map. */
function coverageProblem(byCode: ReadonlyMap<string, CountryShape>): string | undefined {
  /**
   * Checked before the lists, and it is not the same fault: two vintages can
   * happen to draw the same countries and still be different files, so an
   * agreeing list is no proof the artefact was generated from what is imported.
   */
  if (BASEMAP_VINTAGE !== DATASET_RESOLUTION) {
    return (
      `src/basemap-coverage.ts décrit le millésime ${quoteCode(BASEMAP_VINTAGE)} et src/map/dataset.ts importe ` +
      `le ${quoteCode(DATASET_RESOLUTION)} : lance ${quoteCode(REGENERATE_COMMAND)}.`
    );
  }

  const missing = [...byCode.keys()].sort().filter((code) => !DRAWABLE_COUNTRY_CODES.has(code));
  const surplus = [...DRAWABLE_COUNTRY_CODES].sort().filter((code) => !byCode.has(code));

  if (missing.length === 0 && surplus.length === 0) {
    return undefined;
  }

  const differences = [
    missing.length === 0
      ? ""
      : `absents de la liste alors que la carte les dessine : ${missing.join(", ")}`,
    surplus.length === 0
      ? ""
      : `annoncés par la liste alors que la carte n'a pas leur forme : ${surplus.join(", ")}`,
  ].filter((part) => part !== "");

  return (
    `src/basemap-coverage.ts ne décrit plus ${quoteCode(DATASET_MODULE)} — ` +
    `${differences.join(" ; ")}. ` +
    `Ce fichier est généré : lance ${quoteCode(REGENERATE_COMMAND)}, relis le diff, et committe-le. ` +
    `Tant qu'il diverge, « npm run validate:content » refuse des pays que la carte sait dessiner, ` +
    `ou en laisse passer dont elle n'a aucune forme.`
  );
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
 *
 * **Both messages used to end on «relance `npm run validate:content`», and that
 * was the defect TIW-29 fixed.** Measured, on a trip declaring `XK`:
 *
 * ```
 * $ npm run validate:content   →  1 voyage validé …, aucun problème.   (exit 0)
 * $ npm run build              →  Error: le code pays « XK » … relance
 *                                 « npm run validate:content ».        (exit 1)
 * ```
 *
 * The author was sent in a circle by a message that named the wrong tool. The fix
 * is upstream — `src/content/validate.ts` now refuses such a code, with the file,
 * the line, the column and the field — and `package.json` runs it before every
 * `npm run build` through `prebuild`. So this text stops advertising a command as
 * the place to look and says what reaching it means instead: the gate was
 * bypassed. It is kept, and kept precise, because it is the last line of defence
 * for a `next build` run without its `prebuild` — `npx next build`, or a call from
 * inside another tool.
 */
function unknownCodeProblem(code: string): string {
  const upperCased = code.toUpperCase();

  if (upperCased !== code && NUMERIC_BY_ALPHA2.has(upperCased)) {
    return (
      `le code pays ${quoteCode(code)} n'est pas reconnu parce qu'il n'est pas en majuscules : ` +
      `écris-le ${quoteCode(upperCased)}. La norme ISO 3166-1 alpha-2 est en capitales, et ` +
      `« countryCode » est comparé caractère pour caractère. ${bypassNote()}`
    );
  }

  return (
    `le code pays ${quoteCode(code)} n'est attribué à aucun pays par l'ISO 3166-1 alpha-2 : ` +
    `la carte n'a donc aucune forme à lui associer. ` +
    `Corrige le champ « countryCode » du lieu concerné dans content/. ${bypassNote()}`
  );
}

/**
 * Why this message is a surprise, and where the same fault is named properly.
 *
 * Not «relance la commande» but «la commande a été contournée»: since TIW-29
 * `npm run validate:content` refuses both faults above, naming the file, the line
 * and the field, and `prebuild` runs it before any `npm run build`. A reader of
 * this line is therefore looking at a build that skipped it.
 */
function bypassNote(): string {
  return (
    `« npm run validate:content » nomme ce défaut avec son fichier, sa ligne et son champ, et ` +
    `il tourne avant tout « npm run build » (script « prebuild ») : si tu lis ce message, ` +
    `c'est que le build a été lancé sans lui.`
  );
}

/**
 * A real country the map cannot draw at this resolution. Very different news
 * from the above: nothing is misspelled, and the author has a budget decision to
 * make rather than a typo to fix — so the way out is spelled out, with its cost.
 *
 * **Two ways out, not one, and which applies is measured rather than assumed.**
 * Of the 75 assigned codes the 110m vintage cannot draw, 64 are drawn by a finer
 * vintage of the same package and 11 are drawn by none of them — BQ, BV, CC, CX,
 * GF, GP, MQ, RE, SJ, TK, YT. Offering "switch vintage" for Martinique would be
 * offering 152 KB of paths that still would not draw it, which is the same shape
 * of dead end TIW-29 fixed one layer up. `FINER_VINTAGE_COUNTRY_CODES` is what
 * tells the two apart.
 *
 * **And since TIW-30 this message carries {@link bypassNote} too.** It used not
 * to, correctly: at the time no earlier gate refused this fault, so there was no
 * bypass to report. `src/content/validate.ts` now refuses it with the file, the
 * line and the field, and `prebuild` runs that before every `npm run build` — so
 * a reader of this sentence is, again, looking at a build that skipped its gate.
 */
function undrawableCodeProblem(code: string, numeric: string, locale: string): string {
  const label = regionNamesFor(locale).of(code) ?? code;

  const wayOut = FINER_VINTAGE_COUNTRY_CODES.has(code)
    ? `Trois issues : rattache le lieu à un pays que la carte sait dessiner, retire-le du contenu, ` +
      `ou fais passer src/map/dataset.ts sur ${quoteCode(RICHER_DATASET_MODULE)}, déjà livré par le paquet et qui contient ce pays. ` +
      `Cette dernière option porte les tracés de 30,1 Ko à 182,5 Ko brotli (mesuré, voir le commentaire de src/map/dataset.ts) : ` +
      `c'est une décision de budget, et le plafond de 34 Ko du test de poids la refusera tant qu'il n'est pas relevé sciemment.`
    : `Changer de millésime n'y ferait rien : aucun des millésimes livrés par world-atlas ` +
      `(${DATASET_RESOLUTION}, ${FINER_BASEMAP_VINTAGES.join(", ")}) ne porte de forme pour ce code. ` +
      `Deux issues : rattache le lieu à un pays que la carte sait dessiner, ou retire-le du contenu.`;

  return (
    `le pays ${quoteCode(label)} (code ${quoteCode(code)}, ISO 3166-1 numérique ${numeric}) existe, ` +
    `mais le fond de carte ${quoteCode(DATASET_MODULE)} en résolution ${DATASET_RESOLUTION} ne le contient pas : ` +
    `aucun micro-État n'y figure — ni Singapour, ni Monaco, ni Malte, ni Saint-Marin. ` +
    `${wayOut} ${bypassNote()}`
  );
}

/* --- The same two failures, for a code that came from the wishlist (TIW-39). --

   Two wordings and not one parametrised sentence, and the duplication is the
   decision rather than the accident. `src/content/loader.ts` states the principle
   this follows — «where the wording is user-visible it is copied verbatim rather
   than rephrased: the same rule seen twice must not read as two different rules» —
   and the rule *is* the same here: a code no country bears, and a code no shape
   exists for. What differs is everything the reader has to do about it. A trip's
   code is one field of one place among many, and the fixes are "correct the
   field", "detach the place", "change vintage"; a wishlist's code is a whole line
   whose only content is that code, and the only fix is to correct or delete it.
   Folding both into one sentence produced "rattache le lieu à un pays" for a file
   that has no lieux, which is worse than either. -------------------------------- */

/** A wished code ISO 3166-1 assigns to nobody: a typo, or a retired code. */
function wishedUnknownCodeProblem(code: string): string {
  const upperCased = code.toUpperCase();

  if (upperCased !== code && NUMERIC_BY_ALPHA2.has(upperCased)) {
    return (
      `le code pays ${quoteCode(code)} de ${quoteCode(WISHLIST_DISPLAY_PATH)} n'est pas reconnu parce qu'il n'est pas ` +
      `en majuscules : écris-le ${quoteCode(upperCased)}. La norme ISO 3166-1 alpha-2 est en capitales, et les codes ` +
      `sont comparés caractère pour caractère. ${bypassNote()}`
    );
  }

  return (
    `le code pays ${quoteCode(code)}, déclaré dans ${quoteCode(WISHLIST_DISPLAY_PATH)}, n'est attribué à aucun pays ` +
    `par l'ISO 3166-1 alpha-2 : la carte n'a donc aucune forme à teinter. ` +
    `Écris les deux lettres majuscules que la norme attribue au pays (${quoteCode("HR")} pour la Croatie), ` +
    `ou retire la ligne. ${bypassNote()}`
  );
}

/** A real country the shipped vintage draws no shape for, wished rather than visited. */
function wishedUndrawableCodeProblem(code: string, numeric: string, locale: string): string {
  const label = regionNamesFor(locale).of(code) ?? code;

  const wayOut = FINER_VINTAGE_COUNTRY_CODES.has(code)
    ? `Deux issues : retire ce pays de ${quoteCode(WISHLIST_DISPLAY_PATH)}, ou fais passer src/map/dataset.ts sur ` +
      `${quoteCode(RICHER_DATASET_MODULE)}, déjà livré par le paquet et qui contient ce pays. Cette dernière option porte ` +
      `les tracés de 182,6 à 512,6 Kio brotli (mesuré, voir le commentaire de src/map/dataset.ts) : c'est une décision ` +
      `de budget, et le plafond du test de poids la refusera tant qu'il n'est pas relevé sciemment.`
    : `Changer de millésime n'y ferait rien : aucun de ceux que world-atlas livre ` +
      `(${DATASET_RESOLUTION}, ${FINER_BASEMAP_VINTAGES.join(", ")}) ne porte de forme pour ce code. ` +
      `Une seule issue : retire ce pays de ${quoteCode(WISHLIST_DISPLAY_PATH)}.`;

  return (
    `le pays ${quoteCode(label)} (code ${quoteCode(code)}, ISO 3166-1 numérique ${numeric}), souhaité dans ` +
    `${quoteCode(WISHLIST_DISPLAY_PATH)}, existe — mais le fond de carte ${quoteCode(DATASET_MODULE)} en résolution ` +
    `${DATASET_RESOLUTION} n'en porte aucune forme : il n'y a rien à teinter. ${wayOut} ${bypassNote()}`
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
