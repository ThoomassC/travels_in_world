import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/i18n/messages/fr.json";
import { defaultLocale } from "@/i18n/routing";
import { WorldMap, type MapCountry } from "@/components/map/world-map";
import type { TripMark } from "@/components/map/marks";
import {
  MAX_ZOOM_WIDTH_FRACTION,
  TRIP_PARAM,
  VIEW_PARAM,
  ZOOM_STEP,
} from "@/components/map/viewport";

/**
 * The interaction layer, rendered through `WorldMap` exactly as the page renders
 * it — so what is under test is the *whole* boundary: a server component handing
 * the drawing, the markers and the panel bodies to a client component that owns
 * only the `viewBox`, four custom properties and the chrome.
 *
 * **What jsdom can and cannot judge.** It computes no layout: every
 * `getBoundingClientRect()` is zero, so nothing here is about pixels — a pan by
 * pointer moves the frame by `delta / 0`, which this module deliberately answers
 * as no movement. The wheel's modifier rule, the two-finger gesture and the
 * pull-to-close all depend on real events on a real surface, and they are
 * verified in `tests/e2e/map-interaction.populated.spec.ts` against a production
 * build. What lives here is everything that is a *state machine*: which panel
 * opens, where the focus goes, what the URL says, and what a drag does to the
 * activation that follows it.
 *
 * The `viewBox` assertions are exact rather than approximate because the whole
 * chain is deterministic: `frameAround` rounds to one decimal, `clampViewport`
 * keeps the frame's aspect ratio, and the component formats the same numbers into
 * the attribute and into the custom properties.
 */

const WORLD = { width: 960, height: 500 };

const country = (code: string | null, name: string): MapCountry => ({
  code,
  name,
  path: "M0,0L10,0L10,10Z",
});

const COUNTRIES: readonly MapCountry[] = [
  country("JP", "Japon"),
  country("IS", "Islande"),
  country("PE", "Pérou"),
];

/**
 * Three trips: two on the same spot — the zone the panel exists for — and one far
 * away. The pair is given in the WRONG chronological order on purpose, so the
 * panel's "date descending" is asserted against a sort and not against the input.
 */
const TOKYO: TripMark = {
  slug: "japon-2024",
  title: "Japon, printemps 2024",
  startDate: "2024-04-12",
  placeName: "Tokyo",
  href: "/fr/voyages/japon-2024",
  story: "written",
  point: { x: 830, y: 172 },
};

const OSAKA: TripMark = {
  slug: "japon-2025",
  title: "Japon, retour à Osaka",
  startDate: "2025-03-02",
  placeName: "Osaka",
  href: "/fr/voyages/japon-2025",
  story: "written",
  point: { x: 832, y: 175 },
};

const REYKJAVIK: TripMark = {
  slug: "islande-2022",
  title: "Islande, cercle d’or",
  startDate: "2022-09-10",
  placeName: "Reykjavik",
  href: "/fr/voyages/islande-2022",
  story: "written",
  point: { x: 430, y: 60 },
};

const MARKS: readonly TripMark[] = [TOKYO, OSAKA, REYKJAVIK];

/** A card that is unmistakably the server's output and not the client's. */
const cardsFor = (marks: readonly TripMark[]) =>
  new Map(marks.map((mark) => [mark.slug, <p key={mark.slug}>Fiche de {mark.title}</p>]));

function renderMap(marks: readonly TripMark[] = MARKS) {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
      <WorldMap
        countries={COUNTRIES}
        visited={COUNTRIES}
        marks={marks}
        world={WORLD}
        tripCards={cardsFor(marks)}
      />
    </NextIntlClientProvider>
  );
}

const markerFor = (mark: TripMark): HTMLElement =>
  screen.getByRole("link", {
    name: frMessages.map.markLabel
      .replace("{title}", mark.title)
      .replace("{place}", mark.placeName),
  });

const svgOf = (container: HTMLElement): SVGSVGElement => {
  const svg = container.querySelector("svg");
  if (svg === null) {
    throw new Error("The map rendered no <svg>.");
  }
  return svg;
};

const viewBoxOf = (container: HTMLElement): string =>
  svgOf(container).getAttribute("viewBox") ?? "";

const canvasOf = (container: HTMLElement): HTMLElement => {
  const canvas = svgOf(container).parentElement;
  if (canvas === null) {
    throw new Error("The <svg> has no canvas around it.");
  }
  return canvas;
};

