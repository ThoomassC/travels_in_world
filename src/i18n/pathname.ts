import type { Locale } from "./routing";
import { routing } from "./routing";

/**
 * `getPathname`, without next-intl's client `Link` behind it.
 *
 * WHY THIS FILE EXISTS — it is a fork of someone else's function, so the reason
 * has to be worth it. Measured on a real production build (Next 16.3.1,
 * next-intl 4.13.7), one `<a href>` on `/fr`, the same href rendered byte for
 * byte both ways:
 *
 *   import { getPathname } from "@/i18n/navigation"   123.7 KB brotli, 8 chunks
 *   import { localePathname } from "@/i18n/pathname"  119.9 KB brotli, 6 chunks
 *
 * Those 3.8 KB are next-intl's *client* `Link` — `curLocale`, `linkRef`,
 * `localeCookie`, `prefetch`, `usePathname` — shipped to the browser by a Server
 * Component that renders a plain `<a href>` and no client link at all. 3.4 KB of
 * it is the `Link` chunk itself; the rest is what it drags along.
 *
 * The cause is upstream and is not a mistake of this codebase:
 * `navigation/shared/createSharedNavigationFns.js` imports `BaseLink.js` — a
 * `"use client"` module — at the top level, and builds `Link` and `getPathname`
 * inside the same call. Reaching either one makes `BaseLink` a client entry
 * point for the route, and a client reference is not tree-shaken away for being
 * unused. Two things were verified before this file was written, so that nobody
 * pays for them twice:
 *
 * - a dedicated module with its own `createNavigation(routing)` exporting only
 *   `getPathname` changes NOTHING — 123.7 KB, 8 chunks. The `Link` is created
 *   inside the call, not by the destructuring;
 * - next-intl 4.14.1, the latest release, has the identical static
 *   `import c from"./BaseLink.js"` and adds no subpath export that separates the
 *   two. Bumping does not fix it. An upstream report is owed — see
 *   docs/adr/0005-getpathname-sans-le-link-client.md.
 *
 * WHY IT LIVES HERE, in `src/i18n/**`. Invariant 2 of AGENTS.md is that no
 * internal URL is ever assembled outside this folder. Writing
 * `` `/${locale}${tripPath(slug)}` `` at a call site renders the same bytes today
 * — that was measured too — and is exactly the precedent the invariant exists to
 * refuse: it becomes wrong the day a `pathnames` map is declared, and the next
 * person to copy the pattern will not copy the alarm that guards it.
 *
 * WHAT KEEPS IT HONEST. `tests/i18n/pathname.test.ts` asserts every case below
 * against next-intl's real `getPathname`, called with this very routing config.
 * The fork cannot drift without that test going red.
 *
 * WHEN TO DELETE IT. The day next-intl ships `getPathname` free of the client
 * `Link`: drop this module, re-export `getPathname` from `@/i18n/navigation`, and
 * confirm with `npm run build && npm run test:build` that `/fr` stays at 7
 * chunks.
 */

/**
 * The subset of next-intl's `applyPathnamePrefix` that this routing config can
 * reach, transcribed from `navigation/shared/utils.js` and
 * `shared/utils.js` (4.13.7). Each branch below is one upstream function:
 *
 * - `isLocalHref`   — a specifier carrying a scheme (`https:`, `mailto:`) is not
 *                     ours to prefix;
 * - `isRelativeHref`— nor is one that does not start with `/`, since the prefix
 *                     would change what it is relative to;
 * - `applyPathnamePrefix` with `mode: "always"` — everything else is prefixed,
 *                     the default locale included;
 * - `prefixPathname` — the lone `/` (with or without a query) loses its slash to
 *                     the prefix, so the root is `/fr` and never `/fr/`.
 *
 * `compileLocalizedPathname` and `normalizeTrailingSlash` have NO counterpart
 * here, and that is the fork's whole assumption: upstream only reaches them when
 * a `pathnames` map is declared. The last test in `tests/i18n/pathname.test.ts`
 * is what goes red the day one is.
 */
export function localePathname({ href, locale }: { href: string; locale: Locale }): string {
  const hasScheme = /^[a-z]+:/i.test(href);
  const isRelative = !href.startsWith("/");

  if (hasScheme || isRelative) {
    return href;
  }

  const prefix = `/${locale}`;

  // `/` and `/?a=b` only: a lone slash before the query, which the prefix
  // already supplies. `/a/` is left alone — see the trailing-slash case in the
  // spec, and `trailingSlash` is unset in `next.config.ts`.
  return /^\/(\?.*)?$/.test(href) ? `${prefix}${href.slice(1)}` : `${prefix}${href}`;
}

/**
 * The 404's link home, resolved without reading anything ambient.
 *
 * `src/app/not-found.tsx` sits outside the `[locale]` segment, where a single
 * read of the request locale turns the WHOLE route tree dynamic — `/fr`
 * included, with `next build` still exiting 0. Hence the explicit default
 * locale, and hence a named export rather than the expression inline: the
 * hardcoded locale is a known limitation of having one global 404, and it is
 * greppable here.
 */
export function homePathname(): string {
  return localePathname({ href: "/", locale: routing.defaultLocale });
}
