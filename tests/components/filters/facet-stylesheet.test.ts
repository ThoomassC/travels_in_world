import { describe, expect, it } from "vitest";
import { facetStylesheet } from "@/components/filters/facet-stylesheet";
import { buildFacetIndex, byLabel } from "@/components/filters/facets";

/**
 * The rules that do the filtering — the whole feature, in CSS, so that the pages
 * stay prerendered and the browser downloads no JavaScript for them.
 *
 * They are generated rather than written by hand because a rule has to name a
 * token, and the tokens are a function of the content: a hand-written sheet would
 * need either one rule per country of ISO 3166 or an indirection through numbered
 * slots. What is asserted here is the shape of what is generated and, above all,
 * the alphabet it is generated from.
 */

const compare = (left: string, right: string) => left.localeCompare(right, "fr");

const index = buildFacetIndex(
  [
    { key: "a", facets: [{ group: "country", value: "FR", label: "France" }] },
    { key: "b", facets: [{ group: "country", value: "ES", label: "Espagne" }] },
  ],
  [{ key: "country", legend: "Pays", compare: byLabel(compare) }]
);

describe("facetStylesheet", () => {
  it("writes two rules per choice and none for the choice that keeps everything", () => {
    const css = facetStylesheet("trip-filter", index);

    // Two choices — Espagne, France — and nothing for `all`, which hides nothing.
    expect(css.match(/input\[value=/g) ?? []).toHaveLength(4);
    expect(css).not.toContain('value="all"');
  });

  it("hides the entries a choice does not keep, and the groups left holding none", () => {
    const css = facetStylesheet("trip-filter", index);

    expect(css).toContain(
      '#trip-filter:has(input[value="country-FR"]:checked) :is([data-facets]:not([data-facets~="country-FR"]),[data-facet-group]:not(:has([data-facets~="country-FR"]))){display:none}'
    );
  });

  it("reveals the one count line that belongs to the active choice", () => {
    const css = facetStylesheet("trip-filter", index);

    expect(css).toContain(
      '#trip-filter:has(input[value="country-ES"]:checked) [data-facet-status="country-ES"]{display:block}'
    );
  });

  it("is empty when there is nothing to choose between", () => {
    expect(facetStylesheet("trip-filter", buildFacetIndex([], []))).toBe("");
  });

  /**
   * The sheet is printed inside a `<style>` element, which is a raw-text element:
   * a `<` or an `&` in it is a parse error and a `</style` in it ends the sheet
   * early. `buildFacetIndex` refuses a value that could carry one — this is the
   * other half of that claim, asserted on the output rather than on the input.
   */
  it("prints nothing a `<style>` element cannot hold", () => {
    const css = facetStylesheet("trip-filter", index);

    expect(css).not.toMatch(/[<&]/);
    expect(css.length).toBeGreaterThan(0);
  });
});
