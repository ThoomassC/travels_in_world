"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Frame, WorldBox } from "./frame";
import {
  CENTRE,
  PANEL_SWITCH_ATTRIBUTE,
  TRIP_PARAM,
  VIEW_PARAM,
  ZOOM_SCALE_STEPS,
  ZOOM_STEP,
  ZOOM_VALUE_TOKEN,
  boundsOf,
  clampViewport,
  exceedsDragThreshold,
  panViewport,
  pinchFactor,
  readMapState,
  writeMapState,
  zoomNotchOf,
  zoomPercentOf,
  zoomToNotch,
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
 * 2. four custom properties on the stage — `--frame-x/y/w/h`, which the canvas
 *    and every marker inherit.
 *
 * The second is what moves sixty markers without touching one of them. The
 * markers are server-rendered `<a>` elements carrying their position in **world**
 * units (`--mark-x`, `--mark-y`, see `worldPointOf`), and the
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
 * and its accessible names), and each panel's `body` (one trip's description, its
 * photos, and the « Aussi à cet endroit » block naming the markers it overlaps).
 * This component renders the chrome — an `<svg>`, a zoom slider, a panel shell —
 * and nothing else. The ticket's "client component strictly limited to
 * interaction" is a structural property here rather than a promise.
 *
 * ## What the reader keeps when this file never loads
 *
 * Everything the map already did. The `<svg>` is server-rendered with the frame
 * `frameAround` chose, the markers are real links to the trips, and the list of
 * destinations below is untouched — the "no JavaScript" acceptance criterion was
 * already met by TIW-13 and TIW-15, and this ticket **adds a layer over a page
 * that works alone** rather than building a fallback for it. The zoom slider and
 * the panel are rendered only once `ready` is true, so a reader without this
 * script is never shown a control that cannot work.
 *
 * ## What happens to a marker's link
 *
 * It stays. A marker is an `<a href="/fr/voyages/<slug>">` in the document, in
 * the tab ring, named from the message catalogue — exactly as before. What
 * changes is that *while this script is running*, a plain primary activation
 * (mouse click or Enter) opens **that trip's** panel instead of navigating.
 * Nothing is lost and one step is gained: the trip's description and its photos
 * before the reader commits to a page. Three things keep that honest:
 *
 * - a modified click — Ctrl, Cmd, Shift, Alt, middle button — is **not**
 *   intercepted, so "open in a new tab" still works on a marker, and the same
 *   rule is restated on the panel's own delegated handler;
 * - `aria-haspopup="dialog"` is added to the markers **on mount** and never
 *   server-rendered, so a reader without the script is not told about a dialog
 *   that cannot open;
 * - the focus returns to the marker that opened the panel when it closes, which
 *   is an acceptance criterion and the thing a panel most often breaks.
 */

/**
 * One trip's panel.
 *
 * **It used to be one zone's panel, and the difference is the ticket.** A zone
 * grouped every marker a reader's finger could cover and named itself after the
 * most recent of them, so clicking Paris opened « Les 6 voyages à cet endroit »
 * with Gand-Bruges at the top. A panel now belongs to the trip that was clicked;
 * the markers it overlaps are a secondary block at the foot of `body`, rendered
 * by the server like the rest of it.
 */
export type MapViewportPanel = {
  /** The slug: a marker's `data-trip`, and the value of `TRIP_PARAM`. */
  readonly trip: string;
  /** The trip's own title, rendered as-is in the `<h2>` — no ICU here any more. */
  readonly heading: string;
  readonly body: ReactNode;
};

/**
 * The strings this component's own chrome needs, resolved by the server.
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
 * Resolving the strings on the server keeps every message where the catalogue
 * already is — including a panel's heading, which is now the trip's own title and
 * so never crosses this boundary as a key at all — and keeps this component to
 * what the ticket asks of it: interaction. The net cost of the whole ticket is the third row minus the
 * first — **+3.1 KB brotli and one chunk on `/fr`, nothing anywhere else** — of
 * which the chunk itself is 3.09 KB: this file plus its CSS class map, and no
 * other chunk changed by a byte.
 */
