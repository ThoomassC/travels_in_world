import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/i18n/messages/fr.json";
import { defaultLocale } from "@/i18n/routing";
import { WorldMap, type MapCountry, type WorldMapProps } from "@/components/map/world-map";
import type { TripMark } from "@/components/map/marks";

/**
 * The rendered map, queried the way a reader meets it: by accessible role and
 * accessible name. There is no `data-testid` and no snapshot in this repository,
 * and neither would help here — a snapshot of 177 `<path>` elements records the
 * dataset, not the behaviour.
 *
 * jsdom computes no layout: `getBBox`, `getScreenCTM` and `getComputedTextLength`
 * do not exist, so no assertion below is about pixels. What *is* assertable is
 * everything the server emitted — the `viewBox`, the custom properties carrying
 * each marker's position, the `href`s, the roles and the names — which is the
 * whole of this component's output, since it ships no JavaScript to change any
 * of it afterwards.
 */

/** The projected world, identical to production. */
const WORLD = { width: 960, height: 500 };

/**
 * The name is never drawn — a `<path>` inside an `aria-hidden` SVG has nothing
 * to say — but it is read for the visited countries, to name them in text under
 * the caption. Without that, which countries hold a trip is carried by the tint
 * alone, and the tint is a 1.16:1 distinction.
 */
const country = (code: string | null, name: string): MapCountry => ({
  code,
  name,
  // Shape irrelevant: the component copies `d` through and never reads it.
  path: "M0,0L10,0L10,10Z",
});

/**
 * Three entries with `code: null` on purpose. The 110m dataset leaves exactly
 * three territories unidentified, so `code` cannot be the React key — if it
 * were, these three would collide and two of the three paths would disappear
 * from the DOM. The path count assertions below are what catch that.
 */
const COUNTRIES: readonly MapCountry[] = [
  country("FR", "France"),
  country("JP", "Japon"),
  country("IS", "Islande"),
  country("CL", "Chili"),
  country(null, "Territoire non identifié A"),
  country(null, "Territoire non identifié B"),
  country(null, "Territoire non identifié C"),
];

function tripMark(index: number): TripMark {
  const slug = `voyage-${index}`;

  return {
    slug,
    title: `Voyage ${index}`,
    // Descending with the index, like the content façade's own order.
    startDate: `20${String(24 - (index % 20)).padStart(2, "0")}-06-01`,
    placeName: `Ville ${index}`,
    href: `/fr/voyages/${slug}`,
    // Scattered across the world box so that 60 markers really do frame the
    // whole world, rather than all landing on one pixel.
    point: { x: 40 + ((index * 13) % 880), y: 30 + ((index * 7) % 440) },
    /**
     * Written by default, so the sixty-marker cases read as they did before
     * TIW-18. Every untold marker below is built by spreading over this one and
     * saying `story: "unwritten"` at the call site.
     */
    story: "written",
  };
}

/** Dead centre of the world box, which makes the expected percentages exact. */
const CENTRED_MARK: TripMark = {
  slug: "japon-2024",
  title: "Japon 2024",
  startDate: "2024-04-12",
  placeName: "Tokyo",
  href: "/fr/voyages/japon-2024",
  point: { x: 480, y: 250 },
  story: "written",
};

/**
 * A trip whose récit is not written (TIW-18).
 *
 * Its `href` is what the page hands over for this state — the listing, at the
 * fragment of this trip's own entry — because its page does not exist. The
 * component renders `mark.href` as-is (ADR 0003), so the assertion below is that
 * the component does not *replace* it, which is exactly the mistake a
 * `tripPath(slug)` computed here would be.
 */
const UNTOLD_MARK: TripMark = {
  ...CENTRED_MARK,
  slug: "maroc-2026",
  title: "Maroc 2026",
  placeName: "Marrakech",
  href: "/fr/voyages#voyage-maroc-2026",
  story: "unwritten",
};

const SIXTY_MARKS: readonly TripMark[] = Array.from({ length: 60 }, (_, index) => tripMark(index));

