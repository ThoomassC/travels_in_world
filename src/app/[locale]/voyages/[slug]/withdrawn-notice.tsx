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
 * **THE STATUS CODE IS 200 AND THE CRITERION ASKS FOR 410.** That gap is deliberate
 * and measured. TIW-21 shut two doors on it; TIW-31 reopened both and came back with
 * the line that closes each, so what follows is a citation and not a recollection.
 *
 * **Next has no 410 anywhere, and neither does its `canary`** (both read 2026-09-01).
 * A page's status is whatever the render pipeline leaves on the response, and the
 * pipeline's only non-200 exits are a redirect, a 500, and the access fallbacks —
 * which are a closed set of three, `{ NOT_FOUND: 404, FORBIDDEN: 403, UNAUTHORIZED:
 * 401 }`, in `next/dist/client/components/http-access-fallback/http-access-fallback.js:35-40`.
 * A Route Handler *can* return 410, and the line that un-prerenders it the instant it
 * does is `next/dist/export/routes/app-route.js:95` —
 * `const isValidStatus = response.status < 400 || response.status === 404` — which
 * sends every other 4xx down the `revalidate: 0` branch, i.e. `ƒ`. That is the whole
 * of the measured `○`-becomes-`ƒ`, in one expression.
 *
 * And a correction to what this comment used to say, because it named the wrong
 * culprit: the `.meta` file is **not** the obstacle. Next writes its `status` from
 * `res.statusCode` for *any* status above 300
 * (`next/dist/export/routes/app-page.js:129-142`), so the field would carry a 410
 * without complaint. Nothing upstream of it can produce one.
 *
 * **The platform can, and it is still not taken.** A `routes` rule in `vercel.json`
 * does accept a status with no redirect attached — `{ "src": "/legacy", "status":
 * 404 }` is a documented example, and the docs now allow `routes` to sit beside the
 * `headers` and `redirects` this project already uses, which is what used to make
 * this a restructuring. What no document settles is the half that decides it here:
 * whether such a rule answers 410 *with this page* or with an empty body. Nothing in
 * this repository executes `vercel.json` — not `next build`, not `next start`, not
 * Playwright — so the question has no answer short of a deployment, and guessing it
 * wrong trades a reader who gets an explanation for a reader who gets three digits.
 * `docs/deploiement.md` carries the rule, ready, for the day someone can measure it.
 *
 * What this page delivers instead is everything the criterion asks for except the
 * three digits: the reader's URL still resolves, it explains that the story is no
 * longer online, and it offers the map and the three latest trips. And it carries
 * `noindex, follow` — which is what actually removes the page from an index, where
 * a 410 is a *request* to.
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
