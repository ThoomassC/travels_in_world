/**
 * The arithmetic behind the two listing filters: which choices a reader is
 * offered, how many entries each one keeps, and the token every entry carries so
 * that a stylesheet — and not a script — can hide the rest.
 *
 * **Why a filter of this site is CSS and not state.** Every route is prerendered
 * (invariant 1), so a `?pays=FR` page would have to be rendered on demand; and
 * the milestone's three `'use client'` boundaries are spent on things that are
 * genuinely interaction. What is left is what the platform already has: a group
 * of radio buttons, and `:has()` to read which one is on. It costs zero bytes of
 * JavaScript, it works with scripting off, and the keyboard behaviour — arrow
 * keys inside a radio group, the label as a target — comes from the browser
 * rather than from a key map somebody has to maintain.
 *
 * **One choice at a time, across every axis, and that is the design.** Every
 * radio of a page shares one `name`, so picking a year clears a country. Two
 * things follow, and both are the reason rather than a consequence:
 *
 * 1. **Every number stays true.** A choice's label says how many entries it
 *    keeps. Crossed with a second axis, that number would depend on the
 *    combination — "France (7)" would be a lie the moment "2024" was also on —
 *    and CSS cannot recompute it. One active choice means one number, always
 *    exact.
 * 2. **An empty result is unreachable rather than arbitrated.** A choice is only
 *    offered for a value the collection actually holds, so no choice can empty
 *    the page. That is the same move `holdsNoStory` and `freshestTrip` make with
 *    the two home-page banners, recorded in `AGENTS.md`: a state nobody can reach
 *    needs no screen and no rule of precedence.
 *
 * Pure — no React, no locale, no `Intl`, no URL — like `tallyVisitedPlaces` and
 * `buildCatalogue` beside it, so the cases that matter (a group with one value,
 * an entry in two values of one group, an entry in none) are cheap assertions
 * rather than renders.
 */

/** The choice that keeps everything: the group's reset, and its initial state. */
export const ALL_FACET = "all";

/**
 * One value an entry belongs to. `group` and `value` build the token; `label` is
 * what the reader sees and is resolved by the caller, which is the only layer
 * that knows a locale.
 */
export type FacetValue = {
  readonly group: string;
  /** Machine-side, and constrained — see {@link SAFE_TOKEN_PART}. */
  readonly value: string;
  readonly label: string;
};

/** An entry of the listing being filtered, reduced to what filtering needs. */
export type FacetedEntry = {
  /** The entry's identity — a trip's slug, a place's own key. Must be unique. */
  readonly key: string;
  readonly facets: readonly FacetValue[];
};

export type Facet = {
  /** `country-FR`. What the markup carries and the generated selector names. */
  readonly token: string;
  readonly value: string;
  readonly label: string;
  /** How many entries this choice keeps — exactly, because only one is ever on. */
  readonly count: number;
};

/** An axis of the filter: its identity, its `<legend>`, and how it is ordered. */
export type FacetGroupOrder = {
  readonly key: string;
  readonly legend: string;
  readonly compare: (left: Facet, right: Facet) => number;
};

export type FacetGroup = {
  readonly key: string;
  readonly legend: string;
  /** Never fewer than two: a single value is not a choice. */
  readonly facets: readonly Facet[];
};

export type FacetIndex = {
  /** In the order the caller declared them; empty when there is nothing to choose. */
  readonly groups: readonly FacetGroup[];
  /** Entry key to its space-separated tokens, `all` first. */
  readonly tokens: ReadonlyMap<string, string>;
  readonly total: number;
};

/**
 * **The alphabet a token may use, and it is a safety property rather than a
 * style rule.**
 *
 * A token is written verbatim into a generated selector inside a `<style>`
 * element. `<style>` is a raw-text element: a `<` or an `&` in it is a parse
 * error, and the sequence `</style` ends the sheet early — after which the rest
 * of the rules become text on the page. Refusing the character here, where a
 * token is minted, is what lets `facet-stylesheet.ts` print without escaping and
 * what makes that printing provable rather than trusted.
 *
 * Letters and digits only, which is what the two axes this project filters on
 * actually produce: `CountryCodeSchema` guarantees `[A-Z]{2}`, and a year is four
 * digits of a `PlainDate`. A value outside that is a content defect, and failing
 * the build names the trip rather than shipping a broken sheet.
 */
