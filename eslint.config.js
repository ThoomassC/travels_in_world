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
 * The three navigation patterns of invariant 2, extracted so a later block can
 * REPEAT them — which is not a nicety, it is the only way to keep them.
 *
 * `no-restricted-imports` takes options, and for a given file the last matching
 * config's options REPLACE the earlier ones rather than merging with them. So any
 * block below that sets this rule over a set of files silently removes the
 * `next/link` and `next/navigation` bans from those files: lint stays green, and
 * invariant 2 — "Navigation interne : jamais `next/link` ni `next/navigation`" —
 * is gone with no diff to show for it. `travels-in-world/domain-purity` gets away
 * with dropping them only because its own list forbids all of `next`, which is a
 * strict superset. No other block has that excuse, so every other block spreads
 * this one.
 */
const NAVIGATION_RESTRICTED_PATTERNS = [
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
 * `src/map/**` is reached through its façade, `@/map`, and through nothing else.
 * The façade is the single module carrying `import "server-only"` — the guard
 * that fails the build when build-time map geometry is pulled into a client
 * component. A deep import walks straight past that guard, so this rule is what
 * turns the façade from an intention into a boundary.
 */
const MAP_ENTRY_POINT_MESSAGE =
  'Import from "@/map" instead: the façade carries the `server-only` guard that keeps the build-time map geometry out of a client bundle. The deep modules of src/map are internal — tests reach them directly, application code does not.';

/**
 * Two patterns, no negation, and both halves matter.
 *
 * `"@/map/*"` covers the aliased spelling. `"**\/map/*"` covers the relative one,
 * which is the *same import* to the bundler: `"../../map/world"` from
 * `src/app/[locale]/page.tsx` resolves exactly where `"@/map/world"` does. The
 * six-column table above is this repository's record of what a pattern *assumed*
 * to cover a relative spelling costs, so this one was measured instead.
 *
 * Verdicts, 21 spellings, with the `files`/`ignores` of the block below:
 *
 *   from src/app/[locale]/page.tsx    | verdict | note
 *   ----------------------------------|---------|-------------------------------
 *   @/map                             | allowed | the façade
 *   ../../map                         | allowed | the façade, relatively
 *   ./sibling  @/domain/geo  react    | allowed |
 *   @/i18n/navigation  node:path      | allowed |
 *   d3-geo                            | allowed |
 *   @/map/index                       | REFUSED | deliberate, see below
 *   @/map/world  @/map/projection     | REFUSED |
 *   @/map/iso-3166                    | REFUSED |
 *   @/map/world.js                    | REFUSED | the next/link.js trick again
 *   @/map/sub/deep/thing              | REFUSED | deep paths are caught
 *   ../../map/index  ../../map/world  | REFUSED |
 *   ../map/world  ./../map/world      | REFUSED | all three relative spellings
 *   .././map/world                    | REFUSED |
 *   ../../src/map/world               | REFUSED |
 *   ../../src/map/sub/deep            | REFUSED |
 *   next/link                         | REFUSED | invariant 2 survives this block
 *   ----------------------------------|---------|-------------------------------
 *   from src/app/[locale]/probe.tsx   | REFUSED | @/map/world — .tsx is covered
 *   from src/app/probe.test.ts        | allowed | @/map/world — co-located spec
 *   from src/map/world.ts             | allowed | ./iso-3166 and @/map/iso-3166
 *   from src/i18n/navigation.ts       | allowed | next/link — exemption holds
 *
 * Three of those results are worth writing down, because someone will otherwise
 * "simplify" the group:
 *
 * - **`@/map` passes while `@/map/*` refuses everything under it.** That single
 *   fact is what makes this block two patterns and no negation.
 * - **`@/map/index` is refused, on purpose.** The canonical path to the façade is
 *   `@/map`. An exception for `@/map/index` would give one module two spellings,
 *   only one of which is greppable.
 * - **`*` and `**` give identical verdicts on all 21 spellings**, deep paths
 *   included, because a pattern that matches a directory matches everything under
 *   it the way a `.gitignore` entry does — the note at the top of this file says
 *   so, and it is the reason the simple form is enough here.
 *
 * The blind spot this comment used to declare "known and accepted" —
 * `await import("@/map/world")`, a call expression no `no-restricted-imports`
 * option can see — is no longer accepted: `MAP_DYNAMIC_IMPORT_RESTRICTIONS` below
 * closes it with `no-restricted-syntax`. These patterns and that selector are two
 * spellings of one boundary and have to be kept in step; the table there is the
 * measured proof that they currently agree, spelling for spelling.
 */
const MAP_ENTRY_POINT_PATTERNS = ["@/map/*", "**/map/*"];

/**
 * The map's *packages*, which have to be banned separately from its modules.
 *
 * Banning `@/map/*` closes the door on the deep modules and leaves the raw
 * ingredients wide open. Measured, from `src/app/[locale]/page.tsx`, before this
 * existed:
 *
 *   import atlas from "world-atlas/countries-110m.json";  -> ALLOWED
 *   import { geoPath } from "d3-geo";                     -> ALLOWED
 *
 * `resolveJsonModule` is on, so the first line typechecks, lints, builds — and a
 * `'use client'` component doing it ships 105 KB of TopoJSON to the browser. The
 * second hands a client component the whole projection library. Neither ever
 * touches `@/map`, so neither meets the `server-only` guard.
 *
 * `world-atlas` matters most and is the one `DOMAIN_FORBIDDEN_IMPORTS` does not
 * list — it covers `d3-*` and `topojson-*` for `src/domain` but not the atlas.
 * That list is the domain's business and is left alone; this one covers the rest
 * of `src/**`.
 *
 * Bare names, no `/*` companions, for the reason given at the top of this file: a
 * package name matches everything under it, so `world-atlas` alone catches
 * `world-atlas/countries-110m.json`.
 */
const MAP_PACKAGE_PATTERNS = ["world-atlas", "d3", "d3-*", "topojson", "topojson-*"];

const MAP_PACKAGE_MESSAGE =
  'Import from "@/map" instead: d3-geo, topojson-client and world-atlas are build-time only, and reaching for them outside src/map ships the projection library — or 105 KB of TopoJSON — to the browser. The façade returns geometry already projected to SVG paths.';

/**
 * THE SAME BOUNDARY, AGAINST `await import(...)`.
 *
 * **Why a second rule and not an option of the first.** `no-restricted-imports`
 * only ever visits `ImportDeclaration` (and `ExportNamedDeclaration` re-exports).
 * `await import("@/map/world")` is an `ImportExpression` — a call expression, not
 * a declaration — and *no option of that rule can be made to see it*. That is not
 * a guess: it is the blind spot this repository has documented twice already, on
 * the `next/link` ban in the base block and in ADR 0001 for `node:fs` in the
 * domain. `no-restricted-syntax` matches the AST directly, so it is the only
 * mechanism in stock ESLint that reaches the dynamic form.
 *
 * **Measured before this constant existed**, against the real config through
 * `new ESLint({ cwd })` with no `overrideConfig`:
 *
 *   from src/app/[locale]/page.tsx  |  from src/i18n/navigation.ts
 *   --------------------------------|------------------------------
 *   await import("@/map/world")                        -> ALLOWED
 *   await import("../map/dataset")                     -> ALLOWED
 *   await import("world-atlas/countries-110m.json")    -> ALLOWED
 *   await import("d3-geo")                             -> ALLOWED
 *   import { buildWorldGeometry } from "@/map/world";  -> REFUSED  (the witness:
 *                                                       the static rule IS live)
 *
 * The witness line is what makes those four ALLOWEDs mean something: the block is
 * active on that file, it refuses the declaration, and it lets every dynamic
 * spelling of the same module through. A `'use client'` component writing
 * `await import("@/map/world")` therefore ships `d3-geo` and 105 KB of TopoJSON
 * to the browser without ever meeting `import "server-only"` — lint green, build
 * green. That is criterion 1 of TIW-12, "0 Ko de bibliothèque côté client",
 * defeated by four characters.
 *
 * **This does not replace `no-restricted-imports`; it completes it.** The two are
 * both necessary and neither is redundant: this one is blind to
 * `import x from "@/map/world"` (no `ImportExpression` node), that one is blind to
 * `await import("@/map/world")`. Deleting either half re-opens exactly the half it
 * covers, with the other half still green. `tests/lint/map-entry-point.test.ts`
 * asserts on the `ruleId` for that reason — a case that only counted violations
 * would be satisfied by whichever rule survived.
 *
 * **Why regexes rather than the glob list.** `no-restricted-syntax` takes an
 * esquery selector, and esquery's only string test is a regex. So the two globs
 * are transcribed, and the transcription is the risk — a regex that says something
 * slightly different from `["@/map/*", "**\/map/*"]` is exactly the class of
 * silent drift this file has been bitten by twice. Both were therefore measured
 * against the static rule, specifier by specifier, from `src/app/[locale]/page.tsx`.
 * Every row below is a verdict the two mechanisms **agree on**:
 *
 *   specifier                        | verdict | why the row is here
 *   ---------------------------------|---------|----------------------------------
 *   @/map                            | allowed | the façade; `map\/.+` needs a
 *                                    |         | segment *after* the slash
 *   ../../map                        | allowed | the façade, relatively
 *   @/map/world  @/map/index         | REFUSED | `@/map/index` deliberately: one
 *                                    |         | module, one greppable spelling
 *   @/map/projection  @/map/dataset  | REFUSED |
 *   @/map/iso-3166  @/map/path-context | REFUSED |
 *   @/map/sub/deep/thing             | REFUSED | `.+` crosses `/`, so deep paths
 *                                    |         | need no `**` companion
 *   ../map/world  ../../map/dataset  | REFUSED | the relative spellings, all five
 *   ./../map/world  .././map/world   | REFUSED | — the `"./../x"` spelling is the
 *   ../../src/map/world              | REFUSED | one the domain rule shipped open
 *   foo/map/bar   map/bar            | REFUSED | `**\/map/*` catches these too, so
 *                                    |         | the leading segments stay generic
 *   @/mapper/thing  sourcemap/x      | allowed | the segment must be exactly `map`
 *   world-atlas                      | REFUSED |
 *   world-atlas/countries-110m.json  | REFUSED | a package name carries its subtree
 *   d3  d3-geo  topojson             | REFUSED |
 *   topojson-client                  | REFUSED |
 *   d3-geo/src/path/index.js         | REFUSED | deep path into a banned package
 *   d3-geo-projection                | REFUSED | `d3-*` does not stop at one word
 *   world-atlas-lite  topojsonesque  | allowed | see the arbitration below
 *   @/domain/geo  @/i18n/navigation  | allowed |
 *   react  next-intl  node:path      | allowed |
 *
 * **The arbitration, and it is the one judgement call here.** A prefix test would
 * be shorter — `^(world-atlas|d3|topojson)` — and it would refuse an unrelated
 * `world-atlas-lite` or `topojsonesque` on the strength of a shared prefix. A
 * false positive is not a harmless over-reach in a rule like this one: it is what
 * gets the rule switched off by the next person who legitimately needs that
 * package. So the hyphen is written into the pattern rather than assumed:
 * `world-atlas` admits no suffix at all (there is no `world-atlas-*` glob in
 * `MAP_PACKAGE_PATTERNS`), while `d3` and `topojson` admit `-<anything>` because
 * `d3-*` and `topojson-*` are in that list. Measured: the static rule allows
 * `world-atlas-lite` and `topojsonesque` and refuses `d3-geo-projection`, and so
 * does this selector. The transcription is faithful, including where it says no.
 *
 * `/` is escaped as `\/` throughout: esquery lexes the attribute value as a regex
 * *literal* and ends it at the first bare `/`, which would truncate the pattern
 * into something that still parses and matches almost nothing.
 */
const MAP_ENTRY_POINT_DYNAMIC_MESSAGE = `${MAP_ENTRY_POINT_MESSAGE} A dynamic \`await import()\` is not a way around this: it reaches the same internal module, past the same missing \`server-only\` guard, and ships the same bytes to the browser.`;

const MAP_PACKAGE_DYNAMIC_MESSAGE = `${MAP_PACKAGE_MESSAGE} A dynamic \`await import()\` is not a way around this: the projection library and the 105 KB of TopoJSON land in the client bundle either way.`;

const MAP_DYNAMIC_IMPORT_RESTRICTIONS = [
  {
    selector: String.raw`ImportExpression > Literal[value=/^(?:[^\/]*\/)*map\/.+$/]`,
    message: MAP_ENTRY_POINT_DYNAMIC_MESSAGE,
  },
  {
    selector: String.raw`ImportExpression > Literal[value=/^(?:world-atlas|(?:d3|topojson)(?:-[^\/]*)?)(?:\/.*)?$/]`,
    message: MAP_PACKAGE_DYNAMIC_MESSAGE,
  },
];

/** The map boundary, as one reusable group pair. */
const MAP_BOUNDARY_PATTERNS = [
  {
    group: MAP_ENTRY_POINT_PATTERNS,
    message: MAP_ENTRY_POINT_MESSAGE,
  },
  {
    group: MAP_PACKAGE_PATTERNS,
    message: MAP_PACKAGE_MESSAGE,
  },
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
      "no-restricted-imports": ["error", { patterns: NAVIGATION_RESTRICTED_PATTERNS }],
    },
  },
  {
    /**
     * The façade boundary for `src/map/**`. Placed HERE — immediately after the
     * base block and *before* the two blocks below — and the position is load
     * bearing, because the last matching config wins per rule:
     *
     * - after `travels-in-world/i18n-navigation` it would re-impose restrictions
     *   on `src/i18n/navigation.ts`, the one file allowed to import `next/link`;
     * - after `travels-in-world/domain-purity` it would replace the domain's
     *   import list with this much shorter one, and `src/domain/**` would quietly
     *   be free to import React again.
     *
     * From here, both of those blocks still have the last word on the files they
     * name. For `domain-purity` that is safe — its list is a strict superset
     * (`@/*` covers `@/map/*`, `..` covers the relative spellings, `d3-*` and
     * `topojson-*` are already there). For `i18n-navigation` it was NOT: that
     * block used to set the rule to `"off"`, and `"off"` forbids nothing. Measured
     * before the fix, from `src/i18n/navigation.ts` — the module every client
     * component imports, because it exports `usePathname` and `useRouter`:
     *
     *   import { buildWorldGeometry } from "@/map/world";   -> ALLOWED
     *   import { loadWorldDataset } from "../map/dataset";  -> ALLOWED
     *
     * A deep map import in that one file passes lint, typecheck and build, and
     * pulls the TopoJSON and `d3-geo` into the client bundle without ever meeting
     * `server-only` — the exact hole this block exists to close, in the worst
     * possible file. So `i18n-navigation` now re-states the map patterns instead
     * of switching the rule off wholesale. This comment previously claimed both
     * later blocks forbade a superset; that was true of one of them.
     *
     * The position, however, is not guarded by this comment: it is guarded by
     * `npm run test:lint`. Moving this block to the end of the array turns 28 of
     * its 75 cases red.
     *
     * `NAVIGATION_RESTRICTED_PATTERNS` is spread rather than assumed inherited:
     * these options REPLACE the base block's for every file matched below, which
     * includes all of `src/app/**`. Dropping the spread lints green and deletes
     * invariant 2 — see the note on the constant.
     *
     * `files`/`ignores` follow `travels-in-world/domain-purity`, for the two
     * reasons that block records:
     *
     * - all four TypeScript extensions, because `tsconfig.json` compiles
     *   `src/**\/*.tsx` and `.mts`/`.cts` would otherwise answer to no
     *   restriction at all;
     * - co-located specs are exempt, because `vitest.config.ts` allows a spec
     *   next to the file it tests and such a spec legitimately imports its deep
     *   neighbours. Restricting it would make that option a trap.
     *
     * `src/map/**` is exempt so the map's own modules can talk to each other.
     * And `tests/**` is not `src/**`, so the unit tests that import
     * `@/map/projection` or `@/map/path-context` directly are untouched — that is
     * the point, not an oversight: those modules carry no `server-only` guard
     * precisely so they stay testable.
     */
    name: "travels-in-world/map-entry-point",
    files: ["src/**/*.{ts,tsx,mts,cts}"],
    ignores: ["src/map/**", "src/**/*.test.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...NAVIGATION_RESTRICTED_PATTERNS, ...MAP_BOUNDARY_PATTERNS] },
      ],
      /**
       * The dynamic half of the same boundary — see the long note on
       * `MAP_DYNAMIC_IMPORT_RESTRICTIONS`. It is declared once, here, and it is
       * the ONLY block in this file that sets `no-restricted-syntax`.
       *
       * That single fact is why it reaches `src/i18n/navigation.ts` and
       * `src/domain/**` without being re-stated in their blocks, where
       * `no-restricted-imports` has to be: "the last matching config wins" only
       * takes a rule away when a later block *mentions that rule*. Neither of
       * those blocks does, so the options below survive into both.
       *
       * Which makes this an inheritance the next editor can break by accident, in
       * the file with the worst record in this repository for exactly that. If a
       * later block ever sets `no-restricted-syntax` over `src/**`, it must spread
       * `MAP_DYNAMIC_IMPORT_RESTRICTIONS` the way the blocks below spread
       * `NAVIGATION_RESTRICTED_PATTERNS`, or the dynamic boundary disappears from
       * the files it names with nothing to show for it. `tests/lint/map-entry-point.test.ts`
       * lints `src/i18n/navigation.ts` — the module every client component
       * imports — through this rule for that reason, and asserts on the `ruleId`
       * so the static rule cannot stand in for it.
       */
      "no-restricted-syntax": ["error", ...MAP_DYNAMIC_IMPORT_RESTRICTIONS],
    },
  },
  {
    /**
     * The single place allowed to reach for the raw Next.js primitives: this is
     * where the locale-aware wrappers are built.
     *
     * It is exempt from the NAVIGATION patterns and from those only. The rule used
     * to be switched `"off"` here, which also lifted the map boundary — and this
     * is the module every client component imports, since `usePathname` and
     * `useRouter` come from it. A deep `@/map/world` import here reached a client
     * bundle with lint, typecheck and build all green. So the map patterns are
     * re-stated rather than dropped: `next/link` stays allowed, `@/map/*` and
     * `d3-geo` do not.
     */
    name: "travels-in-world/i18n-navigation",
    files: ["src/i18n/navigation.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: MAP_BOUNDARY_PATTERNS }],
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
    },
  },
];

export default config;
