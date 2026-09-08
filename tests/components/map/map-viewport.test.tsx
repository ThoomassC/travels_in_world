import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/i18n/messages/fr.json";
import { defaultLocale } from "@/i18n/routing";
import { WorldMap, type MapCountry } from "@/components/map/world-map";
import type { TripMark } from "@/components/map/marks";
import { TRIP_PARAM, VIEW_PARAM, ZOOM_SCALE_STEPS } from "@/components/map/viewport";

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
 * Three trips: two on the same spot — the overlap « Aussi à cet endroit » exists
 * for — and one far away. The pair is given in the WRONG chronological order on
 * purpose, so nothing below can pass by accident on an input order that happens
 * to match a sort the panel no longer does.
 */
const TOKYO: TripMark = {
  slug: "japon-2024",
  title: "Japon, printemps 2024",
  placeName: "Tokyo",
  href: "/fr/voyages/japon-2024",
  story: "written",
  point: { x: 830, y: 172 },
};

const OSAKA: TripMark = {
  slug: "japon-2025",
  title: "Japon, retour à Osaka",
  placeName: "Osaka",
  href: "/fr/voyages/japon-2025",
  story: "written",
  point: { x: 832, y: 175 },
};

const REYKJAVIK: TripMark = {
  slug: "islande-2022",
  title: "Islande, cercle d’or",
  placeName: "Reykjavik",
  href: "/fr/voyages/islande-2022",
  story: "written",
  point: { x: 430, y: 60 },
};

const MARKS: readonly TripMark[] = [TOKYO, OSAKA, REYKJAVIK];

/** A panel body that is unmistakably the server's output and not the client's. */
const panelsFor = (marks: readonly TripMark[]) =>
  new Map(marks.map((mark) => [mark.slug, <p key={mark.slug}>Récit de {mark.title}</p>]));

function renderMap(marks: readonly TripMark[] = MARKS) {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
      <WorldMap
        countries={COUNTRIES}
        visited={COUNTRIES}
        marks={marks}
        world={WORLD}
        tripPanels={panelsFor(marks)}
      />
    </NextIntlClientProvider>
  );
}

/**
 * A marker's accessible name: `map.markLabel`, `{title}, {place}`. A dot on a
 * drawing has to say where it stands, so the place is part of the name.
 */
const linkNameOf = (mark: TripMark): string =>
  frMessages.map.markLabel.replace("{title}", mark.title).replace("{place}", mark.placeName);

const markerFor = (mark: TripMark): HTMLElement =>
  screen.getByRole("link", { name: linkNameOf(mark) });

/**
 * A trip's row inside an open panel, named by its **title alone**.
 *
 * Deliberately not `linkNameOf`: « Aussi à cet endroit » has just said where
 * these trips are, and on this journal most titles are the place — the served
 * document read « Genève, Genève » and « Rouen, Rouen » when the row reused the
 * marker's name. Scoped to the panel all the same, because a title is also a
 * substring of its own marker's name.
 */
const nearbyLinkIn = (panel: HTMLElement, mark: TripMark): HTMLElement =>
  within(panel).getByRole("link", { name: mark.title });

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

/**
 * The element the four `--frame-*` properties are declared on, one above the
 * canvas since TIW-39.
 *
 * They moved so the stage's own box could be derived from them — that box is what
 * the zoom slider is positioned against, and a control positioned against a
 * full-width stage floats beside the drawing rather than on it. Custom properties
 * inherit downwards, so the canvas, the `<svg>` and every marker still resolve the
 * same digits; `.style` reads the inline attribute rather than the cascade, which
 * is why the assertions below reach one element further up.
 */
const stageOf = (container: HTMLElement): HTMLElement => {
  const stage = canvasOf(container).parentElement;
  if (stage === null) {
    throw new Error("The canvas has no stage around it.");
  }
  return stage;
};

const search = () => new URLSearchParams(window.location.search);

