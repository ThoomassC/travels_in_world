import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { localePathname } from "@/i18n/pathname";
import { tripsPath } from "@/i18n/paths";
import type { Locale } from "@/i18n/routing";
import { SiteBrand } from "./site-brand";
import styles from "./site-nav.module.css";

/**
 * The site's header: the brand lock-up on one side, the main navigation — the map
 * and the full listing, at the same level — on the other.
 *
 * **No `'use client'`, and no JavaScript at all.** Two `<a href>` in a `<nav>` is
 * the whole component; the milestone's two client boundaries belong to the map's
 * interaction (TIW-14) and to the photo viewer (TIW-17), and neither is this.
 *
 * **Plain anchors, and the hrefs come from `localePathname`.** Not `Link` from
 * `@/i18n/navigation`: every export of that module is built inside one
 * `createNavigation(routing)` call whose module imports a `"use client"`
 * `BaseLink` at the top level, so reaching any of them ships next-intl's client
 * `Link` to the route — measured at 3.8 KB brotli and two chunks on `/fr`, and
 * 12.4 KB on `/_not-found`. This nav renders on **every** page of the site, so
 * that cost would be paid everywhere. Invariant 2 is still satisfied: the URL is
 * assembled inside `src/i18n/**`, which is what the rule asks. See
 * `docs/adr/0005-getpathname-sans-le-link-client.md`.
 *
 * **The locale is a prop, never `useLocale()`.** `src/i18n/paths.ts` states the
 * rule — "the locale arrives as a prop, never as ambient state" — and the type is
 * the reason it is not merely style here: `localePathname` takes a `Locale`, and
 * the layout has already narrowed the URL segment with `hasLocale` before
 * rendering. Reading it back from context would mean widening it to `string` and
 * narrowing it again, in a component that has no business deciding what a valid
 * locale is.
 *
 * **What is deliberately absent: `aria-current="page"`.** Marking the current
 * entry needs the pathname, and there are exactly two ways to get it — a client
 * component (`usePathname`), which the milestone does not allow and which would
 * put this nav's JavaScript on every route, or a request read, which de-statifies
 * the whole tree with `next build` still exiting 0 (invariant 1). Neither is
 * worth it for a two-entry navigation on pages whose `<h1>` names them. It
 * becomes worth revisiting the day the nav grows a third entry.
 */
export function SiteNav({ locale }: { readonly locale: Locale }): ReactElement {
  const t = useTranslations("trips");

  return (
    <header className={styles.header}>
      {/*
        The lock-up lives here rather than in the layout so that "the chrome" is
        one component with one stylesheet deciding how its two halves share a
        line. It is the link home from every page — `SiteBrand` records why it is
        a plain anchor and why the SVG is inline.

        OUTSIDE the `<nav>`, deliberately. A logo that is also a link home is not
        a navigation *entry*: putting it in the list would make a screen reader
        announce "3 éléments" and offer the reader a third destination that is the
        same page as the first one ("Carte" is `/fr`). The landmark stays a
        two-entry menu, and the way home stays where every site puts it.
      */}
      <SiteBrand locale={locale} />
      {/*
        Labelled, because `<nav>` is a landmark and an unlabelled one is
        announced as "navigation" with nothing to tell it from the next. There is
        only one today; naming it costs a message key and survives the second.
      */}
      <nav aria-label={t("navLabel")}>
        {/*
          `role="list"` is redundant markup that is NOT redundant in practice:
          `list-style: none` strips the list role in Safari with VoiceOver, and a
          nav that has lost it also loses its item count. The same note is on the
          marker list in `src/components/map/world-map.module.css`; jsdom keeps
          the role either way, so no unit test can see this.
        */}
        <ul className={styles.list} role="list">
          <li>
            <a className={styles.link} href={localePathname({ href: "/", locale })}>
              {t("navMap")}
            </a>
          </li>
          <li>
            <a className={styles.link} href={localePathname({ href: tripsPath(), locale })}>
              {t("navAll")}
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}
