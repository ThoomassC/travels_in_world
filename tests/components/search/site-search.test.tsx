import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildSearchEntries, normaliseForSearch } from "@/components/search/entries";
import { SearchIndex } from "@/components/search/search-index";
import { SiteSearch, foldQuery } from "@/components/search/site-search";

/**
 * The header's search, from the outside.
 *
 * **What this file can and cannot see.** jsdom lays nothing out, so the panel's
 * position, the scrolling and the focus ring are not here — `tests/e2e` owns
 * those. What it *can* see is everything that decides whether the thing works:
 * which rows are hidden, where the focus went, what the count says, and whether
 * the script-less markup is a usable list of links. All four are properties of the
 * DOM, and all four are what a keystroke actually changes.
 *
 * The index is built with the real `buildSearchEntries` rather than hand-written
 * rows: a fixture of fake `data-haystack` values would let the filter pass while
 * the two halves disagreed about what a haystack contains, which is precisely the
 * seam this component has.
 */

const LABELS = {
  open: "Rechercher",
  field: "Rechercher dans le carnet",
  placeholder: "Un voyage, un lieu, un pays…",
  resultsNone: "Aucun résultat.",
  resultsOne: "1 résultat.",
  resultsMany: "{count} résultats.",
};

const GROUPS = {
  listLabel: "Destinations du carnet",
  groups: { trips: "Voyages", places: "Lieux", countries: "Pays", pages: "Pages" },
};

const TRIPS = [
  {
    slug: "crete-2025",
    title: "Crète",
    startDate: "2025-08-01",
    story: "unwritten" as const,
    places: [{ name: "Héraklion", countryCode: "GR" }],
    photos: [],
    tags: [],
  },
  {
    slug: "les-sables-2023",
    title: "Les Sables-d’Olonne",
    startDate: "2023-07-01",
    story: "written" as const,
    places: [{ name: "Les Sables-d’Olonne", countryCode: "FR" }],
    photos: [{ alt: "Le remblai au petit matin" }],
    tags: ["velo"],
  },
];

const ENTRIES = buildSearchEntries({
  trips: TRIPS,
  labels: { countryName: (code) => (code === "FR" ? "France" : "Grèce"), compare: (a, b) => a.localeCompare(b, "fr") },
  tripHref: (slug) => `/fr/voyages/${slug}`,
  tripEntryHref: (slug) => `/fr/voyages#voyage-${slug}`,
  countriesHref: "/fr/voyages",
  placesHref: "/fr/villes",
  pages: [{ label: "À propos", href: "/fr/a-propos" }],
});

function renderSearch() {
  return render(
    <SiteSearch labels={LABELS}>
      <SearchIndex entries={ENTRIES} labels={GROUPS} />
    </SiteSearch>
  );
}

/** The rows a reader can actually see — `hidden` is how the filter works. */
const visibleRows = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("[data-haystack]")].filter((row) => !row.hidden);

/**
 * `fireEvent` and not `@testing-library/user-event`, which this repository does
 * not have and which is not worth a dependency for four gestures. The difference
 * that matters here is that `user-event` dispatches a full keystroke sequence and
 * `fireEvent` dispatches one event — so a `type()` becomes an explicit `change`,
 * which is what a controlled input reads anyway.
 *
 * Opening the panel: `<details>` in jsdom does not toggle on a click of its
 * summary the way a browser does, so the `toggle` event is dispatched directly
 * after setting `open`. The end-to-end suite is where the real gesture is
 * exercised.
 */
function openPanel(container: HTMLElement) {
  const details = container.querySelector("details") as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle", { bubbles: false }));
  return details;
}

/**
 * Press a key **where the reader's focus is**, and let it bubble.
 *
 * The handler is on the panel, and a `keydown` dispatched on the `<details>`
 * never reaches it — an event goes up, not down. The first version of these cases
 * did exactly that and reported "the focus did not move" when nothing had been
 * pressed at all.
 */
const press = (key: string) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key });

const typeQuery = (value: string) =>
  fireEvent.change(screen.getByLabelText(LABELS.field), { target: { value } });

describe("the script-less panel", () => {
  /**
   * The half that matters most and the half nothing else checks: with no script,
   * the disclosure opens onto a complete list of real links. Asserted on the
   * markup the server produced, before any interaction.
   */
  it("is a complete list of real links, before anything is typed", () => {
    const { container } = renderSearch();

    const links = container.querySelectorAll("a[href]");

    expect(links).toHaveLength(ENTRIES.length);
    // Every one addresses something, and none is a placeholder.
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^\/fr/);
    }
  });

  it("carries no tabindex, so Tab alone walks it", () => {
    const { container } = renderSearch();

    expect(container.querySelector("a[tabindex]")).toBeNull();
  });

  /**
   * Each group names the list under it — through `aria-labelledby`, and **not**
   * with a heading. The search is in the header, so a heading here would come
   * before the page's `<h1>` and make every document's outline start at level 2:
   * measured, five cases of `tests/e2e/heading-order.populated.spec.ts` at once.
   */
  it("names each group's list, without putting a heading in the document", () => {
    const { container } = renderSearch();

    for (const name of ["Voyages", "Lieux", "Pays", "Pages"]) {
      expect(screen.getByRole("list", { name })).toBeInTheDocument();
    }

    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0);
  });

  /**
   * An untold trip has no page, so its row addresses its entry in the listing.
   * The same rule the map's markers follow — and the reason a search built from
   * `hasStory` cannot put a 404 in the chrome of every document.
   */
  it("sends an untold trip to its entry and a told one to its page", () => {
    renderSearch();

    expect(screen.getByRole("link", { name: /^Crète/ })).toHaveAttribute(
      "href",
      "/fr/voyages#voyage-crete-2025"
    );
    expect(
      screen.getAllByRole("link", { name: /Sables/ })[0]
    ).toHaveAttribute("href", "/fr/voyages/les-sables-2023");
  });
});

