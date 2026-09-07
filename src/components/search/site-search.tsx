"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import styles from "./site-search.module.css";

/**
 * The header's search: a field, a panel of suggestions, and a keyboard.
 *
 * **THIS IS THE MILESTONE'S THIRD `'use client'`, AND THE ARGUMENT IS HERE.**
 * `AGENTS.md` allots two — the map's interaction (TIW-14) and the photo viewer
 * (TIW-17) — and says any further one is argued in review. So:
 *
 * - what the owner asked for is *suggestions as you type*, and filtering a list
 *   against a keystroke is interaction by definition. No server round trip does
 *   it, because every route of this site is prerendered: a `?q=` results page
 *   would have to render on demand, which is invariant 1;
 * - the boundary is as thin as it can be made. Everything that is not
 *   interaction — building the index, folding accents, deciding what matches —
 *   is in `./entries.ts`, a pure module with twenty unit tests, on the *server*
 *   side of the line. This file has a filter loop, a keymap and two listeners;
 * - **the rows are not props.** They arrive as `children`, already rendered by
 *   the server, exactly as `MapViewport` receives its markers and its cards. So
 *   the index exists **once**, as HTML, and is never also serialised into the
 *   flight payload. That is the difference between this and the obvious design.
 *
 * **What a reader without JavaScript gets, which is why the shell is `<details>`.**
 * A native disclosure. No script: the summary opens it and the panel shows the
 * complete index — every trip, place, country and page of the site, as real links,
 * grouped and in reading order. That is not a degraded search, it is a site index,
 * and it is genuinely useful. With script: the field filters it live. Nothing here
 * is a control that does nothing without JavaScript, which is the trap this
 * repository named on the map's zoom buttons and refuses to fall into twice.
 *
 * **WHY THERE IS NO `role="combobox"` AND NO `aria-activedescendant`.** The ARIA
 * 1.2 pattern keeps DOM focus in the field and names the current row through an
 * attribute — which means the rows must carry `role="option"` and `tabindex="-1"`,
 * and a `tabindex="-1"` rendered by the *server* takes the links out of the tab
 * order for the reader who has no script and needs them most. Adding the roles
 * from the client instead would mean writing ARIA onto DOM React does not own, on
 * every keystroke.
 *
 * So the arrows move the **real focus** to the real link. It costs the ability to
 * keep typing while walking the list — Shift+Tab returns to the field — and it
 * buys: Enter, middle-click and Cmd-click behave as links because they *are*
 * links; the focus ring is the browser's; nothing has to be kept in sync; and the
 * script-less page is a plain, fully tabbable list. For a panel of thirty rows
 * that trade is the right way round.
 *
 * **How the filtering works, and why it reaches into the DOM.** React owns
 * `children`, so this component does not re-render them; it walks
 * `[data-haystack]` inside its own ref and toggles `hidden`. That is the price of
 * not paying for the index twice. It is confined to one callback, it reads an
 * attribute the server wrote, and it never changes the tree's shape — so React's
 * reconciliation has nothing to disagree with.
 */

export type SiteSearchLabels = {
  /** The summary's visible text — "Rechercher". */
  readonly open: string;
  /** The field's own label, visually hidden: a placeholder is not a label. */
  readonly field: string;
  readonly placeholder: string;
  /**
   * The count, already resolved by the caller for none, one and many. The
   * component substitutes `{count}` in the third and does no plural arithmetic of
   * its own, because plural rules are a property of the language and not of a
   * keystroke.
   */
  readonly resultsNone: string;
  readonly resultsOne: string;
  readonly resultsMany: string;
};

export type SiteSearchProps = {
  readonly labels: SiteSearchLabels;
  /** The server-rendered index: grouped lists of `<li data-haystack>` links. */
  readonly children: ReactNode;
};

/** Every row of the panel, in document order. Read from the DOM, never from props. */
const rowsIn = (root: ParentNode): readonly HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>("[data-haystack]"),
];

/**
 * The query, folded the way `normaliseForSearch` folds it in `./entries.ts`.
 *
 * **Duplicated on purpose, and the duplication is four lines.** Importing that
 * module would pull the index builder and its `@/domain` dependency across the
 * client boundary to fold one string. `tests/components/search/site-search.test.tsx`
 * pins the two spellings against each other, so the copy cannot drift in silence
 * — which is the only thing that makes a duplication acceptable in this repository.
 */
