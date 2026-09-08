import type { ReactElement } from "react";
import type { SearchArt, SearchEntry, SearchGroup } from "./entries";
import { TILE_VIEWBOX, tileSymbolId } from "./search-art";
import styles from "./site-search.module.css";

/**
 * The index itself, rendered by the **server** and handed to `./site-search.tsx`
 * as `children`.
 *
 * **This is the whole reason the search costs one payload and not two.** The
 * obvious design passes the entries to the client component as a prop, which
 * serialises every row into the flight payload of every document — and then
 * renders the same rows again as HTML. Handing over rendered nodes instead is the
 * pattern `MapViewport` already uses for its markers and its trip cards, and here
 * it means the index exists exactly once, as markup, in each document.
 *
 * **It is also the script-less experience, and that is not a consolation prize.**
 * With no JavaScript the field opens this on focus — a CSS disclosure, no script
 * involved — and it holds every trip, place, country and page of the site, as
 * real links, grouped, in reading order. A site index. Nothing about it depends on
 * the component above having mounted; that component only ever writes `hidden`
 * onto these rows.
 *
 * **`data-haystack` is the contract between the two halves**, and it is written
 * here because folding a string is `entries.ts`'s job, not a keystroke's. The
 * client reads the attribute and compares; it never re-derives what a row says.
 * `data-label` is the second half of that contract, and it exists for one
 * behaviour: the field's inline completion has to write a **display** name into
 * the input — "Crète", accents and capital — and the haystack is folded.
 */

export type SearchIndexLabels = {
  /** The heading over each family, in the panel's reading order. */
  readonly groups: Readonly<Record<SearchGroup, string>>;
};

export type CountryOutline = {
  /** ISO 3166-1 alpha-2, uppercase. */
  readonly code: string;
  /** The country's outline in a `0 0 40 40` box — `@/map`'s `countryTile`. */
  readonly path: string;
};

export type SearchIndexProps = {
  readonly entries: readonly SearchEntry[];
  readonly labels: SearchIndexLabels;
  /**
   * One outline per country the trips reach, **deduplicated by the caller**. Nine
   * of this carnet's thirteen trips are French; as one `<symbol>` referenced nine
   * times that is 658 bytes instead of six thousand, in the HTML of every document
   * on the site.
   */
  readonly countries: readonly CountryOutline[];
};

/** The four families, in the order `buildSearchEntries` emits them. */
const ORDER: readonly SearchGroup[] = ["trips", "places", "countries", "pages"];

/**
 * The countries, defined **once** per document and referenced by every row that
 * needs one.
 *
 * Nine of this carnet's thirteen trips are in France. Inline, that is nine copies
 * of the same outline in the chrome of every page; as a `<symbol>` and nine
 * `<use>` references it is one path and forty bytes a row. Measured on the five
 * countries the carnet reaches: 3.3 KB of outline against the panel's 24 KiB
 * ceiling in `tests/build/prerender.test.ts`, which is the reason the shape of
 * this matters at all.
 *
 * `width="0" height="0"` and `aria-hidden`: a definitions block draws nothing, and
 * without the two dimensions it still reserves a line box in the flow.
 */
function SearchArtDefs({ countries }: { readonly countries: readonly CountryOutline[] }) {
  if (countries.length === 0) {
    return null;
  }

  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className={styles.defs}>
      <defs>
        {countries.map((country) => (
          /*
            The symbol carries the same `viewBox` as the `<svg>` that references
            it, so the two coordinate spaces coincide and the dot — which is drawn
            in the referencing element, because it moves per trip — lands where
            the projection put it. A symbol with a different box would letterbox
            its contents and the dot would drift off the coast.
          */
          <symbol key={country.code} id={tileSymbolId(country.code)} viewBox={TILE_VIEWBOX}>
            <path d={country.path} />
          </symbol>
        ))}
      </defs>
    </svg>
  );
}

/**
 * A trip's vignette: its country, at the 50m vintage, with a dot on the town it
 * left from.
 *
 * **The state the dot shows is never the only channel that shows it.** It is the
 * accent when the récit is written and hollow in the secondary when it is not —
 * the map's own pair, chosen there because a difference of *shape* survives
 * greyscale and both themes. And it is a repetition either way: the row's second
 * line ends in the words "récit à venir". That is what let the pennant which used
 * to fly at the other end of the row go, when the owner asked for it.
 *
 * `aria-hidden`: it repeats, it does not inform.
 */
