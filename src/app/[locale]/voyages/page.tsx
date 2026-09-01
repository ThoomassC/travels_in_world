import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TripCatalogue } from "@/components/trips/trip-catalogue";
import { listTripSummaries } from "@/content/trips";
import { localePathname } from "@/i18n/pathname";
import { tripsPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { shareMetadata } from "../../share";
import { MAIN_CONTENT_ID } from "../main-content";
import styles from "./page.module.css";

type LocaleParams = { locale: string };

/**
 * The full listing: every published trip, grouped by continent and then by
 * country, in the order the reader reads.
 *
 * **Rendered by the server, readable with JavaScript disabled**, and that is an
 * acceptance criterion rather than a preference. There is no `'use client'` in
 * the tree this page renders, no `next/image`, and no `Link` from
 * `@/i18n/navigation` — the last one is what would have shipped next-intl's
 * client `Link` to a page made entirely of plain anchors (measured at 3.8 KB
 * brotli and two chunks on `/fr`; see
 * `docs/adr/0005-getpathname-sans-le-link-client.md`). Filters and search are out
 * of this ticket's scope, which is what makes zero client JavaScript the natural
 * outcome and not an achievement.
 *
 * **On sharing a directory with TIW-16.** `/voyages/[slug]` is the trip page and
 * belongs to that ticket; this file is `/voyages`, the index of the collection
 * those pages are items of. They are separate files under one segment and neither
 * touches the other — the URL is the reason: `src/i18n/paths.ts` defines
 * `TRIP_SEGMENT` once, `tripPath()` addresses an item and `tripsPath()` addresses
 * this listing, so any other URL for it would be a second spelling of the same
 * collection.
 *
 * **No `dynamicParams` declaration here, unlike the trip page.** That export
 * matters for a route with a `[slug]` Next would otherwise render on demand;
 * this route has no dynamic segment of its own below `[locale]`, whose values
 * come from the layout's `generateStaticParams`. `npm run test:build` is what
 * confirms the outcome rather than this comment: the route has to appear in
 * `.next/prerender-manifest.json`, and its payload is budgeted automatically
 * because that suite derives its route list from the manifest.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  /**
   * `getTranslations({ locale, namespace })` and never the implicit
   * `getTranslations(namespace)`. Inside `[locale]` the implicit form is safe
   * once `setRequestLocale` has run — but `generateMetadata` runs *before* the
   * component, so there is no request locale set yet, and next-intl would read
   * the request headers to find one. A single such read turns the whole route
   * tree dynamic with `next build` still exiting 0, which is invariant 1 breaking
   * in silence. Same reasoning, at length, in `src/app/not-found.tsx`.
   */
  const t = await getTranslations({ locale, namespace: "trips" });
  const site = await getTranslations({ locale, namespace: "metadata" });

  /**
   * `shareMetadata` rather than the two fields this used to return. The canonical
   * is mandatory on every page — the layout's canonical is the *home page's*, so
   * inheriting it would ask a crawler to drop this one in its favour — and the Open
   * Graph block has to repeat `siteName` and `locale`, because Next replaces the
   * parent's `openGraph` wholesale instead of merging into it. See
   * `src/app/share.ts`.
   *
   * No share image, deliberately: this page is an index, and the only pictures the
   * project holds are the trips' own photos. Promoting one of them here would put a
   * single trip's picture on the card of the whole collection.
   */
  return shareMetadata({
    locale,
    path: localePathname({ href: tripsPath(), locale }),
    title: t("metaTitle"),
    description: t("metaDescription"),
    siteName: site("title"),
    type: "website",
  });
}

export default async function AllTripsPage({ params }: { params: Promise<LocaleParams> }) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const trips = await listTripSummaries();
  const t = await getTranslations("trips");

  return (
    /*
      The landing point of the layout's skip link — the same `id` and the same
      `tabIndex={-1}` as the home page, from the same constant. See
      `../layout.tsx` for why the attribute is needed and why the `id` cannot
      live in the layout.
    */
    <main id={MAIN_CONTENT_ID} tabIndex={-1}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("allHeading")}</h1>
        {/*
          The count is announced only when there is something to count. With no
          trip the sentence below says so in words, and a "0 voyage, groupé par
          continent" line above nothing is exactly the empty block the acceptance
          criterion refuses.
        */}
        {trips.length > 0 ? (
          <p className={styles.intro}>{t("allIntro", { count: trips.length })}</p>
        ) : null}
      </header>

      {trips.length === 0 ? (
        <section className={styles.empty}>
          <h2>{t("emptyHeading")}</h2>
          <p className={styles.emptyBody}>{t("emptyBody")}</p>
          {/*
            A way out, not just an apology. This page is reachable from the main
            navigation on every page of the site, so a reader can land here first
            — and an empty page with no link is a dead end.
          */}
          <a className={styles.emptyLink} href={localePathname({ href: "/", locale })}>
            {t("emptyBackHome")}
          </a>
        </section>
      ) : (
        <TripCatalogue trips={trips} locale={locale} />
      )}
    </main>
  );
}
