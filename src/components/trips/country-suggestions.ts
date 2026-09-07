/**
 * What the listing's country search box matches on, and how.
 *
 * **This module imports nothing, and that is its entire reason for existing as a
 * file.** It is loaded by the server — which precomputes one row per visited
 * country — and by the `'use client'` box the reader types into. A shared leaf is
 * what guarantees the two fold « Pérou » by the same rule; the alternative, two
 * spellings of one fold, is the defect `countryListOf` in `./format.ts` records
 * paying for with two different renderings of "Bolivie, Pérou". And because the
 * leaf reaches neither the domain nor `@/map` nor `@/content`, importing it from
 * the client pulls none of them into the bundle — a property of the import graph
 * rather than a discipline three components have to keep.
 *
 * No `Intl` here either, unlike everything else in this folder: `Intl.Collator`
 * with `sensitivity: "base"` folds accents beautifully and answers a *comparison*,
 * not a substring — there is no collator API for "is this fragment somewhere
 * inside that string". So the folding is done once per name, by the server, and
 * the client compares two already-folded strings.
 */

/**
 * One country the reader can search for and jump to.
 *
 * Built by the page, which is the one place holding the content façade, the
 * locale and `@/i18n/paths`. Every field is a string the client renders or
 * compares as-is: nothing here is re-derived on the reader's machine.
 */
export type CountrySuggestion = {
  /**
   * ISO 3166-1 alpha-2. The React key of the row and nothing else — no href, no
   * label and no match is built from it, so a code the map cannot draw does not
   * become a second source of truth for anything a reader sees.
   */
  readonly code: string;
  /** « Japon » — localised by the server, and the only field {@link search} folds. */
  readonly name: string;
  /** The visible text of the link, count included, assembled by the server. */
  readonly label: string;
  /** Already prefixed with the locale by the page, per ADR 0003 on `mark.href`. */
  readonly href: string;
  /**
   * `foldForSearch(name)`, precomputed.
   *
   * Carried in the payload rather than folded on the fly because the fold is the
   * expensive half — a `normalize("NFD")` and two regex passes per name — and it
   * is the *names* that are many while the query is one. Sixty countries folded
   * once by the server beats sixty folds per keystroke.
   */
  readonly search: string;
};

/**
 * A name reduced to what a reader actually types: lowercase, unaccented, and
 * without the apostrophe.
 *
 * **The accents are the point.** « perou » has to find « Pérou », and a French
 * keyboard makes `é` no harder to type than `e` — it makes it easier to *forget*.
 *
 * **The apostrophe is a measured defect and not a nicety.**
 * `Intl.DisplayNames(["fr"], { type: "region" }).of("CI")` answers
 * `"Côte d’Ivoire"` with U+2019, the typographic apostrophe, while the key on the
 * reader's keyboard is U+0027. Folding accents alone leaves « cote d'ivoire »
 * matching nothing on the one name in the French table that has an apostrophe at
 * all. Both are removed rather than unified, which additionally lets
 * « cote divoire » match — strictly more permissive, and there is no name this
 * conflates with another.
 *
 * **What is deliberately NOT folded: the hyphen.** « royaume uni » does not find
 * « Royaume-Uni ». That is a different tolerance — separator-insensitivity — and
 * it is not the same bet: a hyphen is on every keyboard and is visible in the
 * name the reader is reading, where an ICU apostrophe is neither. Folding
 * separators also changes what a substring means, and « uni » finding
 * « Royaume-Uni » is the case that has to keep working.
 *
 * `\p{Diacritic}` over the decomposed form, so `ç`, `å` and `é` all go the same
 * way; a letter with no decomposition (`đ`) is left alone, and no French country
 * name has one.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/['’]/gu, "")
    .toLowerCase();
}

/**
 * The suggestions whose folded name holds the folded query, **in the order they
 * were given**.
 *
 * That order is the tally's, which `tallyVisitedCountries` collates by localised
 * name — so it is the reader's own alphabet, and re-ranking by match position
 * would replace an order they can predict with one only the code knows. There is
 * no scoring here for the same reason.
 *
 * **An empty query answers an empty list, deliberately.** The alternative — every
 * country — drops a sixty-row panel over the page the moment the box takes focus,
 * and no reader asked for that by not typing. Whitespace is treated as nothing
 * typed rather than as a query, because a lone space is a substring of
 * « Corée du Sud » and of half the table.
 */
export function filterSuggestions(
  suggestions: readonly CountrySuggestion[],
  query: string
): readonly CountrySuggestion[] {
  const folded = foldForSearch(query).trim();

  if (folded === "") {
    return [];
  }

  return suggestions.filter((suggestion) => suggestion.search.includes(folded));
}