export function foldQuery(text: string): readonly string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export function SiteSearch({ labels, children }: SiteSearchProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState<number | null>(null);

  const rootRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  /**
   * Hide the rows that do not match, then hide any group left with nothing under
   * it — a heading over an empty list is a lie the reader has to disprove.
   */
  const applyFilter = useCallback((next: string) => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }

    const words = foldQuery(next);
    let shown = 0;

    for (const row of rowsIn(panel)) {
      const matches = words.every((word) => (row.dataset.haystack ?? "").includes(word));

      row.hidden = !matches;
      if (matches) {
        shown += 1;
      }
    }

    for (const group of panel.querySelectorAll<HTMLElement>("[data-group]")) {
      group.hidden = rowsIn(group).every((row) => row.hidden);
    }

    setCount(shown);
  }, []);

  useEffect(() => {
    if (open) {
      applyFilter(query);
    }
  }, [applyFilter, open, query]);

  /**
   * Focus the field when the panel opens — the whole point of opening it — and
   * only then. Refocusing on every render would take the caret back from a reader
   * who has arrowed into the list.
   */
  useEffect(() => {
    if (open) {
      fieldRef.current?.focus();
    }
  }, [open]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      // WCAG 2.4.3: closing a thing puts the focus back on what opened it, never
      // on the document.
      rootRef.current?.querySelector("summary")?.focus();
    }
  }, []);

  /**
   * Close on a click outside and on `Escape` — what every reader expects of a
   * panel and what `<details>` does not do on its own.
   *
   * Bound to the document, because the events this needs are precisely the ones
   * the panel never sees. Both are removed on close, so the site carries no
   * listener at all while the search is shut, which is nearly always.
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || rootRef.current?.contains(event.target) !== true) {
        close(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        close(true);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  /**
   * Move the focus by `delta` through the **visible** links.
   *
   * `from === null` means the field, so ArrowDown from the field lands on the
   * first row. Walking off either end returns to the field rather than wrapping:
   * a list that loops has no end, and a reader who cannot see it has no way to
   * know they have been round once.
   */
  const moveFocus = (delta: number, from: HTMLElement | null) => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }

    const links = rowsIn(panel)
      .filter((row) => !row.hidden)
      .map((row) => row.querySelector<HTMLAnchorElement>("a"))
      .filter((link): link is HTMLAnchorElement => link !== null);

    if (links.length === 0) {
      return;
    }

    const current = from === null ? -1 : links.findIndex((link) => link === from);
    const next = current + delta;

    if (next < 0 || next >= links.length) {
      fieldRef.current?.focus();
      return;
    }

    const target = links[next];
    target?.focus();
    // The panel scrolls; a focused row the reader cannot see is not focused as far
    // as they are concerned. `nearest` so it never jumps when already in view.
    target?.scrollIntoView({ block: "nearest" });
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const active = document.activeElement;
    const from = active instanceof HTMLAnchorElement ? active : null;

    // Only the field and the rows answer the arrows; anything else in the panel
    // keeps the browser's own behaviour.
    if (from === null && active !== fieldRef.current) {
      return;
    }

    event.preventDefault();
    moveFocus(event.key === "ArrowDown" ? 1 : -1, from);
  };

  const announcement =
    count === null
      ? ""
      : count === 0
        ? labels.resultsNone
        : count === 1
          ? labels.resultsOne
          : labels.resultsMany.replace("{count}", String(count));

  return (
    <details
      ref={rootRef}
      className={styles.search}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {/*
        The disclosure's own control. Without JavaScript this is the whole
        interaction: it opens the panel and the complete index is there.
      */}
      <summary className={styles.searchSummary}>
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className={styles.searchGlyph}>
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12.6 12.6 L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className={styles.searchSummaryText}>{labels.open}</span>
      </summary>

      {/*
        The keydown handler lives on the panel because the two things it routes
        between — the field and the rows — are siblings, and neither can move focus
        to the other on its own. Every target of it is a real control with its own
        native behaviour; nothing here makes a `<div>` interactive, which is why it
        carries no role.
      */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions --
          Refused once, with the reason, rather than silenced by an invented role.
          The rule guards against a `<div>` that a reader must operate; this one is
          a keyboard **router** between two real controls — the field and the rows
          — which are siblings, so neither can move focus to the other on its own.
          Every target it dispatches to is natively focusable and keeps its own
          behaviour; the handler adds ArrowUp and ArrowDown and nothing else. Giving
          the `<div>` a role to satisfy the rule would put a control in the
          accessibility tree that answers to nothing, which is the defect the rule
          exists to prevent. */}
      <div className={styles.searchPanel} ref={panelRef} onKeyDown={onPanelKeyDown}>
        <label className={styles.searchLabel} htmlFor="site-search-field">
          {labels.field}
        </label>
        {/*
          `type="search"` and not `text`: it is the native role, it gets the
          platform's clear affordance, and it tells a mobile keyboard to offer a
          "search" key.

          `aria-describedby` points at the count, so a reader returning to the
          field after typing hears how many rows are left without hunting for it.
        */}
        <input
          ref={fieldRef}
          id="site-search-field"
          className={styles.searchField}
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={labels.placeholder}
          aria-describedby="site-search-count"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />

        {/* The server-rendered index. This component writes only `hidden` into it. */}
        <div className={styles.searchResults}>{children}</div>

        {/*
          **The count, announced.** A sighted reader watches the list shrink; a
          screen-reader user hears nothing at all unless something says so.
          `role="status"` is `aria-live="polite"` with a role attached: it waits
          for a pause rather than interrupting.

          Visible text and not a hidden twin, because the number is as useful to
          the eye as to the ear — and one string is one string to translate rather
          than two to keep in step. Empty until the first filter runs, so the panel
          does not open on "30 résultats" before anyone has asked anything.
        */}
        <p id="site-search-count" className={styles.searchCount} role="status">
          {announcement}
        </p>
      </div>
    </details>
  );
}
