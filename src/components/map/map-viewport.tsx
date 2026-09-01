"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Frame, WorldBox } from "./frame";
import {
  TRIP_PARAM,
  VIEW_PARAM,
  ZOOM_STEP,
  boundsOf,
  clampViewport,
  exceedsDragThreshold,
  panViewport,
  pinchFactor,
  readMapState,
  writeMapState,
  zoomViewport,
  type Viewport,
} from "./viewport";
import styles from "./world-map.module.css";

/**
 * The map's interaction layer — the **first of the two `'use client'` components
 * milestone 1 allows**, and the only JavaScript this project ships for the map.
 *
 * ## Where the server/client boundary runs, and why it runs there
 *
 * The drawing stays on the server. The 177 `<path>` elements arrive as
 * `children`, already rendered by `WorldMap`, and this component puts them inside
 * an `<svg>` whose `viewBox` it owns. A React element handed across the boundary
 * travels in the flight payload; it is never *code*, so no path, no `d` attribute
 * and no country name enters the client bundle, and re-rendering this component
 * on every frame of a pan does not re-render one of them — React diffs the
 * `children` prop by identity and it never changes.
 *
 * That is the answer to the only hard question in this ticket: **the client
 * pilots the `viewBox` without owning the drawing.** Two attributes move, and
 * both are on elements this component renders itself:
 *
 * 1. the `viewBox` of the one `<svg>` tag — four numbers;
 * 2. four custom properties on the canvas — `--frame-x/y/w/h`.
 *
 * The second is what moves sixty markers without touching one of them. The
 * markers are server-rendered `<a>` elements carrying their position in **world**
 * units (`--mark-x`, `--mark-y`, see `zonesOf`/`worldPointOf`), and the
 * stylesheet re-derives each percentage from the live frame:
 *
 *     left: calc((var(--mark-x) - var(--frame-x)) / var(--frame-w) * 100%)
 *
 * So the browser recomputes the whole overlay from four numbers, in CSS, with no
 * per-marker JavaScript and no React node for a marker anywhere in this file.
 *
 * ## What is server-rendered, and therefore free
 *
 * `children` (the paths), `overlay` (the marker list, with its real `<a href>`
 * and its accessible names), and each zone's `body` (the trip cards, with their
 * covers, dates and durations, formatted by `Intl` on the server). This component
 * renders the chrome — an `<svg>`, three buttons, a hint, a panel shell — and
 * nothing else. The ticket's "client component strictly limited to interaction"
 * is a structural property here rather than a promise.
 *
 * ## What the reader keeps when this file never loads
 *
 * Everything the map already did. The `<svg>` is server-rendered with the frame
 * `frameAround` chose, the markers are real links to the trips, and the list of
 * destinations below is untouched — the "no JavaScript" acceptance criterion was
 * already met by TIW-13 and TIW-15, and this ticket **adds a layer over a page
 * that works alone** rather than building a fallback for it. The three zoom
 * buttons and the panel are rendered only once `mounted` is true, so a reader
 * without this script is never shown a control that cannot work.
 *
 * ## What happens to a marker's link
 *
 * It stays. A marker is an `<a href="/fr/voyages/<slug>">` in the document, in
 * the tab ring, named from the message catalogue — exactly as before. What
 * changes is that *while this script is running*, a plain primary activation
 * (mouse click or Enter) opens the panel instead of navigating, and the panel's
 * own card carries the same href. Nothing is lost and one step is gained: the
 * cover, the dates and the duration before the reader commits to a page. Three
 * things keep that honest:
 *
 * - a modified click — Ctrl, Cmd, Shift, Alt, middle button — is **not**
 *   intercepted, so "open in a new tab" still works on a marker;
 * - `aria-haspopup="dialog"` is added to the markers **on mount** and never
 *   server-rendered, so a reader without the script is not told about a dialog
 *   that cannot open;
 * - the focus returns to the marker that opened the panel when it closes, which
 *   is an acceptance criterion and the thing a panel most often breaks.
 */

