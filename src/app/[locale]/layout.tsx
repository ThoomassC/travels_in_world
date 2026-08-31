import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";
import "@/styles/tokens.css";
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

  return {
    title: t("title"),
    description: t("description"),
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

  return (
    <html lang={locale}>
      <body>
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
          <SiteNav locale={locale} />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
