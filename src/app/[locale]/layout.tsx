import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buildSearchEntries } from "@/components/search/entries";
import { countryTile } from "@/map";
import { collatorFor, countryNameOf } from "@/components/trips/format";
import { JournalNotice } from "@/components/site/journal-notice";
import { PaperGrain } from "@/components/site/paper-grain";
import { SiteNav } from "@/components/site/site-nav";
import { listTripSummaries, loadTrips } from "@/content/trips";
import { holdsNoStory } from "@/domain/trip";
import { localePathname } from "@/i18n/pathname";
import { aboutPath, placesPath, tripPath, tripsPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import "@/styles/tokens.css";
import { shareMetadata } from "../share";
import { SITE_URL } from "../site-url";
import { MAIN_CONTENT_ID } from "./main-content";
import styles from "./layout.module.css";

type LocaleParams = { locale: string };

/** Next 16 hands route params as a Promise — they must be awaited. */
type LocaleLayoutProps = {
  children: ReactNode;
  params: Promise<LocaleParams>;
};

export function generateStaticParams(): LocaleParams[] {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * The locale segment's metadata — and, since TIW-21, two things that describe the
 * home page rather than the layout. That is a coupling, so it is written down
 * rather than left to be discovered.
 *
 * `metadataBase` belongs here: it applies to "the current segment and below", so
 * one declaration lets every page under `[locale]` hand Next a *relative* canonical
 * and a relative `og:image` and have them resolved once, in Next's implementation
 * instead of a second one of ours. Without it Next warns and falls back to
 * `http://localhost:3000` — measured on this branch before the line existed: a
 * wrong absolute URL written into every prerendered document, with a green build.
 *
 * The **canonical and the Open Graph block below describe `/fr`**, the home page,
 * whose file (`./page.tsx`) belongs to another ticket and declares no metadata of
 * its own. Next merges metadata shallowly per top-level field, so a page declaring
 * `alternates` or `openGraph` replaces these entirely — `./voyages/page.tsx` and
 * `./voyages/[slug]/page.tsx` both do, through `shareMetadata`. The trap that
 * leaves is precise: a *new* page under this segment that forgets its own canonical
 * inherits the home page's, and asks to be de-indexed in its favour.
 * `tests/build/durable-urls.test.ts` refuses exactly that — it reads every
 * prerendered document and compares its canonical with its own URL.
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

  const t = await getTranslations({ locale, namespace: "metadata" });
  const siteName = t("title");

  return {
    metadataBase: SITE_URL,
    ...shareMetadata({
      locale,
      href: "/",
      title: siteName,
      description: t("description"),
      siteName,
      type: "website",
    }),
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  // An unknown locale must 404, not fall back silently: a typo'd prefix
  // otherwise serves French content under a URL claiming another language.
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Opts this segment into static rendering; without it every page using
  // translations is forced to be dynamic.
  setRequestLocale(locale);

  /**
   * `getTranslations({ locale, namespace })` and not the implicit form, even
   * though `setRequestLocale` has just run and the implicit form would work.
   * Explicit is what the 404 page and `generateMetadata` above both use, for the
   * reason invariant 1 gives: a read of the request locale in a layout is the one
   * that de-statifies the whole tree with `next build` still exiting 0.
   * `npm run test:build` is what confirms the outcome.
   */
  const t = await getTranslations({ locale, namespace: "trips" });

  /**
   * **Whether the journal holds a récit at all** — the notice below, and TIW-35.
   *
   * Read here rather than declared by a constant somebody has to remember to turn
   * off; `docs/le-bandeau-des-recits-a-venir.md` carries the arbitration, and the
   * short version is that the two banners of the home page then become mutually
   * exclusive by construction instead of by an arbitration nobody would maintain.
   *
   * **This is a disk read in a layout, so it is worth being precise about what it
   * costs and what it does not.** The façade memoises its parse for the whole life
   * of a build, and `src/app/[locale]/page.tsx` calls it too, so this is not a
   * second read of `content/trips` — measured in the ticket's report. And it does
   * **not** de-statify the tree: invariant 1 is about reading the *request* — a
   * header, a cookie, the URL — and a file read at build time is exactly what
   * prerendering is made of. `npm run test:build` is what confirms the outcome
   * rather than this comment.
   *
   * Not a `Promise.all` with `getTranslations` above: the two are independent, but
   * awaiting a memoised parse and a message catalogue in sequence costs one
   * microtask, and pairing them would suggest a waterfall exists where there is
   * none.
   */
  const noRecitYet = holdsNoStory(await listTripSummaries());

  /*
    The search's own catalogue. A second namespace rather than reaching into
    `t` above: `trips` and `search` are two vocabularies, and a row that read a
    card's wording would drift the day the card's changed.
  */
  const search = await getTranslations({ locale, namespace: "search" });

  /**
   * **The search index, built once per document and rendered as markup.**
   *
   * `loadTrips()` and not `listTripSummaries()`, which is the one unusual call
   * added here. The summary carries the countries and a single `firstArrival`;
   * the full list of a trip's places, its tags and its photographs' alt text —
   * the only free text a récit owns — live on the detail alone. The façade
   * memoises its parse for the whole build and both doors project from the same
   * parsed trips, so this is a second projection and never a second read of the
   * disk. `src/app/[locale]/villes/page.tsx` records the same trade for the same
   * reason.
   *
   * **Built in the layout because the search lives in the chrome**, and the
   * chrome is on every route. Two consequences worth stating rather than
   * discovering: the index lands in the HTML of every document — measured in this
   * ticket's report, and `tests/build/prerender.test.ts` is what caps it — and
   * every page pays the projection, which is arithmetic over already-parsed
   * objects.
   *
   * The naming and the collation come from the listing's own helpers, so a
   * country reads the same here, on `/voyages`, on `/villes` and under the map,
   * and so `buildSearchEntries` stays a pure function that knows no locale.
   */
  const searchEntries = buildSearchEntries({
    trips: await loadTrips(),
    labels: {
      countryName: (code) => countryNameOf(locale, code),
      compare: collatorFor(locale).compare,
      /*
        The plural is resolved here and never in `entries.ts`: plural rules are a
        property of the language, next-intl owns them, and a pure module that
        picked a form would be a second implementation of French and Spanish.
        One call per trip, at build time.
      */
      stepCount: (count) => search("stepCount", { count }),
      unwritten: search("unwritten"),
    },
    tripHref: (slug) => localePathname({ href: tripPath(slug), locale }),
    /*
      An untold trip has no page — `tripStaticParams` never built one — so its row
      addresses its entry in the listing instead. The same branch the map's
      markers take, and for the same reason: a row pointing at a 404 would be in
      the suggestions of every document on the site.
    */
    tripEntryHref: (slug) =>
      localePathname({ href: `${tripsPath()}#voyage-${slug}`, locale }),
    /*
      **The vignette's geometry, and the only place it can be computed.**
      `@/map` is server-only and `entries.ts` is pure, so the projection is handed
      over as a callback exactly as the country's name is. `countryTile` memoises
      per code, so thirteen trips over five countries build five projections.
    */
    tilePointOf: (place) => countryTile(place.countryCode)?.place(place.coordinates),
    countriesHref: localePathname({ href: tripsPath(), locale }),
    placesHref: localePathname({ href: placesPath(), locale }),
    pages: [
      { label: t("navMap"), href: localePathname({ href: "/", locale }) },
      { label: t("navCountries"), href: localePathname({ href: tripsPath(), locale }) },
      { label: t("navPlaces"), href: localePathname({ href: placesPath(), locale }) },
      { label: t("navAbout"), href: localePathname({ href: aboutPath(), locale }) },
    ],
  });

  /**
   * **One outline per country the suggestions reach, deduplicated here.**
   *
   * Nine of this carnet's thirteen trips are French, and the panel is in the HTML
   * of every document on the site: as one `<symbol>` referenced nine times that
   * country costs 658 bytes rather than six thousand. Derived from the entries
   * rather than from the trips, so a trip whose country the dataset cannot draw
   * simply has no `art` and contributes no outline — the row keeps its words.
   *
   * `Map` and not a `Set` of codes plus a second lookup: the order is the order
   * the trips arrive in, which is the content façade's sort, which is what keeps
   * the prerendered markup byte-identical between two builds.
   */
  const searchCountries = [
    ...new Map(
      searchEntries
        .map((entry) => entry.art?.country)
        .filter((code): code is string => code !== undefined)
        .map((code) => [code, countryTile(code)])
    ),
  ].flatMap(([code, tile]) => (tile === undefined ? [] : [{ code, path: tile.path }]));

  return (
    <html lang={locale}>
      <body>
        {/*
          The grain (TIW-38). First in the document and `position: fixed` behind
          everything, so it is one paint under the whole site rather than a
          background each block has to remember. It is `aria-hidden` decoration
          with nothing focusable in it, so it does not disturb the tab order the
          note below describes — the skip link is still the first focusable thing.
        */}
        <PaperGrain />
        {/*
          The skip link, and it is the first focusable thing in the document
          because that is the entirety of what it does.

          2.4.1 is already satisfied by this site's headings and landmarks, so
          this is not a conformance fix.

          **What it actually skips, measured rather than assumed.** With four
          published trips, the tab order of `/fr` is: this link, the two nav
          entries, then one marker per trip, then one link per card. Activating
          this link moves the focus onto `<main>` and the next Tab lands on the
          first marker — so it skips the navigation, on every route, and it does
          NOT skip the markers. The markers are inside `<main>`: on the home page
          the map *is* the content, not the chrome. Skipping past sixty markers
          would need a second target below the map, and that is a decision about
          the page rather than about this link.

          `tabIndex={-1}` on the target is not decoration: without it Safari
          moves the scroll position and leaves the focus on the link, so the next
          Tab continues from the top of the page and the reader has skipped
          nothing. The target is `<main>`, which the *pages* render — there is one
          `<main>` per document — so the `id` lives with them and the constant is
          shared through `./main-content`.

          Outside `NextIntlClientProvider` because it needs nothing from it: the
          label comes from `getTranslations` above, on the server. Its place in
          the DOM is what matters, and it is first.
        */}
        <a className={styles.skip} href={`#${MAIN_CONTENT_ID}`}>
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          {/*
            The main navigation lives in the layout and not in each page, so that
            every route under `[locale]` — the trip pages of TIW-16 included —
            carries it without doing anything. It is two plain anchors and zero
            byte of JavaScript; the one thing it gives up for that is
            `aria-current="page"`, and `SiteNav` records why at length.

            Inside the provider rather than around it: a Server Component reading
            `useTranslations` needs the request configuration, which
            `setRequestLocale` above has just set, and keeping the nav in the same
            subtree as the pages means one place decides what "the current locale"
            is.
          */}
          <SiteNav
            locale={locale}
            searchEntries={searchEntries}
            searchCountries={searchCountries}
          />
          {/*
            The journal-state notice (TIW-35), and its three positions in this file
            are each a decision.

            **In the layout**, because "visible sur toutes les pages sous
            `[locale]`" is a criterion, and a line each page has to remember to
            render is not one. `src/app/not-found.tsx` sits above this segment and
            therefore does not carry it, which is what the criterion says.

            **After the nav and before `<main>`.** After, so a screen reader meets
            the site's navigation before a note about the site's state, and so the
            notice is not the first thing announced on every single page load.
            Before `<main>`, so it is outside what the skip link jumps to: a reader
            who has read the sentence once skips it with the rest of the chrome on
            the next fifty-nine pages, and the notice adds no tab stop of its own to
            pay for that.

            **Adjacent to `<main>`, and that adjacency is load-bearing** — the
            stylesheet's `.notice + main` rule is what makes this notice cost
            nothing at the fold instead of pushing the map off the first screen.
            Inserting anything between the two silently gives back the 60-odd pixels
            it reclaims, at both reference viewports. `journal-notice.module.css`
            carries the measurement.

            Rendered only when there is nothing to read. `JournalNotice` takes no
            props, so this branch is the whole of the condition and cannot be a
            component quietly returning `null` — the same shape as
            `FreshTripBanner` on the home page, and the pair can never both appear
            (`holdsNoStory` in `src/domain/trip.ts`).
          */}
          {noRecitYet ? <JournalNotice /> : null}
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
