import { describe, expect, it } from "vitest";
import { getPathname } from "@/i18n/navigation";
import { homePathname, localePathname } from "@/i18n/pathname";
import { tripPath } from "@/i18n/paths";
import { defaultLocale, routing } from "@/i18n/routing";

/**
 * `src/i18n/pathname.ts` is a re-implementation of next-intl's `getPathname`,
 * and the ONLY reason it exists is a packaging defect measured on a real build:
 * importing `getPathname` from `@/i18n/navigation` drags next-intl's *client*
 * `Link` into the browser bundle of the importing route — measured on `/fr`,
 * 3.8 KB brotli and two extra chunks on a page that renders no client link at
 * all. See TIW-28 and docs/adr/0005-getpathname-sans-le-link-client.md.
 *
 * A re-implementation is a fork, and a fork rots. So this file is not a spec for
 * a helper — it is the proof that the fork still says what the original says.
 * The whole table below is asserted TWICE: once against a literal, once against
 * next-intl's own `getPathname` called with the very same routing config.
 *
 * That second assertion is what makes this a real guard rather than a copy of
 * the implementation. It goes red on its own if:
 *
 * - `routing.localePrefix` stops being `"always"` (upstream would stop prefixing
 *   the default locale; the fork would keep prefixing it);
 * - a `pathnames` map is declared (upstream would compile a localised template;
 *   the fork would pass the internal pathname straight through);
 * - a next-intl upgrade changes how a pathname is built.
 *
 * None of those three shows up anywhere else in the suite, and each of them
 * ships a URL that 404s while lint, typecheck and build all stay green.
 */

/**
 * Every href shape the site actually builds, plus the four non-localisable ones
 * that must be handed back untouched. Those four are the interesting rows:
 * upstream deliberately does NOT prefix an href it cannot localise, and a fork
 * that "helpfully" prefixed them would produce `/fr/mailto:a@b.c`.
 */
const CASES: ReadonlyArray<{ href: string; expected: string }> = [
  // The 404's link home — the one call site in the codebase today.
  { href: "/", expected: "/fr" },
  // What the map (TIW-13) and the trip page (TIW-16) build, via `tripPath`.
  { href: tripPath("japon-2024"), expected: "/fr/voyages/japon-2024" },
  { href: "/voyages", expected: "/fr/voyages" },
  // A trailing slash is preserved, not normalised: `trailingSlash` is unset in
  // `next.config.ts`, and with no `pathnames` declared upstream never calls its
  // `normalizeTrailingSlash` on this path either.
  { href: "/a/", expected: "/fr/a/" },
  // A query string rides along, and the root is the special case: the prefix
  // absorbs the lone slash so `/fr` and `/fr?b=1` carry no trailing slash.
  { href: "/a?b=1", expected: "/fr/a?b=1" },
  { href: "/?b=1", expected: "/fr?b=1" },
  { href: "/a#b", expected: "/fr/a#b" },
  // Absolute URLs and non-HTTP schemes: not ours to prefix.
  { href: "https://x.test/y", expected: "https://x.test/y" },
  { href: "mailto:a@b.c", expected: "mailto:a@b.c" },
  // Relative hrefs are not localisable upstream, so they pass through. This is
  // the row that documents the fork's sharpest edge: a caller who drops the
  // leading slash gets an un-prefixed URL and therefore a silent 404. Guarding
  // callers is `src/i18n/paths.ts`'s job — `tests/i18n/paths.test.ts` pins that
  // `tripPath` always starts with `/voyages/`.
  { href: "voyages/x", expected: "voyages/x" },
  { href: "", expected: "" },
];

describe("localePathname", () => {
  it.each(CASES)("prefixes $href as $expected", ({ href, expected }) => {
    expect(localePathname({ href, locale: defaultLocale })).toBe(expected);
  });

  /**
   * The differential assertion. Not `it.each` over a computed expectation — that
   * would be a tautology if both sides were wrong the same way; the literal
   * table above is the independent anchor, and this is the equivalence.
   */
  it.each(CASES)("agrees with next-intl's own getPathname on $href", ({ href }) => {
    expect(localePathname({ href, locale: defaultLocale })).toBe(
      getPathname({ href, locale: defaultLocale })
    );
  });

  it("reads nothing ambient: same arguments, same answer, called twice", () => {
    // The point of the whole exercise. `src/app/not-found.tsx` lives OUTSIDE the
    // `[locale]` segment, where any read of the request locale turns the entire
    // route tree dynamic — see the comment in that file and `npm run test:build`.
    expect(localePathname({ href: "/", locale: defaultLocale })).toBe("/fr");
    expect(localePathname({ href: "/", locale: defaultLocale })).toBe("/fr");
  });
});

