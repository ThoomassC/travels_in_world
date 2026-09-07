import type { ReactElement } from "react";
import type { SearchEntry, SearchGroup } from "./entries";
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
 * With no JavaScript the disclosure opens onto this: every trip, every place,
 * every country and every page of the site, grouped, in reading order, each a
 * real `<a href>`. A site index. Nothing about it depends on the component above
 * having mounted — that component only ever writes `hidden` onto these rows.
 *
 * **`data-haystack` is the contract between the two halves**, and it is written
 * here because folding a string is `entries.ts`'s job, not a keystroke's. The
 * client reads the attribute and compares; it never re-derives what a row says.
 */

export type SearchIndexLabels = {
  /** The heading over each family, in the panel's reading order. */
  readonly groups: Readonly<Record<SearchGroup, string>>;
  /** The list's accessible name — it is a list of destinations, not of words. */
  readonly listLabel: string;
};

export type SearchIndexProps = {
  readonly entries: readonly SearchEntry[];
  readonly labels: SearchIndexLabels;
};

/** The four families, in the order `buildSearchEntries` emits them. */
const ORDER: readonly SearchGroup[] = ["trips", "places", "countries", "pages"];

export function SearchIndex({ entries, labels }: SearchIndexProps): ReactElement {
  return (
    <div aria-label={labels.listLabel}>
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
                <li
                  key={entry.id}
                  id={entry.id}
                  className={styles.searchRow}
                  data-haystack={entry.haystack}
                >
                  {/*
                    A real link with a real `href`, and **no `tabindex`**. The
                    component above moves focus with the arrow keys, but it does so
                    by focusing these elements rather than by taking them out of
                    the tab order — which is what keeps the script-less panel
                    walkable with Tab alone.
                  */}
                  <a className={styles.searchLink} href={entry.href}>
                    <span className={styles.searchLabelText}>{entry.label}</span>
                    {/*
                      The second line — a year, a country. Rendered only when there
                      is one, because an empty `<span>` between two flex items is a
                      gap the reader reads as a missing value.
                    */}
                    {entry.detail === "" ? null : (
                      <span className={styles.searchDetail}>{entry.detail}</span>
                    )}
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
