import { defineRouting } from "next-intl/routing";

/**
 * Three locales are active — `fr` (default), `en`, `es` — and each one has a
 * message catalogue in `./messages/`. That pairing is the rule this list obeys:
 * a locale declared here without its catalogue prerenders pages full of
 * missing-message errors, with a green build, so the two move together. The
 * alarm is `tests/smoke.test.tsx`, which reads the catalogue folder and refuses
 * a declared locale that has no file and a file that is missing a key `fr` has.
 *
 * WHAT IS TRANSLATED, AND WHAT IS NOT — read this before reporting a bug.
 *
 * **The chrome is translated; the récits are not.** `content/trips/**` holds one
 * `trip.yaml` per journey, written in French, with no per-locale field. So
 * `/en/voyages/japon-2024` serves an English shell — navigation, headings, dates,
 * country names, metadata — around a French story, and `/es/...` likewise. That
 * is the owner's decision, not an oversight: the interface is what a foreign
 * reader needs to get around the journal, and translating sixty récits is a
 * writing project rather than a routing one. The day it happens, the shape it
 * takes is a per-locale field in `TripSchema`, not a change here.
 *
 * **The URL segments stay French too** (`/en/voyages/...`, `/es/a-propos`).
 * next-intl translates them through a `pathnames` map, and declaring one is not
 * free: it changes the type of `Link` and `getPathname` across the project and it
 * invalidates `src/i18n/pathname.ts`, the fork that keeps next-intl's client
 * `Link` out of every bundle (it transcribes the no-`pathnames` branch of
 * `applyPathnamePrefix`, and `tests/i18n/pathname.test.ts` asserts the absence of
 * the map). Paying that to translate two nouns, on a site whose stories are in
 * French, buys nothing a reader can use.
 *
 * **The 404 answers in French under every prefix.** There is one global
 * `src/app/not-found.tsx`, above the `[locale]` segment, and it resolves
 * `defaultLocale` explicitly — because a single read of the request locale up
 * there de-statifies the whole tree (invariant 1 of AGENTS.md), and because an
 * unmatched URL goes to the global boundary and never to a segment's
 * `not-found.tsx` (measured). The alternative is a `[locale]/[...rest]` catch-all,
 * which costs a dynamic `ƒ` route. A French 404 on `/en/no-such-page` is the
 * accepted price; see README, "Rendu statique".
 *
 * **No negotiation.** `/` redirects to `/fr` through a single `redirects()` entry
 * in `next.config.ts`, so an unknown first segment (`/de`) is just an unknown
 * route and 404s where it stands. Reaching `/en` or `/es` is a matter of
 * following a link or typing the prefix — there is no proxy reading
 * `Accept-Language`, and there is no cookie (see `localeCookie` below).
 *
 * To activate a fourth locale: add `src/i18n/messages/<code>.json` with every key
 * `fr.json` has, then add the code below. Everything that iterates the site's
 * locales — `generateStaticParams`, the sitemap's `hreflang` block, the rename
 * redirects of `next.config.ts`, the `alternates.languages` of `src/app/share.ts`
 * — derives from this array and needs no diff.
 */
export const locales = ["fr", "en", "es"] as const;

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
   *    nothing in the UI can clear it. Now that `en` and `es` are active, a
   *    single visit to an `/en/...` link would pin the visitor to English on `/`
   *    for a year, with no way back — the reason this was refused in advance.
   *    With `localePrefix: "always"` the URL already carries the locale, so the
   *    cookie adds nothing and only removes control.
   */
  localeCookie: false,
});