/** One zone's panel: the trips a reader would take for one place. */
export type MapViewportZone = {
  /** `zonesOf`'s id — the newest trip's slug — and the marker's `data-zone`. */
  readonly id: string;
  /**
   * The panel's own heading, **already formatted by the server** — "Les 2 voyages
   * à cet endroit". The count is known at build time, so the ICU plural is
   * resolved there; see {@link MapViewportLabels} for what that buys.
   */
  readonly heading: string;
  /** The cards, server-rendered, date descending. */
  readonly body: ReactNode;
};

/**
 * The five strings this component's own chrome needs, resolved by the server.
 *
 * **This is a measured decision and not a style preference.** `useTranslations`
 * works perfectly well in a client component here — the layout's
 * `NextIntlClientProvider` already puts the catalogue in the flight payload — and
 * the first version of this file used it. Measured on production builds of the
 * same code, initial JS with the `noModule` chunk excluded:
 *
 *                                       /fr                  /fr/voyages
 *     baseline, before this ticket      119.9 KB, 6 chunks   119.9 KB, 6 chunks
 *     useTranslations in this file      124.9 KB, 8 chunks   121.7 KB, 7 chunks
 *     labels resolved on the server     123.0 KB, 7 chunks   119.9 KB, 6 chunks
 *
 * Two things that table says. The 1.9 KB difference is `use-intl`'s translator and
 * its memoisation cache, which `NextIntlClientProvider` alone does not pull in: it
 * arrives the moment a *client* component asks for a message. And it landed in a
 * chunk **shared with `/fr/voyages`** — a route with no map on it, which was
 * paying 1.8 KB and a whole extra chunk for a component it never renders. That is
 * the same shape of leak TIW-28 paid for on `/_not-found`
 * (`docs/adr/0005-getpathname-sans-le-link-client.md`), found by measuring every
 * prerendered route rather than only the one being worked on.
 *
 * Resolving the strings on the server keeps every ICU plural (`panelHeading`)
 * where the catalogue already is, and keeps this component to what the ticket asks
 * of it: interaction. The net cost of the whole ticket is the third row minus the
 * first — **+3.1 KB brotli and one chunk on `/fr`, nothing anywhere else** — of
 * which the chunk itself is 3.09 KB: this file plus its CSS class map, and no
 * other chunk changed by a byte.
 */
export type MapViewportLabels = {
  readonly zoomIn: string;
  readonly zoomOut: string;
  readonly zoomReset: string;
  readonly wheelHint: string;
  readonly panelClose: string;
};

export type MapViewportProps = {
  /** The frame the build chose, and the frame the reset button goes back to. */
  readonly initialFrame: Frame;
  /** The projected world the frame is a window on — `{ 960, 500 }` in production. */
  readonly world: WorldBox;
  /** The 177 `<path>` elements, grouped, already rendered by the server. */
  readonly children: ReactNode;
  /** The server-rendered marker list, or `null` when no trip is published. */
  readonly overlay: ReactNode;
  /** One entry per zone; empty when there is nothing to select. */
  readonly zones: readonly MapViewportZone[];
  /** The chrome's strings, already translated — see {@link MapViewportLabels}. */
  readonly labels: MapViewportLabels;
};

/**
 * React's `CSSProperties` is closed — its index signature was removed on purpose
 * — so naming the custom properties in the type is what lets the object literal
 * be written without a cast that would silence every other typo in it. Same note
 * as `world-map.tsx` and `src/app/[locale]/page.tsx`.
 */
type CanvasStyle = CSSProperties &
  Record<"--frame-x" | "--frame-y" | "--frame-w" | "--frame-h", string>;

type SheetStyle = CSSProperties & Record<"--sheet-shift", string>;

/** What is selected: a trip, its zone, and the element to give the focus back to. */
type Selection = {
  readonly trip: string;
  readonly zone: string;
};

/** How long the "use Ctrl and the wheel" message stays on screen. */
const HINT_MS = 2600;

/** How far a finger must pull a sheet down before it closes, in CSS pixels. */
const SHEET_CLOSE_PX = 72;

/** Where the buttons zoom from: the middle of what the reader is looking at. */
const CENTRE = { x: 0.5, y: 0.5 };

