"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent, ReactElement } from "react";
import { PhotoFigure } from "./photo-figure";
import type { PhotoView } from "./photo-figure";
import styles from "./photo-lightbox.module.css";

/**
 * The photo viewer — and the SECOND of the two `'use client'` components the
 * milestone allows (AGENTS.md, invariant 3; the other is the map's interaction).
 * Anything added here is paid by every reader of a trip page, against a 150 KB
 * brotli budget measured at 119.9 KB on `/fr`. Hence: no animation library, no
 * focus-trap library, no gesture library, no new dependency of any kind. Measured:
 * this file compiles to 1.5 KB brotli, in one chunk, on the trip route alone.
 *
 * **Four things this file is careful about.**
 *
 * 1. *It imports NOTHING but React, its own siblings and its stylesheet.* Not
 *    `@/content/**` — `@/content/trips` carries `import "server-only"` and the
 *    bundler exits 1, which is measured and wanted. Not `@/i18n/navigation`, whose
 *    five exports all come from one `createNavigation(routing)` in a module
 *    importing next-intl's `"use client"` `BaseLink` at the top level, so reaching
 *    any of them ships up to 12.4 KB of client `Link` — refused by the fingerprint
 *    guard in `tests/build/prerender.test.ts`. And **not `next-intl` at all**: the
 *    labels arrive as strings from `photo-viewer.tsx`, because calling
 *    `useTranslations` here put next-intl's client `IntlProvider` and its
 *    formatters into the shared chunk of *every* `[locale]` route — 1.8 KB brotli
 *    and one chunk on `/fr`, a page with no viewer on it. The numbers are in
 *    `photo-viewer.tsx`; the shape of the defect is TIW-28's, at half the size.
 *
 * 2. *The native `<dialog>` does the hard part.* `showModal()` gives a real focus
 *    trap, `Escape`, the top layer, `::backdrop` and an inert background — four
 *    things a hand-written trap gets wrong, in more code. What is added on top is
 *    the explicit focus restoration below, which the platform does not guarantee.
 *
 * 3. *The only bridge to the page is `data-photo-index`.* One delegated listener
 *    on the page's content element; no callback, no context, no client component
 *    wrapped around the galleries. The galleries stay Server Components rendering
 *    plain `<a href>` that work with no JavaScript at all.
 *
 * 4. *Nothing of a photo is in the initial HTML.* The `<dialog>` ships empty —
 *    an element and an `aria-labelledby` — and its content is mounted on open.
 *    Twelve `<picture>` elements with their placeholders would be ~4 KB of
 *    document on a route budgeted at 100 KB, for markup nobody has asked to see.
 *
 * The keyboard walk (`Escape`, `Tab` inside the modal, the arrows in a real
 * browser) is E2E territory: jsdom implements `<dialog>` as a plain element with
 * no `showModal`, no top layer and no `Escape` handling — see
 * `tests/components/photos/photo-lightbox.test.tsx` for exactly what the unit
 * suite can and cannot see.
 */

/**
 * The viewer's six strings, already translated and already formatted.
 *
 * Plain strings and not a translator function, which is the whole point of
 * `photo-viewer.tsx`: a function cannot cross the server/client frontier, and
 * calling next-intl's hook on this side of it ships its runtime to every route
 * under the `[locale]` layout.
 */
export type PhotoViewerLabels = {
  readonly heading: string;
  readonly close: string;
  readonly previous: string;
  readonly next: string;
  /**
   * « Photo 3 sur 12 », one per photo, index-aligned with `photos`.
   *
   * An array rather than a template with a placeholder, because interpolating one
   * here means an ICU formatter here. Read with a bounds check all the same: a
   * shorter array than `photos` is a caller's mistake, and an undefined position
   * line must not become the string "undefined" in front of a reader.
   */
  readonly positions: readonly string[];
};

