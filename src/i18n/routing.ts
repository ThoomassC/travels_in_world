import { defineRouting } from "next-intl/routing";

/**
 * The route tree is bilingual from day one (`/fr/...`, later `/en/...`) so that
 * adding English is a translation job, not a routing migration. Only `fr` is
 * declared active: listing a locale without a message catalogue would let the
 * build produce pages full of missing-message errors.
 *
 * To activate English: add `src/i18n/messages/en.json`, then add "en" below.
 */
export const locales = ["fr"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "fr";

export const routing = defineRouting({
  locales,
  defaultLocale,
  // "always" keeps a single canonical URL per page — `/` redirects to `/fr`
  // rather than serving the same content under two paths.
  localePrefix: "always",

  /**
   * No `NEXT_LOCALE` cookie. Two reasons, both measured:
   *
   * 1. Caching. A response carrying `Set-Cookie` is not stored by a CDN. `/fr`
   *    is prerendered HTML served with `Cache-Control: s-maxage=31536000`; with
   *    the cookie attached, that year-long cache never applied and every hit
   *    went back through a server function.
   * 2. Locale pinning. The cookie takes precedence over `Accept-Language`, and
   *    nothing in the UI can clear it. Once `en` is active, a single visit to an
   *    `/en/...` link would pin the visitor to English on `/` for a year, with
   *    no way back. With `localePrefix: "always"` the URL already carries the
   *    locale — the cookie adds nothing and only removes control.
   */
  localeCookie: false,
});
