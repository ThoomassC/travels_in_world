import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { localePathname } from "@/i18n/pathname";
import type { Locale } from "@/i18n/routing";
import {
  BRAND_LOCKUP_COMET_TRANSFORM,
  BRAND_LOCKUP_TRACK_DASH,
  BRAND_LOCKUP_TRACK_PATH,
  BRAND_LOCKUP_TRACK_WIDTH,
  BRAND_LOCKUP_VIEWBOX,
  BRAND_COMET_PATH,
} from "./brand-art";
import styles from "./site-brand.module.css";

/**
 * The header lock-up: the comet, the trajectory, the name — and the link home.
 *
 * **No `'use client'`, and no JavaScript at all.** One `<a href>` wrapping an
 * inline `<svg>` and a `<span>`. The milestone's two client boundaries belong to
 * the map's interaction (TIW-14) and the photo viewer (TIW-17); a logo is not one
 * of them, and a logo that shipped a runtime would ship it on every route of the
 * site.
 *
 * **The href comes from `localePathname`, never from `@/i18n/navigation`.** Every
 * export of that module is built inside one `createNavigation(routing)` call whose
 * file imports a `"use client"` `BaseLink` at the top level, so reaching any of
 * them registers a client reference for the route — 3.8 KB brotli on `/fr`, 12.4 KB
 * on `/_not-found`, for a page that renders a plain anchor. Same reason and same
 * measurement as `./site-nav.tsx`; see
 * `docs/adr/0005-getpathname-sans-le-link-client.md`, and note that
 * `tests/build/prerender.test.ts` fingerprints that `Link` in every initial chunk.
 *
 * **The locale is a prop, never `useLocale()`** — `localePathname` takes a
 * `Locale`, and the layout has already narrowed the URL segment with `hasLocale`.
 *
 * WHY THE SVG IS INLINE AND NOT AN `<img src="/icon.svg">`. An `<img>` renders its
 * SVG in a separate document, where `--logo-ink` and `--logo-accent` do not exist:
 * the mark would be frozen to whatever the file hardcodes and could not follow the
 * visitor's theme, which is an acceptance criterion. Inline is also what lets the
 * *page* override the two tokens, which is the other half of that criterion.
 *
 * WHAT THE INLINE SVG COSTS, since it lands in the HTML of every route: 471 bytes
 * of markup, 172 bytes brotli. Measured against the budgets in
 * `tests/build/prerender.test.ts` — `/fr` went from 36.26 KB to 36.36 KB brotli
 * against a 100 KB ceiling.
 */
export function SiteBrand({ locale }: { readonly locale: Locale }): ReactElement {
  const t = useTranslations("brand");

  return (
    <a className={styles.brand} href={localePathname({ href: "/", locale })}>
      {/*
        `aria-hidden` and no `<title>`: the mark carries no information the name
        beside it does not already carry, and an announced decoration is noise.
        The accessible name of this link comes from the two spans below, which is
        also what makes it work for voice control — a spoken "Travels in World"
        matches text that is really in the accessibility tree, not an `aria-label`
        that shadowed it.

        `focusable="false"` is not redundant with `aria-hidden` — old Trident and
        Edge put SVG elements in the tab order regardless. It costs 18 bytes.
      */}
      <svg
        className={styles.mark}
        viewBox={BRAND_LOCKUP_VIEWBOX}
        aria-hidden="true"
        focusable="false"
      >
        {/*
          The trajectory first, so the comet paints over it if a future placement
          ever brings them within a hair of each other. They are ~7 units apart
          today; `./brand-art.ts` records why that clearance is the load-bearing
          number of this mark.
        */}
        <path
          className={styles.track}
          d={BRAND_LOCKUP_TRACK_PATH}
          fill="none"
          strokeWidth={BRAND_LOCKUP_TRACK_WIDTH}
          strokeLinecap="round"
          strokeDasharray={BRAND_LOCKUP_TRACK_DASH}
        />
        <g transform={BRAND_LOCKUP_COMET_TRANSFORM}>
          <path className={styles.comet} d={BRAND_COMET_PATH} />
        </g>
      </svg>

      {/*
        `lang="en"` on the name, in a `lang="fr"` document. The brand is three
        English words, and a French screen reader reading them with French
        phonemes says something that is not the name of this site. The criterion
        asks for a pronounceable accessible name — "travels in world", and
        emphatically not the repository's `travels_in_world`, which a screen
        reader spells out underscore by underscore.
      */}
      <span className={styles.word} lang="en">
        {t("name")}
      </span>

      {/*
        Where the link GOES, for a reader who cannot see that it is the logo in
        the corner. Visually hidden text rather than `aria-label`, and the
        difference matters twice: `aria-label` would replace the name — losing the
        `lang="en"` above and, with it, the pronunciation — and it would leave the
        visible "Travels in World" out of the accessible name, which is what WCAG
        2.5.3 (Label in Name) asks a voice-control user to be able to say.

        The message starts with a comma on purpose: screen readers concatenate
        adjacent text nodes without punctuation, and "Travels in World retour à
        l'accueil" runs the two together as one phrase.
      */}
      <span className={styles.destination}>{t("homeDestination")}</span>
    </a>
  );
}