export type PhotoLightboxProps = {
  /**
   * Every photo the viewer can show, in the order the arrows walk them. The index
   * of a photo here is the number its trigger's `data-photo-index` carries — see
   * `collection.ts`, which is the single place that numbering is derived.
   *
   * A plain serialisable DTO: this array crosses the server/client frontier, so
   * it is `PhotoView` and never a parsed `Photo`, a `TripDetail` or anything
   * holding a method.
   */
  readonly photos: readonly PhotoView[];
  /**
   * The element whose clicks are watched, by `id`.
   *
   * The trip page passes its `<main>`, not a gallery: photos live in two places
   * on that page — the trip's gallery and the stays of the timeline — so one
   * listener on their common ancestor is one listener, where one per grid would
   * be several. `data-photo-index` is what selects a trigger, so widening the
   * scope intercepts nothing else: the page's other links have no such attribute.
   */
  readonly scopeId: string;
  readonly labels: PhotoViewerLabels;
};

/**
 * The horizontal distance, in CSS pixels, past which a pointer gesture counts as
 * a swipe. Below it the gesture is a tap — and a tap on the photograph must not
 * move the viewer, or every attempt to look closely changes the picture.
 */
const SWIPE_MIN_PX = 40;

/** The dialog's accessible name comes from a real heading with this id. */
const VIEWER_HEADING_ID = "visionneuse-photos-titre";

