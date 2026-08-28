import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * The only sanctioned navigation primitives for internal routes. `next/link`
 * and `next/navigation`'s `redirect` are banned everywhere else by ESLint
 * (`no-restricted-imports`) because they ignore the `[locale]` segment.
 *
 * IMPORTING FROM THIS MODULE COSTS CLIENT JAVASCRIPT on the route that does it —
 * every export here, `getPathname` included, drags next-intl's client `Link` into
 * the browser bundle. Measured, same href rendered byte for byte: on `/fr`,
 * 119.9 KB / 6 chunks without against 123.7 KB / 8 with; on `/_not-found`, where
 * the `Link` also pulls `useLocale` from `use-intl`, 111.1 KB / 5 against
 * 123.5 KB / 7 — 12.4 KB. `createSharedNavigationFns` imports the `"use client"`
 * `BaseLink` at the top level and builds all five exports in one call, so a
 * client reference is registered for the route whether or not a `Link` is ever
 * rendered; splitting the destructuring across modules changes nothing, and
 * next-intl 4.14.1 has the same packaging. Both verified.
 *
 * SO: to build an href in a Server Component that renders a plain `<a>`, use
 * `localePathname` from `@/i18n/pathname` — a Link-free fork of `getPathname`,
 * kept provably equivalent by `tests/i18n/pathname.test.ts`. This module is for
 * `Link`, `redirect`, `usePathname` and `useRouter`, where the client runtime is
 * the point and the bytes are earned.
 *
 * `getPathname` stays exported: it is the reference that fork is tested against,
 * and it is what `@/i18n/pathname` gets deleted in favour of once next-intl
 * separates the two. See docs/adr/0005-getpathname-sans-le-link-client.md.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