const frameWidthOf = (container: HTMLElement): number => Number(viewBoxOf(container).split(" ")[2]);

const search = () => new URLSearchParams(window.location.search);

beforeEach(() => {
  window.history.replaceState(null, "", "/fr");
});

afterEach(() => {
  window.history.replaceState(null, "", "/fr");
});

describe("what the server rendered is still what is drawn", () => {
  it("keeps the country paths out of the client's hands and in the document", () => {
    // The whole point of the boundary: the drawing is server output passed as
    // `children`, so it is in the DOM once and the client never re-renders it.
    const { container } = renderMap();

    expect(container.querySelectorAll("path")).toHaveLength(COUNTRIES.length * 2);
    expect(svgOf(container)).toHaveAttribute("aria-hidden", "true");
    expect(svgOf(container)).toHaveAttribute("focusable", "false");
  });

  it("leaves every marker a real link to its trip", () => {
    /**
     * The acceptance criterion this ticket could most easily have broken. A panel
     * that *replaces* a working navigation is a regression for anyone not using a
     * mouse, so the `<a href>` stays: without JavaScript it navigates, with it a
     * plain activation opens the panel and the panel's card carries the same href.
     */
    renderMap();

    for (const mark of MARKS) {
      expect(markerFor(mark)).toHaveAttribute("href", mark.href);
    }
  });

  it("starts from the frame the build chose, with the canvas locked to its ratio", () => {
    const { container } = renderMap();

    const [x, y, width, height] = viewBoxOf(container).split(" ");
    const canvas = canvasOf(container);

    expect(canvas.style.getPropertyValue("--frame-x")).toBe(x);
    expect(canvas.style.getPropertyValue("--frame-y")).toBe(y);
    expect(canvas.style.getPropertyValue("--frame-w")).toBe(width);
    expect(canvas.style.getPropertyValue("--frame-h")).toBe(height);
  });

  it("marks itself interactive only once mounted", () => {
    // The gate the whole progressive enhancement hangs on: the cursor and
    // `touch-action` are CSS rules on `[data-interactive]`, which the server never
    // renders, so a reader with no script keeps an ordinary page.
    const { container } = renderMap();

    expect(canvasOf(container)).toHaveAttribute("data-interactive");
  });

  it("announces the dialog on the markers only after mounting", () => {
    /**
     * `aria-haspopup` is added by the client and never server-rendered. A reader
     * without this script would otherwise be told about a dialog that cannot open
     * — a lie in the accessibility tree, and one nothing else would catch.
     */
    renderMap();

    for (const mark of MARKS) {
      expect(markerFor(mark)).toHaveAttribute("aria-haspopup", "dialog");
      expect(markerFor(mark)).not.toHaveAttribute("aria-expanded");
    }
  });
});

describe("opening a trip panel", () => {
  it("opens the zone's panel instead of navigating", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));

    const panel = screen.getByRole("dialog");
    expect(panel).toBeInTheDocument();
    // The card came from the server, through the client component, untouched.
    expect(within(panel).getByText(`Fiche de ${TOKYO.title}`)).toBeInTheDocument();
  });

  it("lists every trip of the zone, most recent first", () => {
    /**
     * Tokyo and Osaka are 400 km apart, which at any realistic rendered scale is
     * a handful of pixels: two 44 px targets overlapping, so a reader cannot have
     * meant one of them in particular. The criterion is that both are reachable,
     * date descending — and `OSAKA` is the newer trip while `TOKYO` is given
     * first, so this fails if the order is the input's rather than the sort's.
     */
    renderMap();

    fireEvent.click(markerFor(TOKYO));

    const panel = screen.getByRole("dialog");
    const cards = within(panel)
      .getAllByText(/^Fiche de /)
      .map((node) => node.textContent);

    expect(cards).toEqual([`Fiche de ${OSAKA.title}`, `Fiche de ${TOKYO.title}`]);
  });

  it("names the panel after how many trips it holds", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Les 2 voyages à cet endroit");

    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(markerFor(REYKJAVIK));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Le voyage à cet endroit");
  });

  it("opens a lone marker's panel with its own trip only", () => {
    renderMap();

    fireEvent.click(markerFor(REYKJAVIK));

    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText(`Fiche de ${REYKJAVIK.title}`)).toBeInTheDocument();
    expect(within(panel).queryByText(`Fiche de ${TOKYO.title}`)).not.toBeInTheDocument();
  });

  it("moves the focus into the panel, and marks the marker expanded", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));

    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(markerFor(TOKYO)).toHaveAttribute("aria-expanded", "true");
    expect(markerFor(REYKJAVIK)).not.toHaveAttribute("aria-expanded");
  });

  it("leaves a modified click to the browser, so a marker still opens in a new tab", () => {
    /**
     * The other half of "the link stays a link". Ctrl-, Cmd-, Shift- and
     * Alt-click all mean something to a browser, and intercepting them would take
     * away a behaviour the reader had before this ticket.
     */
    renderMap();

    for (const modifier of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      fireEvent.click(markerFor(TOKYO), modifier);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
  });

  it("swaps panels when another zone is activated", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    fireEvent.click(markerFor(REYKJAVIK));

    const panels = screen.getAllByRole("dialog");
    expect(panels).toHaveLength(1);
    expect(within(panels[0] as HTMLElement).getByText(`Fiche de ${REYKJAVIK.title}`)).toBeVisible();
  });
});

