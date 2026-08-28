import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

/**
 * Internal navigation must go through the locale-aware `Link` produced by
 * `createNavigation(routing)`. A raw `next/link` drops the `[locale]` segment,
 * which does not fail the build — it silently produces a 404 for the visitor.
 */
const INTERNAL_LINK_MESSAGE =
  'Import { Link } from "@/i18n/navigation" instead: next/link ignores the [locale] segment and produces 404s.';

const INTERNAL_REDIRECT_MESSAGE =
  'Import { redirect } from "@/i18n/navigation" instead: the Next.js redirect ignores the [locale] segment and produces 404s.';

/**
 * `usePathname` is the nastier of the two: Next's returns the pathname WITH the
 * `/fr` prefix, next-intl's returns it without. Same name, same shape, opposite
 * value — and nothing warns. `useRouter` is the same story for `push`/`replace`,
 * which drop the locale segment.
 */
const INTERNAL_HOOKS_MESSAGE =
  'Import { usePathname, useRouter } from "@/i18n/navigation" instead: the Next.js hooks ignore the [locale] segment (usePathname keeps the prefix, useRouter drops it).';

/**
 * `src/domain/**` is pure TypeScript over Zod — invariant 3 of AGENTS.md, and
 * the decision recorded in docs/adr/0001-domain-purity.md. The rule below is
 * what makes that mechanical rather than documentary.
 */
const DOMAIN_PURITY_MESSAGE =
  "src/domain/** depends on Zod and nothing else: no React, no Next, no Node built-in, no d3, and no other @/ module. Move the code that needs them into the layer that owns them (src/content, src/map, src/app), and keep the domain testable without a framework.";

/**
 * Gitignore-style globs. A bare package name also matches everything *under* it,
 * exactly as a directory does in `.gitignore` — measured: `node:fs/promises`,
 * `next/dist/client/link` and `d3-geo/src/path/index.js` are all caught by
 * `node:*`, `next` and `d3-*` alone. So no `name/*` companion is needed, and
 * adding one would only report the same violation twice.
 */
const DOMAIN_FORBIDDEN_IMPORTS = [
  "react",
  "react-dom",
  "next",
  "next-intl",
  "node:*",
  "fs",
  "path",
  "d3",
  "d3-*",
  "topojson",
  "topojson-*",
  "server-only",
  // Every aliased module, `@/domain/*` included: inside the domain, siblings are
  // reached with a relative "./geo". That keeps this pattern free of exceptions,
  // and the domain flat — which the pattern below is what enforces.
  "@/*",
  /**
   * Leaving the folder relatively, which is the same import as `@/content/trips`
   * to the bundler and walks past every pattern above.
   *
   * `".."` and nothing else, which is not the obvious answer. These patterns are
   * matched against the specifier *string*, unresolved, and `*` does not cross a
   * `/` — so `"../**"` looks like the pattern to write, and it lets
   * `"./../content/trips"` through. That spelling linted, typechecked and built
   * clean until this line changed. Measured over six spellings:
   *
   *          | ../x | ./../x | .././x | ./../../src/x | .. | ./.. | ./geo
   *   "../**"| yes  |   —    |  yes   |       —       | —  |  —   |  —
   *   ".."   | yes  |  yes   |  yes   |      yes      | yes|  yes |  —
   *
   * `".."` is a superset of `"../**"`, `"./../**"` and `"./.."` — all three were
   * here and all three were redundant — and it still lets a sibling `"./geo"`
   * through, which is the one relative form the domain needs.
   *
   * `tests/lint/domain-purity.test.ts` pins every row of that table; deleting
   * this line turns six of its cases red.
   */
  "..",
];

/**
 * Every spelling that resolves to the same Next module. `next/link` and
 * `next/link.js` are the same file to `require.resolve`, so a rule keyed on the
 * specifier string has to list both; the `**\/` variants catch a specifier
 * reached through a deeper path.
 */
const nextModuleSpellings = (name) => [
  `next/${name}`,
  `next/${name}.js`,
  `**/next/${name}`,
  `**/next/${name}.js`,
];

