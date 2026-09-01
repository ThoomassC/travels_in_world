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