/**
 * The four numbers of the frame, rounded ONCE, as strings.
 *
 * **Rounding once is the point, and a test caught it not being.** The `viewBox`
 * attribute and the four `--frame-*` custom properties must carry the very same
 * digits: the attribute drives `preserveAspectRatio` and the properties drive both
 * the container's locked `aspect-ratio` and every marker's percentage. The first
 * version formatted the attribute to one decimal and wrote the raw state into the
 * properties — so after one zoom press the canvas asked for a ratio of
 * `456.79999999999995 / 237.9…` while the drawing was framed at `456.8`. Sub-pixel
 * today; the same class of disagreement that letterboxes the SVG and slides every
 * marker off the country it names, which `frameAround` and `clampViewport` both
 * keep their arithmetic exact for.
 */
type FrameDigits = {
  readonly x: string;
  readonly y: string;
  readonly w: string;
  readonly h: string;
};

const digitsOf = (view: Viewport): FrameDigits => ({
  x: round(view.x),
  y: round(view.y),
  w: round(view.width),
  h: round(view.height),
});

/** One decimal, like every other number this map writes into an attribute. */
const round = (value: number): string => value.toFixed(1).replace(/\.0$/, "");

/** Where a pointer is inside an element, as a pair of fractions of its box. */
function anchorIn(element: Element, clientX: number, clientY: number) {
  const box = element.getBoundingClientRect();

  return {
    x: box.width > 0 ? (clientX - box.left) / box.width : CENTRE.x,
    y: box.height > 0 ? (clientY - box.top) / box.height : CENTRE.y,
  };
}

/** The two-finger state a pinch is measured against. */
type Pinch = { readonly distance: number; readonly x: number; readonly y: number };

