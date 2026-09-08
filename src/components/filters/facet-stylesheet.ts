import { type FacetIndex } from "./facets";

/**
 * The rules that do the filtering. This is the whole feature: a radio button
 * changes which rules match, the browser hides what the choice does not keep, and
 * no JavaScript runs at any point.
 *
 * **Why the sheet is generated and not written by hand in a CSS Module.** A rule
 * has to name a token, and the tokens are a function of the content: a static
 * sheet would need either one rule per country of ISO 3166 and per year the
 * journal might ever hold, or an indirection through numbered slots — `f0`, `f1`
 * — with an arbitrary ceiling and a table nobody can read in devtools. What is
 * generated here is exactly the rules the content needs, named after the values a
 * reader can see, and it grows with the journal instead of being capped by it.
 *
 * Everything that does not depend on the content — the layout of the control, the
 * pills, the focus, the count line's resting state — is in
 * `facet-filter.module.css`, where the rest of this project's styling lives.
 *
 * **On printing CSS into the document.** `<style>` is a raw-text element, so
 * React writes its text verbatim: measured on this repository's react-dom,
 * `renderToStaticMarkup` prints `[data-facets~="country-FR"]` with its quotation
 * marks intact rather than as `&quot;`. That is what makes this readable rather
 * than a stream of escapes — and it is asserted in
 * `tests/components/filters/facet-filter.test.tsx`, because if a future React
 * escaped the quotes the sheet would parse to nothing and every filter on the
 * site would go on showing everything, in silence. The other half of the same
 * safety is `SAFE_TOKEN_PART` in `./facets.ts`: no token can carry a `<`, an `&`
 * or a `</style`, so there is nothing here to escape in the first place.
 */

/**
 * Minified deliberately — no newlines, no spaces around braces. It is machine
 * output that lands in the HTML of a page, on every route that filters, in three
 * locales; the readable version of it is this file and the selector a reader
 * meets in devtools, which is unaffected.
 */
export function facetStylesheet(scopeId: string, index: FacetIndex): string {
  return index.groups
    .flatMap((group) => group.facets)
    .flatMap(({ token }) => {
      const active = `#${scopeId}:has(input[value="${token}"]:checked)`;

      return [
        /*
          Two things go at once, because a group whose every entry is hidden must
          not leave its heading standing over nothing: a country section with no
          matching card, and — on a journal spanning several continents — the
          continent chapter above it. `:has()` reads the markup and not the
          painting, so a section hidden by the first half of this selector is
          still found by the second half of the one above it; that is why the
          group's test is "does it contain a matching entry" and never "is
          anything inside it still visible".
        */
        `${active} :is([data-facets]:not([data-facets~="${token}"]),` +
          `[data-facet-group]:not(:has([data-facets~="${token}"]))){display:none}`,
        /*
          And the one count line that belongs to this choice. The lines rest at
          `display: none` in the Module, so a document where no radio is checked —
          which nothing can produce, since the reset is checked at render — shows
          the unfiltered page rather than every line at once.
        */
        `${active} [data-facet-status="${token}"]{display:block}`,
      ];
    })
    .join("");
}