/** The four numbers of the rendered `viewBox`, as numbers. */
const frameOf = (container: HTMLElement) => {
  const [x = Number.NaN, y = Number.NaN, width = Number.NaN, height = Number.NaN] = viewBoxOf(
    container
  )
    .split(" ")
    .map(Number);

  return { x, y, width, height };
};

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

    /*
      The drawing's paths, not the document's: since the marker became a pennant
      it carries an inline `<svg><path>` of its own, and counting every path in
      the container would count the markers too. The markers are HTML beside the
      drawing, never inside it (ADR 0003), so scoping to the `<svg>` is exact.
    */
    const drawing = container.querySelector("figure svg");
    expect(drawing?.querySelectorAll("path")).toHaveLength(COUNTRIES.length * 2);
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
    const stage = stageOf(container);

    expect(stage.style.getPropertyValue("--frame-x")).toBe(x);
    expect(stage.style.getPropertyValue("--frame-y")).toBe(y);
    expect(stage.style.getPropertyValue("--frame-w")).toBe(width);
    expect(stage.style.getPropertyValue("--frame-h")).toBe(height);
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
  it("opens the clicked trip's own panel instead of navigating", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));

    const panel = screen.getByRole("dialog");
    expect(panel).toBeInTheDocument();
    // The body came from the server, through the client component, untouched.
    expect(within(panel).getByText(`Récit de ${TOKYO.title}`)).toBeInTheDocument();
  });

  it("names the panel after the trip that was clicked, and never after a count", () => {
    /**
     * **The owner's report, turned into an assertion.** The panel used to belong
     * to a *zone* named after its most recent trip, so clicking Tokyo opened
     * "Les 2 voyages à cet endroit" with Osaka — the newer of the pair — at the
     * top: « quand je clique sur un voyage je veux le descriptif avec les photos
     * du voyage, pas les autres voyages du pays ».
     *
     * Tokyo and Osaka overlap, and `OSAKA` is the newer trip, so this fails if
     * anything but the clicked slug decides the heading.
     */
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    expect(screen.getByRole("dialog")).toHaveAccessibleName(TOKYO.title);

    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(markerFor(REYKJAVIK));
    expect(screen.getByRole("dialog")).toHaveAccessibleName(REYKJAVIK.title);
  });

  it("shows the clicked trip's body and not its neighbour's", () => {
    // The other half of the same report: the overlapping trip is a link in a
    // secondary block, never a second body in the panel's main content.
    renderMap();

    fireEvent.click(markerFor(TOKYO));

    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText(`Récit de ${TOKYO.title}`)).toBeInTheDocument();
    expect(within(panel).queryByText(`Récit de ${OSAKA.title}`)).not.toBeInTheDocument();
  });

  it("names the overlapping trip under « Aussi à cet endroit »", () => {
    /**
     * The reason the grouping does not simply disappear: Tokyo and Osaka are two
     * 44 px targets whose centres are less than one target apart, so a reader at a
     * pointer cannot always hit the one they meant. The way out is a link in the
     * panel — a secondary block, not the panel's subject.
     */
    renderMap();

    fireEvent.click(markerFor(TOKYO));

    const panel = screen.getByRole("dialog");
    expect(
      within(panel).getByRole("heading", { name: frMessages.map.panelNearbyHeading })
    ).toBeInTheDocument();

    const link = nearbyLinkIn(panel, OSAKA);
    expect(link).toHaveAttribute("href", OSAKA.href);
    // The title and nothing else: the heading above already said "here".
    expect(link).toHaveAccessibleName(OSAKA.title);
  });

  it("gives a lone marker's panel no « Aussi à cet endroit » block at all", () => {
    // An empty secondary block is a heading promising rows that do not exist;
    // `overlappingMarks` leaves a lone marker out of its answer entirely.
    renderMap();

    fireEvent.click(markerFor(REYKJAVIK));

    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText(`Récit de ${REYKJAVIK.title}`)).toBeInTheDocument();
    expect(
      within(panel).queryByRole("heading", { name: frMessages.map.panelNearbyHeading })
    ).toBeNull();
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

  it("swaps panels when another marker is activated", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    fireEvent.click(markerFor(REYKJAVIK));

    const panels = screen.getAllByRole("dialog");
    expect(panels).toHaveLength(1);
    expect(within(panels[0] as HTMLElement).getByText(`Récit de ${REYKJAVIK.title}`)).toBeVisible();
  });
});

