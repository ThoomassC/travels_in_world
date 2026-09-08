import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildSearchEntries, normaliseForSearch } from "@/components/search/entries";
import { SearchIndex } from "@/components/search/search-index";
import { SiteSearch, foldQuery } from "@/components/search/site-search";

/**
 * The header's search, from the outside.
 *
 * **What this file can and cannot see.** jsdom lays nothing out and applies none
 * of the CSS module, so the *disclosure* is not here at all: the panel opens on
 * `:focus-within`, which is a stylesheet rule, and `tests/e2e/search.populated.spec.ts`
 * is the only place that can watch it. What jsdom *can* see is everything that
 * decides whether the thing works: which rows are hidden, where the focus went,
 * what the field displays after a keystroke, what the count says, and whether the
 * script-less markup is a usable list of links.
 *
 * The index is built with the real `buildSearchEntries` rather than hand-written
 * rows: a fixture of fake `data-haystack` values would let the filter pass while
 * the two halves disagreed about what a haystack contains, which is precisely the
 * seam this component has.
 */

const LABELS = {
  field: "Rechercher dans le carnet",
  placeholder: "Un voyage, un lieu, un pays…",
  listLabel: "Destinations du carnet",
  resultsNone: "Aucun résultat.",
  resultsOne: "1 résultat.",
  resultsMany: "{count} résultats.",
};

const GROUPS = {
  groups: { trips: "Voyages", places: "Lieux", countries: "Pays", pages: "Pages" },
};

const TRIPS = [
  {
    slug: "crete-2025",
    title: "Crète",
    startDate: "2025-08-01",
    endDate: "2025-08-12",
    story: "unwritten" as const,
    steps: [{}, {}, {}],
    places: [{ name: "Héraklion", countryCode: "GR", coordinates: { lat: 35.3, lon: 25.1 } }],
    photos: [],
    tags: [],
  },
  {
    slug: "les-sables-2023",
    title: "Les Sables-d’Olonne",
    startDate: "2023-07-01",
    endDate: "2023-07-08",
    story: "written" as const,
    steps: [{}],
    places: [
      { name: "Les Sables-d’Olonne", countryCode: "FR", coordinates: { lat: 46.49, lon: -1.78 } },
    ],
    photos: [{ alt: "Le remblai au petit matin" }],
    tags: ["velo"],
  },
];

const ENTRIES = buildSearchEntries({
  trips: TRIPS,
  labels: {
    countryName: (code) => (code === "FR" ? "France" : "Grèce"),
    compare: (a, b) => a.localeCompare(b, "fr"),
    stepCount: (count) => `${count} étapes`,
    unwritten: "récit à venir",
  },
  tripHref: (slug) => `/fr/voyages/${slug}`,
  tripEntryHref: (slug) => `/fr/voyages#voyage-${slug}`,
  countriesHref: "/fr/voyages",
  placesHref: "/fr/villes",
  pages: [{ label: "À propos", href: "/fr/a-propos" }],
  /*
    A stand-in for `@/map`'s projection: this file is about the rendering, and the
    real Mercator lives behind a server-only façade. `tests/map/country-tile.test.ts`
    is where the geometry is tested, on real coastlines.
  */
  tilePointOf: ({ coordinates }) => ({ x: 20 + coordinates.lon, y: 20 - coordinates.lat / 10 }),
});

/** One outline per country the entries reach — what the layout deduplicates. */
const COUNTRIES = [
  { code: "GR", path: "M4,4L36,4L36,36L4,36Z" },
  { code: "FR", path: "M8,8L32,8L32,32Z" },
];

function renderSearch() {
  return render(
    <SiteSearch labels={LABELS}>
      <SearchIndex entries={ENTRIES} labels={GROUPS} countries={COUNTRIES} />
    </SiteSearch>
  );
}

/**
 * **Every role query here passes `hidden: true`, and that is a statement about
 * jsdom rather than about the markup.**
 *
 * `vitest.config.ts` sets `css: true`, so the real stylesheet is applied — and
 * `.searchPanel` is `display: none` until `:focus-within`. jsdom evaluates no
 * pseudo-class in `getComputedStyle`, so the panel is *permanently* closed as far
 * as this environment is concerned and Testing Library's default role query, which
 * skips anything hidden, finds nothing at all. The disclosure is therefore not
 * testable here at all; `tests/e2e/search.populated.spec.ts` owns it, in a browser
 * that has a `:focus-within`. What is asserted below is the content of the panel,
 * which is what this file is for.
 */
const role = <T extends HTMLElement>(...args: Parameters<typeof screen.getByRole>): T =>
  screen.getByRole(args[0], { ...args[1], hidden: true }) as T;

