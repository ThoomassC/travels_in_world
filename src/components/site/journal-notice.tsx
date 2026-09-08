import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import styles from "./journal-notice.module.css";

/**
 * The journal's state, said in one sentence at the top of every page under
 * `[locale]` — TIW-35.
 *
 * It answers a reader who arrives on a complete site with a working map and not one
 * récit to read, and who has no way of telling "in progress" from "broken". The
 * places arrive before the stories do, because a place is known as soon as the
 * journey happened and a date often is not, so `story: unwritten` (TIW-18) is the
 * ordinary first state of the collection rather than an edge case.
 *
 * **Rendered by the layout only when the journal holds no récit**, and never as an
 * empty shell. The condition is `holdsNoStory` in `src/domain/trip.ts`; the branch
 * is in `src/app/[locale]/layout.tsx`. So this component takes no props at all — the
 * absence is decided one level up, where the layout has already read the collection,
 * rather than by a component that can return `null` and be forgotten in a test. Same
 * shape, and the same reason, as `FreshTripBanner`.
 *
 * **In the layout and not in each page**, because "toutes les pages sous `[locale]`"
 * is a criterion and a discipline three pages have to keep is not a criterion.
 * `/_not-found` sits *above* the locale segment and therefore does not carry it,
 * which is what the criterion says.
 *
 * **A band, and it used to be a line.** TIW-35 shipped this as one muted sentence
 * in the whitespace above the `<h1>` — « une ligne, pas un encart » — and the
 * stylesheet next door still carries the fold measurement that decided it. The
 * owner reversed the call: a reader who lands on a carnet with a working map and
 * no récit was not noticing the line at all, and being noticed is the entire job
 * of this component. It is now a full-bleed advisory band. What that costs at the
 * fold, and what was given back to pay for it, is in `journal-notice.module.css`.
 *
 * **Zero byte of JavaScript.** An `<aside>`, a `<p>` and a stylesheet. The
 * milestone's two `'use client'` boundaries are spent — the map's interaction
 * (TIW-14) and the photo viewer (TIW-17) — and a banner nobody can dismiss has no
 * use for a third. Synchronous, hence `useTranslations` and not `getTranslations`,
 * the reason `SiteNav` next door records: an `async` component cannot be rendered by
 * Testing Library at all.
 *
 * **Not dismissible, and that is a decision with a price attached.** The two
 * script-free ways to close a banner — `:target` and a hidden checkbox — both fail
 * on the same thing: each page of a prerendered site is a fresh document, so neither
 * persists past the first click on "Tous les voyages", and both add a tab stop to
 * every page of the site to buy that. What replaces the dismissal is below.
 *
 * **`<aside aria-label>`, and each of those three choices is refusing something.**
 *
 * - `<aside>` rather than a bare `<div>`: the sentence is complementary to whatever
 *   page carries it, and a landmark is what makes it *skippable* — one gesture in a
 *   screen reader's landmark list. That is the accessible equivalent of the dismiss
 *   button this banner does not have, with no state to persist. It holds no
 *   focusable element, so it costs the keyboard nothing.
 * - **No `role="alert"`**, which the acceptance criterion names: the role interrupts
 *   the reader mid-sentence, and this is permanent information rather than an
 *   urgency. No `role="status"` either — a live region over bytes frozen at build
 *   time announces nothing to anybody, ever, and only muddies what the landmark is.
 * - **No heading, and `aria-label` instead.** A `<h2>` here — even visually hidden —
 *   would sit *before* the `<h1>` of every page in the document and break the
 *   heading order `tests/e2e/heading-order.populated.spec.ts` guards. So the region
 *   is named by an attribute, which is the one case
 *   `docs/adr/0003-carte-svg-inerte-et-balises-html.md` leaves open when it refuses
 *   `aria-label` for a marker: there the attribute would have *replaced* the
 *   content, here it names a region whose content is a real text node beside it.
 */
export function JournalNotice(): ReactElement {
  const t = useTranslations("trips");

  return (
    <aside className={styles.notice} aria-label={t("noticeLabel")}>
      {/*
        The band bleeds to both edges of the viewport, so the sentence needs a box
        of its own to stay on the page's measure — otherwise it would start at the
        glass on a wide screen while every other first letter of the document
        starts at the content column.
      */}
      <div className={styles.inner}>
        <p className={styles.body}>
          {/*
          The glyph, and it is not decoration in the sense that lets you drop it.
          The shared palette states the rule its semantic colours come with — « la
          couleur double toujours un mot ET un glyphe » — so the amber is never on
          its own in carrying "this is an advisory" (WCAG 1.4.1). The words do it,
          the shape does it, and the colour is the third channel rather than the
          only one.

          `aria-hidden` and `focusable="false"`: it repeats what the sentence
          beside it already says, and an announced decoration is noise. Same
          reasoning, and the same two attributes, as the header mark in
          `./site-brand.tsx`.
        */}
          <svg
            className={styles.glyph}
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 3.4 22.2 21.4 1.8 21.4 Z" />
            <path d="M12 9.6V14.4" />
            <path d="M12 17.9h0.01" />
          </svg>

          {/*
          One sentence, and it names the map without depending on being next to one:
          this renders on `/fr/a-propos` too, where there is no map on the page — the
          reader has one nav entry away. It is also true in both states
          `holdsNoStory` covers: an empty collection, where the places are on their
          way, and an untold-only collection, where they are already drawn.

          Inside the `<p>` rather than beside it, which is what centring forced.
          As a flex sibling the glyph sat against the left edge of a paragraph
          bounded by `--measure`, so on a wide screen it hung two hundred pixels
          away from a sentence centred inside that box. In the text flow it leads
          the first line and travels with it at every width.
        */}
          {t("noticeBody")}
        </p>
      </div>
    </aside>
  );
}
