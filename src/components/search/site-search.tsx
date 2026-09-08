"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import styles from "./site-search.module.css";

/**
 * The header's search: a field that is always there, a panel of suggestions under
 * it, and a keyboard.
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
 *   is in `./entries.ts`, a pure module with its own unit tests, on the *server*
 *   side of the line. This file has a filter loop, a keymap and a completion;
 * - **the rows are not props.** They arrive as `children`, already rendered by
 *   the server, exactly as `MapViewport` receives its markers and its cards. So
 *   the index exists **once**, as HTML, and is never also serialised into the
 *   flight payload. That is the difference between this and the obvious design.
 *
 * **THE DISCLOSURE IS CSS, NOT JAVASCRIPT, AND THAT IS THE CHANGE OF THIS
 * REVISION.** The field used to be behind a `<summary>`; the owner chose an
 * always-open field from a sheet of five, so there is nothing left to open. What
 * opens the panel is `:focus-within` in the stylesheet — so **a reader with no
 * script tabs into the field and the whole index appears**, in real links, and
 * tabs on through it. That is strictly better than the disclosure it replaces,
 * which needed a click. This component's only say in the matter is `data-dismissed`,
 * written on Escape and cleared on the next keystroke: one attribute, so the
 * script can close a panel it never has to open.
 *
 * Two listeners went with the summary and are not missed: the click-outside is
 * what losing focus already means, and the panel that has no state has none to
 * reset.
 *
 * **WHY THERE IS NO `role="combobox"` AND NO `aria-activedescendant`.** The ARIA
 * 1.2 pattern keeps DOM focus in the field and names the current row through an
 * attribute, which means keeping a `role="option"` and an `aria-selected` in step
 * with the DOM on every keystroke — on nodes React does not own, because the rows
 * are `children` the server rendered.
 *
 * So the arrows move the **real focus** to the real link. It costs the ability to
 * keep typing while walking the list, and it buys: Enter, middle-click and
 * Cmd-click behave as links because they *are* links; the focus ring is the
 * browser's; and nothing has to be kept in sync.
 *
 * **The rows leave the tab order, and it is the CLIENT that takes them out — the
 * one place in this design where the two readers get different DOM, and it is
 * deliberate.** The panel is opened by `:focus-within`, so tabbing into the field
 * opens it and the next Tab walks into it: measured on the fixture,
 * `tests/e2e/map-equivalent.populated.spec.ts` stopped reaching the map's markers
 * at all, because twenty-one suggestions now stood between the header and the
 * page. On every document of the site. A `tabIndex={-1}` in `search-index.tsx`
 * would fix that and break the other reader — the script-less one, for whom this
 * panel *is* the site index and Tab is the only way through it. So the attribute
 * is written here, once, on mount: the reader who has a script gets the combobox's
 * bargain (arrows in, Enter to follow, Tab straight past), and the reader who has
 * none gets a plain, fully tabbable list. One `querySelectorAll`, one attribute,
 * no keystroke involved.
 *
 * **How the filtering works, and why it reaches into the DOM.** React owns
 * `children`, so this component does not re-render them; it walks
 * `[data-haystack]` inside its own ref and toggles `hidden`. That is the price of
 * not paying for the index twice. It is confined to one callback, it reads an
 * attribute the server wrote, and it never changes the tree's shape — so React's
 * reconciliation has nothing to disagree with.
 */