function TripArt({ art }: { readonly art: SearchArt }): ReactElement {
  return (
    <svg
      viewBox={TILE_VIEWBOX}
      aria-hidden="true"
      focusable="false"
      data-story={art.told ? "written" : "unwritten"}
    >
      <use href={`#${tileSymbolId(art.country)}`} />
      {/* The one thing in the vignette that moves: where in its country the trip
          left from. `@/map`'s `countryTile` places it, from the trip's first
          place — the point the world map anchors its own marker on. */}
      <circle cx={art.x} cy={art.y} r="2.4" />
    </svg>
  );
}

export function SearchIndex({ entries, labels, countries }: SearchIndexProps): ReactElement {
  return (
    /*
      A plain wrapper, and it used to carry an `aria-label` — which did nothing at
      all: a name on a `<div>` with no role is dropped by every implementation.
      The suggestions are named where they are also scrolled and focused, on
      `.searchResults` in `./site-search.tsx`, because those three have to be one
      element.
    */
    <div>
      <SearchArtDefs countries={countries} />
      {ORDER.map((group) => {
        const rows = entries.filter((entry) => entry.group === group);

        if (rows.length === 0) {
          return null;
        }

        const headingId = `site-search-group-${group}`;

        return (
          /*
            **`data-group` is what lets one heading disappear with its rows.**
            Filtering hides rows one by one, and a heading left standing over an
            empty list tells the reader there is something there. The client hides
            the whole section instead, which is one decision rather than one per
            heading — and it can only do that if the heading and its list are one
            box.
          */
          <section key={group} className={styles.searchGroup} data-group={group}>
            {/*
              **A `<p>` and not a heading, and this cost a rendering.**

              The search lives in the header, so anything it renders comes BEFORE
              the page's `<h1>` in the document. As `<h2>` these four labels made
              the first heading of every page a level 2 — measured, five cases of
              `tests/e2e/heading-order.populated.spec.ts` went red at once, on
              `/fr`, `/fr/voyages`, `/fr/a-propos`, a trip page and the map with
              its panel open.

              And they were never document structure: they name a group inside a
              widget, not a section of the page. `aria-labelledby` on the list
              below gives them the only job they have — naming what follows — with
              no outline to disturb.
            */}
            <p id={headingId} className={styles.searchGroupHeading}>
              {labels.groups[group]}
            </p>
            {/*
              `role="list"` is redundant markup that is not redundant in practice:
              `list-style: none` strips the list role in Safari with VoiceOver, and
              a list that has lost its role has also lost its item count. The same
              note is on the map's marker list and on the nav; jsdom keeps the role
              either way, so no unit test can see it.
            */}
            <ul className={styles.searchList} role="list" aria-labelledby={headingId}>
              {rows.map((entry) => (
                <li key={entry.id} id={entry.id} data-haystack={entry.haystack}>
                  {/*
                    A real link with a real `href`, and **no `tabindex`**. The
                    component above moves focus with the arrow keys, but it does so
                    by focusing these elements rather than by taking them out of
                    the tab order — which is what keeps the script-less panel
                    walkable with Tab alone.

                    **No class on any of this**, which is deliberate and measured:
                    the stylesheet reaches these from `.searchList` down, and the
                    note above that block counts what the class names were costing
                    in the HTML of every document. `data-illustrated` and
                    `data-label` earn their bytes — the first is the one bit of
                    shape a row varies by, the second is read by the client's
                    inline completion.
                  */}
                  <a href={entry.href} data-illustrated={entry.art === undefined ? undefined : ""}>
                    {entry.art === undefined ? null : <TripArt art={entry.art} />}
                    <span>
                      {/* `data-label` is read by the inline completion, which needs
                          the display spelling and not the folded haystack. */}
                      <span data-label>{entry.label}</span>
                      {/*
                        The second line — a year, a country, a count of étapes.
                        Rendered only when there is one, because an empty `<span>`
                        between two flex items is a gap the reader reads as a
                        missing value.
                      */}
                      {entry.detail === "" ? null : (
                        <span>{entry.detail}</span>
                      )}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
