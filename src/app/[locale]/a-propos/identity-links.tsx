import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { IdentityLink, IdentityLinkKey } from "./identity";
import styles from "./identity-links.module.css";

/**
 * The outbound links of "À propos" — the repository, and whatever else the author
 * has declared in `./identity.ts`.
 *
 * **No `'use client'`, and no JavaScript at all.** A `<ul>` of plain anchors. The
 * milestone's two client boundaries belong to the map's interaction (TIW-14) and
 * the photo viewer (TIW-17); this page spends none of that budget, which is the
 * whole point of the ticket that asks for it.
 *
 * **No `localePathname` and no `@/i18n/navigation`.** Every href here leaves the
 * site, so there is no locale prefix to add — invariant 2 is about *internal*
 * routes. (And reaching `@/i18n/navigation` would ship next-intl's client `Link`
 * to a page made of four anchors; see docs/adr/0005.)
 *
 * **It renders one row per link it is given, and has no notion of a missing one.**
 * That is deliberate rather than incidental: the only way this component can put a
 * dead anchor on the page is if `identityLinks` hands it one, and that function
 * throws instead. A component that iterated over the four *keys* and rendered a
 * disabled row for the absent ones would look almost identical and would be the
 * bug. `tests/app/identity-links.test.tsx` pins the behaviour from this side.
 */

/**
 * Link key → message key, written out rather than interpolated.
 *
 * `t(\`link${key}\`)` would be shorter and would make every one of these four
 * message keys invisible to `grep` — which is how a message survives in `fr.json`
 * long after the code that read it is gone, and how a *missing* one goes unnoticed
 * until the day that link is declared. The table also makes the mapping total:
 * `Record<IdentityLinkKey, …>` is what fails `npm run typecheck` if a fifth link
 * is added without a label.
 */
const LABEL_KEY: Record<IdentityLinkKey, string> = {
  repository: "linkRepository",
  portfolio: "linkPortfolio",
  instagram: "linkInstagram",
  contact: "linkContact",
};

export function IdentityLinks({
  links,
}: {
  readonly links: readonly IdentityLink[];
}): ReactElement {
  const t = useTranslations("about");

  return (
    /*
      `role="list"` is redundant markup that is NOT redundant in practice:
      `list-style: none` strips the list role in Safari with VoiceOver, and a list
      that has lost it also loses its item count — which here is the reader's only
      cue that they have reached the end of the ways to contact this site. Same
      note, same reason, as `src/components/site/site-nav.module.css`.
    */
    <ul className={styles.list} role="list">
      {links.map((link) => (
        <li key={link.key}>
          {/*
            No `target="_blank"`. It takes the back button away from the reader
            without asking and drags `rel="noopener"` in behind it; these are
            ordinary outbound links and the reader decides how to open them.

            The accessible name is the two spans together — "Le code source de ce
            site, sur GitHub github.com/ThoomassC/travels_in_world" — so it says
            where the link goes out of context, which is what someone tabbing
            through a list of links gets. Visible text rather than an
            `aria-label`, so voice control can say what is on the screen (WCAG
            2.5.3).
          */}
          <a className={styles.link} href={link.href}>
            <span className={styles.label}>{t(LABEL_KEY[link.key])}</span>
            <span className={styles.target}>{link.target}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
