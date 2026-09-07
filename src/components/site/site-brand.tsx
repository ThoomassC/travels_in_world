import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { localePathname } from "@/i18n/pathname";
import type { Locale } from "@/i18n/routing";
import { BRAND_PLANE_PATH, BRAND_PLANE_VIEWBOX } from "./brand-art";
import styles from "./site-brand.module.css";

/**
 * The header lock-up: the aeroplane on its medallion, the name — and the link home.
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
 * WHAT THE INLINE SVG COSTS, since it lands in the HTML of every route. The old
 * lock-up — a banked aeroplane plus a dotted trajectory — was 471 bytes of markup.
 * The mark the owner supplied on 7 September 2026 is a shorter *document* (one
 * `<path>` instead of two, no `<g>`, no transform, no dash attributes) and a much
 * longer *path*, because the airframe carries two nose curves and the needle is a
 * second contour: **1343 bytes of markup**, measured in the built HTML.
 *
 * On the page, that is **+0.3 KiB brotli per document** — `/fr/a-propos` 7.4 to
 * 7.7, `/fr/voyages` 8.4 to 8.6, `/fr/villes` 7.7 to 7.9 — against a 100 KiB
 * ceiling. The figure is quoted with a caveat the README earns: this repository
 * measured a 74-byte spread between two builds of an identical tree, so a
 * document delta this size is only worth stating because it moved the same way on
 * three routes at once and has an obvious cause. `tests/build/prerender.test.ts`
 * is what actually holds the line.
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
      {/*
        The medallion (TIW-38) — a plain wrapper, because a disc is a box and an
        `<svg>` cannot be both the drawing and the round plate under it without
        the mark stretching to the plate's square.

        It is filled with `--accent-active`, the header bar's own colour, so on
        the bar it is invisible and below the bar it is the bar continuing. That
        is what makes the owner's ask — "que le fond du header s'adapte" — a
        property of the markup rather than of the image: the mark is a
        transparent cut, and what shows through it is the header.
      */}
      <span className={styles.medallion}>
        {/*
          The aeroplane, in its own box rather than in a square one: the drawing
          is 0.72 : 1 and a square viewBox would have spent a fifth of the disc on
          empty margin. `./brand-art.ts` says why the favicon does the opposite.

          `fillRule="evenodd"` is load-bearing, not decoration: the second contour
          of the path is the compass needle, and it is a hole. With the default
          non-zero rule it fills solid and the mark loses its only detail.
        */}
        <svg
          className={styles.mark}
          viewBox={BRAND_PLANE_VIEWBOX}
          aria-hidden="true"
          focusable="false"
        >
          <path className={styles.plane} d={BRAND_PLANE_PATH} fillRule="evenodd" />
        </svg>
      </span>

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
