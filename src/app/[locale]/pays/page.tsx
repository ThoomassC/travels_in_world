import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CountryList } from "@/components/countries/country-list";
import { loadTrips } from "@/content/trips";
import { localePathname } from "@/i18n/pathname";
import { countriesPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { shareMetadata } from "../../share";
import { PAGE_MARK } from "@/components/site/site-nav";
import { MAIN_CONTENT_ID } from "../main-content";
import { countryEntries } from "./entries";
import styles from "./page.module.css";

type LocaleParams = { locale: string };

/**
 * The countries this carnet has been to: one row each, with its silhouette, its
 * number of trips and its number of cities, leading to the country's own page.
 *
 * **Why this page exists, and what it took from `/voyages`.** The « Pays » entry
 * of the main navigation used to point at the catalogue, whose heading reads
 * « Voyages par pays » — three names for one thing, which stopped being tolerable
 * the day real country pages arrived. This is the page the entry names: the
 * address is `/pays`, the heading is « Pays », and the tab says « Pays ». The
 * catalogue keeps its own URL and its own job — every trip, grouped, filed under
 * its first arrival — and is reached from the home page and from each country
 * page.
 *
 * **No planisphere here either**, for the reason the country pages give at
 * length: 186 KB of world paths on an index of five rows, in three languages,
 * buys a drawing nobody asked for. Each row carries its own country fitted to its
 * own 40-unit frame — 3.3 KB for the five, and `countryTile` memoises per code,
 * so the five projections are built once for the whole build and not once per
 * locale.
 *
 * **The row is a component and not markup**, because the home page's map is to
 * carry the same list on a narrow screen. Two spellings of one row is how a count
 * ends up phrased differently on two pages of one site; see
 * `src/components/countries/country-list.tsx`.
 *
 * **Rendered by the server, readable with JavaScript disabled**, like the two
 * listings beside it: no `'use client'` in this tree, no `next/image`, and plain
 * anchors rather than `Link` from `@/i18n/navigation` — the last one is what would
 * ship next-intl's client `Link` to a page made entirely of anchors (measured at
 * 3.8 KB brotli and two chunks on `/fr`; see
 * `docs/adr/0005-getpathname-sans-le-link-client.md`).
 *
 * **No `dynamicParams` declaration here, unlike `./[slug]/page.tsx`.** That export
 * matters for a route with a dynamic segment Next would otherwise render on
 * demand; this route has none of its own below `[locale]`, whose values come from
 * the layout's `generateStaticParams`. `npm run test:build` is what confirms the
 * outcome rather than this comment.
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
   * `getTranslations(namespace)`. Inside `[locale]` the implicit form is safe once
   * `setRequestLocale` has run — but `generateMetadata` runs *before* the
   * component, so there is no request locale set yet and next-intl would read the
   * request headers to find one. A single such read turns the whole route tree
   * dynamic with `next build` still exiting 0, which is invariant 1 breaking in
   * silence.
   */
  const t = await getTranslations({ locale, namespace: "country" });
  const site = await getTranslations({ locale, namespace: "metadata" });

  /**
   * `shareMetadata`, and the canonical is the point: the locale layout's canonical
   * is the *home page's*, so a page declaring none would ask a crawler to drop this
   * one in favour of `/fr`. `tests/build/durable-urls.test.ts` refuses exactly
   * that, and it is also what keeps `countriesPath()` agreeing with this folder's
   * name.
   *
   * No share image, for the reason the two other indexes give: this page is an
   * index, and the only pictures the project holds are the trips' own photographs.
   */
  return shareMetadata({
    locale,
    href: countriesPath(),
    title: t("metaTitle"),
    description: t("metaDescription"),
    siteName: site("title"),
    type: "website",
  });
}

export default async function CountriesPage({ params }: { params: Promise<LocaleParams> }) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  /**
   * **`loadTrips()` and not `listTripSummaries()`**, the same unusual call
   * `/villes` makes and for the same reason: `TripSummary` carries `countryCodes`
   * and the single `firstArrival`, while the full list of a trip's places — which
   * is what the second count on every row is — lives on `TripDetail` alone. The
   * façade memoises its parse for the whole build, so the cost here is a
   * projection and never a second read of the disk.
   *
   * Untold trips are included, deliberately: a journey whose récit is not written
   * still happened, its country is tinted on the map and its card is in the
   * catalogue. Counting it here is the same decision.
   */
  const trips = await loadTrips();
  const t = await getTranslations("country");

  const countries = countryEntries(trips, locale);

  return (
    /*
      The landing point of the layout's skip link — the same `id` and the same
      `tabIndex={-1}` as every other page, from the same constant. See
      `../layout.tsx` for why the attribute is needed and why the `id` cannot live
      in the layout.
    */
    <main id={MAIN_CONTENT_ID} tabIndex={-1} data-page={PAGE_MARK.countries}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("heading")}</h1>
        {/*
          The count is announced only when there is something to count. With no
          country the section below says so in words, and a "0 pays" line above
          nothing is exactly the empty block the two other indexes refuse.
        */}
        {countries.length > 0 ? (
          <p className={styles.intro}>{t("intro", { count: countries.length })}</p>
        ) : null}
      </header>

      {countries.length === 0 ? (
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
        <CountryList countries={countries} locale={locale} />
      )}
    </main>
  );
}