export type MapViewportLabels = {
  readonly panelClose: string;
  /** The zoom slider's accessible name. */
  readonly zoomLabel: string;
  /**
   * The zoom slider's `aria-valuetext`, with `ZOOM_VALUE_TOKEN` where the live
   * percentage goes. See that constant, in `./viewport.ts`, for why it is a
   * template — and for why it cannot be declared in this file.
   */
  readonly zoomValue: string;
};

export type MapViewportProps = {
  /** The frame the build chose, and the widest the reader is shown by default. */
  readonly initialFrame: Frame;
  /** The projected world the frame is a window on — `{ 960, 500 }` in production. */
  readonly world: WorldBox;
  /** The 177 `<path>` elements, grouped, already rendered by the server. */
  readonly children: ReactNode;
  /** The server-rendered marker list, or `null` when no trip is published. */
  readonly overlay: ReactNode;
  /** One entry per trip that has a panel; empty when there is nothing to select. */
  readonly panels: readonly MapViewportPanel[];
  /** The chrome's strings, already translated — see {@link MapViewportLabels}. */
  readonly labels: MapViewportLabels;
};

/**
 * React's `CSSProperties` is closed — its index signature was removed on purpose
 * — so naming the custom properties in the type is what lets the object literal
 * be written without a cast that would silence every other typo in it. Same note
 * as `world-map.tsx` and `src/app/[locale]/page.tsx`.
 */
type FrameStyle = CSSProperties &
  Record<"--frame-x" | "--frame-y" | "--frame-w" | "--frame-h", string>;

type SheetStyle = CSSProperties & Record<"--sheet-shift", string>;