describe("filtering", () => {
  it("hides the rows that do not match, and keeps the ones that do", () => {
    const { container } = renderSearch();
    openPanel(container);

    typeQuery("crete");

    const shown = visibleRows(container).map((row) => row.textContent);
    expect(shown.some((text) => text?.includes("Crète"))).toBe(true);
    expect(shown.some((text) => text?.includes("Sables"))).toBe(false);
  });

  /**
   * The case the whole normalisation exists for: the carnet spells "Crète" and
   * the reader types "crete". Asserted here as well as in `entries.test.ts`,
   * because the two halves fold the query in two different files and this is the
   * only test that runs both.
   */
  it("finds an accented name from an unaccented query", () => {
    const { container } = renderSearch();
    openPanel(container);

    typeQuery("crete");

    expect(visibleRows(container).length).toBeGreaterThan(0);
  });

  /**
   * A trip is findable by things its row does not display — a place, a country, a
   * tag, the caption of a photograph. That is the entire reason the haystack is
   * built rather than read off the rendered text.
   */
  it("finds a trip by a caption its row does not show", () => {
    const { container } = renderSearch();
    openPanel(container);

    typeQuery("remblai");

    const shown = visibleRows(container).map((row) => row.textContent);
    expect(shown.some((text) => text?.includes("Sables"))).toBe(true);
  });

  it("hides a group whose every row was filtered out", () => {
    const { container } = renderSearch();
    openPanel(container);

    typeQuery("crete");

    /*
      "Crète" is a trip and "Héraklion" a place, so Pages has nothing left — and a
      heading over an empty list is what this refuses.

      Queried through the DOM and not through `getByRole`, because a hidden
      section is out of the accessibility tree and its heading with it: the role
      query would fail with "unable to find", which is the right outcome for the
      wrong reason and would keep passing if the section vanished entirely.
    */
    const sectionFor = (group: string) =>
      container.querySelector<HTMLElement>(`[data-group="${group}"]`);

    expect(sectionFor("trips")?.hidden).toBe(false);
    expect(sectionFor("pages")?.hidden).toBe(true);
    // And the heading really is the one that went with it.
    expect(sectionFor("pages")?.textContent).toContain("Pages");
  });

  it("says how many rows are left, and says it politely", () => {
    const { container } = renderSearch();
    openPanel(container);

    const status = screen.getByRole("status");
    typeQuery("crete");

    expect(status.textContent).toMatch(/résultat/);
    expect(status).toHaveAttribute("id", "site-search-count");
  });

  it("says so when nothing matches, rather than showing an empty panel", () => {
    const { container } = renderSearch();
    openPanel(container);

    typeQuery("reykjavik");

    expect(visibleRows(container)).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent(LABELS.resultsNone);
  });
});

describe("the keyboard", () => {
  /**
   * ArrowDown from the field lands on the first visible row — the real link, with
   * the real focus, which is what makes Enter, middle-click and Cmd-click behave
   * as links without this component implementing any of them.
   */
  it("moves the focus into the list and back out of it", () => {
    const { container } = renderSearch();
    openPanel(container);

    const field = screen.getByLabelText(LABELS.field);
    field.focus();

    press("ArrowDown");
    expect(document.activeElement?.tagName).toBe("A");

    // And up again from the first row returns to the field rather than wrapping to
    // the last: a list that loops has no end for a reader who cannot see it.
    press("ArrowUp");
    expect(document.activeElement).toBe(field);
  });

  it("walks only the rows the filter left visible", () => {
    const { container } = renderSearch();
    openPanel(container);

    const field = screen.getByLabelText(LABELS.field);
    field.focus();
    typeQuery("crete");
    press("ArrowDown");

    expect(document.activeElement?.textContent).toContain("Crète");
  });

  it("closes on Escape and gives the focus back to what opened it", () => {
    const { container } = renderSearch();
    openPanel(container);

    expect(container.querySelector("details")?.open).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(container.querySelector("details")?.open).toBe(false);
    expect(document.activeElement?.tagName).toBe("SUMMARY");
  });
});

/**
 * **THE SEAM.** `foldQuery` in the client component is a four-line copy of
 * `normaliseForSearch` in the pure module, because importing the module would drag
 * the index builder and its `@/domain` dependency across the client boundary.
 *
 * A duplication is acceptable in this repository only when something refuses to
 * let it drift. This is that thing: the same inputs, through both spellings, must
 * give the same words — and the inputs are the ones that actually differ between
 * naive implementations.
 */
describe("the client's query folding matches the server's", () => {
  it.each([
    "Crète",
    "Les Sables-d’Olonne",
    "Les Sables-d'Olonne",
    "  GAND   et Bruges ",
    "Málaga",
    "!?-'",
    "",
    "sables france",
  ])("folds %j the same way on both sides of the boundary", (input) => {
    expect(foldQuery(input).join(" ")).toBe(normaliseForSearch(input));
  });
});

describe("the index the server rendered", () => {
  it("gives each row a haystack that already carries what the label does not", () => {
    const { container } = renderSearch();

    const row = container.querySelector<HTMLElement>('[id^="q-t-les-sables"]');

    expect(row?.dataset.haystack).toContain("remblai");
    expect(row?.dataset.haystack).toContain("velo");
    expect(within(row as HTMLElement).getByRole("link").textContent).not.toContain("remblai");
  });
});
