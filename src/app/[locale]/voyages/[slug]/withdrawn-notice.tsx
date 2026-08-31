import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { LatestTrips } from "@/components/trips/latest-trips";
import type { TripEntry } from "@/components/trips/entry";
import { localePathname } from "@/i18n/pathname";
import type { Locale } from "@/i18n/routing";
import styles from "./withdrawn-notice.module.css";

/**
 * What stays at the address of a trip that was taken offline on purpose.
 *
 * WHY A PAGE AND NOT A 404. A 404 says "this address is wrong", and the reader who
 * followed a link somebody sent them concludes they mis-copied it, or that the site
 * is broken. A story withdrawn by its author is neither: the address was right, and
 * saying so — then offering the map and the latest trips — is the difference between
 * a dead end and a redirection of attention.
 *
 * **THE STATUS CODE IS 200 AND THE CRITERION ASKS FOR 410.** That gap is deliberate,
 * measured, and recorded here rather than in a commit message. Next 16.3.1 lets a
 * prerendered document carry 404 (`notFound()`), 401 and 403 (`unauthorized()`,
 * `forbidden()`) and has no equivalent for 410; a Route Handler *can* return 410,
 * and measured on this branch it stops being prerendered the moment it does — the
 * same handler returning 200 builds as `○`, returning 410 builds as `ƒ`, and the
 * `.meta` file Next writes next to a prerendered body has a `status` field it simply
 * declines to fill with anything but 200. So a real 410 costs a server function on
 * a URL that has no content to compute, against invariant 1 of AGENTS.md.
 *
 * What this page delivers instead is everything the criterion asks for except the
 * three digits: the reader's URL still resolves, it explains that the story is no
 * longer online, and it offers the map and the three latest trips. And it carries
 * `noindex, follow` — which is what actually removes the page from an index, where
 * a 410 is a *request* to. The follow-up ticket is the one place a genuine 410 is
 * cheap: a platform-level rule in `vercel.json`, or the day Next exposes a `gone()`
 * interrupt with a prerenderable document.
 */

export type WithdrawnNoticeProps = {
  readonly locale: Locale;
  /**
   * Every published trip, in the façade's order. `LatestTrips` slices the three it
   * shows — the number is its own, so this page cannot disagree with the home page
   * about what "les derniers voyages" means.
   */
  readonly trips: readonly TripEntry[];
};

export function WithdrawnNotice({ locale, trips }: WithdrawnNoticeProps): ReactElement {
  const t = useTranslations("withdrawn");

  return (
    <div className={styles.page}>
      {/*
        `<h1>` and not `<h2>`: this is the page's subject. The heading names what
        happened in the reader's words — "Ce récit n'est plus en ligne" — and never
        the status code or the slug, which is the "aucune trace technique" half of
        the criterion the 404 page carries too.
      */}
      <section className={styles.notice}>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.body}>{t("body")}</p>
        {/*
          A plain anchor, and the href comes from `localePathname` — never from
          `getPathname` in `@/i18n/navigation`, which ships next-intl's client
          `Link` to a page made of two anchors. Measured at 3.8 KB brotli on a page
          inside `[locale]`; see docs/adr/0005 and the fingerprint guard in
          `tests/build/prerender.test.ts`.
        */}
        <a className={styles.link} href={localePathname({ href: "/", locale })}>
          {t("backMap")}
        </a>
      </section>

      {/*
        The three latest trips, through the home page's own component rather than a
        second implementation of them. It brings its own heading, its own count and
        its own "Voir tous les voyages" link — which is the criterion's second way
        out — and its own honest empty block for the state this site is in today,
        where nothing is published and a "Derniers voyages" heading above nothing
        would be the one thing worse than the withdrawal itself.
      */}
      <LatestTrips trips={trips} locale={locale} />
    </div>
  );
}
