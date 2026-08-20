import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
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
 * - `getPathname` + a plain anchor rather than the `Link` component, which
 *   reads the request locale even when handed a `locale` prop. A 404 is also
 *   the one place where a full document load beats client-side navigation:
 *   it leaves the error state behind entirely.
 *
 * Both were verified by building with and without them.
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
  const homeHref = getPathname({ href: "/", locale: routing.defaultLocale });

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