/**
 * The internal-navigation ban, extracted so it can be *reused* rather than
 * recopied. This is not tidiness, it is the load-bearing part of the block below.
 *
 * `no-restricted-imports` resolves by last-matching-config-wins, per rule, and
 * replaces the options rather than merging them — the `domain-purity` block says
 * so in its own comment. So any new block adding patterns for `src/app/**` wipes
 * these three out there, and invariant 2 of `AGENTS.md` dies with a green lint: a
 * raw `next/link` drops the `[locale]` segment and the visitor gets a 404.
 * `tests/lint/content-facade.test.ts` has a case per spelling, in both folders,
 * for exactly that reason.
 */
const NAVIGATION_PATTERNS = [
  {
    group: nextModuleSpellings("link"),
    message: INTERNAL_LINK_MESSAGE,
  },
  {
    group: nextModuleSpellings("navigation"),
    importNames: ["redirect", "permanentRedirect"],
    message: INTERNAL_REDIRECT_MESSAGE,
  },
  {
    group: nextModuleSpellings("navigation"),
    importNames: ["usePathname", "useRouter"],
    message: INTERNAL_HOOKS_MESSAGE,
  },
];

/**
 * `src/content/trips.ts` is the one module the application may import to reach
 * the content, and it is the one module carrying `import "server-only"`.
 * Every other module under `src/content/**` is plain Node code without the guard
 * — `@/content/loader` reads the disk and lints, typechecks and builds perfectly
 * clean from a page. Nothing but this rule stands between a client component and
 * the filesystem reader.
 */
const CONTENT_FACADE_MESSAGE =
  'Import from "@/content/trips" instead: it is the only content module carrying import "server-only", and the rest of src/content/** would ship the filesystem reader into a client bundle.';

/**
 * Everything under `content/` except the façade, in both the aliased and the
 * relative spelling. Measured through ESLint's Node API over 24 spellings, and
 * the results are worth writing down because two of them do not follow from
 * reading the docs.
 *
 *   refused                        | accepted
 *   -------------------------------|--------------------------
 *   @/content/loader               | @/content/trips
 *   @/content/validate             | ../content/trips
 *   @/content/collection           | ./../content/trips
 *   @/content/diagnose             | @/domain/trip
 *   ../content/loader              | @/i18n/navigation
 *   ./../content/loader            | ../lib/helper
 *   .././content/loader            | ./sibling
 *   ../../src/content/loader       | next-intl
 *   @/content/loader.js            | react
 *   @/content/loader/index         | node:path
 *   @/content/sub/deep/thing       |
 *   ../content/loader/index        |
 *   ../../src/content/sub/deep     |
 *
 * Plus the controls, because a rule widened by accident would forbid the façade
 * from doing its one job. Measured: `@/content/loader` is **accepted** from
 * `src/content/trips.ts`, from `src/content/validate.ts`, from `scripts/**`, from
 * `tests/**` and from a co-located spec — the block below matches none of them,
 * either because its glob is anchored at `src/` or because its `ignores` says so,
 * one line per reason. From `src/domain/**` it is refused, but by the
 * `domain-purity` block, which forbids every `@/*` there.
 *
 * Two measured facts that do not guess right:
 *
 * - `"@/content/*"` and `"@/content/**"` return the **same** verdict on all 24
 *   spellings, so the simple form is enough. The reason is *not* that `*` crosses
 *   a `/` — it does not, measured separately: `"a/*\/c"` catches `"a/b1/c"` and
 *   does not catch `"a/b1/b2/c"`. What catches the deep spellings is the
 *   gitignore rule documented two comments above: an entry matching a directory
 *   drags in everything under it, and `@/content/loader` is an ancestor of
 *   `@/content/loader/index`.
 * - `@/content/trips.js` is **refused**. An accepted false positive: gitignore
 *   ancestry works on `/` segments, so the negation `!@/content/trips` does not
 *   cover it. Same call as the `next/link.js` spelling this file already bans —
 *   erring strict on a spelling nobody writes here beats widening the surface of
 *   the exceptions.
 *
 * **And one hole left open on purpose: the bare `@/content` is accepted.** It is
 * harmless today — there is no `src/content/index.ts` for it to resolve to, so the
 * import does not build — and latent the day somebody adds one, since a barrel
 * there would re-export the loader. It is *not* closed, and that is a measurement
 * rather than an oversight: adding `"@/content"` to this group (with or without a
 * `"**\/content"` companion) makes the pattern an ancestor of the façade itself,
 * and the negation two lines below does not recover it —
 *
 *   REFUSED  src/app/[locale]/page.tsx   import * as p from "@/content/trips";
 *
 * — which forbids the one import the whole boundary exists to allow. The cheaper
 * guard is the absence of the file: if a barrel is ever added under
 * `src/content/`, it has to be `trips.ts` itself.
 */