/** The rows a reader can actually see — `hidden` is how the filter works. */
const visibleRows = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("[data-haystack]")].filter((row) => !row.hidden);

const field = () => screen.getByLabelText(LABELS.field) as HTMLInputElement;

/**
 * `fireEvent` and not `@testing-library/user-event`, which this repository does
 * not have and which is not worth a dependency for four gestures.
 *
 * **`fireEvent.input` and not `.change`**, which is the one subtlety here: React's
 * `onChange` is the DOM's `input` event, and only `input` carries an `InputEvent`
 * with an `inputType`. The component reads that property to tell an insertion from
 * a deletion, because a completion offered while the reader is pressing Backspace
 * puts back the text they are deleting. A `change` would dispatch a plain `Event`
 * and the completion would silently never fire — which is exactly the sort of
 * green-for-the-wrong-reason this note exists to prevent.
 */
const type = (value: string, inputType = "insertText") => {
  const input = field();
  input.focus();
  fireEvent.input(input, { target: { value }, inputType });
};

/** Press a key **where the reader's focus is**, and let it bubble to the router. */
const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key });

describe("the script-less panel", () => {
  /**
   * The half that matters most and the half nothing else checks: with no script,
   * the field's `:focus-within` opens onto a complete list of real links. Asserted
   * on the markup the server produced, before any interaction.
   */
  it("is a complete list of real links, before anything is typed", () => {
    const { container } = renderSearch();

    const links = container.querySelectorAll("a[href]");

    expect(links).toHaveLength(ENTRIES.length);
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^\/fr/);
    }
  });

  /**
   * **The markup the server writes carries no `tabindex`**, which is the whole of
   * the script-less bargain: the panel is that reader's site index and Tab is
   * their only way through it.
   *
   * Rendered on its own, without the client component above, because that is the
   * DOM a browser with no script receives — `SiteSearch` takes the rows out of the
   * tab order on mount, and the case below is the other half of the same decision.
   */
  it("carries no tabindex as the server writes it, so Tab alone walks it", () => {
    const { container } = render(
      <SearchIndex entries={ENTRIES} labels={GROUPS} countries={COUNTRIES} />
    );

    expect(container.querySelector("a[tabindex]")).toBeNull();
  });

  /**
   * And with a script, the rows leave the tab order.
   *
   * PROVEN BY DELIBERATE FAILURE, and by a defect the end-to-end suite found on
   * the real build: `:focus-within` opens the panel, so Tab out of the field
   * walked into twenty-one suggestions before reaching the page — measured, and
   * `tests/e2e/map-equivalent.populated.spec.ts` stopped reaching the map's
   * markers within thirty presses:
   *
   *   npm run test:e2e:content -> 1 failed
   *     "Expected length: 5   Received length: 0   Received array: []"
   *
   * The arrows are how a reader with a script walks this list, and Enter in the
   * field follows the first row. Both are covered under "the keyboard" below.
   */
  it("takes the rows out of the tab order once a script is running", () => {
    const { container } = renderSearch();

    const links = [...container.querySelectorAll<HTMLAnchorElement>("[data-haystack] a")];

    expect(links).toHaveLength(ENTRIES.length);
    expect(links.every((link) => link.tabIndex === -1)).toBe(true);
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
      expect(role("list", { name })).toBeInTheDocument();
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

    expect(role("link", { name: /^Crète/ })).toHaveAttribute(
      "href",
      "/fr/voyages#voyage-crete-2025"
    );
    expect(screen.getAllByRole("link", { name: /Sables/, hidden: true })[0]).toHaveAttribute(
      "href",
      "/fr/voyages/les-sables-2023"
    );
  });

  /**
   * **The field is inside its own label**, which is what makes the whole pill
   * clickable with no script — and it matters most on a narrow bar, where the
   * input is zero pixels wide and the pill is all there is to aim at.
   */
  it("wraps the field in the label that names it", () => {
    renderSearch();

    expect(field().closest("label")).not.toBeNull();
    expect(field().labels?.[0]?.textContent).toContain(LABELS.field);
  });
});

/**
 * The illustrated rows — direction 5's suggestions, in direction 3's field.
 */
