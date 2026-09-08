import type { ReactElement, ReactNode } from "react";
import styles from "./facet-filter.module.css";
import { facetStylesheet } from "./facet-stylesheet";
import { ALL_FACET, type Facet, type FacetIndex } from "./facets";

/**
 * The filter both listing pages wear: a group of radio buttons above the list,
 * and a generated stylesheet that hides what the active choice does not keep.
 *
 * **No `'use client'`, and that is the point of the whole design.** The three
 * boundaries the milestone has spent are the map's interaction, the photo viewer
 * and the header's search; this adds none. What a script would have done here the
 * platform already does — a radio group remembers which one is on, arrow keys
 * move between them, a `<label>` extends the target, and `:has()` reads the state
 * from CSS. `src/components/filters/facets.ts` carries the argument at length;
 * the short version is that a filter is a *selection*, not an interaction, and a
 * selection is what a form control is for.
 *
 * **One choice at a time, across every axis.** Every radio shares one `name`, so
 * picking a year clears a country. That keeps every count on every label exactly
 * true — a crossed pair would need a different number per combination, which CSS
 * cannot compute — and it makes an empty result unreachable, since a choice only
 * exists for a value the collection holds.
 *
 * **The labels arrive as strings and as functions**, the way `CatalogueLabels`
 * and `PlaceLabels` do next door: this component is shared by `/voyages` and
 * `/villes`, which count voyages and lieux, and neither the namespace nor the
 * locale is its business.
 */

export type FacetFilterProps = {
  /** The scope of the generated rules. Must be unique in the document. */
  readonly id: string;
  /** The radio group's `name` — one per page, since one choice is active at a time. */
  readonly name: string;
  /** The `<legend>` of the whole control: "Filtrer les voyages". */
  readonly legend: string;
  /** The reset choice's label: "Tous les voyages". Its count is `index.total`. */
  readonly allLabel: string;
  readonly index: FacetIndex;
  /** "7 voyages" — beside a choice, so a screen reader hears it on landing. */
  readonly countLabel: (count: number) => string;
  /** "7 voyages affichés" — the line under the control, once a choice is on. */
  readonly statusLabel: (count: number) => string;
  /** The listing itself. Its entries carry `data-facets`; its groups, `data-facet-group`. */
  readonly children: ReactNode;
};

function Option({
  id,
  name,
  token,
  label,
  count,
  countLabel,
}: {
  readonly id: string;
  readonly name: string;
  readonly token: string;
  readonly label: string;
  readonly count: number;
  readonly countLabel: (count: number) => string;
}): ReactElement {
  const inputId = `${id}-${token}`;

  return (
    <div className={styles.option}>
      {/*
        A visible, native radio button. Hiding it behind a styled pill is the
        usual move and it buys nothing here: the browser's own focus ring, its
        checked mark and its arrow-key navigation are exactly what this control
        needs, and every one of them would then have to be rebuilt — the same
        reasoning that made the photo viewer a `<dialog>` and the language menu a
        `<details>`.

        `defaultChecked` and never `checked`: there is no client boundary to hold
        state, so a controlled input would be an input the reader cannot change.
      */}
      <input
        className={styles.input}
        type="radio"
        id={inputId}
        name={name}
        value={token}
        defaultChecked={token === ALL_FACET}
      />
      {/*
        The count is inside the label, and that is what makes "how many are left"
        a guarantee rather than a hope: a screen reader announces a radio's own
        accessible name when focus lands on it. The status line below is the
        visible echo of the same number — and a live region that changes because
        an element was revealed is at the mercy of the implementation, so it is
        not what the promise rests on.

        The explicit space is load-bearing, the lesson `/villes` already paid for:
        whether two sibling flex items contribute a separator to an accessible
        name is up to the engine, and without it the name comes out "France7
        voyages".
      */}
      <label className={styles.label} htmlFor={inputId}>
        {label} <span className={styles.count}>{countLabel(count)}</span>
      </label>
    </div>
  );
}

export function FacetFilter({
  id,
  name,
  legend,
  allLabel,
  index,
  countLabel,
  statusLabel,
  children,
}: FacetFilterProps): ReactElement {
  /**
   * Nothing to choose between — an empty journal, or one country and one year —
   * and there is no control at all. A single button that cannot change anything
   * is worse than no filter: it is a promise the page does not keep.
   */
  if (index.groups.length === 0) {
    return <>{children}</>;
  }

  const facets: readonly Facet[] = index.groups.flatMap((group) => group.facets);

  return (
    <div id={id} className={styles.scope}>
      {/*
        `precedence` asks React to hoist this into the `<head>`, where a
        stylesheet belongs — a `<style>` in the body is tolerated by every parser
        and conforms to none. The rules are id-scoped, so their specificity puts
        them above the Modules whatever order they land in.

        What no unit test can see is whether the browser then *applies* them,
        which is the one thing that matters: `tests/e2e/filters.populated.spec.ts`
        picks a choice on a real build and counts what is left on the page.
      */}
      <style href={id} precedence="medium">
        {facetStylesheet(id, index)}
      </style>

      <fieldset className={styles.filter}>
        <legend className={styles.legend}>{legend}</legend>

        <div className={styles.options}>
          <Option
            id={id}
            name={name}
            token={ALL_FACET}
            label={allLabel}
            count={index.total}
            countLabel={countLabel}
          />
        </div>

        {/*
          A nested `<fieldset>` per axis, so each one carries its own `<legend>`
          while the radios stay a single group. Nesting is what says "Pays" and
          "Année" are two readings of one choice rather than two independent
          controls — which is precisely the promise the shared `name` makes.
        */}
        {index.groups.map((group) => (
          <fieldset key={group.key} className={styles.axis}>
            <legend className={styles.axisLegend}>{group.legend}</legend>
            <div className={styles.options}>
              {group.facets.map((facet) => (
                <Option
                  key={facet.token}
                  id={id}
                  name={name}
                  token={facet.token}
                  label={facet.label}
                  count={facet.count}
                  countLabel={countLabel}
                />
              ))}
            </div>
          </fieldset>
        ))}
      </fieldset>

      {/*
        One line per choice, all of them at rest in `display: none`, the active
        one revealed by the generated sheet. The region is in the document from
        the first paint and empty — a live region created at the moment its text
        appears is a live region screen readers do not announce.

        There is no line for the reset: with everything shown, the page's own
        introduction already says how many there are, and "13 voyages affichés"
        under "13 voyages, groupés par continent" is the same number twice.
      */}
      <div className={styles.statuses} role="status">
        {facets.map((facet) => (
          <p key={facet.token} className={styles.status} data-facet-status={facet.token}>
            {statusLabel(facet.count)}
          </p>
        ))}
      </div>

      <div className={styles.listing}>{children}</div>
    </div>
  );
}