const SAFE_TOKEN_PART = /^[A-Za-z0-9]+$/;

/** `country` + `FR` — the one place a token is spelled. */
function tokenOf(facet: FacetValue): string {
  if (!SAFE_TOKEN_PART.test(facet.group) || !SAFE_TOKEN_PART.test(facet.value)) {
    throw new Error(
      `Refusing a facet value that cannot be written into a selector: ` +
        `group ${JSON.stringify(facet.group)}, value ${JSON.stringify(facet.value)}. ` +
        `Letters and digits only — see SAFE_TOKEN_PART in src/components/filters/facets.ts.`
    );
  }

  return `${facet.group}-${facet.value}`;
}

/** Alphabetical on the reader-facing label, in the caller's own collation. */
export function byLabel(
  compare: (left: string, right: string) => number
): (left: Facet, right: Facet) => number {
  return (left, right) => compare(left.label, right.label);
}

/**
 * Newest first. Comparison operators and never `localeCompare`, whose result
 * depends on the runtime's ambient locale data — the rule `collatorFor` states
 * for names holds here for years, where collation has nothing to add anyway.
 */
export function byValueDescending(left: Facet, right: Facet): number {
  if (left.value === right.value) return 0;

  return left.value < right.value ? 1 : -1;
}

/**
 * The choices, their counts, and each entry's tokens.
 *
 * **A group holding a single value is dropped.** Every entry has it, so picking
 * it changes nothing: it is the "filtre dont toutes les valeurs sauf une sont
 * vides" a listing must not offer. Dropped here rather than in each page, so both
 * pages drop it by the same rule and a journal that grows into a second country
 * gains the axis without anyone editing a page.
 *
 * **A duplicate key throws.** The tokens are a map keyed on the entry's identity,
 * so a second entry under one key would render with the first one's tokens — it
 * would be filtered by somebody else's countries, silently. The keys are primary
 * keys upstream (a trip's slug, a place's name-and-country pair), so this cannot
 * fire on content the façade accepts; it fires on a caller that built the wrong
 * key, which is worth a failed build.
 */
export function buildFacetIndex(
  entries: readonly FacetedEntry[],
  groups: readonly FacetGroupOrder[]
): FacetIndex {
  const tokens = new Map<string, string>();
  /** Token to its count and its labelling, in first-seen order per group. */
  const counted = new Map<string, { readonly facet: FacetValue; count: number }>();

  for (const entry of entries) {
    if (tokens.has(entry.key)) {
      throw new Error(`Duplicate facet entry key ${JSON.stringify(entry.key)}.`);
    }

    const own: string[] = [];

    for (const facet of entry.facets) {
      const token = tokenOf(facet);
      const existing = counted.get(token);

      if (existing === undefined) {
        counted.set(token, { facet, count: 1 });
      } else {
        existing.count += 1;
      }

      // A duplicate value on one entry — the same country declared twice — would
      // otherwise put the token in the attribute twice. `~=` would not care; a
      // reader of the markup would.
      if (!own.includes(token)) {
        own.push(token);
      }
    }

    tokens.set(entry.key, [ALL_FACET, ...own].join(" "));
  }

  const built = groups.flatMap((group) => {
    const facets = [...counted]
      .filter(([, { facet }]) => facet.group === group.key)
      .map(([token, { facet, count }]) => ({
        token,
        value: facet.value,
        label: facet.label,
        count,
      }))
      .sort(group.compare);

    return facets.length < 2 ? [] : [{ key: group.key, legend: group.legend, facets }];
  });

  return { groups: built, tokens, total: entries.length };
}
