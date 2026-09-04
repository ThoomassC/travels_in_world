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
        One sentence, and it names the map without depending on being next to one:
        this renders on `/fr/a-propos` too, where there is no map on the page — the
        reader has one nav entry away. It is also true in both states
        `holdsNoStory` covers: an empty collection, where the places are on their
        way, and an untold-only collection, where they are already drawn.
      */}
      <p className={styles.body}>{t("noticeBody")}</p>
    </aside>
  );
}