/**
 * The expected accessible name, built from the catalogue rather than retyped:
 * this asserts that the component feeds the right two values into the right
 * message, and leaves the wording where it belongs.
 */
const linkName = (mark: TripMark): string =>
  frMessages.map.markLabel.replace("{title}", mark.title).replace("{place}", mark.placeName);

function renderMap(props: Partial<WorldMapProps> = {}) {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
      <WorldMap countries={COUNTRIES} visited={[]} marks={[]} world={WORLD} {...props} />
    </NextIntlClientProvider>
  );
}

function mapSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");

  if (svg === null) {
    throw new Error("the map rendered no <svg>");
  }

  return svg;
}

const viewBoxOf = (container: HTMLElement): string =>
  mapSvg(container).getAttribute("viewBox") ?? "";

/** The `<g>` layers, in paint order: background first, tinted second. */
const layersOf = (container: HTMLElement): readonly Element[] =>
  Array.from(mapSvg(container).querySelectorAll(":scope > g"));

describe("WorldMap", () => {
  describe("with no published trip", () => {
    it("frames the whole world", () => {
      const { container } = renderMap({ marks: [] });

      expect(viewBoxOf(container)).toBe("0 0 960 500");
    });

    it("renders no marker at all, and no empty list to announce", () => {
      renderMap({ marks: [] });

      expect(screen.queryAllByRole("link")).toHaveLength(0);
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    });

    it("still draws the countries and still states the count", () => {
      const { container } = renderMap({ marks: [] });

      expect(screen.getByRole("figure")).toBeInTheDocument();
      expect(container.querySelectorAll("path")).toHaveLength(COUNTRIES.length);
      expect(screen.getByText("Carte du monde : aucun voyage publié, aucun pays")).toBeVisible();
    });
  });

  describe("with a single published trip", () => {
    it("crops the frame instead of zooming without bound", () => {
      const { container } = renderMap({ marks: [CENTRED_MARK] });

      // 30 % of the world's width, the legibility floor `frameAround` applies to
      // a point-sized extent, normalised to the world's 960/500 ratio. A frame
      // as wide as the world would mean the crop never happened; a much narrower
      // one would mean a flat wash of one country's interior.
      expect(viewBoxOf(container)).toBe("336 175 288 150");
    });

    it("gives the container exactly the frame's aspect ratio", () => {
      const { container } = renderMap({ marks: [CENTRED_MARK] });
      const canvas = mapSvg(container).parentElement;

      /**
       * Asserted as a *relation* to the `viewBox`, not as literals: these are the
       * numbers that must never disagree, because the markers are positioned in
       * percentages of the container while the countries are drawn in percentages
       * of the drawing.
       *
       * Since TIW-14 the container's `aspect-ratio` is literally
       * `var(--frame-w) / var(--frame-h)` and those two properties are the very
       * values the `viewBox` is formatted from — the client component writes both
       * from one rounded viewport — so this is now an equality rather than an
       * approximation. That is what keeps the relation true at every zoom level
       * and not only at the frame the build chose.
       */
      const [x, y, width, height] = viewBoxOf(container).split(" ");
      expect(canvas?.style.getPropertyValue("--frame-x")).toBe(x);
      expect(canvas?.style.getPropertyValue("--frame-y")).toBe(y);
      expect(canvas?.style.getPropertyValue("--frame-w")).toBe(width);
      expect(canvas?.style.getPropertyValue("--frame-h")).toBe(height);
    });

    it("anchors the marker on its projected point, in world units", () => {
      const { container } = renderMap({ marks: [CENTRED_MARK] });

      const [item] = screen.getAllByRole("listitem");

      /**
       * **World units, not percentages** — the change TIW-14 made to this layer.
       * A percentage is a fraction of one particular frame, and the reader now
       * chooses the frame; the stylesheet re-derives the percentage from the four
       * `--frame-*` values on the canvas, which is what moves sixty markers on a
       * zoom without a byte of per-marker JavaScript.
       *
       * The mark sits at the centre of the world box, so it must come back out as
       * the centre of the frame: asserted as the arithmetic the CSS performs,
       * against the numbers really rendered, so any drift is caught wherever it
       * comes from.
       */
      expect(item?.style.getPropertyValue("--mark-x")).toBe(String(CENTRED_MARK.point.x));
      expect(item?.style.getPropertyValue("--mark-y")).toBe(String(CENTRED_MARK.point.y));

      const canvas = mapSvg(container).parentElement;
      const numberOf = (property: string) =>
        Number(canvas?.style.getPropertyValue(property) ?? Number.NaN);
      const markOf = (property: string) => Number(item?.style.getPropertyValue(property) ?? "");

      expect(
        ((markOf("--mark-x") - numberOf("--frame-x")) / numberOf("--frame-w")) * 100
      ).toBeCloseTo(50, 6);
      expect(
        ((markOf("--mark-y") - numberOf("--frame-y")) / numberOf("--frame-h")) * 100
      ).toBeCloseTo(50, 6);
    });

    it("names the link after the trip and its anchor place", () => {
      renderMap({ marks: [CENTRED_MARK] });

      const link = screen.getByRole("link", { name: linkName(CENTRED_MARK) });

      expect(link).toHaveAttribute("href", CENTRED_MARK.href);
      // The name says where the link goes, and it is real text in the tree —
      // an `aria-label` on an empty link would satisfy the query above while
      // leaving nothing for voice control to match on.
      expect(link.textContent).toContain(CENTRED_MARK.title);
      expect(link.textContent).toContain(CENTRED_MARK.placeName);
    });

    it("labels the marker list", () => {
      renderMap({ marks: [CENTRED_MARK] });

      expect(screen.getByRole("list")).toHaveAccessibleName(frMessages.map.markListLabel);
    });

    it("carries the fragment the trip page links back to", () => {
      /**
       * The trip page links to `/fr/#voyage-<slug>`. Nothing on the home page
       * carried that `id` — verified in the served HTML — so the fragment matched
       * nothing and the reader landed at the top of the page.
       *
       * The spelling is asserted rather than derived, and that is the point: the
       * prefix is duplicated by hand between the two sides, so this test is what
       * makes a rename on either side visible.
       */
      const { container } = renderMap({ marks: [CENTRED_MARK] });

      expect(container.querySelector(`#voyage-${CENTRED_MARK.slug}`)?.tagName).toBe("LI");
    });
  });

  describe("with sixty published trips", () => {
    it("renders one marker per trip", () => {
      renderMap({ marks: SIXTY_MARKS });

      expect(screen.getAllByRole("listitem")).toHaveLength(SIXTY_MARKS.length);
      expect(screen.getAllByRole("link")).toHaveLength(SIXTY_MARKS.length);
    });

    it("keeps the DOM order the content façade sorted, and every href intact", () => {
      renderMap({ marks: SIXTY_MARKS });

      const links = screen.getAllByRole("link");

      // `marks` arrives sorted by `startDate` descending then `slug`; the
      // component must not re-sort, because that order is the tab order.
      expect(links.map((link) => link.getAttribute("href"))).toEqual(
        SIXTY_MARKS.map((mark) => mark.href)
      );
      expect(links.map((link) => link.textContent)).toEqual(SIXTY_MARKS.map(linkName));
    });

    it("paints the first tab stop last, so it wins an overlap", () => {
      renderMap({ marks: SIXTY_MARKS });

      const orders = screen
        .getAllByRole("listitem")
        .map((item) => Number(item.style.getPropertyValue("--mark-order")));

      // Absolutely positioned siblings paint in DOM order, which would bury the
      // newest trip under every older one it overlaps. The inverted stacking
      // order is what keeps the pointer and the keyboard agreeing on which
      // marker is on top.
      expect(orders).toEqual(SIXTY_MARKS.map((_, index) => SIXTY_MARKS.length - index));
    });

    it("frames the whole world once the trips span it", () => {
      const { container } = renderMap({ marks: SIXTY_MARKS });

      expect(viewBoxOf(container)).toBe("0 0 960 500");
    });

    it("gives every marker its own id, with no duplicate among sixty", () => {
      // A duplicate `id` is invalid HTML that nothing reports: the browser
      // silently scrolls to the first match, so a fragment would quietly point
      // at the wrong trip. `mark.slug` is the façade's primary key, and this is
      // what holds that assumption to sixty trips.
      const { container } = renderMap({ marks: SIXTY_MARKS });

      const ids = [...container.querySelectorAll("li[id]")].map((item) => item.id);

      expect(ids).toEqual(SIXTY_MARKS.map((mark) => `voyage-${mark.slug}`));
      expect(new Set(ids).size).toBe(SIXTY_MARKS.length);
    });
  });

  describe("the country layers", () => {
    it("draws the visited countries in addition to the background layer", () => {
      const visited = COUNTRIES.slice(0, 3);
      const { container } = renderMap({ visited, marks: [CENTRED_MARK] });

      const [background, tinted] = layersOf(container);

      expect(background?.querySelectorAll("path")).toHaveLength(COUNTRIES.length);
      expect(tinted?.querySelectorAll("path")).toHaveLength(visited.length);
      expect(container.querySelectorAll("path")).toHaveLength(COUNTRIES.length + visited.length);
    });

    it("hides the whole drawing from assistive technology", () => {
      const { container } = renderMap({ visited: COUNTRIES, marks: [CENTRED_MARK] });
      const svg = mapSvg(container);

      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
    });

    it("leaves nothing focusable or interactive inside the drawing", () => {
      const { container } = renderMap({ visited: COUNTRIES, marks: SIXTY_MARKS });
      const svg = mapSvg(container);

      // "The other countries are neutral, not focusable and have no hover
      // state": true by construction, not by a list of CSS rules. A `<title>`,
      // a `tabindex` or a nested `<a>` added later turns this red.
      expect(svg.querySelectorAll("[tabindex], a, button, title, [role]")).toHaveLength(0);
    });
  });

  /**
   * The counter is the repository's first ICU plural, and the two French traps
   * it has to survive are why these expectations are written out in full rather
   * than read from `frMessages`: reading the expectation from the same catalogue
   * that supplies the plural rule would make the assertion vacuous, and the
   * point here is precisely the rule.
   *
   * - In French CLDR, the `one` category covers **0 and 1**, so without an
   *   explicit `=0` branch ahead of it the map announces "0 voyage" — measured.
   * - "pays" is invariable: the plural branch must add no `s`.
   */
  describe("the counter", () => {
    const cases: readonly { trips: number; countries: number; expected: string }[] = [
      // 0 and 60 trips both frame the whole world — the first for having no
      // extent at all, the second for spanning it — so both keep "du monde".
      { trips: 0, countries: 0, expected: "Carte du monde : aucun voyage publié, aucun pays" },
      { trips: 60, countries: 23, expected: "Carte du monde : 60 voyages, 23 pays" },
      // 1 and 2 trips are cropped by `frameAround`, hence the other wording.
      // Kept in this table rather than moved out, because the plural rules are
      // what this block is about and they must hold in both messages.
      {
        trips: 1,
        countries: 1,
        expected: "Carte du monde, recadrée sur les voyages publiés : 1 voyage, 1 pays",
      },
      {
        trips: 2,
        countries: 2,
        expected: "Carte du monde, recadrée sur les voyages publiés : 2 voyages, 2 pays",
      },
    ];

    for (const { trips, countries, expected } of cases) {
      it(`reads "${expected}"`, () => {
        renderMap({
          marks: SIXTY_MARKS.slice(0, trips),
          visited: Array.from({ length: countries }, (_, index) =>
            country(`C${index}`, `Pays ${index}`)
          ),
        });

        expect(screen.getByText(expected)).toBeVisible();
      });
    }
  });

  /**
   * The caption must not promise a world it is not showing, and the case that
   * makes this concrete is the state production reaches the day after the first
   * récit: one published trip.
   *
   * `frameAround` floors that trip's point-sized extent at 30 % of the world's
   * width, so the drawing shows about a continent — and the caption read "Carte
   * du monde : 1 voyage, 1 pays". A label read aloud, describing a picture it did
   * not match. These two tests assert the *relation* between the `viewBox` and
   * the wording rather than either alone, so a change to the framing floor cannot
   * make the caption lie again without failing here.
   */
  describe("the caption against the framing", () => {
    const captionOf = (container: HTMLElement): string =>
      container.querySelector("figcaption")?.textContent ?? "";

    it("says the world only when the frame really is the world", () => {
      const { container } = renderMap({ marks: [] });

      expect(viewBoxOf(container)).toBe("0 0 960 500");
      expect(captionOf(container)).toContain("Carte du monde :");
      expect(captionOf(container)).not.toContain("recadrée");
    });

    it("says it is cropped as soon as the frame is narrower than the world", () => {
      const { container } = renderMap({
        marks: [CENTRED_MARK],
        visited: [country("JP", "Japon")],
      });

      // The 30 % legibility floor, normalised to the world's ratio.
      expect(viewBoxOf(container)).toBe("336 175 288 150");
      expect(captionOf(container)).toBe(
        "Carte du monde, recadrée sur les voyages publiés : 1 voyage, 1 pays"
      );
    });

    it("stops piling country names into the figure's accessible name", () => {
      /**
       * A `<figcaption>` *is* the `<figure>`'s accessible name (HTML-AAM), and
       * until TIW-15 it also carried a visually hidden enumeration of every
       * visited country. That was the right call while nothing else named them;
       * `VisitedCountries` now names them visibly, counted and linked, so forty
       * country names in a *label* is all that removal leaves behind.
       *
       * Asserted on the caption's own text rather than through
       * `toHaveAccessibleName`, because jsdom's name computation for `figure` is
       * not the browser's — the end-to-end suite is where the real accessible
       * name is checked.
       */
      const visited = [country("JP", "Japon"), country("IS", "Islande")];
      const { container } = renderMap({ marks: [CENTRED_MARK], visited });

      expect(captionOf(container)).not.toContain("Japon");
      expect(captionOf(container)).not.toContain("Islande");
      expect(captionOf(container)).toContain("2 pays");
    });
  });

  /**
   * "Never an empty frame" is an acceptance criterion of TIW-15, and the state
   * that breaks it is not a thrown error: an empty `countries` array is a
   * perfectly valid value that renders a ratio-locked, bordered rectangle of
   * nothing with a counter underneath. Nothing in the console, nothing in the
   * build.
   */
  describe("with no geometry to draw", () => {
    it("renders a sentence instead of an empty box", () => {
      const { container } = renderMap({ countries: [], visited: [], marks: [] });

      expect(container.querySelector("svg")).toBeNull();
      expect(screen.getByText(frMessages.map.unavailable)).toBeVisible();
    });

    it("keeps the figure and its caption, so the count is still stated", () => {
      renderMap({ countries: [], visited: [], marks: [] });

      expect(screen.getByRole("figure")).toBeInTheDocument();
      expect(screen.getByText("Carte du monde : aucun voyage publié, aucun pays")).toBeVisible();
    });

    it("drops the markers with the drawing rather than piling them in a corner", () => {
      // The markers are positioned in percentages of the canvas that no longer
      // exists. Rendering them anyway would stack sixty 44 px targets at the
      // top-left of the figure, overlapping the caption.
      renderMap({ countries: [], visited: [], marks: SIXTY_MARKS });

      expect(screen.queryAllByRole("link")).toHaveLength(0);
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    });
  });
});

