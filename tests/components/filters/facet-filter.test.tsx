import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { FacetFilter } from "@/components/filters/facet-filter";
import { buildFacetIndex, byLabel, byValueDescending } from "@/components/filters/facets";
import { renderWithMessages } from "../trips/support";

/**
 * The control itself: a group of radio buttons, a `<fieldset>` per axis, and no
 * line of JavaScript anywhere in it.
 *
 * **One choice at a time, and that is the decision the whole component rests
 * on.** Every radio shares one `name`, so picking a year clears a country. It
 * buys two things CSS alone cannot give back: every count on every label is
 * *exactly* the number of entries that choice leaves — with two axes crossed, a
 * label would have to say a different number per combination — and an empty
 * result becomes unreachable rather than arbitrated, since a choice is only ever
 * offered for a value the collection actually holds.
 */

const compare = (left: string, right: string) => left.localeCompare(right, "fr");

const index = buildFacetIndex(
  [
    {
      key: "a",
      facets: [
        { group: "country", value: "FR", label: "France" },
        { group: "year", value: "2024", label: "2024" },
      ],
    },
    {
      key: "b",
      facets: [
        { group: "country", value: "FR", label: "France" },
        { group: "year", value: "2023", label: "2023" },
      ],
    },
    {
      key: "c",
      facets: [
        { group: "country", value: "ES", label: "Espagne" },
        { group: "year", value: "2023", label: "2023" },
      ],
    },
  ],
  [
    { key: "country", legend: "Pays", compare: byLabel(compare) },
    { key: "year", legend: "Année", compare: byValueDescending },
  ]
);

const props = {
  id: "trip-filter",
  name: "trip-filter",
  legend: "Filtrer les voyages",
  allLabel: "Tous les voyages",
  index,
  countLabel: (count: number) => `${count} voyages`,
  statusLabel: (count: number) => `${count} voyages affichés`,
} as const;

const filter = (overrides: Partial<Parameters<typeof FacetFilter>[0]> = {}) =>
  renderWithMessages(
    <FacetFilter {...props} {...overrides}>
      <p>la liste</p>
    </FacetFilter>
  );

describe("FacetFilter — a group of radio buttons and nothing else", () => {
  it("names the whole control, and each axis inside it", () => {
    filter();

    expect(screen.getByRole("group", { name: "Filtrer les voyages" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Pays" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Année" })).toBeInTheDocument();
  });

  it("puts every choice in one radio group, so exactly one can be active", () => {
    filter();

    const radios = screen.getAllByRole("radio");

    expect(radios).toHaveLength(5);
    expect(new Set(radios.map((radio) => radio.getAttribute("name")))).toEqual(
      new Set(["trip-filter"])
    );
  });

  it("starts on the choice that keeps everything", () => {
    filter();

    const checked = screen
      .getAllByRole("radio")
      .filter((radio) => (radio as HTMLInputElement).checked);

    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAttribute("value", "all");
  });

  /**
   * The count is inside the label and not only in the status line below, and that
   * is what makes "combien il reste" a guarantee rather than a hope: a screen
   * reader announces a radio's own accessible name when it lands on it, whereas a
   * live region that changes because an element was revealed is at the mercy of
   * the implementation.
   */
  it("says on each choice how many entries it keeps", () => {
    filter();

    expect(screen.getByRole("radio", { name: "France 2 voyages" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Espagne 1 voyages" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "2023 2 voyages" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tous les voyages 3 voyages" })).toBeInTheDocument();
  });

  it("holds one count line per choice, in a live region that starts empty", () => {
    filter();

    const status = screen.getByRole("status");

    expect(status.querySelector('[data-facet-status="country-FR"]')).toHaveTextContent(
      "2 voyages affichés"
    );
    // Four choices, four lines — the CSS shows the one that matches, and `all`
    // has none because the page's own introduction already carries that number.
    expect(status.querySelectorAll("[data-facet-status]")).toHaveLength(4);
  });

  it("renders the listing it wraps, untouched", () => {
    filter();

    expect(screen.getByText("la liste")).toBeInTheDocument();
  });

  /**
   * Nothing to choose between — one country, one year, or an empty journal — and
   * the control disappears entirely rather than offering a single button that
   * does nothing. The listing still renders.
   */
  it("renders no control at all when there is nothing to choose", () => {
    filter({ index: buildFacetIndex([], []) });

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("la liste")).toBeInTheDocument();
  });

  /**
   * **The rules reach the browser as written.** A `<style>` element is a raw-text
   * element and React leaves its text alone — measured on this repository's own
   * react-dom, `renderToStaticMarkup` prints `[data-facets~="country-FR"]` with
   * its quotation marks intact. If a future React escaped them the selector would
   * become `&quot;`, the sheet would parse to nothing, and every filter on the
   * site would silently keep showing everything. Client rendering never goes
   * through HTML at all, so only a server render can see this.
   */
  it("prints its stylesheet into the document without escaping it", () => {
    const markup = renderToStaticMarkup(
      <FacetFilter {...props}>
        <p>la liste</p>
      </FacetFilter>
    );

    expect(markup).toContain('[data-facets~="country-FR"]');
    expect(markup).not.toContain("&quot;");
  });
});