describe("what a trip's row draws", () => {
  const rowOf = (container: HTMLElement, id: string) =>
    container.querySelector<HTMLElement>(`[id^="${id}"]`);

  it("gives a trip a vignette and a place none", () => {
    const { container } = renderSearch();

    const trip = rowOf(container, "q-t-crete");
    const place = rowOf(container, "q-l-heraklion");

    expect(trip?.querySelectorAll("svg")).toHaveLength(1);
    expect(place?.querySelectorAll("svg")).toHaveLength(0);
  });

  /**
   * **Every row starts at the same left edge**, vignette or no vignette — the
   * owner read the panel and saw that the trips did not line up with the places
   * and the countries below them.
   *
   * Asserted on the grid rather than on a measured box: jsdom lays nothing out, so
   * a geometry assertion here would measure zero against zero. What can be checked
   * is that one template governs both shapes and that a plain row's text is placed
   * in the second column rather than the first.
   */
  it("puts every row's text in the same column, illustrated or not", () => {
    const { container } = renderSearch();

    const links = [...container.querySelectorAll<HTMLElement>("[data-haystack] a")];
    const templates = new Set(links.map((link) => getComputedStyle(link).gridTemplateColumns));

    expect(templates.size).toBe(1);
    expect([...templates][0]).toContain("2.5rem");

    const place = rowOf(container, "q-l-heraklion")?.querySelector<HTMLElement>("a > span");
    expect(getComputedStyle(place as HTMLElement).gridColumn).toBe("2");
  });

  /**
   * Both drawings repeat what the row already says, so both are out of the
   * accessibility tree. The state they carry is in the second line, in words.
   */
  it("hides the drawings from assistive technology and says the state in words", () => {
    const { container } = renderSearch();

    const trip = rowOf(container, "q-t-crete");

    for (const drawing of trip?.querySelectorAll("svg") ?? []) {
      expect(drawing.getAttribute("aria-hidden")).toBe("true");
    }
    expect(trip?.textContent).toContain("récit à venir");
  });

  it("marks the vignette with the story state, for the stylesheet", () => {
    const { container } = renderSearch();

    expect(
      rowOf(container, "q-t-les-sables")?.querySelector("[data-story]")?.getAttribute("data-story")
    ).toBe("written");
    expect(
      rowOf(container, "q-t-crete")?.querySelector("[data-story]")?.getAttribute("data-story")
    ).toBe("unwritten");
  });

  /**
   * The shape is defined once per document and referenced by every trip row. On a
   * carnet of sixty trips that is the difference between a panel that costs a
   * kilobyte and one that costs several — and the panel is in every document.
   */
  it("defines one outline per country and references it once per trip", () => {
    const { container } = renderSearch();

    expect(container.querySelectorAll("symbol")).toHaveLength(COUNTRIES.length);
    expect(container.querySelectorAll("use").length).toBe(TRIPS.length);
  });
});

describe("filtering", () => {
  it("hides the rows that do not match, and keeps the ones that do", () => {
    const { container } = renderSearch();

    type("crete");

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

    type("crete");

    expect(visibleRows(container).length).toBeGreaterThan(0);
  });

  /**
   * A trip is findable by things its row does not display — a place, a country, a
   * tag, the caption of a photograph. That is the entire reason the haystack is
   * built rather than read off the rendered text.
   */
  it("finds a trip by a caption its row does not show", () => {
    const { container } = renderSearch();

    type("remblai");

    const shown = visibleRows(container).map((row) => row.textContent);
    expect(shown.some((text) => text?.includes("Sables"))).toBe(true);
  });

  it("hides a group whose every row was filtered out", () => {
    const { container } = renderSearch();

    type("crete");

    /*
      "Crète" is a trip and "Héraklion" a place, so Pages has nothing left — and a
      heading over an empty list is what this refuses.

      Queried through the DOM and not through `getByRole`, because a hidden
      section is out of the accessibility tree and its heading with it.
    */
    const sectionFor = (group: string) =>
      container.querySelector<HTMLElement>(`[data-group="${group}"]`);

    expect(sectionFor("trips")?.hidden).toBe(false);
    expect(sectionFor("pages")?.hidden).toBe(true);
    expect(sectionFor("pages")?.textContent).toContain("Pages");
  });

  it("says how many rows are left, and says it politely", () => {
    renderSearch();

    const status = role("status");
    type("crete");

    expect(status.textContent).toMatch(/résultat/);
    expect(status).toHaveAttribute("id", "site-search-count");
  });

  it("says so when nothing matches, rather than showing an empty panel", () => {
    const { container } = renderSearch();

    type("reykjavik");

    expect(visibleRows(container)).toHaveLength(0);
    expect(role("status")).toHaveTextContent(LABELS.resultsNone);
  });

  /**
   * An empty query is not "no results", it is "no question". The panel goes back
   * to the whole index and the count goes back to saying nothing at all — which
   * is what a reader who has just cleared the field is looking at.
   */
  it("says nothing at all on an empty query, and shows every row again", () => {
    const { container } = renderSearch();

    type("crete");
    type("", "deleteContentBackward");

    expect(visibleRows(container)).toHaveLength(ENTRIES.length);
    expect(role("status")).toHaveTextContent("");
  });
});