/**
 * The newest récit's marker — the first of TIW-19's three placements.
 *
 * Two channels, and the second is the one that decides whether the criterion is
 * met: an animated halo, and the marker's **accessible name**. jsdom computes no
 * animation and no `@media`, so what is assertable here is the markup the halo
 * hangs off and the words a screen reader receives — which is exactly the half
 * that must not depend on motion. The `prefers-reduced-motion` rule itself lives
 * in `world-map.module.css` and is exercised end to end in
 * `tests/e2e/fresh-trip.populated.spec.ts`.
 */
describe("WorldMap — the newest récit's marker", () => {
  const OLDER: TripMark = {
    slug: "perou-2019",
    title: "Pérou 2019",
    startDate: "2019-08-01",
    placeName: "Cusco",
    href: "/fr/voyages/perou-2019",
    point: { x: 200, y: 300 },
    story: "written",
  };

  /** The same name the component builds, assembled from the catalogue. */
  const freshLinkName = (mark: TripMark): string =>
    frMessages.map.markLabelNew.replace("{title}", mark.title).replace("{place}", mark.placeName);

  it("marks no marker when the journal has no fresh récit", () => {
    const { container } = renderMap({ marks: [CENTRED_MARK, OLDER] });

    expect(container.querySelectorAll("[data-new]")).toHaveLength(0);
    expect(screen.getByRole("link", { name: linkName(CENTRED_MARK) })).toBeInTheDocument();
  });

  it("says so in the marker's accessible name, not only in the animation", () => {
    /**
     * The case that makes the badge exist for a screen reader. An implementation
     * that only added `data-new` and let CSS pulse would pass every visual
     * review and fail here — "le badge reste identifiable sans l'animation
     * (libellé textuel, pas seulement une animation)".
     */
    renderMap({ marks: [{ ...CENTRED_MARK, isNew: true }, OLDER] });

    expect(screen.getByRole("link", { name: freshLinkName(CENTRED_MARK) })).toBeInTheDocument();
  });

  it("marks exactly one marker, and it is the one asked for", () => {
    const { container } = renderMap({ marks: [{ ...CENTRED_MARK, isNew: true }, OLDER] });

    const marked = container.querySelectorAll("[data-new]");

    expect(marked).toHaveLength(1);
    // The attribute sits on the `<a>`, beside `data-trip` and `data-zone` — the
    // element the halo lives inside and the one the stylesheet keys off.
    expect(marked[0]?.getAttribute("data-trip")).toBe(CENTRED_MARK.slug);
  });

  it("leaves the older markers with their ordinary name", () => {
    renderMap({ marks: [{ ...CENTRED_MARK, isNew: true }, OLDER] });

    expect(screen.getByRole("link", { name: linkName(OLDER) })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: freshLinkName(OLDER) })).toBeNull();
  });

  it("keeps the marker a plain link to its trip", () => {
    /**
     * The halo is decoration over an unchanged marker: same href, same 44 px
     * target, same `data-trip` the interaction layer reads. A badge that turned
     * the newest trip into a different kind of control would break the map's own
     * criterion that a marker navigates without JavaScript.
     */
    renderMap({ marks: [{ ...CENTRED_MARK, isNew: true }] });

    const link = screen.getByRole("link", { name: freshLinkName(CENTRED_MARK) });

    expect(link).toHaveAttribute("href", CENTRED_MARK.href);
    expect(link).toHaveAttribute("data-trip", CENTRED_MARK.slug);
  });

  it("renders the halo on every marker so no target changes size", () => {
    /**
     * The halo element exists on all of them and is lit by `[data-new]` in CSS.
     * Rendering it only on the fresh marker would make that one `<a>` a
     * different box from its neighbours, and a 44 px target that changes size is
     * a target that moves under the reader's finger.
     */
    const { container } = renderMap({ marks: [{ ...CENTRED_MARK, isNew: true }, OLDER] });

    const items = container.querySelectorAll("li");

    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.querySelectorAll("span[aria-hidden='true']").length).toBeGreaterThanOrEqual(2);
    }
  });
});

