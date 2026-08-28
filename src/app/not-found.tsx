import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { homePathname } from "@/i18n/pathname";
import { routing } from "@/i18n/routing";
import "@/styles/tokens.css";

/**
 * Catches URLs that never reach the `[locale]` segment. The root layout renders
 * only its children, so this page owns `<html>`/`<body>` itself.
 *
 * Everything here resolves the locale EXPLICITLY, and that is load-bearing
 * rather than stylistic. Outside the `[locale]` segment there is no request
 * locale, so any implicit lookup makes next-intl read the request headers —
 * and measured on Next 16.3.1, a single such read turns the whole route tree
 * dynamic (`ƒ`), `/fr` included, instead of prerendered. Hence:
 *
 * - `getTranslations({ locale, namespace })` rather than `getTranslations(ns)`;
 * - `homePathname()` + a plain anchor rather than the `Link` component, which
 *   reads the request locale even when handed a `locale` prop. A 404 is also
 *   the one place where a full document load beats client-side navigation:
 *   it leaves the error state behind entirely.
 *
 * Both were verified by building with and without them.
 *
 * The href comes from `@/i18n/pathname` and NOT from `getPathname` in
 * `@/i18n/navigation`, and the difference on THIS route is 12.4 KB brotli of
 * client JavaScript and two chunks — 123.5 KB / 7 chunks before, 111.1 KB / 5
 * after. next-intl builds `getPathname` and its client `Link` in one call, so
 * importing the first ships the second, and the `Link` in turn pulls `useLocale`
 * from `use-intl` — the whole client intl runtime, onto a 404 that uses none of
 * it. That is why the saving here is far larger than the 3.8 KB the same import
 * costs a page inside `[locale]`. Measured both ways; see
 * `src/i18n/pathname.ts` and docs/adr/0005-getpathname-sans-le-link-client.md.
 */

/**
 * Without this the tab shows the raw URL: Next emits no default `<title>` for
 * the 404, and the locale layout's `generateMetadata` never runs on this route.
 *
 * `getTranslations({ locale, namespace })` — never the implicit
 * `getTranslations(namespace)` — for the exact reason spelled out above.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "notFound" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function NotFound() {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "notFound" });
  const homeHref = homePathname();

  return (
    <html lang={routing.defaultLocale}>
      <body>
        <main>
          <h1>{t("title")}</h1>
          <p>{t("description")}</p>
          <a href={homeHref}>{t("backHome")}</a>
        </main>
      </body>
    </html>
  );
}