const CONTENT_FACADE_ONLY = [
  "@/content/*",
  "**/content/*",
  "!@/content/trips",
  "!**/content/trips",
];

/**
 * `jsx-a11y` is not re-declared as a plugin here on purpose — eslint-config-next
 * already registers that namespace, and declaring it twice with a different
 * module instance makes ESLint throw. We only override its rule severities,
 * which resolve against the already-registered plugin.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      /**
       * Git worktrees, which are *other checkouts of this repository* sitting
       * inside it. `eslint .` walks into them, so a half-written file in one
       * branch fails `npm run lint` in another, and nobody can tell "my lint is
       * green" from "my neighbour's is". Measured: a `jsx-a11y` error in one
       * worktree failed the barrier of a checkout that did not contain the file.
       *
       * Flat config does not read `.gitignore`, so ignoring them in git — which
       * also matters, one worktree measured 579 MB a `git add -A` would have
       * committed — does not answer this. Both are needed.
       *
       * No effect on CI: a clone has no worktrees.
       */
      ".claude/worktrees/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    name: "travels-in-world/rules",
    files: ["**/*.{ts,tsx}"],
    rules: {
      // eslint-config-next ships most of these as "warn"; strict raises them to error.
      ...jsxA11y.flatConfigs.strict.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-unused-expressions": "error",
      /**
       * `patterns` only, no `paths`: `paths` matches the specifier STRING, so
       * `next/link.js` — the very same module to `require.resolve` — walked
       * straight through it. `patterns` covers the exact specifier as well, so
       * keeping both would only report every violation twice.
       *
       * Known and accepted blind spot: `await import("next/link")` is a call
       * expression, not an import declaration, and no `no-restricted-imports`
       * option can see it.
       */
      "no-restricted-imports": ["error", { patterns: NAVIGATION_PATTERNS }],
    },
  },
  {
    /**
     * The application reaches the content through `@/content/trips` and through
     * nothing else. See {@link CONTENT_FACADE_ONLY} for the measured table of
     * spellings, and {@link NAVIGATION_PATTERNS} for why the navigation ban is
     * spread in here rather than assumed to survive: this block *replaces* the
     * options of the global one for every file it matches.
     *
     * **`src/**` minus what owns or outranks the rule, not a list of consumer
     * folders.** A glob naming `src/app/**` and `src/map/**` only guards the
     * folders that exist today, and the folder that does not exist yet is exactly
     * where the breach lands: TIW-17 ships the photo viewer, one of the two
     * `'use client'` components milestone 1 allows, and it goes in
     * `src/components/`. Measured through ESLint's Node API over 22 cases, the
     * two scopes side by side:
     *
     *   file                                 | import              | app+map | src/**
     *   -------------------------------------|---------------------|---------|-------
     *   src/components/photo-viewer.tsx      | @/content/loader    | allow   | refuse
     *   src/ui/trip-card.tsx                 | @/content/loader    | allow   | refuse
     *   src/lib/sitemap.ts                   | @/content/loader    | allow   | refuse
     *   src/i18n/request.ts                  | @/content/loader    | allow   | refuse
     *   src/components/photo-viewer.tsx      | ../content/loader   | allow   | refuse
     *   src/components/deep/nested/thing.tsx | @/content/collection| allow   | refuse
     *   src/app/[locale]/page.tsx            | @/content/loader    | refuse  | refuse
     *   src/app/[locale]/page.tsx            | @/content/trips     | allow   | allow
     *   src/components/photo-viewer.tsx      | @/content/trips     | allow   | allow
     *
     * Six holes, all of them a file that lints, typechecks and builds clean while
     * importing the unguarded disk reader — `loader.ts` carries no `server-only`,
     * which is the whole point of the split, so nothing else is behind this rule.
     *
     * **Why the three `ignores`, one reason each:**
     *
     * - `src/content/**` *owns* the loader: the façade re-exports it and
     *   `validate.ts` imports `collection.ts`. Refusing there would forbid the
     *   rule's own subject from existing.
     * - `src/domain/**` is guarded harder by `domain-purity` below, which forbids
     *   every `@/*` import including `@/content/trips`. Matching it here would
     *   *replace* that stricter rule with this looser one — last matching config
     *   wins, per rule.
     * - A co-located spec, for the reason the `domain-purity` block records for
     *   its own: `vitest.config.ts` allows a spec next to the file it tests
     *   (`include: ["src/**\/*.test.{ts,tsx}"]`), a spec is never part of a client
     *   bundle, so the failure this rule defends against cannot happen in one, and
     *   refusing it would turn that Vitest option into a trap. Measured: without
     *   it, `src/app/[locale]/page.test.tsx`, `src/map/world.test.ts` and
     *   `src/components/photo-viewer.test.tsx` are refused.
     *
     * **`src/i18n/navigation.ts` is deliberately *not* in that list any more, and
     * that is a fix rather than a tidy-up.** An `ignores` entry exempts a file from
     * the whole block, so it switched the content patterns off along with the
     * navigation ones — measured: `src/i18n/navigation.ts` importing
     * `@/content/loader` was **ACCEPTED**. And that file is the one every client
     * component imports; it exists to export `Link`, `useRouter` and `usePathname`.
     * A helper there that needed a slug would have pulled the filesystem reader
     * into the client graph through the most-imported module of the bundle.
     * The opposite trap is real too and was measured: with no exemption at all,
     * this block — being *later* than the old `no-restricted-imports: "off"` one —
     * turned the rule back on there and **refused `next/link`**, which makes the
     * locale-aware wrappers unwritable and kills invariant 2. So the exemption is
     * now a block of its own, *after* this one, restoring the content pattern only:
     * `travels-in-world/navigation-primitives` below.
     *
     * `tests/**` needs no `ignores` at all and never did: a glob anchored at
     * `src/` cannot reach it. The content suites stay free to import the
     * internals, which is what a unit test of the disk reader is.
     *
     * All four TypeScript extensions, as the domain block learned to do: `.mts`
     * and `.cts` match no other content block in this file.
     *
     * **Two limits, measured and documented rather than fixed:**
     *
     * - **A relay outside `src/` is not covered.** `import "../../../scripts/relay"`
     *   from a page is **accepted**, because every glob here is anchored at `src/`.
     *   Contrived — nothing imports `scripts/` today — but it is the honest answer
     *   to "is the intermediate relay closed": inside `src/`, yes; outside, no. The
     *   bundler is what closes it for a *client* component, and that is the split
     *   `src/content/trips.ts` documents.
     * - **A computed specifier is out of reach of any lint.**
     *   `await import(`@/content/${name}`)` is caught by neither rule below: the
     *   `no-restricted-syntax` selector needs a `Literal`. Nothing here can fix
     *   that; it is written down so the next reader does not mistake the silence
     *   for coverage.
     */
    name: "travels-in-world/content-facade",
    files: ["src/**/*.{ts,tsx,mts,cts}"],
    ignores: ["src/content/**", "src/domain/**", "src/**/*.test.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...NAVIGATION_PATTERNS,
            {
              group: CONTENT_FACADE_ONLY,
              message: CONTENT_FACADE_MESSAGE,
            },
          ],
        },
      ],
      /**
       * The dynamic spelling of the same crossing. `no-restricted-imports` sees
       * import *declarations* only — a known blind spot for `next/link`, and a
       * worse one here, because `await import()` is the natural way to load
       * something lazily in a Server Component. Measured before this rule:
       * `await import("@/content/loader")` was **accepted** from a page and from
       * `src/components/**`.
       *
       * The selector matches the specifier string of an `ImportExpression`, and
       * the regex is anchored on the folder — `(^|/)content/` — so a package
       * called `x-content/y` is not swept in. `(?!trips$)` is what lets the façade
       * through; `@/content/trips.js` is refused, the same accepted false positive
       * `CONTENT_FACADE_ONLY` already makes for the static spelling.
       *
       * Measured through ESLint's Node API: refuses `@/content/loader` and
       * `../content/loader`, accepts `@/content/trips`.
       */
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression > Literal[value=/(^|\\/)content\\/(?!trips$)/]",
          message: CONTENT_FACADE_MESSAGE,
        },
      ],
    },
  },
  {
    /**
     * The one file allowed to reach for the raw Next.js navigation primitives:
     * this is where the locale-aware wrappers are built, so `next/link` and
     * `next/navigation` must be importable here and nowhere else.
     *
     * **A block, and not an `ignores` entry on the block above.** `ignores` is
     * per-block, so exempting this file there switched off the *content* pattern
     * too — measured: `@/content/loader` was accepted in the module that every
     * client component imports. This block instead restores exactly one of the two
     * bans: `no-restricted-imports` with the content group only.
     *
     * **Order is load-bearing.** ESLint resolves a rule by last-matching-config
     * wins, replacing the options rather than merging them, so this block must
     * come *after* `content-facade` — before it, the façade block would reinstate
     * the navigation ban here. `tests/lint/content-facade.test.ts` pins both
     * halves: `next/link` accepted, `@/content/loader` refused, in this file.
     *
     * `no-restricted-syntax` is deliberately not overridden: the dynamic-import
     * ban from the block above still applies here, which is what it is for.
     */
    name: "travels-in-world/navigation-primitives",
    files: ["src/i18n/navigation.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: CONTENT_FACADE_ONLY, message: CONTENT_FACADE_MESSAGE }] },
      ],
    },
  },
  {
    /**
     * Replaces the `no-restricted-imports` options above rather than adding to
     * them — the last matching config wins per rule. Nothing is lost: this list
     * forbids all of `next/**`, which is a superset of the three navigation
     * patterns for this folder.
     *
     * `*.test.*` is exempt because `vitest.config.ts` allows a spec next to the
     * file it tests, and a co-located spec legitimately imports Vitest and, one
     * day, a test helper. Restricting it would turn that option into a trap.
     *
     * All four TypeScript extensions, not just `.ts`. `tsconfig.json` compiles
     * `src/**\/*.tsx`, so a `src/domain/Widget.tsx` importing React would ship;
     * and `.mts`/`.cts` match no other block in this file, so they answered to no
     * restriction at all. Measured: each of the three was clean before this glob
     * covered it.
     */
    name: "travels-in-world/domain-purity",
    files: ["src/domain/**/*.{ts,tsx,mts,cts}"],
    ignores: ["src/domain/**/*.test.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: DOMAIN_FORBIDDEN_IMPORTS,
              message: DOMAIN_PURITY_MESSAGE,
            },
          ],
        },
      ],
      /**
       * The same boundary, for the spelling `no-restricted-imports` cannot see.
       * `await import("node:fs")` from `src/domain/**` linted, typechecked and
       * built clean until this line existed — measured — because a dynamic import
       * is a call expression and no `no-restricted-imports` option reaches one.
       *
       * **Why this block needs its own copy.** The `content-facade` block above
       * carries a `no-restricted-syntax` too, and it `ignores` `src/domain/**` —
       * so the domain was the one folder excluded from the very remedy that block
       * introduced. `ignores` is per *block*, not per rule: exempting a folder
       * from one family of patterns exempts it from everything else the block
       * carries. That is the trap this file keeps re-teaching, and the rule it
       * yields is: **the last block matching a file must carry everything that
       * should apply to it.**
       *
       * **An allowlist, not a translation of `DOMAIN_FORBIDDEN_IMPORTS`.** Turning
       * those gitignore-style globs into a regular expression would be a second
       * declaration of the same list, free to drift from the first. The domain is
       * a flat folder over Zod, so `./geo` — a bare sibling — is the only
       * specifier it ever legitimately needs, and everything else is refused
       * without naming it. Measured over 25 spellings, 0 mismatch:
       *
       *   refused | react · react-dom · next · next-intl · node:fs
       *           | node:fs/promises · fs · path · d3-geo · topojson-client
       *           | server-only · @/content/loader · @/content/trips
       *           | @/domain/geo · ../content/loader · ./../content/loader
       *           | .././content/loader · ../../src/content/loader
       *           | .. · ./.. · ./sub/deep
       *   allowed | ./geo · ./schema · ./route · ./trip
       *
       * `./sub/deep` is refused on purpose: the domain is flat, and the day it
       * stops being flat is a decision to take in review rather than to discover
       * through a dynamic import.
       *
       * The `ignores` above covers this rule as well, so a co-located spec may
       * still `await import("vitest")` — verified, for the same reason the static
       * rule exempts it.
       *
       * Still out of reach, and it is a limit rather than an oversight: a
       * *computed* specifier (`await import(name)`) is not a `Literal`, so no
       * syntactic selector can see it. `AGENTS.md` says so.
       */
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression > Literal[value=/^(?!\\.\\/[A-Za-z0-9-]+$)/]",
          message: DOMAIN_PURITY_MESSAGE,
        },
      ],
    },
  },
];

export default config;