/** How far a finger must pull a sheet down before it closes, in CSS pixels. */
const SHEET_CLOSE_PX = 72;

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
  panels,
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
  /** The slug of the open panel, and nothing else — see {@link MapViewportPanel}. */
  const [selection, setSelection] = useState<string | null>(null);
  /**
   * False until the effects have run, and the whole of the progressive
   * enhancement. The zoom slider and the panel are rendered only when it is
   * true, so the server-rendered document — which is what a reader without this
   * script keeps — carries no control that could not work.
   */
  const [ready, setReady] = useState(false);
  /** Escape hides the hover/focus tooltips; WCAG 1.4.13 asks for the mechanism. */
  const [tipsHidden, setTipsHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sheetShift, setSheetShift] = useState(0);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /**
   * The panels, read through a ref by `applyUrl` and **never through its
   * dependency list**, which is the point of the ref and not a style preference.
   *
   * `applyUrl` is called by the mount effect that also sets `ready`, and that
   * effect depends on `applyUrl`. Put `panels` in the callback's dependencies and
   * the effect re-runs whenever the prop's identity changes — the array is built
   * fresh by `world-map.tsx` on every render of the server tree — and re-running
   * it re-reads a URL the reader has since moved past: the open panel closes on
   * its own, for no reason anything in the DOM could explain.
   *
   * Seeded from the first render's `panels` by `useRef`'s own initial value, so
   * the mount call already sees the right list, and kept in step by the effect
   * below rather than by an assignment during the render — `react-hooks/refs`
   * refuses the latter, measured, and the seed is what makes the effect's
   * one-commit lag harmless: nothing reads this ref before the browser has
   * painted once.
   */
  const panelsRef = useRef<readonly MapViewportPanel[]>(panels);
  /**
   * The open panel's slug, readable from an event handler.
   *
   * Not a convenience: `selection` is a **string**, so re-selecting the trip that
   * is already open hands `setSelection` a value React compares equal, and React
   * bails out — no re-render, so the effect that moves the focus into the panel
   * never runs. Meanwhile the handler has already called `preventDefault()`. The
   * reader who tabs back to the marker of the open panel — which announces
   * `aria-haspopup="dialog"` and `aria-expanded="true"` — and presses Enter
   * therefore got **nothing at all**: no navigation, no focus, no answer.
   *
   * It is a regression of the panel-per-trip change and not an old defect: the
   * selection used to be an object literal, so every activation produced a fresh
   * reference and the effect always re-ran.
   */
  const selectionRef = useRef<string | null>(null);
  /** The marker the focus goes back to — an acceptance criterion of its own. */
  const triggerRef = useRef<HTMLElement | null>(null);
  /** Set only when the reader opened the panel, never when a URL restored it. */
  const wantsFocusRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  const sheetRef = useRef<{ y: number } | null>(null);
  /** True once a pointer travelled far enough that its release is not a tap. */
  const swallowClickRef = useRef(false);
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

  const activePanel = useMemo(
    () => (selection === null ? null : (panels.find((panel) => panel.trip === selection) ?? null)),
    [selection, panels]
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
   * Opens a trip's panel. `fromReader` is false only when a URL restored the
   * selection: that must neither move the focus nor add a history entry.
   *
   * `trigger` is the element the focus goes back to on closing, and it is always
   * a **marker on the map** — never the control that was activated. See
   * `onPanelClick` for the case where the two differ and why it matters.
   */
  const select = useCallback((trip: string, trigger: HTMLElement | null, fromReader: boolean) => {
    triggerRef.current = trigger;
    wantsFocusRef.current = fromReader;
    pushHistoryRef.current = pushHistoryRef.current || fromReader;
    setSheetShift(0);

    /**
     * **The panel this trip already owns is re-focused here and not by the
     * effect below**, for the reason `selectionRef` records: React bails out on
     * an identical string, so there is no render to hang an effect on. Done in
     * the handler, which is also where `close` puts its own `focus()` and for
     * the same argument — a browser honours a synchronous `focus()` inside a
     * user gesture.
     *
     * `fromReader` guards it: a URL restoring the selection must never move the
     * focus, and that is the only caller that passes false.
     */
    if (fromReader && selectionRef.current === trip && panelRef.current !== null) {
      wantsFocusRef.current = false;
      panelRef.current.focus();
    }

    setSelection(trip);
  }, []);

  /**
   * Whether closing the panel would leave the reader's focus nowhere.
   *
   * **Every close has to ask this, and three of the four passed a literal.**
   * Escape, the close button, a pulled sheet and a Back all unmount the same
   * dialog, and whether the marker should take the focus back depends on where
   * the focus *is* — not on which control was used.
   *
   * Two cases answer yes, and they are different:
   *
   * - the focus is **inside the panel**, so unmounting it would drop the focus on
   *   `<body>` — WCAG 2.4.3, the criterion a dialog most often fails;
   * - **nobody holds the focus**, which is the state a panel restored from a
   *   `?voyage=` address leaves the page in: that restore deliberately does not
   *   steal the focus, so a reader who then presses Escape is placed on the
   *   marker the address named. That is a gain and it takes the focus from no one.
   *
   * The case that answers no is the one an audit caught: the focus was in the
   * header's search field, and Escape — pressed to clear that field — emptied it
   * **and** threw the focus onto a marker on the map.
   */
  const focusWouldBeLost = useCallback((): boolean => {
    const active = document.activeElement;

    return (
      active === null ||
      active === document.body ||
      panelRef.current?.contains(active) === true
    );
  }, []);

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
   * The one write to `panelsRef`, and the only reason it is an effect: the panels
   * are not derived state, they are the latest value of a prop that an event
   * subscription — `popstate` — has to read without being torn down and rebuilt
   * every time the server tree re-renders.
   */
  useEffect(() => {
    panelsRef.current = panels;
  }, [panels]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

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
      /**
       * **Back closes the panel, and the focus has to go somewhere.** Without
       * this the dialog is unmounted from under the reader and `document.body`
       * inherits the focus — WCAG 2.4.3, and measured: after opening a panel,
       * swapping to a neighbour and pressing Back, `document.activeElement` was
       * `<body>`. Escape and the close button had always restored it; Back never
       * did, and swapping between neighbours makes Back the natural way out.
       *
       * **Only when the focus is inside the panel being removed.** This callback
       * also runs on mount, where `triggerRef` is null and nothing is focused,
       * and a reader who has since tabbed into the header must not have the
       * focus yanked back onto the map by a history entry.
       */
      const losingFocus = focusWouldBeLost();
      const trigger = triggerRef.current;

      setSelection(null);
      triggerRef.current = null;

      if (losingFocus && trigger !== null && trigger.isConnected) {
        trigger.focus();
      }
      return;
    }

    const trip = state.trip;

    if (!panelsRef.current.some((panel) => panel.trip === trip)) {
      // A slug with no panel: a stale link, a trip since withdrawn, or a page
      // that passed no bodies at all. The map is shown as it is rather than
      // pretending a selection exists.
      setSelection(null);
      return;
    }

    // No focus move: stealing the focus on page load, or on a Back, is hostile.
    select(trip, markerOf(trip), false);
  }, [bounds, focusWouldBeLost, initialView, markerOf, select]);

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
    writeUrl({ view, trip: selection }, push);
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
     * Only markers whose own trip really has a panel are announced as opening
     * one. A caller that passes no `tripPanels` renders a map with no panel at
     * all, and a marker promising a dialog nobody can open is the same lie as
     * announcing one before this script has mounted.
     */
    const openable = new Set(panels.map((panel) => panel.trip));

    for (const marker of canvas.querySelectorAll<HTMLElement>("a[data-trip]")) {
      const trip = marker.dataset.trip;

      if (trip !== undefined && openable.has(trip)) {
        marker.setAttribute("aria-haspopup", "dialog");
      } else {
        marker.removeAttribute("aria-haspopup");
      }

      if (trip === selection) {
        marker.setAttribute("aria-expanded", "true");
      } else {
        marker.removeAttribute("aria-expanded");
      }
    }

    /**
     * **The panel's own rows get the same treatment, and an audit is why.**
     *
     * A row under « Aussi à cet endroit » is an `<a href>` whose plain activation
     * does not navigate — it swaps the panel. That is the same bargain a marker
     * makes, and a marker says so: `aria-haspopup="dialog"`. The rows said
     * nothing, because this sweep reads `canvasRef` and the panel is portalled to
     * `document.body`, outside it. Measured on the served page: 14 links carrying
     * `data-trip`, 13 carrying `aria-haspopup` — the missing one was the row.
     *
     * No `aria-expanded` here, unlike the markers: that attribute says a control
     * owns an expanded region, and a row does not own the panel it replaces.
     *
     * Server-rendered nowhere, like the markers': without this script the row is
     * a plain link that really does navigate, and promising a dialog then would
     * be the lie this effect exists to avoid.
     */
    for (const row of panelRef.current?.querySelectorAll<HTMLElement>(
      `a[${PANEL_SWITCH_ATTRIBUTE}]`
    ) ?? []) {
      const trip = row.dataset.trip;

      if (trip !== undefined && openable.has(trip)) {
        row.setAttribute("aria-haspopup", "dialog");
      } else {
        row.removeAttribute("aria-haspopup");
      }
    }
  }, [selection, overlay, panels]);

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
        /*
          `focusWouldBeLost()` and not `true`: this listener is on `document`, so
          Escape reaches it from anywhere on the page. Measured before the guard —
          focus in the header's search field, Escape to clear it, and the focus
          landed on a marker.
        */
        close(focusWouldBeLost());
        return;
      }
      setTipsHidden(true);
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, focusWouldBeLost, selection]);

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
  }, [bounds]);

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
    /**
     * No panel, no interception. `preventDefault()` before knowing a panel can
     * open would turn a working link into a marker that answers nothing — the
     * exact regression this whole design refuses — and it is reachable: a caller
     * that passes no `tripPanels` renders the map with an empty `panels`.
     */
    if (trip === undefined || !panels.some((panel) => panel.trip === trip)) {
      return;
    }

    event.preventDefault();
    select(trip, marker, true);
  };

  /**
   * The second delegated handler, on the panel's own root — and it needs to
   * exist because the panel is **portalled to `document.body`**, outside the
   * `canvasRef` element the marker handler listens on. Without it a row under
   * « Aussi à cet endroit » would leave the map for a trip page, which is a
   * heavier answer than the reader asked for when they only mis-aimed by twenty
   * pixels.
   *
   * It intercepts links carrying {@link PANEL_SWITCH_ATTRIBUTE} and nothing else,
   * so a trip body's own links — a photo, a stage, a country — stay ordinary
   * navigation.
   *
   * **The trigger registered is the new trip's MARKER, never the link that was
   * clicked**, and that is the whole subtlety of this handler. The link lives
   * inside the block the swap replaces, so it is unmounted the moment the
   * selection changes; a `triggerRef` pointing at it would find
   * `isConnected === false` in `close()`, skip the `focus()` and drop the reader
   * on `<body>` — WCAG 2.4.3 lost, with nothing on screen to explain it. The
   * marker outlives every panel.
   */
  const onPanelClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Same rule as on a marker, restated because this is a second root: a
    // modified click and the middle button keep their browser meaning.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    const target = event.target;
    const link = target instanceof Element ? target.closest(`a[${PANEL_SWITCH_ATTRIBUTE}]`) : null;
    if (!(link instanceof HTMLElement)) {
      return;
    }

    const trip = link.dataset.trip;
    if (trip === undefined || !panels.some((panel) => panel.trip === trip)) {
      return;
    }

    event.preventDefault();
    select(trip, markerOf(trip), true);
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

  /**
   * The slider, in one line, and there is nothing else to it — which is the point.
   *
   * No state of its own: the `value` below is derived from `view` during the
   * render, so the wheel, a pinch, a drag and a shared `?carte=` address all move
   * the thumb without this handler knowing they exist. A `useState` mirroring the
   * notch would be a second copy of the zoom, and the two would drift the first
   * time anything but the slider changed it.
   *
   * `replaceState` is what the URL effect will do with it, like the wheel and
   * unlike a selection: dragging a slider must not fill the history with a hundred
   * entries. `pushHistoryRef` is left alone, so it stays false.
   */
  const onZoomChange = (event: ChangeEvent<HTMLInputElement>) => {
    const notch = Number(event.currentTarget.value);
    setView((current) => zoomToNotch(current, notch, bounds));
  };

  const onSheetPointerUp = () => {
    const shift = sheetShift;
    sheetRef.current = null;
    if (shift > SHEET_CLOSE_PX) {
      /*
        `false` was a literal here, and a reader who had explored the sheet with
        VoiceOver before pulling it shut lost the focus to `<body>`. A pull is a
        pointer gesture, so the focus is usually elsewhere — hence the question
        rather than an unconditional restore.
      */
      close(focusWouldBeLost());
      return;
    }
    setSheetShift(0);
  };

  const frame = digitsOf(view);
  /**
   * The four numbers, written **on the stage** and inherited by everything under
   * it — the canvas, the `<svg>`'s box and every marker.
   *
   * They moved up one element when the slider arrived, and the reason is layout
   * rather than tidiness. The stage is what the slider is positioned against, so
   * the stage has to be exactly the drawing's box — otherwise the control floats
   * tens of pixels off the map's right edge at every width where the first-screen
   * budget binds rather than the viewport. That box is derived from `--frame-w`
   * and `--frame-h` in the stylesheet, and an element cannot read a custom
   * property declared on its own child. Custom properties inherit downwards, so
   * the canvas still resolves all four and `aspect-ratio` still locks to the very
   * digits the `viewBox` carries.
   */
  const frameStyle: FrameStyle = {
    "--frame-x": frame.x,
    "--frame-y": frame.y,
    "--frame-w": frame.w,
    "--frame-h": frame.h,
  };
  const sheetStyle: SheetStyle = { "--sheet-shift": `${sheetShift}px` };
  /** Both derived from the frame during the render — see `onZoomChange`. */
  const zoomNotch = zoomNotchOf(view, bounds);
  const zoomPercent = zoomPercentOf(view, bounds);

  return (
    <div className={styles.stage} style={frameStyle} data-tips-hidden={tipsHidden ? "" : undefined}>
      {/*
        **The zoom slider, and with it the keyboard path back.**

        TIW-38 removed the three zoom buttons at the owner's request, and the note
        left in their place said the loss was not nothing: they were the only
        KEYBOARD route to the zoom, because the wheel needs `Ctrl` and the pinch
        needs two fingers, and the map's zoom became a pointer-only enhancement.
        **That paragraph is no longer true, and this control is why.** A native
        `<input type="range">` is keyboard-operable by construction — arrows for a
        notch, Page Up/Down for ten, Home and End for the two ends — so the zoom is
        reachable again without a mouse, a trackpad or a touchscreen.

        Native, and not a `<div>` with pointer listeners, for four things nobody
        has to write: that keyboard vocabulary, the `slider` role with its value in
        the accessibility tree, a rendering in forced-colours mode, and a thumb the
        platform already sizes for a finger.

        **Vertical by `writing-mode`, on the right edge of the drawing** — the
        stylesheet holds that half, including why the recipe is not the
        `-webkit-appearance: slider-vertical` a search still suggests (removed from
        Chromium in 132).

        It is inside the `<figure>` deliberately: `tests/e2e/support/axe.ts`
        confines the map's one tolerated `target-size` allowance to that element,
        and a control dropped outside it would have widened the allowance to cover
        the whole page — the same trap the panel's portal note records, taken from
        the other side.

        Behind `ready`, like everything else here: an inert slider in a document
        with no script is a control that answers nothing.
      */}
      {ready ? (
        <div className={styles.zoomRail}>
          {/*
            The two signs, and they are signs rather than buttons on purpose.
            The owner asked for a `+` at the top and a `−` at the bottom "to
            indicate" — so they say which way the rail runs, and nothing else
            does. Making them press would be two more tab stops and two more
            44 px targets for a job the arrow keys already do on the control
            between them, and it would put three ways to zoom on one rail.

            `aria-hidden`, therefore: the slider next to them is already named,
            already announces its value as a percentage, and already reports its
            orientation. A reader who hears "plus, Zoom de la carte, moins" has
            been told the same thing three times, twice by punctuation.

            U+2212 MINUS SIGN and not a hyphen: at this size a hyphen is visibly
            shorter than the bar of the `+` above it, and the pair reads as
            mismatched rather than as a scale.
          */}
          <span className={styles.zoomSign} aria-hidden="true">
            +
          </span>
          <input
            type="range"
            className={styles.zoom}
            min={0}
            max={ZOOM_SCALE_STEPS}
            step={1}
            value={zoomNotch}
            aria-label={labels.zoomLabel}
            /*
            `aria-valuetext` because the raw value is a notch on a scale nobody
            chose and nobody can picture. "Zoom 250 %" is the unit every image
            viewer already uses; "37" is this file's implementation detail read
            aloud. `zoomPercentOf` computes it from the frame's width, so it is the
            zoom itself and not the thumb's position — the two agree, and the
            percentage is the one of the pair a reader can act on.
          */
            aria-valuetext={labels.zoomValue.replace(ZOOM_VALUE_TOKEN, String(zoomPercent))}
            /*
            Not implied by the element: `role="slider"` is horizontal by default in
            ARIA, and the vertical layout is a CSS fact the accessibility tree
            cannot see. Stated so the announcement matches what is on screen and
            what the arrow keys do.
          */
            aria-orientation="vertical"
            onChange={onZoomChange}
          />
          <span className={styles.zoomSign} aria-hidden="true">
            &#8722;
          </span>
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
        named keyboard equivalent beside it: the zoom slider above and, for
        panning, the fact that the reader can zoom out on it and back in on
        another point. A drag has no keyboard analogue to add here.
      */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegation surface over real links; see above. */}
      <div
        ref={canvasRef}
        className={styles.canvas}
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
        **The wheel hint is gone** (TIW-38, at the owner's request), and with it
        its state, its expiry timer and its message key — a component that keeps
        the machinery of something it does not render is a component nobody can
        read. `git log` is where it lives now.

        Nothing accessible is lost: it was `aria-hidden`, so it never existed for
        a screen reader. What IS lost is the discoverability of `Ctrl` + wheel for
        a sighted mouse reader — the wheel still refuses to zoom without the
        modifier, and now says nothing about why. The named slider above is the
        discoverable path, which is what the note on the wheel already said of the
        buttons it replaced.
      */}

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
      {ready && activePanel !== null
        ? createPortal(
            /*
              The same two rules the canvas disables, disabled here for the same
              reason and measured the same way: this `onClick` is a **delegation
              surface** over the real `<a href>` elements the server rendered
              inside the panel, not a control pretending to be one. Pressing Enter
              on a focused row runs the link's own activation, which dispatches a
              `click` that bubbles to exactly this handler — so the keyboard path
              is complete and native, and an `onKeyDown` here would be a second
              path leading to the same place.
            */
            /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- delegation surface over real links; see above. */
            <div
              ref={panelRef}
              className={styles.panel}
              style={sheetStyle}
              role="dialog"
              aria-labelledby={headingId}
              tabIndex={-1}
              onClick={onPanelClick}
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
                  {activePanel.heading}
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
            The trip's own body, rendered by the server — its description, its
            photos, and the « Aussi à cet endroit » block when its marker overlaps
            another. A vertical column, so "all reachable without horizontal
            scrolling" is a property of the layout rather than of a scroll
            position.
          */}
              <div className={styles.panelBody}>{activePanel.body}</div>
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
