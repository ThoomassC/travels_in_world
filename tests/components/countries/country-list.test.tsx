import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { CountryList } from "@/components/countries/country-list";
import type { CountryListEntry } from "@/components/countries/country-list";
import { defaultLocale, renderWithMessages } from "../trips/support";

/**
 * The list of visited countries, rendered from a literal.
 *
 * **It takes rows that are already resolved** — a name, a slug, two counts and an
 * outline — and it knows no façade: `@/map` is server-only and the content one is
 * too, so a component that reached either would be unrenderable here and would
 * pin the list to one page. That is the whole point of the shape: `/{locale}/pays`
 * renders it today and the home page's map can render the same rows tomorrow,
 * with no second spelling of a country row on this site.
 *
 * What it does own is the address. `slug` in, `href` out, built through
 * `localePathname(countryPath(...))` — invariant 2 of AGENTS.md is that no
 * internal URL is assembled outside `src/i18n/**`, and handing the component a
 * ready-made `href` would have moved that assembly to every caller.
 */

const FRANCE: CountryListEntry = {
  code: "FR",
  name: "France",
  slug: "france",
  tripCount: 7,
  placeCount: 7,
  outline: "M2,2L38,2L38,38Z",
};

const GREECE: CountryListEntry = {
  code: "GR",
  name: "Grèce",
  slug: "grece",
  tripCount: 1,
  placeCount: 1,
};

const list = (countries: readonly CountryListEntry[] = [FRANCE, GREECE]) =>
  renderWithMessages(<CountryList countries={countries} locale={defaultLocale} />);

describe("CountryList", () => {
  it("gives each country one link to its own page", () => {
    list();

    expect(screen.getByRole("link", { name: /France/ })).toHaveAttribute("href", "/fr/pays/france");
    expect(screen.getByRole("link", { name: /Grèce/ })).toHaveAttribute("href", "/fr/pays/grece");
  });

  /**
   * A screen reader announces a link and not its neighbours, so every fact of a
   * row lives inside the anchor — the same call, and the same argument, as the
   * rows of `/villes`.
   */
  it("puts the counts inside the link, where they are announced", () => {
    list();

    expect(screen.getByRole("link", { name: /France/ })).toHaveAccessibleName(
      "France 7 voyages, 7 villes"
    );
  });

  it("says a single trip and a single place in the singular", () => {
    list();

    expect(screen.getByRole("link", { name: /Grèce/ })).toHaveAccessibleName(
      "Grèce 1 voyage, 1 ville"
    );
  });

  /**
   * The rows are a list, so the number of countries is announced on entering
   * rather than discovered by scrolling. `role="list"` for the Safari/VoiceOver
   * reason recorded on the map's marker list: `list-style: none` strips the role,
   * and jsdom cannot see it.
   */
  it("is a list of as many items as there are countries", () => {
    list();

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  /**
   * The silhouette is an ornament beside a row that already says everything in
   * words, so it is `aria-hidden` — the same treatment the search's vignette and
   * the trip's mini-map get.
   */
  it("draws the outline it is given, and hides it from the accessibility tree", () => {
    const { container } = list([FRANCE]);
    const tile = container.querySelector("svg");

    expect(tile).toHaveAttribute("aria-hidden", "true");
    expect(tile?.querySelector("path")).toHaveAttribute("d", FRANCE.outline);
  });

  /**
   * A country the 50m dataset cannot draw loses its 40 px drawing and nothing
   * else — the asymmetry `countryTile` states: failing over an ornament would be
   * the wrong trade, and the row still says where the carnet went, in words.
   */
  it("renders no drawing at all for a country with no outline", () => {
    const { container } = list([GREECE]);

    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("link", { name: /Grèce/ })).toBeInTheDocument();
  });

  /**
   * Rendered in the order it is given. The ordering rule is `countryRows`', which
   * collates on the reader's own alphabet; a component that sorted as well would
   * be a second rule to disagree with the first.
   */
  it("keeps the order it is given rather than sorting again", () => {
    list([GREECE, FRANCE]);

    expect(screen.getAllByRole("link").map((link) => link.textContent?.slice(0, 5))).toEqual([
      "Grèce",
      "Franc",
    ]);
  });

  /**
   * No empty box: a page with nothing to list says so in its own words, which is
   * a sentence and a way out rather than an empty grid. Both index pages of this
   * site take the same branch.
   */
  it("renders nothing at all when there is no country", () => {
    const { container } = list([]);

    expect(container).toBeEmptyDOMElement();
  });
});