describe("switching to an overlapping trip from inside the panel", () => {
  it("swaps the panel to that trip without leaving the page", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    const activation = fireEvent.click(nearbyLinkIn(screen.getByRole("dialog"), OSAKA));

    // `fireEvent` answers false when a handler called `preventDefault`.
    expect(activation).toBe(false);

    const panel = screen.getByRole("dialog");
    expect(panel).toHaveAccessibleName(OSAKA.title);
    expect(within(panel).getByText(`Récit de ${OSAKA.title}`)).toBeInTheDocument();
    // And the block now offers the way back.
    expect(nearbyLinkIn(panel, TOKYO)).toBeInTheDocument();
  });

  it("keeps the focus inside the panel it just swapped", () => {
    // The link that was under the pointer is gone with the block that held it, so
    // a focus left where it was would be a focus on a detached node.
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    fireEvent.click(nearbyLinkIn(screen.getByRole("dialog"), OSAKA));

    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("gives Escape back to the NEW trip's marker, not to the link that vanished", () => {
    /**
     * **The trap this whole handler is written around.** The obvious
     * implementation records the clicked link as the element to restore the focus
     * to — and that link is unmounted by the very swap it triggered, so `close()`
     * finds `isConnected === false`, skips the `focus()` and drops the reader on
     * `<body>`: WCAG 2.4.3 lost, silently, with every assertion above still green.
     *
     * The trigger registered by a swap is therefore the **marker of the new trip**
     * on the map, which is a node that outlives the panel.
     */
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    fireEvent.click(nearbyLinkIn(screen.getByRole("dialog"), OSAKA));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(markerFor(OSAKA)).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("reflects the swap in the address bar, so the new panel is the shareable one", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    fireEvent.click(nearbyLinkIn(screen.getByRole("dialog"), OSAKA));

    expect(search().get(TRIP_PARAM)).toBe(OSAKA.slug);
  });

  it("leaves a modified click on a neighbour to the browser", () => {
    /**
     * Same rule as on a marker, and it has to be restated because this is a second
     * delegated handler on a second root: the panel is portalled to
     * `document.body`, out of the canvas the marker handler listens on. Ctrl, Cmd,
     * Shift, Alt and the middle button all mean something to a browser.
     */
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    const panel = screen.getByRole("dialog");

    for (const modifier of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      const activation = fireEvent.click(nearbyLinkIn(panel, OSAKA), modifier);

      expect(activation).toBe(true);
      expect(screen.getByRole("dialog")).toHaveAccessibleName(TOKYO.title);
    }
  });
});

/**
 * Two ways of leaving, or re-entering, a panel that the panel-per-trip change
 * broke or made worse. Both were found by an adversarial review of the diff and
 * neither was reachable from the cases above — which is the point of writing
 * them down rather than fixing quietly.
 */
describe("the activations a string-shaped selection nearly swallowed", () => {
  /**
   * **The regression this change introduced.** The selection used to be an
   * object literal, so every activation handed `setSelection` a fresh reference
   * and React re-rendered. It is a string now: re-selecting the trip already
   * open is a value React compares equal, so it bails out and the effect that
   * moves the focus into the panel never runs — while the handler has already
   * called `preventDefault()`.
   *
   * The reader this stranded is a real one: the marker of the open panel carries
   * `aria-haspopup="dialog"` and `aria-expanded="true"`, so a screen reader
   * announces a control that opens a dialog. Activating it did nothing at all —
   * no navigation, no focus, no answer.
   */
  it("re-activating the open trip's marker puts the focus back in its panel", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveFocus();

    // The reader shift-tabs back out to the marker, then activates it again.
    markerFor(TOKYO).focus();
    expect(markerFor(TOKYO)).toHaveFocus();

    fireEvent.click(markerFor(TOKYO));

    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(screen.getByRole("dialog")).toHaveAccessibleName(TOKYO.title);
  });

  /**
   * **Back closed the panel and dropped the focus on `<body>`** — WCAG 2.4.3.
   * Older than this change, and made far more likely by it: swapping between
   * neighbours pushes a history entry each time, so Back becomes the natural way
   * back to the previous trip.
   */
  it("gives the focus back to the marker when Back closes the panel", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    expect(screen.getByRole("dialog")).toHaveFocus();

    window.history.pushState({}, "", "/fr");
    fireEvent.popState(window);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(markerFor(TOKYO)).toHaveFocus();
  });

  /**
   * The other half of the rule, and the reason the fix is conditional: this
   * callback also runs on mount, and a reader who has since tabbed away must not
   * have the focus yanked back onto the map by a history entry.
   */
  /**
   * **Escape listens on `document`, so it reaches this component from anywhere on
   * the page** — including the header's search field, which has an Escape of its
   * own. Measured before the guard: a reader clearing « jap » from that field
   * emptied it *and* found the focus thrown onto a marker on the map.
   *
   * The panel still closes. Only the focus stays put.
   */
  it("closes on Escape from outside the panel without taking the focus", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    const elsewhere = markerFor(REYKJAVIK);
    elsewhere.focus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
  });

  /**
   * **A row and a marker make the same bargain, so they must say the same thing.**
   * Both are `<a href>` whose plain activation opens a dialog instead of
   * navigating; the marker announced it, the row did not, because the sweep that
   * adds the attribute reads the map's canvas and the panel is portalled out of
   * it. Measured on the served page: 14 links carrying `data-trip`, 13 carrying
   * `aria-haspopup`.
   *
   * No `aria-expanded` on a row: that attribute says a control owns an expanded
   * region, and a row does not own the panel it replaces.
   */
  it("announces the dialog on a panel row, exactly as on a marker", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    const row = nearbyLinkIn(screen.getByRole("dialog"), OSAKA);

    expect(row).toHaveAttribute("aria-haspopup", "dialog");
    expect(row).not.toHaveAttribute("aria-expanded");
  });

  it("leaves the focus alone when Back closes a panel the reader had left", () => {
    renderMap();

    fireEvent.click(markerFor(TOKYO));
    const elsewhere = markerFor(REYKJAVIK);
    elsewhere.focus();

    window.history.pushState({}, "", "/fr");
    fireEvent.popState(window);

    expect(elsewhere).toHaveFocus();
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

/*
 * `describe("the zoom controls")` lived here — six cases on the three buttons —
 * and went with them in TIW-38. The block below is not their restoration: the
 * ZOOM's own arithmetic (the scale, the legibility floor, the world clamp, the
 * centre anchor, the value ↔ width round trip) is a property of `./viewport.ts`
 * and `./viewport.test.ts` walks it across 51 cases without a DOM. What is here
 * is only what needs one — the wiring, the gate and the accessible name.
 */
describe("the zoom slider", () => {
  const sliderOf = (name = frMessages.map.zoomLabel): HTMLInputElement => {
    const slider = screen.getByRole("slider", { name });
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error("The zoom control is not an <input>.");
    }
    return slider;
  };

  it("is a native range input, named, vertical and inside the figure", () => {
    /**
     * Four claims in one case because they are one decision: a native
     * `<input type="range">` is what buys the keyboard, the `slider` role and the
     * platform's own rendering, and losing any of the four means it has been
     * replaced by a `<div>`. `aria-orientation` is stated because the ARIA
     * default for the role is horizontal and the vertical layout is a CSS fact
     * the accessibility tree cannot see.
     *
     * "Inside the figure" is not tidiness: `tests/e2e/support/axe.ts` confines
     * the map's one tolerated `target-size` violation to that element, so a
     * control outside it would silently widen the allowance to the whole page.
     */
    const { container } = renderMap();
    const slider = sliderOf();

    expect(slider.type).toBe("range");
    expect(slider).toHaveAttribute("aria-orientation", "vertical");
    expect(slider.max).toBe(String(ZOOM_SCALE_STEPS));
    expect(slider.step).toBe("1");
    expect(container.querySelector("figure")?.contains(slider)).toBe(true);
  });

  it("is not rendered until the layer has mounted", () => {
    /**
     * The same gate the panel is behind, and the reason it matters more here: a
     * range input in a document with no script is focusable, draggable and does
     * nothing at all — the one thing `no-javascript.populated.spec.ts` exists to
     * refuse. jsdom mounts effects synchronously, so this asserts the condition
     * rather than the pre-mount frame; the byte-level proof is in
     * `map-interaction.spec.ts`, which greps the served HTML.
     */
    renderMap();

    expect(sliderOf()).toBeInTheDocument();
    expect(canvasOf(document.body)).toHaveAttribute("data-interactive");
  });

  it("zooms the map in when it is moved up the scale, from the centre", () => {
    const { container } = renderMap();
    const before = frameOf(container);

    fireEvent.change(sliderOf(), { target: { value: "60" } });

    const after = frameOf(container);
    expect(after.width).toBeLessThan(before.width);

    /**
     * The centre of what the reader was looking at has not moved: a slider with
     * no pointer to aim at must not slide the map sideways as it zooms.
     *
     * **The tolerance is the frame's own rounding, and it is stated rather than
     * borrowed from `toBeCloseTo`.** `digitsOf` rounds every frame to one
     * decimal, so `x` and `width` each land on a 0.1 grid and a centre — half of
     * a rounded number added to another — lands on a 0.05 one. This assertion
     * first read `toBeCloseTo(…, 1)`, whose window is a half-open `< 0.05`, and it
     * failed on a drift of exactly 0.05: the arithmetic was right and the
     * boundary was off by one representable step. Widening it to precision 0
     * would have hidden a real half-unit slide, so the quantum is named instead.
     *
     * `EPSILON` on top of it is not slack, it is binary: the drift is exactly
     * 0.05 in decimal and 0.05000000000001137 once `x + width / 2` has been
     * through two additions of numbers that have no exact double. Comparing a
     * decimal quantum against a computed double without allowing for that is how
     * a correct implementation fails a correct test.
     */
    const ROUNDING_QUANTUM = 0.05;
    const EPSILON = 1e-9;
    expect(Math.abs(after.x + after.width / 2 - (before.x + before.width / 2))).toBeLessThanOrEqual(
      ROUNDING_QUANTUM
    );
    expect(
      Math.abs(after.y + after.height / 2 - (before.y + before.height / 2))
    ).toBeLessThanOrEqual(ROUNDING_QUANTUM + EPSILON);
  });

  it("goes back out again, so the control is not one-way", () => {
    const { container } = renderMap();

    fireEvent.change(sliderOf(), { target: { value: "70" } });
    const zoomedIn = Number(viewBoxOf(container).split(" ")[2]);

    fireEvent.change(sliderOf(), { target: { value: "10" } });
    const zoomedOut = Number(viewBoxOf(container).split(" ")[2]);

    expect(zoomedOut).toBeGreaterThan(zoomedIn);
  });

  it("follows a zoom it did not make, because it holds no state of its own", () => {
    /**
     * The bidirectional half of the ticket, and the property that makes this a
     * *view* of the frame rather than a second copy of it: the value is derived
     * during the render, so a frame restored from a shared address moves the
     * thumb with nothing to synchronise. The wheel and the pinch cannot be
     * dispatched under jsdom (they need `passive: false` on a real surface); a
     * URL-restored frame goes through the very same state.
     */
    const { unmount } = renderMap();
    const atTheBuildsFrame = Number(sliderOf().value);
    unmount();

    window.history.replaceState(null, "", `/fr?${VIEW_PARAM}=400,200,120`);
    const { container } = renderMap();

    // A 120-unit frame is far tighter than the crop the build chose, so the thumb
    // has to be further up the scale — and it has to agree with the drawing.
    expect(Number(sliderOf().value)).toBeGreaterThan(atTheBuildsFrame);
    expect(frameOf(container).width).toBeCloseTo(120, 6);
  });

  it("announces the zoom as a percentage, never as a bare notch", () => {
    /**
     * `aria-valuetext` is the whole of what a screen reader says here, and "37"
     * would be this file's own scale read aloud. The sentence comes from the
     * catalogue with a token where the number goes — see `ZOOM_VALUE_TOKEN` — so
     * this also proves the substitution happened: a template that reached the
     * accessibility tree with its brace still in it is the failure that shape
     * risks, and it would pass every other assertion in this file.
     */
    renderMap();

    fireEvent.change(sliderOf(), { target: { value: "0" } });
    expect(sliderOf()).toHaveAttribute(
      "aria-valuetext",
      frMessages.map.zoomValue.replace("{percent}", "100")
    );

    fireEvent.change(sliderOf(), { target: { value: "100" } });
    const announced = sliderOf().getAttribute("aria-valuetext") ?? "";
    expect(announced).not.toContain("{");
    expect(announced).toMatch(/\d/);
    expect(Number(announced.replace(/\D+/g, ""))).toBeGreaterThan(100);
  });

  it("writes the frame into the address bar without filling the history", () => {
    /**
     * A drag is a hundred `change` events. Each one must replace the address and
     * none may push a history entry, or Back becomes a hundred presses back to
     * the page the reader came from — the same rule the wheel obeys, and the
     * opposite of the one a selection obeys.
     */
    const depth = window.history.length;

    renderMap();
    for (const value of ["20", "30", "40", "50"]) {
      fireEvent.change(sliderOf(), { target: { value } });
    }

    expect(search().get(VIEW_PARAM)?.split(",")).toHaveLength(3);
    expect(window.history.length).toBe(depth);
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

  /*
   * "carries the frame once it has changed, and drops it on reset" was here. Both
   * halves needed a button: one to change the frame, one to put it back. The
   * writing half is still covered end to end — `tests/e2e/map-interaction.spec.ts`
   * drives it with `Ctrl` + wheel in a real browser, which is the only place a
   * wheel listener registered with `passive: false` can be exercised at all — and
   * the reset half no longer exists.
   */

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
    expect(within(panel).getByText(`Récit de ${TOKYO.title}`)).toBeInTheDocument();
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
  /*
   * A case that pressed the zoom button to prove the layer had mounted lived
   * here. `[data-interactive]` says the same thing without a control, and the
   * cases above already assert it.
   */

  it("leaves a marker's link alone when the page passed no panel at all", () => {
    /**
     * `tripPanels` is optional, and a caller that omits it gets a map with no
     * panel. The activation must then fall through to the link rather than being
     * swallowed by a panel that cannot open — which is what the "does this trip
     * have a panel?" test in the click handler is for.
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