export function PhotoLightbox({ photos, scopeId, labels }: PhotoLightboxProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  /** The `<a>` that opened the viewer, so focus can be handed back to it. */
  const triggerRef = useRef<HTMLElement | null>(null);
  const gestureRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const [index, setIndex] = useState<number | null>(null);

  const total = photos.length;

  /**
   * One delegated listener on a DOM node that is not in this component's React
   * tree — the legitimate use of `useEffect`, and the only one in this file:
   * synchronising with an outside system, with its cleanup.
   *
   * Delegation and not a listener per link: a trip with sixty photos would
   * otherwise attach sixty, and the galleries are server-rendered HTML this
   * component never sees as elements.
   */
  useEffect(() => {
    const scope = document.getElementById(scopeId);
    if (scope === null) {
      return undefined;
    }

    const openFromClick = (event: globalThis.MouseEvent): void => {
      /**
       * A modified click is the reader's, not ours. Ctrl/Cmd-click opens a new
       * tab, Shift-click a new window, Alt-click downloads, and the middle button
       * opens a background tab — every one of them a working way to get the photo
       * at full size, because the trigger is a real `<a href>`. Hijacking them
       * would turn four browser features into one modal.
       */
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      // `instanceof` rather than a cast: `event.target` is `EventTarget | null`,
      // and a cast here would be the one place a text node could reach `closest`.
      if (!(event.target instanceof Element)) {
        return;
      }
      const trigger = event.target.closest<HTMLElement>("[data-photo-index]");
      if (trigger === null) {
        return;
      }

      /**
       * Parsed strictly, because `Number("")` is `0` and not `NaN`: an empty
       * `data-photo-index` — a rendering mistake — would open the first photo and
       * look like a working viewer pointed at the wrong picture.
       */
      const raw = trigger.dataset.photoIndex;
      if (raw === undefined || !/^\d+$/.test(raw)) {
        return;
      }
      const opened = Number(raw);
      if (opened >= total) {
        return;
      }

      event.preventDefault();
      triggerRef.current = trigger;
      setIndex(opened);
    };

    scope.addEventListener("click", openFromClick);

    return () => scope.removeEventListener("click", openFromClick);
  }, [scopeId, total]);

  /**
   * `showModal()` is imperative and has no declarative equivalent — an `open`
   * attribute renders a *non-modal* dialog, with no top layer, no focus trap and
   * no inert background. So opening is a synchronisation with the platform, which
   * is again what `useEffect` is for.
   *
   * Closing is deliberately NOT done here: every close goes through
   * `dialog.close()`, and the `close` listener below is the single place state is
   * reset. One direction per path, so a state change and an event cannot both
   * decide to restore focus.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || index === null || dialog.open) {
      return;
    }
    dialog.showModal();
  }, [index]);

  /**
   * Moves by `delta`, and **stops at both ends rather than wrapping**.
   *
   * A wrapping viewer cannot tell a reader they have seen everything: the twelfth
   * photo followed by the first looks exactly like a thirteenth, and the only way
   * out of the loop is to notice a picture repeating. Clamping makes the end of
   * the set a fact, said twice — by the position line, and by a control that
   * announces itself unavailable.
   *
   * Two details that are load-bearing rather than stylistic. The updater form of
   * `setIndex`, because this runs from a listener registered once per `total`: a
   * closure over `index` would move from whichever photo was showing when the
   * listener was installed. And `useCallback` over `[total]`, so the effect below
   * can name it in its dependency list and re-register only when the photo set
   * changes — not on every render, and not behind a suppressed lint rule.
   */
  const step = useCallback(
    (delta: number): void => {
      setIndex((previous) => {
        if (previous === null) {
          return previous;
        }
        const next = previous + delta;

        return next < 0 || next >= total ? previous : next;
      });
    },
    [total]
  );

  /**
   * The dialog's own three events, listened for on the element and NOT through
   * React's `onClose` / `onKeyDown` / `onClick`.
   *
   * **`close` has to be here.** It does not bubble, so an element listener is the
   * shape that is certain to work whatever React's delegation does with it. And it
   * is the ONE place that reacts to a closed dialog, whichever of the three ways
   * closed it — `Escape` (the platform's, no code of ours), the cross, or a click
   * on the backdrop.
   *
   * **`keydown` and `click` joined it, and the linter is the honest reason.**
   * `jsx-a11y/no-noninteractive-element-interactions` refuses a mouse or keyboard
   * handler in the JSX of an element whose role is not a widget, and `<dialog>` is
   * one: a container, not a control. The rule is right in the general case, and
   * the answer is not to silence it — it is that this element is a *platform
   * object* this component already drives imperatively (`showModal`, `close`), so
   * its events belong in the same effect rather than half here and half in the
   * markup. Nothing is lost: a listener on the dialog sees keydowns and clicks
   * from every descendant, because both bubble.
   *
   * **The focus restoration is explicit and is not decoration.** A browser returns
   * focus to the previously focused element when a modal closes, but that is a
   * "should" the specification leaves to implementations, and the element it
   * remembers is not necessarily the one that opened the viewer — a swipe, for
   * instance, focuses nothing. Handing it back to the recorded trigger means the
   * reader's next `Tab` continues from the photo they clicked instead of the top
   * of the document (WCAG 2.4.3).
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return undefined;
    }

    const handleClose = (): void => {
      setIndex(null);
      gestureRef.current = null;
      const trigger = triggerRef.current;
      triggerRef.current = null;
      trigger?.focus();
    };

    /**
     * `preventDefault` because `ArrowLeft`/`ArrowRight` also scroll the document
     * sideways, and a viewer that changes the photo *and* nudges the page under it
     * reads as a glitch. `Escape` is deliberately absent: the UA closes a modal
     * dialog on it, and a second handler would be a second thing to keep correct.
     */
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    };

    /**
     * A click that lands on the dialog itself and not on its content is a click on
     * the area around the photograph — the gesture everyone expects to dismiss a
     * lightbox. `event.target` identity is what tells the two apart; a `closest`
     * test would call the photograph "outside" too, since it is a descendant of
     * the dialog.
     */
    const handleBackdropClick = (event: globalThis.MouseEvent): void => {
      if (event.target === dialog) {
        dialog.close();
      }
    };

    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("keydown", handleKeyDown);
    dialog.addEventListener("click", handleBackdropClick);

    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("keydown", handleKeyDown);
      dialog.removeEventListener("click", handleBackdropClick);
    };
  }, [step]);

  const close = (): void => {
    dialogRef.current?.close();
  };

  /**
   * Swipe, with Pointer Events and no library: `pointerdown` records the origin,
   * `pointerup` measures the trip. Two refusals matter as much as the threshold —
   * a non-primary pointer (the second finger of a pinch) and a gesture that
   * travelled further vertically than horizontally, which is a scroll and must
   * stay one.
   */
  const handlePointerDown = (event: PointerEvent<HTMLElement>): void => {
    gestureRef.current = event.isPrimary ? { x: event.clientX, y: event.clientY } : null;
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>): void => {
    const start = gestureRef.current;
    gestureRef.current = null;
    if (start === null) {
      return;
    }

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) >= Math.abs(dx)) {
      return;
    }

    // Dragging left reveals what comes after, the way a page turns.
    step(dx < 0 ? 1 : -1);
  };

  const handlePointerCancel = (): void => {
    gestureRef.current = null;
  };

  const current = index === null ? undefined : photos[index];

  return (
    /*
      No `onKeyDown` / `onClick` in this markup: the dialog's three events are
      registered on the element in the effect above — see the comment there for
      why that is the coherent place and not a way around the linter.
    */
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={VIEWER_HEADING_ID}>
      {current === undefined || index === null ? null : (
        <div className={styles.viewer}>
          {/*
            A visually hidden heading rather than an `aria-label` on the dialog,
            the same choice `trip-header.tsx` makes and for the same reason: a
            heading is a real text node, navigable and announced by every screen
            reader, where an attribute is a string a translator never sees in
            context and a tool cannot find in the DOM.
          */}
          <h2 className={styles.visuallyHidden} id={VIEWER_HEADING_ID}>
            {labels.heading}
          </h2>

          <div className={styles.bar}>
            {/*
              Where the reader is, as visible text — not a hidden announcement.
              `aria-live="polite"` because navigating replaces this text inside a
              region that is already in the tree, which is the case a screen
              reader does announce; the dialog's own opening announcement covers
              the first photo.

              `?? ""` rather than a non-null assertion: a `positions` array
              shorter than `photos` is a caller's mistake, and an empty line is a
              smaller failure in front of a reader than the word "undefined".
            */}
            <p className={styles.position} aria-live="polite">
              {labels.positions[index] ?? ""}
            </p>

            <button type="button" className={styles.control} onClick={close}>
              {/*
                A glyph for the eye and a text node for the name — never an
                `aria-label` on the glyph. `×` is `aria-hidden` so it is not
                announced as "times" beside the label.
              */}
              <span className={styles.glyph} aria-hidden="true">
                ×
              </span>
              <span className={styles.visuallyHidden}>{labels.close}</span>
            </button>
          </div>

          <figure
            className={styles.frame}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
            <PhotoFigure
              photo={current}
              /* Full-viewport: the 1440 px rung is the last one the ladder
                 carries, and past it the `<img>` fallback — the original — is
                 what a very wide screen gets. Deliberate, see `@/domain/photo`. */
              sizes="100vw"
              className={styles.image}
              /* The reader asked for this photograph and is looking at nothing
                 else: it is the LCP of the top layer. */
              loading="eager"
              fetchPriority="high"
            />
          </figure>

          {/*
            The arrows have visible equivalents, because a keyboard shortcut with
            no control beside it is a feature only its author knows about. Omitted
            entirely for a single photo: two permanently unavailable buttons are
            two tab stops that never do anything.
          */}
          {total > 1 ? (
            <div className={styles.steps}>
              {/*
                `aria-disabled` and not `disabled`, at both ends.

                A `disabled` button loses focus the instant it is disabled, and
                inside a modal that focus lands nowhere a reader can see — the
                exact moment they were mid-keyboard-walk. `aria-disabled` keeps the
                control focusable and announced as unavailable, which is the ARIA
                practice for a control that must not move focus. `step` clamps
                anyway, so activating one is a no-op rather than an error path.
              */}
              <button
                type="button"
                className={styles.control}
                aria-disabled={index === 0}
                onClick={() => step(-1)}
              >
                <span className={styles.glyph} aria-hidden="true">
                  ‹
                </span>
                <span className={styles.visuallyHidden}>{labels.previous}</span>
              </button>
              <button
                type="button"
                className={styles.control}
                aria-disabled={index === total - 1}
                onClick={() => step(1)}
              >
                <span className={styles.glyph} aria-hidden="true">
                  ›
                </span>
                <span className={styles.visuallyHidden}>{labels.next}</span>
              </button>
            </div>
          ) : null}
        </div>
      )}
    </dialog>
  );
}