function pinchOf(touches: TouchList): Pinch | null {
  const first = touches.item(0);
  const second = touches.item(1);

  if (first === null || second === null) {
    return null;
  }

  return {
    distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

export function MapViewport({
  initialFrame,
  world,
  children,
  overlay,
  zones,
  labels,
}: MapViewportProps): ReactElement {
  const headingId = useId();

  /**
   * The bounds every operation is clamped by, computed once. `boundsOf` throws
   * for a frame or a world with no area; both come from `frameAround`, which
   * throws first, so this cannot fail on a page that rendered.
   */
  const bounds = useMemo(() => boundsOf(initialFrame, world), [initialFrame, world]);
  const initialView = useMemo(() => clampViewport(initialFrame, bounds), [initialFrame, bounds]);

  const [view, setView] = useState<Viewport>(initialView);
  const [selection, setSelection] = useState<Selection | null>(null);
  /**
   * False until the effects have run, and the whole of the progressive
   * enhancement. The zoom buttons and the panel are rendered only when it is
   * true, so the server-rendered document — which is what a reader without this
   * script keeps — carries no control that could not work.
   */
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState(false);
  /** Escape hides the hover/focus tooltips; WCAG 1.4.13 asks for the mechanism. */
  const [tipsHidden, setTipsHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sheetShift, setSheetShift] = useState(0);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** The marker the focus goes back to — an acceptance criterion of its own. */
  const triggerRef = useRef<HTMLElement | null>(null);
  /** Set only when the reader opened the panel, never when a URL restored it. */
  const wantsFocusRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  const sheetRef = useRef<{ y: number } | null>(null);
  /** True once a pointer travelled far enough that its release is not a tap. */
  const swallowClickRef = useRef(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Whether the next URL write is a history entry of its own.
   *
   * A selection is: a reader who opened a panel expects Back to close it. A frame
   * is not: four wheel notches must not be four history entries — and Safari
   * throttles `replaceState` hard enough to throw, so a drag cannot write history
   * at all. Set in the event handler that decides, read once by the effect that
   * writes.
   */
  const pushHistoryRef = useRef(false);

  const activeZone = useMemo(
    () => (selection === null ? null : (zones.find((zone) => zone.id === selection.zone) ?? null)),
    [selection, zones]
  );

  /**
   * The marker of a slug, found by **iterating and comparing strings** rather
   * than by building a selector.
   *
   * The slug can come from the query string, so it is untrusted text; `readTrip`
   * refuses anything that is not shaped like a slug, and this is the second lock.
   * `querySelector(\`[data-trip="${slug}"]\`)` would have been shorter and would
   * have handed a URL a way into a selector.
   */
  const markerOf = useCallback((slug: string): HTMLElement | null => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return null;
    }
    for (const element of canvas.querySelectorAll<HTMLElement>("a[data-trip]")) {
      if (element.dataset.trip === slug) {
        return element;
      }
    }
    return null;
  }, []);

  /**
   * Writes the map's state into the address bar, preserving whatever else is in
   * it.
   *
   * `pushState` for a selection, `replaceState` for a frame: a reader who opened a
   * panel expects Back to close it, and a reader who turned the wheel four times
   * does not expect four history entries. A query string and not a fragment, and
   * `window.location` read directly rather than `useSearchParams` — that hook
   * needs a Suspense boundary and reports nothing during a prerender, and this
   * route must stay prerendered (invariant 1).
   */
  const writeUrl = useCallback(
    (next: { view: Viewport; trip: string | null }, push: boolean) => {
      const search = writeMapState(window.location.search, {
        view: next.view,
        trip: next.trip,
        initial: initialView,
      });
      const url = `${window.location.pathname}${search}${window.location.hash}`;

      if (push) {
        window.history.pushState(null, "", url);
      } else {
        window.history.replaceState(null, "", url);
      }
    },
    [initialView]
  );

  /**
   * Opens the panel of a zone. `fromReader` is false only when a URL restored the
   * selection: that must neither move the focus nor add a history entry.
   */
  const select = useCallback(
    (trip: string, zone: string, trigger: HTMLElement | null, fromReader: boolean) => {
      triggerRef.current = trigger;
      wantsFocusRef.current = fromReader;
      pushHistoryRef.current = pushHistoryRef.current || fromReader;
      setSheetShift(0);
      setSelection({ trip, zone });
    },
    []
  );

  const close = useCallback((restoreFocus: boolean) => {
    const trigger = triggerRef.current;
    pushHistoryRef.current = true;
    setSelection(null);
    setSheetShift(0);
    /**
     * **The focus goes back to the marker that opened the panel** — an acceptance
     * criterion, and the thing a panel most often breaks. Done here, in the
     * handler, rather than in an effect: the browser only keeps a synchronous
     * `focus()` inside a user gesture, and an effect would race the panel's own
     * removal from the DOM.
     *
     * `isConnected` because a marker can have gone: the overlay is re-rendered by
     * the server on a new build, and a stale node would swallow the focus into
     * nothing — the body would end up with it and the reader would be back at the
     * top of the page.
     */
    if (restoreFocus && trigger !== null && trigger.isConnected) {
      trigger.focus();
    }
    triggerRef.current = null;
  }, []);

  /**
   * Reads the URL and puts the map where it says — on mount, so a reloaded or
   * shared address restores the frame and the panel, and on `popstate`, so Back
   * closes the panel and undoes a zoom.
   *
   * **The known cost, stated rather than hidden:** the document is prerendered
   * with the frame the *build* chose, so a shared `?carte=` address paints that
   * frame for one moment before this runs. Removing the flash would mean either a
   * server that reads the query string — which de-statifies the whole tree,
   * against invariant 1 — or a blocking inline script, which is a CSP problem
   * for a cosmetic gain.
   */
  const applyUrl = useCallback(() => {
    const state = readMapState(window.location.search, bounds);

    setView(state.view ?? initialView);

    if (state.trip === null) {
      setSelection(null);
      triggerRef.current = null;
      return;
    }

    const marker = markerOf(state.trip);
    const zone = marker?.dataset.zone;

    if (marker === undefined || marker === null || zone === undefined) {
      // A slug that names no marker: a stale link, or a trip since withdrawn.
      // The map is shown as it is rather than pretending a selection exists.
      setSelection(null);
      return;
    }

    // No focus move: stealing the focus on page load, or on a Back, is hostile.
    select(state.trip, zone, marker, false);
  }, [bounds, initialView, markerOf, select]);

  useEffect(() => {
    /**
     * `react-hooks/set-state-in-effect` is disabled here, once, with its reason.
     *
     * The rule's own guidance is that an effect may "subscribe for updates from
     * some external system, calling setState in a callback when external state
     * changes". The address bar IS that external system, `popstate` is the
     * subscription, and this line is its first read — which cannot happen during
     * render, because the document is **prerendered** and `window.location` does
     * not exist there. Invariant 1 of `AGENTS.md` forbids the alternative (a
     * server that reads the query string de-statifies the whole route tree), and
     * a `useState` initialiser reading `location` would render one thing on the
     * server and another on the client: a hydration mismatch, not a fix.
     *
     * The cost is exactly one extra render, on mount, batched with `setReady`:
     * `applyUrl` and `setReady` land in the same React batch, so the controls,
     * the restored frame and the restored panel all arrive in one commit.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is the external system; see above.
    applyUrl();
    setReady(true);

    const onPopState = () => {
      applyUrl();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [applyUrl]);

  /**
   * The one place the address bar is written, from the two pieces of state that
   * describe the map. Deriving it here rather than in each handler is what makes
   * "the selection is reflected in the URL" a property of the state instead of
   * five call sites that can drift.
   *
   * `writeMapState` writes no `carte` parameter while the view still equals the
   * frame the server rendered, so an address stays clean until the reader has
   * actually moved the map.
   */
  useEffect(() => {
    if (!ready) {
      return;
    }
    const push = pushHistoryRef.current;
    pushHistoryRef.current = false;
    writeUrl({ view, trip: selection?.trip ?? null }, push);
  }, [ready, view, selection, writeUrl]);

  /**
   * `aria-haspopup` on the markers, added here and never server-rendered: with
   * this script absent a marker is a plain link to a trip, and announcing a
   * dialog it cannot open would be a lie in the accessibility tree. `aria-expanded`
   * follows the selection so a screen reader can tell an open marker from a closed
   * one.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    /**
     * Only markers whose zone really has a panel are announced as opening one.
     * A caller that passes no `tripCards` renders a map with no panel at all, and
     * a marker promising a dialog nobody can open is the same lie as announcing
     * one before this script has mounted.
     */
    const openable = new Set(zones.map((zone) => zone.id));

    for (const marker of canvas.querySelectorAll<HTMLElement>("a[data-trip]")) {
      const zone = marker.dataset.zone;

      if (zone !== undefined && openable.has(zone)) {
        marker.setAttribute("aria-haspopup", "dialog");
      } else {
        marker.removeAttribute("aria-haspopup");
      }

      if (marker.dataset.trip === selection?.trip) {
        marker.setAttribute("aria-expanded", "true");
      } else {
        marker.removeAttribute("aria-expanded");
      }
    }
  }, [selection, overlay, zones]);

  /** The focus goes into the panel the reader just opened, and only then. */
  useEffect(() => {
    if (selection === null || !wantsFocusRef.current) {
      return;
    }
    wantsFocusRef.current = false;
    panelRef.current?.focus();
  }, [selection]);

  /**
   * Escape, at the document level because the focus is not necessarily inside the
   * map: a panel restored from a URL is open while the focus is still on the
   * body, and a hover tooltip is showing while the focus is anywhere at all.
   *
   * The panel wins over the tooltip: one Escape closes what is most in the way.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        // Any other key re-arms the tooltips: dismissing one must not silence the
        // map for the rest of the visit.
        setTipsHidden(false);
        return;
      }
      if (selection !== null) {
        close(true);
        return;
      }
      setTipsHidden(true);
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, selection]);

  const showHint = useCallback(() => {
    setHint(true);
    if (hintTimerRef.current !== null) {
      clearTimeout(hintTimerRef.current);
    }
    hintTimerRef.current = setTimeout(() => {
      setHint(false);
    }, HINT_MS);
  }, []);

  useEffect(
    () => () => {
      if (hintTimerRef.current !== null) {
        clearTimeout(hintTimerRef.current);
      }
    },
    []
  );

  /**
   * The wheel and the two-finger gestures, as **native** listeners with
   * `passive: false`.
   *
   * React registers `wheel`, `touchstart` and `touchmove` passively on the root
   * container, so `preventDefault()` inside an `onWheel` or an `onTouchMove` prop
   * is ignored and logs a warning. Both acceptance criteria here need it: the
   * wheel must scroll the page when it is turned alone, and two fingers must move
   * the map instead of the page.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      /**
       * The wheel alone does not zoom, and the page scrolls as it always did.
       * The message says what to press instead. `ctrlKey` covers a trackpad
       * pinch, which every browser reports as a Ctrl-wheel.
       */
      if (!event.ctrlKey && !event.metaKey) {
        showHint();
        return;
      }
      event.preventDefault();
      setView((current) =>
        zoomViewport(
          current,
          event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
          anchorIn(canvas, event.clientX, event.clientY),
          bounds
        )
      );
    };

    /** One finger scrolls the page; two move the map. */
    const onTouchStart = (event: TouchEvent) => {
      pinchRef.current = event.touches.length >= 2 ? pinchOf(event.touches) : null;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinchRef.current = null;
        return;
      }

      const next = pinchOf(event.touches);
      if (next === null) {
        return;
      }

      event.preventDefault();
      const previous = pinchRef.current;
      pinchRef.current = next;

      if (previous === null) {
        return;
      }

      const box = canvas.getBoundingClientRect();
      setView((current) => {
        const zoomed = zoomViewport(
          current,
          pinchFactor(previous.distance, next.distance),
          anchorIn(canvas, next.x, next.y),
          bounds
        );

        return panViewport(
          zoomed,
          {
            x: box.width > 0 ? (next.x - previous.x) / box.width : 0,
            y: box.height > 0 ? (next.y - previous.y) / box.height : 0,
          },
          bounds
        );
      });
    };

    const onTouchEnd = () => {
      pinchRef.current = null;
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);

    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [bounds, showHint]);

  const zoomBy = useCallback(
    (factor: number) => {
      setView((current) => zoomViewport(current, factor, CENTRE, bounds));
    },
    [bounds]
  );

  /** Mouse and pen drags pan the map. Touch is handled by the two-finger rule. */
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || event.button !== 0) {
      return;
    }
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
    swallowClickRef.current = false;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (drag === null || canvas === null) {
      return;
    }

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;

    if (!drag.moved) {
      if (!exceedsDragThreshold(dx, dy)) {
        return;
      }
      drag.moved = true;
      setDragging(true);
    }

    const box = canvas.getBoundingClientRect();
    drag.x = event.clientX;
    drag.y = event.clientY;

    setView((current) =>
      panViewport(
        current,
        {
          x: box.width > 0 ? dx / box.width : 0,
          y: box.height > 0 ? dy / box.height : 0,
        },
        bounds
      )
    );
  };

  const endDrag = () => {
    /**
     * The acceptance criterion "a drag ending on a marker does not open the
     * panel". The browser fires `click` on the marker after the release
     * regardless, so the flag is what the click handler below reads.
     */
    swallowClickRef.current = dragRef.current?.moved ?? false;
    dragRef.current = null;
    setDragging(false);
  };

  /**
   * One delegated handler for every marker, and the reason the marker list can
   * stay server-rendered HTML: sixty `<a>` elements need no React node and no
   * listener of their own.
   */
  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (swallowClickRef.current) {
      swallowClickRef.current = false;
      event.preventDefault();
      return;
    }

    // A modified click keeps its browser meaning — "open in a new tab" still
    // works on a marker, which is the point of leaving the `<a href>` in place.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const target = event.target;
    const marker = target instanceof Element ? target.closest("a[data-trip]") : null;
    if (!(marker instanceof HTMLElement)) {
      return;
    }

    const trip = marker.dataset.trip;
    const zone = marker.dataset.zone;
    /**
     * No zone, no interception. `preventDefault()` before knowing a panel can
     * open would turn a working link into a marker that answers nothing — the
     * exact regression this whole design refuses — and it is reachable: a caller
     * that passes no `tripCards` renders the map with an empty `zones`.
     */
    if (trip === undefined || zone === undefined || !zones.some((entry) => entry.id === zone)) {
      return;
    }

    event.preventDefault();
    select(trip, zone, marker, true);
  };

  /** The sheet's grab handle: a downward pull closes it on a touch screen. */
  const onSheetPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") {
      return;
    }
    sheetRef.current = { y: event.clientY };
  };

  const onSheetPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = sheetRef.current;
    if (start === null) {
      return;
    }
    setSheetShift(Math.max(0, event.clientY - start.y));
  };

  const onSheetPointerUp = () => {
    const shift = sheetShift;
    sheetRef.current = null;
    if (shift > SHEET_CLOSE_PX) {
      close(false);
      return;
    }
    setSheetShift(0);
  };

  const frame = digitsOf(view);
  const canvasStyle: CanvasStyle = {
    "--frame-x": frame.x,
    "--frame-y": frame.y,
    "--frame-w": frame.w,
    "--frame-h": frame.h,
  };
  const sheetStyle: SheetStyle = { "--sheet-shift": `${sheetShift}px` };

  return (
    <div className={styles.stage} data-tips-hidden={tipsHidden ? "" : undefined}>
      {/*
        Rendered only once mounted: a zoom button in the server's HTML would be a
        control that does nothing for a reader without this script.

        **Before the canvas in the DOM, and absolutely positioned over its
        top-right corner.** The order is a keyboard decision, not a visual one:
        with sixty published trips, controls placed after the marker list would sit
        sixty tab stops away, so a reader on a keyboard would have to walk the
        whole map to reach the button that makes the map smaller. `position:
        absolute` and `z-index` put them back where the eye expects them, and
        `tests/e2e/map-equivalent.populated.spec.ts` pins the resulting tab order
        as the sequence a reader really receives.
      */}
      {ready ? (
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.control}
            onClick={() => {
              zoomBy(ZOOM_STEP);
            }}
          >
            <span aria-hidden="true">+</span>
            {/*
              Real text, visually hidden — never an `aria-label`. Same reason as
              the markers': an attribute is a string a translator never sees in
              context and no tool finds in the DOM.
            */}
            <span className={styles.visuallyHidden}>{labels.zoomIn}</span>
          </button>
          <button
            type="button"
            className={styles.control}
            onClick={() => {
              zoomBy(1 / ZOOM_STEP);
            }}
          >
            <span aria-hidden="true">−</span>
            <span className={styles.visuallyHidden}>{labels.zoomOut}</span>
          </button>
          <button
            type="button"
            className={styles.control}
            onClick={() => {
              setView(initialView);
            }}
          >
            <span aria-hidden="true">↺</span>
            <span className={styles.visuallyHidden}>{labels.zoomReset}</span>
          </button>
        </div>
      ) : null}

      {/*
        `jsx-a11y/click-events-have-key-events` and
        `jsx-a11y/no-static-element-interactions` are disabled on this element,
        once, with the reason rather than as a warning the next reader is invited
        to "fix".

        Both rules exist to catch a `<div>` **pretending to be a control**: no
        role, no tab stop, no keyboard path. Neither is the case here, and the
        rules cannot see why.

        - This div is an **event-delegation surface**, not a control. Its `onClick`
          exists to intercept activations of the real `<a href>` elements inside
          it, which the server rendered, which are in the tab ring, and which
          carry their own accessible names. That is what lets sixty markers cost
          zero React nodes and zero listeners.
        - The keyboard path is therefore **complete and native**: pressing Enter on
          a focused link runs its activation behaviour, which dispatches a `click`
          event that bubbles to exactly this handler. A reader on a keyboard opens
          the panel by the same code path as a reader with a mouse — verified end
          to end in `tests/e2e/map-interaction.populated.spec.ts`.
        - Adding an `onKeyDown` here to satisfy the first rule would be a second,
          redundant path that nothing needs, and a role would put a stop in the tab
          ring that leads nowhere.

        The pointer handlers pan the map, which is a pointer-only gesture with a
        named keyboard equivalent beside it: the three zoom buttons and, for
        panning, the fact that the reader can zoom out and back in on another
        point. A drag has no keyboard analogue to add here.
      */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegation surface over real links; see above. */}
      <div
        ref={canvasRef}
        className={styles.canvas}
        style={canvasStyle}
        data-dragging={dragging ? "" : undefined}
        data-interactive={ready ? "" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        onClick={onClick}
      >
        {/*
          Inert by construction, exactly as TIW-13 left it: `aria-hidden`, no
          `tabindex`, no `:hover`, `pointer-events: none` in the stylesheet. The
          only thing this ticket changed about the drawing is who writes the
          `viewBox` — and `children` is the server's output, untouched.
        */}
        <svg
          className={styles.map}
          viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
          aria-hidden="true"
          focusable="false"
        >
          {children}
        </svg>
        {overlay}
      </div>

      {/*
        The ephemeral message the wheel-alone gesture earns. Not a live region:
        it answers a pointer gesture, and a reader who never turns a wheel would
        hear it announced for nothing. The keyboard path to the same result is the
        three buttons above, which are named.
      */}
      {ready && hint ? (
        <p className={styles.hint} aria-hidden="true">
          {labels.wheelHint}
        </p>
      ) : null}

      {/*
        **The panel is portalled to `document.body`, and there are three reasons
        rather than one.**

        1. It is `position: fixed` in both of its layouts, and `fixed` resolves
           against the nearest ancestor carrying a `transform`, a `filter` or
           `contain` — none of which exists on this page today, and any of which
           would silently turn a side panel into a box trapped inside the map.
           Out of the tree, that class of bug cannot happen.
        2. A `<dialog>`-shaped thing is not part of a `<figure>`'s content. The
           `<figcaption>` is the figure's accessible NAME (HTML-AAM), and the
           figure is what `tests/e2e/support/axe.ts` uses to confine the map's one
           tolerated `target-size` violation to the drawing's markers. A panel
           inside the figure would have quietly widened that allowance to cover
           every link in every trip card — an exception nobody re-reads becoming a
           blanket, which is exactly what TIW-15 wrote that helper to prevent.
        3. The tab order becomes the document's end rather than the middle of the
           map, which is what a non-modal dialog should be: the focus is moved in
           on opening and given back to the marker on closing, so DOM proximity
           buys nothing here.

        `createPortal` cannot run while rendering on the server, and it never has
        to: the panel is behind `ready`, which is false until this component has
        mounted in a browser.
      */}
      {ready && activeZone !== null && selection !== null
        ? createPortal(
            <div
              ref={panelRef}
              className={styles.panel}
              style={sheetStyle}
              role="dialog"
              aria-labelledby={headingId}
              tabIndex={-1}
            >
              {/*
            The header is the sheet's grab handle on a touch screen: a downward
            pull closes it. Attached here and not to the whole panel so a pull
            inside the card list stays a scroll — the list is the one thing that
            must keep scrolling vertically.
          */}
              <div
                className={styles.panelHeader}
                onPointerDown={onSheetPointerDown}
                onPointerMove={onSheetPointerMove}
                onPointerUp={onSheetPointerUp}
                onPointerCancel={onSheetPointerUp}
              >
                <span className={styles.panelGrip} aria-hidden="true" />
                <h2 id={headingId} className={styles.panelTitle}>
                  {activeZone.heading}
                </h2>
                <button
                  type="button"
                  className={styles.panelClose}
                  onClick={() => {
                    close(true);
                  }}
                >
                  <span aria-hidden="true">×</span>
                  <span className={styles.visuallyHidden}>{labels.panelClose}</span>
                </button>
              </div>
              {/*
            The cards, rendered by the server: covers, dates and durations
            already formatted, and one `<a href>` per trip. A vertical column, so
            "all reachable without horizontal scrolling" is a property of the
            layout rather than of a scroll position.
          */}
              <div className={styles.panelBody}>{activeZone.body}</div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

/**
 * Re-exported for the tests and for `world-map.tsx`, so the query parameter
 * names are written once. They are part of this component's public contract: a
 * shared address is an API.
 */
export { TRIP_PARAM, VIEW_PARAM };