/**
 * **A trip whose récit is not written** (TIW-18), on the map.
 *
 * Two things have to be true at once here, and they pull in opposite directions.
 * The trip must be *present* — the country tinted, the marker placed, the panel
 * able to open on it — because "visited but not written up" is exactly the state
 * the field exists to make visible. And it must lead **nowhere that does not
 * exist**, which on this layer means the marker's `href` is the page's business
 * and its wording is this component's.
 *
 * The marker stays a real `<a href>`, and that is a decision rather than an
 * oversight. Three alternatives were considered and each breaks something ADR
 * 0003 or WCAG holds:
 *
 * - **no marker at all** — the country would be tinted with nothing to explain
 *   why, and the panel the criterion asks for could never open;
 * - **an `<a>` with no `href`** — no link role, so it is not focusable and not
 *   activable by keyboard; the panel would open under a mouse and be unreachable
 *   otherwise, a 2.1.1 failure;
 * - **a `<button>`** — focusable, but dead without JavaScript, on a map whose
 *   whole point is that it works with none.
 *
 * So the href points at something that certainly exists — the listing entry of
 * this very trip — which is the same move `visited-countries.tsx` records making
 * when its `#pays-xx` fragment turned out to dangle.
 */
describe("WorldMap — a trip whose récit is not written", () => {
  const untoldName = (mark: TripMark): string =>
    frMessages.map.markLabelToCome
      .replace("{title}", mark.title)
      .replace("{place}", mark.placeName);

  it("still places the marker, and keeps it a real link", () => {
    renderMap({ marks: [UNTOLD_MARK], visited: [], untold: [country("MA", "Maroc")] });

    const link = screen.getByRole("link", { name: untoldName(UNTOLD_MARK) });

    // Focusable, activable by keyboard, and navigable with no JavaScript — the
    // three properties the alternatives in this block's header each give up.
    expect(link).toHaveAttribute("href", "/fr/voyages#voyage-maroc-2026");
  });

  it("renders the href it was given and never rebuilds one", () => {
    /**
     * The component constructs no URL (ADR 0003), and this is the case where a
     * `tripPath(mark.slug)` slipped in here would be a dead address rather than a
     * merely redundant one — so it is worth asserting on the exact string.
     */
    renderMap({ marks: [UNTOLD_MARK] });

    expect(screen.getByRole("link").getAttribute("href")).toBe("/fr/voyages#voyage-maroc-2026");
  });

  it("says « récit à venir » in the marker's own accessible name", () => {
    renderMap({ marks: [UNTOLD_MARK] });

    /**
     * In the one text node that is already doing two jobs — the link's accessible
     * name and the hover/focus bubble — and not in an `aria-label`, an
     * `aria-describedby` or a visually hidden twin. The same decision TIW-19's
     * badge took one message over, and for the same reason: it is the only
     * spelling that reaches a screen reader, a mouse and a keyboard at once with
     * nothing to keep in step.
     */
    expect(screen.getByRole("link", { name: untoldName(UNTOLD_MARK) })).toBeInTheDocument();
    expect(screen.getByText(untoldName(UNTOLD_MARK))).toBeInTheDocument();
  });

  it("marks the dot with an attribute, so the state is not carried by colour alone", () => {
    const { container } = renderMap({ marks: [UNTOLD_MARK, CENTRED_MARK] });

    /**
     * `data-story` and not a second class name, exactly as TIW-19's `data-new`:
     * the client component's `closest("a[data-trip]")` never looks at classes, so
     * the interaction layer is untouched. The visual distinction it drives is a
     * hollow dot — a *shape* difference, so a reader who cannot separate the hues
     * still sees two kinds of marker — and the accessible name says it in words
     * regardless.
     */
    const flagged = container.querySelectorAll("[data-story='unwritten']");

    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toHaveAttribute("data-trip", "maroc-2026");
  });

  it("keeps a told marker's own name and label untouched", () => {
    renderMap({ marks: [CENTRED_MARK, UNTOLD_MARK] });

    // The branch must not leak: a written récit reads exactly as it did.
    expect(screen.getByRole("link", { name: linkName(CENTRED_MARK) })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: untoldName(UNTOLD_MARK) })).toBeInTheDocument();
  });

  it("never says both « nouveau récit » and « récit à venir » about one marker", () => {
    /**
     * Unreachable through the real pipeline — `freshestTrip` skips untold trips
     * before it compares — but `isNew` is a prop, and the two are independent at
     * this boundary. « Nouveau récit » on a trip whose récit is not written is the
     * map announcing something it also says does not exist.
     */
    renderMap({ marks: [{ ...UNTOLD_MARK, isNew: true }] });

    expect(screen.getByRole("link", { name: untoldName(UNTOLD_MARK) })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /nouveau récit/ })).toBeNull();
  });

  it("still opens its zone's panel, which is where « Récit à venir » is read", () => {
    /**
     * The criterion asks for the panel to say it, so the marker has to be able to
     * open one: `data-zone` is what the client component reads, and dropping it
     * for this state would have made the panel unreachable for exactly the trips
     * that need it. The card's own wording is `TripCard`'s business and is
     * asserted there.
     */
    const { container } = renderMap({
      marks: [UNTOLD_MARK],
      tripCards: new Map([["maroc-2026", <p key="card">Récit à venir</p>]]),
    });

    expect(container.querySelector("a[data-trip='maroc-2026']")).toHaveAttribute("data-zone");
  });
});

