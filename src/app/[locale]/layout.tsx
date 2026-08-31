import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";
import "@/styles/tokens.css";

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

  return (
    <html lang={locale}>
      <body>
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