describe("closing a trip panel", () => {
  it("closes on Escape and gives the focus back to the marker", () => {
    // Two acceptance criteria in one assertion, and the second is the one a panel
    // most often loses: the focus must not be left on the body.
    renderMap();
    const marker = markerFor(TOKYO);

    fireEvent.click(marker);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(markerFor(TOKYO)).toHaveFocus();
  });

  it("closes on the cross, and gives the focus back too", () => {
    renderMap();

    fireEvent.click(markerFor(OSAKA));
    fireEvent.click(screen.getByRole("button", { name: frMessages.map.panelClose }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(markerFor(OSAKA)).toHaveFocus();
  });

  it("Escape with no panel open does not throw and leaves the map alone", () => {
    const { container } = renderMap();
    const before = viewBoxOf(container);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(viewBoxOf(container)).toBe(before);
  });

  it("hides the tooltips on Escape and re-arms them on the next key", () => {
    /**
     * WCAG 1.4.13's "dismissible": a bubble drawn over its neighbours owes a way
     * out that does not require moving the pointer. The visual half is a CSS rule
     * on `[data-tips-hidden]`; this is the state machine behind it, including the
     * re-arming — dismissing one tooltip must not silence the map for the rest of
     * the visit.
     */
    const { container } = renderMap();
    const stage = canvasOf(container).parentElement;

    fireEvent.keyDown(document, { key: "Escape" });
    expect(stage).toHaveAttribute("data-tips-hidden");

    fireEvent.keyDown(document, { key: "Tab" });
    expect(stage).not.toHaveAttribute("data-tips-hidden");
  });
});

describe("a drag is not a tap", () => {
  it("does not open the panel when the pointer travelled before the release", () => {
    /**
     * The acceptance criterion "a movement ending on a marker does not open the
     * panel". The browser fires `click` on the marker after the release whatever
     * happened in between, so the only thing that can tell the two apart is the
     * distance — {@link exceedsDragThreshold}, measured on the diagonal.
     */
    const { container } = renderMap();
    const canvas = canvasOf(container);

    fireEvent.pointerDown(canvas, { pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerType: "mouse", clientX: 140, clientY: 130 });
    fireEvent.pointerUp(canvas, { pointerType: "mouse", clientX: 140, clientY: 130 });
    fireEvent.click(markerFor(TOKYO));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("still opens the panel after a pointer that barely moved", () => {
    // The other side of the threshold: a hand is never perfectly still, and a
    // marker that answers nothing after a 2 px tremor is a broken marker.
    const { container } = renderMap();
    const canvas = canvasOf(container);

    fireEvent.pointerDown(canvas, { pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerType: "mouse", clientX: 102, clientY: 101 });
    fireEvent.pointerUp(canvas, { pointerType: "mouse", clientX: 102, clientY: 101 });
    fireEvent.click(markerFor(TOKYO));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("swallows only the one activation the drag produced", () => {
    // A suppressed click that stayed suppressed would leave every marker dead
    // after the reader's first pan.
    const { container } = renderMap();
    const canvas = canvasOf(container);

    fireEvent.pointerDown(canvas, { pointerType: "mouse", button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerType: "mouse", clientX: 80, clientY: 0 });
    fireEvent.pointerUp(canvas, { pointerType: "mouse", clientX: 80, clientY: 0 });
    fireEvent.click(markerFor(TOKYO));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(markerFor(TOKYO));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("never starts a drag from a single finger, which must scroll the page", () => {
    /**
     * "One finger scrolls the page, two manipulate the map". The pointer handlers
     * ignore `pointerType: "touch"` outright — the two-finger gesture is a native
     * `touchmove` listener — so a one-finger swipe over the map can neither pan it
     * nor swallow the tap that follows.
     */
    const { container } = renderMap();
    const canvas = canvasOf(container);

    fireEvent.pointerDown(canvas, { pointerType: "touch", button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerType: "touch", clientX: 100, clientY: 300 });
    fireEvent.pointerUp(canvas, { pointerType: "touch", clientX: 100, clientY: 300 });
    fireEvent.click(markerFor(TOKYO));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("the zoom controls", () => {
  const zoomIn = () => screen.getByRole("button", { name: frMessages.map.zoomIn });
  const zoomOut = () => screen.getByRole("button", { name: frMessages.map.zoomOut });
  const reset = () => screen.getByRole("button", { name: frMessages.map.zoomReset });

  it("offers three named controls, and they are real buttons", () => {
    renderMap();

    for (const control of [zoomIn(), zoomOut(), reset()]) {
      expect(control.tagName).toBe("BUTTON");
      expect(control).toHaveAttribute("type", "button");
    }
  });

  it("narrows the frame by the step on the way in", () => {
    const { container } = renderMap();
    const before = frameWidthOf(container);

    fireEvent.click(zoomIn());

    expect(frameWidthOf(container)).toBeCloseTo(before / ZOOM_STEP, 0);
  });

  it("keeps the canvas ratio and the viewBox in step at every level", () => {
    // The invariant that decides whether the markers stay on their countries:
    // any disagreement letterboxes the SVG and slides all of them.
    const { container } = renderMap();

    for (const press of [zoomIn(), zoomIn(), zoomOut(), zoomIn()]) {
      fireEvent.click(press);
      const [x, y, width, height] = viewBoxOf(container).split(" ");
      const canvas = canvasOf(container);
      expect(canvas.style.getPropertyValue("--frame-x")).toBe(x);
      expect(canvas.style.getPropertyValue("--frame-y")).toBe(y);
      expect(canvas.style.getPropertyValue("--frame-w")).toBe(width);
      expect(canvas.style.getPropertyValue("--frame-h")).toBe(height);
    }
  });

  it("stops at the legibility floor, however many times it is pressed", () => {
    const { container } = renderMap();

    for (let press = 0; press < 30; press += 1) {
      fireEvent.click(zoomIn());
    }

    expect(frameWidthOf(container)).toBeCloseTo(WORLD.width * MAX_ZOOM_WIDTH_FRACTION, 1);
  });

  it("stops at the world, however many times it is pressed", () => {
    const { container } = renderMap();

    for (let press = 0; press < 30; press += 1) {
      fireEvent.click(zoomOut());
    }

    const [x, y, width, height] = viewBoxOf(container).split(" ").map(Number);
    expect(Number(x)).toBeGreaterThanOrEqual(0);
    expect(Number(y)).toBeGreaterThanOrEqual(0);
    expect(Number(x) + Number(width)).toBeLessThanOrEqual(WORLD.width + 0.05);
    expect(Number(y) + Number(height)).toBeLessThanOrEqual(WORLD.height + 0.05);
  });

  it("puts the frame back where the build left it", () => {
    const { container } = renderMap();
    const initial = viewBoxOf(container);

    fireEvent.click(zoomIn());
    fireEvent.click(zoomIn());
    expect(viewBoxOf(container)).not.toBe(initial);

    fireEvent.click(reset());
    expect(viewBoxOf(container)).toBe(initial);
  });
});

describe("the state in the address bar", () => {
  it("says nothing until the reader has moved something", () => {
    // A `?carte=` appearing on a first render would be a shareable address
    // pinning a state nobody chose.
    renderMap();

    expect(window.location.search).toBe("");
  });

  it("carries the selected trip, and drops it when the panel closes", () => {
    renderMap();

    fireEvent.click(markerFor(OSAKA));
    expect(search().get(TRIP_PARAM)).toBe(OSAKA.slug);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(search().get(TRIP_PARAM)).toBeNull();
  });

  it("carries the frame once it has changed, and drops it on reset", () => {
    renderMap();

    fireEvent.click(screen.getByRole("button", { name: frMessages.map.zoomIn }));
    const parked = search().get(VIEW_PARAM);
    expect(parked?.split(",")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: frMessages.map.zoomReset }));
    expect(search().get(VIEW_PARAM)).toBeNull();
  });

  it("restores the frame a shared address names", () => {
    /**
     * "A reload restores the same map and panel state." There is no server in
     * this: the document is prerendered with the build's frame, and the client
     * reads the query string on mount. The flash that implies is the documented
     * cost of invariant 1 — a server that read the query string would de-statify
     * the whole route tree.
     */
    window.history.replaceState(null, "", `/fr?${VIEW_PARAM}=100,50,300`);

    const { container } = renderMap();

    expect(viewBoxOf(container).startsWith("100 50 300")).toBe(true);
  });

  it("restores the panel a shared address names, without stealing the focus", () => {
    window.history.replaceState(null, "", `/fr?${TRIP_PARAM}=${TOKYO.slug}`);

    renderMap();

    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText(`Fiche de ${TOKYO.title}`)).toBeInTheDocument();
    // Moving the focus on page load is hostile: the reader has not asked for
    // anything yet. It moves when THEY open a panel, and it comes back when they
    // close one — which the closing test above pins.
    expect(panel).not.toHaveFocus();
  });

  it("gives the restored panel its marker back, so Escape returns the focus there", () => {
    window.history.replaceState(null, "", `/fr?${TRIP_PARAM}=${REYKJAVIK.slug}`);

    renderMap();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(markerFor(REYKJAVIK)).toHaveFocus();
  });

  it("shows the map as it is when the address names a trip that is not on it", () => {
    // A stale link, or a trip since withdrawn. Not an error state: a map, with
    // the dangling parameter cleaned out of the address.
    window.history.replaceState(null, "", `/fr?${TRIP_PARAM}=un-voyage-disparu`);

    renderMap();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(search().get(TRIP_PARAM)).toBeNull();
  });

  it("ignores a frame it cannot use rather than blanking the drawing", () => {
    const { container: reference } = renderMap();
    const initial = viewBoxOf(reference);

    for (const raw of ["NaN,0,300", "1,2", "0,0,-5", "bidon"]) {
      window.history.replaceState(null, "", `/fr?${VIEW_PARAM}=${encodeURIComponent(raw)}`);
      const { container } = renderMap();

      expect(viewBoxOf(container)).toBe(initial);
    }
  });

  it("leaves a parameter it does not own alone", () => {
    window.history.replaceState(null, "", "/fr?utm_source=lettre");

    renderMap();
    fireEvent.click(markerFor(TOKYO));

    expect(search().get("utm_source")).toBe("lettre");
    expect(search().get(TRIP_PARAM)).toBe(TOKYO.slug);
  });

  it("follows the history back out of a selection", () => {
    /**
     * A selection is pushed, so Back closes the panel — which is what a reader on
     * a phone expects of a sheet. Asserted through `popstate`, the event the
     * component subscribes to, since jsdom's `history.back()` is asynchronous and
     * would make this a timing test rather than a behaviour one.
     */
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    window.history.replaceState(null, "", "/fr");
    fireEvent.popState(window);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("a map with nothing on it", () => {
  it("draws the world, offers the controls, and opens no panel", () => {
    // The production state today: `content/trips` is empty until TIW-24. The
    // interaction layer must be harmless there rather than absent.
    const { container } = renderMap([]);

    expect(container.querySelectorAll("path")).toHaveLength(COUNTRIES.length * 2);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: frMessages.map.zoomIn })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: frMessages.map.zoomIn }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves a marker's link alone when the page passed no cards at all", () => {
    /**
     * `tripCards` is optional, and a caller that omits it gets a map with no
     * panel. The activation must then fall through to the link rather than being
     * swallowed by a panel that cannot open — which is what the "is this zone
     * known?" test in the click handler is for.
     */
    render(
      <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
        <WorldMap countries={COUNTRIES} visited={COUNTRIES} marks={MARKS} world={WORLD} />
      </NextIntlClientProvider>
    );

    const marker = markerFor(REYKJAVIK);
    expect(marker).not.toHaveAttribute("aria-haspopup");

    const activation = fireEvent.click(marker);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // `fireEvent` answers false when a handler called `preventDefault`.
    expect(activation).toBe(true);
  });
});