/**
 * **The third tint** (TIW-18): a country every one of whose trips is untold.
 *
 * Drawn as its own `<g>` layer rather than tinted in place, and the partition
 * matters more than the layer. If the untold shapes stayed in `visited` and the
 * new layer only painted *over* them, the dashed stroke's gaps would show the
 * solid stroke underneath and the two states would look identical — the reason
 * `visited` here means "reached by at least one written récit" and the two lists
 * are disjoint.
 */
describe("WorldMap — the untold country layer", () => {
  const MOROCCO = country("MA", "Maroc");

  it("draws an untold country in a layer of its own", () => {
    const visited = [country("JP", "Japon")];
    const { container } = renderMap({ visited, untold: [MOROCCO], marks: [CENTRED_MARK] });

    // Background, told, untold: three layers, and the untold one last so it is
    // painted above a neighbour drawn before it.
    const layers = layersOf(container);

    expect(layers).toHaveLength(3);
    expect(layers[2]?.querySelectorAll("path")).toHaveLength(1);
  });

  it("renders no third layer at all when every récit is written", () => {
    const { container } = renderMap({ visited: [country("JP", "Japon")], marks: [CENTRED_MARK] });

    // An empty `<g>` is not a rendering: today's production state — and every
    // journal with no untold trip — must emit exactly the two layers it did.
    expect(layersOf(container)).toHaveLength(2);
  });

  it("counts an untold country in the caption's total, like any other", () => {
    renderMap({
      visited: [country("JP", "Japon")],
      untold: [MOROCCO],
      marks: [CENTRED_MARK, UNTOLD_MARK],
    });

    /**
     * "2 pays" and not "1 pays": the caption answers *where has he been*, and a
     * country visited without being written about has still been visited. The
     * distinction belongs to the tint and to `VisitedCountries`, not to this
     * count — which is also what keeps the caption agreeing with the textual
     * equivalent beside it, since that list counts trips per country the same way.
     */
    expect(screen.getByText(/2 voyages, 2 pays/)).toBeInTheDocument();
  });

  it("adds the untold paths to the total drawn, without dropping any", () => {
    const visited = COUNTRIES.slice(0, 2);
    const untold = COUNTRIES.slice(2, 4);
    const { container } = renderMap({ visited, untold, marks: [CENTRED_MARK] });

    expect(container.querySelectorAll("path")).toHaveLength(
      COUNTRIES.length + visited.length + untold.length
    );
  });

  it("is absent from the drawing when there is no drawing at all", () => {
    // The failed-geometry branch: a sentence replaces the box, and no layer of
    // any kind is emitted. `untold` must not resurrect an `<svg>`.
    const { container } = renderMap({ countries: [], visited: [], untold: [MOROCCO], marks: [] });

    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText(frMessages.map.unavailable)).toBeInTheDocument();
  });
});