export type SiteSearchLabels = {
  /** The field's own label, visually hidden: a placeholder is not a label. */
  readonly field: string;
  readonly placeholder: string;
  /**
   * The suggestions' own name — read out at the one tab stop this control has
   * besides the field. It belongs here rather than on `SearchIndex` because the
   * element it names is the *scrolling* box, which this component owns; see the
   * note on `.searchResults` in the stylesheet for why those three things (the
   * scroll, the name and the tab stop) have to be one element.
   */
  readonly listLabel: string;
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

/**
 * The **other** fold, and the two are not interchangeable.
 *
 * {@link foldQuery} cuts a string into words and drops the punctuation, which is
 * right for matching and wrong for completing: the inline completion has to put
 * the caret at a position in the *original* string, so the fold it compares with
 * must map one character to one character. This one only strips accents and case.
 *
 * Its known limit, stated rather than hidden: a ligature ("œ") is one character
 * that NFD does not decompose, so a label holding one would put the caret a
 * character early. No place, country or page of this carnet holds one, and the
 * consequence if one arrives is a selection off by one — not a wrong destination.
 */
const foldChars = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function SiteSearch({ labels, children }: SiteSearchProps): ReactElement {
  /** What the reader typed. Not what the field displays — see `completion`. */
  const [query, setQuery] = useState("");
  /**
   * The full label the field is offering, or `null`. When it is set, the input
   * *displays* it and the part past `query` is selected, so the next keystroke
   * replaces it — which is how a native inline completion behaves and why this is
   * not a ghost element beside the field: a second box has to be kept aligned
   * with a proportional font, and a selection is aligned by construction.
   */
  const [completion, setCompletion] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  /**
   * Hide the rows that do not match, then hide any group left with nothing under
   * it — a heading over an empty list is a lie the reader has to disprove.
   *
   * Returns the first visible row's display label, which is what the completion
   * needs and what only this pass knows.
   */
  const applyFilter = useCallback((next: string): string | null => {
    const panel = panelRef.current;
    if (panel === null) {
      return null;
    }

    const words = foldQuery(next);
    let shown = 0;
    let first: string | null = null;

    for (const row of rowsIn(panel)) {
      const matches = words.every((word) => (row.dataset.haystack ?? "").includes(word));

      row.hidden = !matches;
      if (matches) {
        shown += 1;
        first ??= row.querySelector<HTMLElement>("[data-label]")?.textContent ?? null;
      }
    }

    for (const group of panel.querySelectorAll<HTMLElement>("[data-group]")) {
      group.hidden = rowsIn(group).every((row) => row.hidden);
    }

    // `null` and not `0` on an empty query: the panel opens on the whole index,
    // and "15 résultats" before anyone has asked anything is an answer to no
    // question.
    setCount(next === "" ? null : shown);

    return first;
  }, []);

  /**
   * Take the rows out of the tab order — see the header. Once, on mount, and never
   * again: `children` is server-rendered markup React does not re-render, so a row
   * cannot arrive later.
   */
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    for (const link of panel.querySelectorAll<HTMLAnchorElement>("[data-haystack] a")) {
      link.tabIndex = -1;
    }
  }, []);

  /**
   * The index starts unfiltered, and one pass on mount is what makes that true of
   * the DOM as well as of the markup — a row left `hidden` by a previous render
   * would be invisible with no query to explain it.
   */
  useEffect(() => {
    applyFilter("");
  }, [applyFilter]);

  /**
   * **One keystroke, one render, and the completion decided inside it.**
   *
   * This used to be an effect on `query`, and the effect was a defect: React
   * renders once with the *new* query and the *old* completion before the effect
   * clears it, so every Backspace re-expanded the field to the full label for a
   * frame and put the caret back at the end of it. Measured on the build — two
   * presses of Backspace on "Islande, cercle d'or" left "i" rather than "Is".
   *
   * Deciding here costs nothing: `applyFilter` is a DOM write, which an event
   * handler is exactly the right place for, and its verdict — the first row still
   * visible — is what the completion needs.
   */
  const onType = (value: string, native: Event) => {
    /*
      A completion is offered on an insertion and never on a deletion. Otherwise
      Backspace puts back the text it was pressed to remove, and the field becomes
      impossible to clear — the classic way an autocomplete becomes a trap.
    */
    const inserting = native instanceof InputEvent && native.inputType.startsWith("insert");
    const first = applyFilter(value);
    const offer =
      inserting && value !== "" && first !== null && foldChars(first).startsWith(foldChars(value))
        ? first
        : null;

    setDismissed(false);
    setQuery(value);
    setCompletion(offer === value ? null : offer);
  };

  /**
   * Select the completed tail, so the next keystroke replaces it.
   *
   * `useLayoutEffect`: React has just written the longer value into the input, and
   * a selection set after a paint is a selection the reader sees appear.
   */
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (field === null || completion === null || document.activeElement !== field) {
      return;
    }
    field.setSelectionRange(query.length, completion.length);
  }, [completion, query]);

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

  /** The first row the reader can see — where Enter in the field goes. */
  const firstVisibleLink = (): HTMLAnchorElement | null => {
    const panel = panelRef.current;
    if (panel === null) {
      return null;
    }

    return (
      rowsIn(panel)
        .filter((row) => !row.hidden)
        .map((row) => row.querySelector<HTMLAnchorElement>("a"))
        .find((link): link is HTMLAnchorElement => link !== null) ?? null
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const active = document.activeElement;
    const inField = active === fieldRef.current;

    if (event.key === "Escape") {
      // The panel closes and the caret stays where it was: Escape dismisses the
      // suggestions, it does not throw the reader out of the field they are in.
      setDismissed(true);
      return;
    }

    /*
      **Enter in the field follows the first suggestion**, which is the promise the
      completion makes: the field has just written a trip's name into itself, and
      Enter has to go there. On a row it does nothing at all — the row is a link,
      and the browser already knows what Enter on a link means.
    */
    if (event.key === "Enter" && inField) {
      const target = firstVisibleLink();
      if (target !== null) {
        event.preventDefault();
        target.click();
      }
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const from = active instanceof HTMLAnchorElement ? active : null;

    // Only the field and the rows answer the arrows; anything else in the panel
    // keeps the browser's own behaviour.
    if (from === null && !inField) {
      return;
    }

    event.preventDefault();
    setDismissed(false);
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
    /* eslint-disable-next-line jsx-a11y/no-static-element-interactions --
       Refused once, with the reason, rather than silenced by an invented role.
       The rule guards against a `<div>` that a reader must operate; this one is a
       keyboard **router** between two real controls — the field and the rows —
       which are siblings, so neither can move focus to the other on its own. Every
       target it dispatches to is natively focusable and keeps its own behaviour;
       the handler adds Escape, Enter, ArrowUp and ArrowDown and nothing else.
       Giving the `<div>` a role to satisfy the rule would put a control in the
       accessibility tree that answers to nothing, which is the defect the rule
       exists to prevent. */
    <div
      ref={rootRef}
      className={styles.search}
      onKeyDown={onKeyDown}
      data-dismissed={dismissed ? "" : undefined}
    >
      {/*
        **The frame is the `<label>`, and that is not tidiness.** Clicking a label
        focuses its control, natively — so the whole pill is a target with no
        script at all. It matters most on a narrow bar, where the stylesheet
        collapses the input to zero width and the pill is the only thing left to
        aim at; a `<div>` there would be a control that answers no finger, and the
        alternative was an onClick on a static element.

        `htmlFor` as well as the nesting: redundant to a browser, and the pair is
        what makes the association survive a future reader moving the input.
      */}
      <label className={styles.searchFrame} htmlFor="site-search-field">
        <span className={styles.searchLabel}>{labels.field}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className={styles.searchGlyph}>
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12.6 12.6 L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
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
          value={completion ?? query}
          onChange={(event) => onType(event.currentTarget.value, event.nativeEvent)}
        />
      </label>

      <div className={styles.searchPanel} ref={panelRef}>
        {/*
          The server-rendered index. This component writes only `hidden` and one
          `tabindex` into it.

          **The `tabindex="0"` is a real fix and not a lint appeasement.** This box
          scrolls, and the rows inside it left the tab order (see the header), so
          without it a keyboard reader could reach a scrolling region by no means
          at all — axe reported `scrollable-region-focusable`, serious, in both
          themes. One stop, named, right after the field, from which the arrows
          take over.
        */}
        {/* **The tab stop below is refused with a measurement, not silenced.**
            The rule's heuristic
            is "only interactive elements take a tabindex"; the exception it does
            not know is a **scrolling region**, which WCAG 2.1.1 requires to be
            reachable by keyboard and axe reports as `scrollable-region-focusable`.
            This box scrolls and its rows are out of the tab order — the header
            says why — so without the attribute a keyboard reader could reach it by
            no means at all. Measured on the build, both themes:

              scrollable-region-focusable  serious  .searchPanel

            Giving it an interactive role to satisfy the rule would put a control
            in the accessibility tree that answers to nothing, which is the defect
            the rule exists to prevent. `role="group"` and a name are what an
            unnamed generic tab stop would otherwise lack. */}
        <div
          className={styles.searchResults}
          role="group"
          aria-label={labels.listLabel}
          /* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- see above */
          tabIndex={0}
        >
          {children}
        </div>

        {/*
          **The count, announced.** A sighted reader watches the list shrink; a
          screen-reader user hears nothing at all unless something says so.
          `role="status"` is `aria-live="polite"` with a role attached: it waits
          for a pause rather than interrupting.

          Visible text and not a hidden twin, because the number is as useful to
          the eye as to the ear — and one string is one string to translate rather
          than two to keep in step. Empty until the first filter runs, so the panel
          does not open on "15 résultats" before anyone has asked anything.
        */}
        <p id="site-search-count" className={styles.searchCount} role="status">
          {announcement}
        </p>
      </div>
    </div>
  );
}