/**
 * **The inline completion — direction 3's signature, and the one behaviour here
 * that writes into the control the reader is typing in.**
 *
 * A native completion and not a ghost element beside the field: the input holds
 * the whole label and the part past what was typed is *selected*, so the next
 * keystroke replaces it. A second box would have to be kept aligned with a
 * proportional face at every size; a selection is aligned by construction.
 */
describe("the inline completion", () => {
  it("completes to the first suggestion and selects what it added", () => {
    renderSearch();

    type("crè");

    expect(field().value).toBe("Crète");
    expect(field().selectionStart).toBe(3);
    expect(field().selectionEnd).toBe(5);
  });

  /** Accents included: the reader types "cre", the carnet answers "Crète". */
  it("completes across an accent the reader did not type", () => {
    renderSearch();

    type("cre");

    expect(field().value).toBe("Crète");
  });

  /**
   * **Never on a deletion**, and this is the case that keeps the control usable:
   * a completion offered while Backspace is held puts back the text the reader is
   * pressing the key to remove, and the field becomes impossible to clear.
   */
  it("does not complete while the reader is deleting", () => {
    renderSearch();

    type("crè");
    type("cr", "deleteContentBackward");

    expect(field().value).toBe("cr");
  });

  it("offers nothing when no label begins with what was typed", () => {
    renderSearch();

    // "remblai" matches a trip through a photograph's caption, so there IS a row
    // — but no label starts with it, and completing to one would be a lie about
    // what the field is going to do.
    type("remblai");

    expect(field().value).toBe("remblai");
  });

  it("offers nothing on an empty field", () => {
    renderSearch();

    type("");

    expect(field().value).toBe("");
  });
});

describe("the keyboard", () => {
  /**
   * ArrowDown from the field lands on the first visible row — the real link, with
   * the real focus, which is what makes Enter, middle-click and Cmd-click behave
   * as links without this component implementing any of them.
   */
  it("moves the focus into the list and back out of it", () => {
    renderSearch();

    field().focus();

    press("ArrowDown");
    expect(document.activeElement?.tagName).toBe("A");

    // And up again from the first row returns to the field rather than wrapping to
    // the last: a list that loops has no end for a reader who cannot see it.
    press("ArrowUp");
    expect(document.activeElement).toBe(field());
  });

  it("walks only the rows the filter left visible", () => {
    renderSearch();

    type("crete");
    press("ArrowDown");

    expect(document.activeElement?.textContent).toContain("Crète");
  });

  /**
   * **Enter in the field follows the first suggestion**, which is the promise the
   * completion makes: the field has just written a trip's name into itself, and
   * Enter has to go there.
   */
  it("follows the first suggestion on Enter in the field", () => {
    renderSearch();
    let followed: string | null = null;
    for (const link of screen.getAllByRole("link", { hidden: true })) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        followed ??= (event.currentTarget as HTMLAnchorElement).getAttribute("href");
      });
    }

    type("sables");
    press("Enter");

    expect(followed).toBe("/fr/voyages/les-sables-2023");
  });

  /**
   * Escape dismisses the suggestions and **leaves the caret where it is**. The
   * panel is opened by `:focus-within` in the stylesheet, so the only thing the
   * script can do — and the only thing it does — is write the attribute that
   * stylesheet reads.
   */
  it("dismisses the panel on Escape without taking the field's focus", () => {
    const { container } = renderSearch();

    type("crete");
    press("Escape");

    expect(container.firstElementChild).toHaveAttribute("data-dismissed");
    expect(document.activeElement).toBe(field());
  });

  it("brings the panel back on the next keystroke", () => {
    const { container } = renderSearch();

    type("crete");
    press("Escape");
    type("crete ");

    expect(container.firstElementChild).not.toHaveAttribute("data-dismissed");
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
    expect(
      within(row as HTMLElement).getByRole("link", { hidden: true }).textContent
    ).not.toContain("remblai");
  });

  /**
   * `data-label` is the second half of the contract between the server's index and
   * the client's field: the completion has to write a **display** name into the
   * input — accents, capitals — and the haystack is folded.
   */
  it("marks the display label, which is what the completion writes", () => {
    const { container } = renderSearch();

    const row = container.querySelector<HTMLElement>('[id^="q-t-crete"]');

    expect(row?.querySelector("[data-label]")?.textContent).toBe("Crète");
  });
});