/**
 * The hostile half of the equivalence, differential only — no literal column.
 *
 * The table above documents what the site builds and is worth reading. These are
 * inputs nobody should ever pass, kept for one reason: a fork transcribed from
 * four upstream functions is most likely to diverge exactly where the original
 * looks arbitrary. Pinning a literal for each would document upstream's quirks as
 * if this project had chosen them — including the ones that look like bugs
 * (`//evil.test` comes back as `/fr//evil.test`, a protocol-relative URL turned
 * into a path). What matters is not that those answers are good, it is that the
 * fork gives the SAME answer, so the day one is judged a real problem it is fixed
 * once, upstream, for both.
 *
 * Every row was run against next-intl 4.13.7 and agrees. The classes covered:
 * mixed-case and exotic schemes, scheme-like segments that are not schemes,
 * protocol-relative and backslash forms, empty and whitespace, query/fragment
 * combinations, percent-encoding, non-ASCII and astral characters, and control
 * characters inside a path.
 */
const ADVERSARIAL_HREFS = [
  " ",
  "//",
  "///",
  "/a//b",
  "/#h",
  "/a#b=1?c",
  "/?",
  "/?#",
  "//example.com/x",
  "///example.com/x",
  "\\\\evil.test",
  "/\\evil.test",
  "HTTPS://x.test/y",
  "HtTpS://x",
  "MAILTO:a@b.c",
  "tel:+33",
  "javascript:alert(1)",
  "data:text/html,x",
  "a:",
  "a1:",
  "1a:",
  "-a:",
  "./x",
  "../x",
  "?x=1",
  "#h",
  "/é",
  "/%C3%A9",
  "/a b",
  "/a%20b",
  "/fr",
  "/fr/",
  ":",
  "://x",
  "/:",
  "/a:b",
  "/a:b/c",
  "\t/a",
  " /a",
  "/a\nb",
  "/트",
  "/😀",
] as const;

describe("localePathname, on inputs it should never be given", () => {
  it.each(ADVERSARIAL_HREFS)("still answers exactly like next-intl on %j", (href) => {
    expect(localePathname({ href, locale: defaultLocale })).toBe(
      getPathname({ href, locale: defaultLocale })
    );
  });
});

describe("homePathname", () => {
  it("is the default locale's root, with no trailing slash", () => {
    // `/fr/` and `/fr` are two URLs for one page; `next.config.ts` redirects `/`
    // to `/fr` and this must agree with it, or the 404's way out costs a hop.
    expect(homePathname()).toBe("/fr");
  });

  it("takes the locale from the routing config, not from a request", () => {
    expect(homePathname()).toBe(localePathname({ href: "/", locale: defaultLocale }));
  });
});

/**
 * The alarm, in the shape `tests/smoke.test.tsx` uses for the active-locale set.
 * The differential test above already goes red on each of these changes — but it
 * fails with a diff of two URLs, which says nothing about why. These three say
 * why, and they name the file to re-read.
 */
describe("the routing config that src/i18n/pathname.ts is allowed to assume", () => {
  const WHY =
    "Re-read src/i18n/pathname.ts: its simplification of next-intl's getPathname assumes this.";

  it("prefixes every locale, always", () => {
    // `as-needed` would stop prefixing the default locale, and the fork would
    // keep emitting `/fr/...` — every internal link off by one segment.
    expect(routing.localePrefix, WHY).toBe("always");
  });

  it("declares no localised pathnames and no per-domain routing", () => {
    // With `pathnames` declared, upstream compiles a localised template per
    // locale and the fork would ship the untranslated internal pathname.
    // With `domains`, the prefix mode can be overridden per domain.
    expect(routing, WHY).not.toHaveProperty("pathnames");
    expect(routing, WHY).not.toHaveProperty("domains");
  });

  /**
   * The catch-all, and the reason it is worth its brittleness: the two
   * assertions above cover the routing options that exist TODAY. This one goes
   * red when an option nobody here has thought about is added — which is exactly
   * the class of change that makes a fork of someone else's function wrong.
   *
   * Going red is not a failure to fix by widening the array. It is a request to
   * re-read `src/i18n/pathname.ts` against next-intl's `applyPathnamePrefix`,
   * and then widen it.
   */
  it("has exactly the four options this fork was written against", () => {
    expect(Object.keys(routing).sort(), WHY).toEqual([
      "defaultLocale",
      "localeCookie",
      "localePrefix",
      "locales",
    ]);
  });
});
