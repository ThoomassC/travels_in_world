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
 * REPEAT them. That is not tidiness and not a nicety: it is the only way to keep
 * them, and it is the load-bearing part of every block below.
 *
 * `no-restricted-imports` takes options, and for a given file the last matching
 * config's options REPLACE the earlier ones rather than merging with them — the
 * `domain-purity` block says so in its own comment. So any block below that sets
 * this rule over a set of files, all of `src/app/**` included, silently removes
 * the `next/link` and `next/navigation` bans from those files: lint stays green,
 * and invariant 2 of `AGENTS.md` — «Navigation interne : jamais `next/link` ni
 * `next/navigation`» — is gone with no diff to show for it, while a raw
 * `next/link` drops the `[locale]` segment and the visitor gets a 404.
 *
 * `travels-in-world/domain-purity` gets away with dropping them only because its
 * own list forbids all of `next`, which is a strict superset. No other block has
 * that excuse, so every other block spreads this one — and
 * `tests/lint/content-facade.test.ts` and `tests/lint/map-entry-point.test.ts`
 * each carry a case per spelling, in every folder their block touches, for
 * exactly that reason.
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
 * `tests/**` and from a co-located spec — the `travels-in-world/content-facade`
 * block below matches none of them,
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
 * The content boundary, as one reusable group — three blocks below carry it, and
 * the two that are not `content-facade` itself carry it because they are *later*
 * and would otherwise replace it away. The same reasoning as
 * {@link NAVIGATION_RESTRICTED_PATTERNS}, one boundary further in.
 */
const CONTENT_FACADE_RESTRICTED_PATTERNS = [
  {
    group: CONTENT_FACADE_ONLY,
    message: CONTENT_FACADE_MESSAGE,
  },
];

/**
 * The same boundary against `await import(...)`, extracted for the same reason
 * and kept in step with the group above: an `ImportExpression` is a call, not a
 * declaration, and no `no-restricted-imports` option can be made to see it.
 *
 * The regex is anchored on the folder — `(^|/)content/` — so a package called
 * `x-content/y` is not swept in, and `(?!trips$)` is what lets the façade
 * through. `/` is escaped throughout because esquery lexes the attribute value
 * as a regex *literal* and would end it at the first bare `/`.
 */
const CONTENT_FACADE_DYNAMIC_IMPORT_RESTRICTIONS = [
  {
    selector: "ImportExpression > Literal[value=/(^|\\/)content\\/(?!trips$)/]",
    message: CONTENT_FACADE_MESSAGE,
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
      /**
       * Agent worktrees: other checkouts of *this* repository, on other branches,
       * sitting inside it.
       *
       * `eslint .` is a traversal target rather than an anchored glob — unlike
       * `vitest.config.ts`, whose `tests/**` and `src/**` do not match a nested
       * checkout — so without this line a sibling branch's work in progress fails
       * `npm run lint` here, and this branch's fails it there. Nobody can then tell
       * "my lint is green" from "my neighbour's is". Measured: a `jsx-a11y` error in
       * one worktree failed the barrier of a checkout that did not contain the file.
       *
       * `.gitignore` carries the same path and does **not** replace this one: the
       * flat config does not read `.gitignore`, and `.gitignore` hides nothing from
       * ESLint. Ignoring them in git matters for its own reason — one worktree
       * measured 579 MB that a `git add -A` would have committed — so both are
       * needed, and removing either one re-opens half the problem.
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
      /**
       * `role="list"` on a list element is redundant markup that is not redundant
       * in practice: `list-style: none` makes Safari drop the list role, and with
       * it the list's `aria-label` and its item count. A reader landing among the
       * world map's sixty trip links needs both. The rule ships an option for
       * exactly this case, and this is the narrowest exception that covers it —
       * only `list`, and only on the two list elements; every other redundant
       * role stays an error.
       *
       * **`ol` was added by TIW-16, and the reason is that the bug does not care.**
       * The mini-map's stop list is an `<ol>` because the stops *are* ordered, and
       * it is styled `list-style: none` like every other list here. ARIA has no
       * separate ordered-list role — `ol` and `ul` both map to `list` — so
       * `role="list"` is exactly as redundant and exactly as protective on one as
       * on the other. Restricting the exception to `ul` did not make the rule
       * stricter, it made an author choose between the right element and a green
       * lint.
       *
       * No test can see the underlying bug: jsdom keeps the role either way.
       */
      "jsx-a11y/no-redundant-roles": ["error", { ul: ["list"], ol: ["list"] }],
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
     * base block and *before* the three blocks below — and the position is load
     * bearing, because the last matching config wins per rule:
     *
     * - after `travels-in-world/i18n-navigation` it would re-impose restrictions
     *   on `src/i18n/navigation.ts`, the one file allowed to import `next/link`;
     * - after `travels-in-world/domain-purity` it would replace the domain's
     *   import list with this much shorter one, and `src/domain/**` would quietly
     *   be free to import React again.
     *
     * From here, the blocks below still have the last word on the files they name.
     * For `domain-purity` that is safe — its list is a strict superset (`@/*`
     * covers `@/map/*`, `..` covers the relative spellings, `d3-*` and
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
     * `travels-in-world/content-facade` is the third block that has the last word
     * here, over everything this one covers except `src/content/**`, and it
     * re-states BOTH halves of this boundary for that reason. See its own comment
     * for the measurement.
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
     * `src/map/**` is exempt so the map's own modules can talk to each other and
     * open `d3-geo`, `topojson-client` and `world-atlas` — `dataset.ts` opens with
     * all three. That exemption is a per-*block* one, so it survives only as long
     * as no later block re-imposes the map patterns on the folder;
     * `travels-in-world/map-internals` below is what keeps it after
     * `content-facade` widened its own reach to `src/**`.
     *
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
       * `MAP_DYNAMIC_IMPORT_RESTRICTIONS`.
       *
       * It used to be the ONLY block in this file setting `no-restricted-syntax`,
       * which is how it reached `src/i18n/navigation.ts` and `src/domain/**`
       * without being re-stated there: "the last matching config wins" only takes
       * a rule away when a later block *mentions that rule*. That is no longer
       * true, and the change is the whole reason this comment was rewritten —
       * `travels-in-world/content-facade`, `travels-in-world/map-internals` and
       * `travels-in-world/domain-purity` all set `no-restricted-syntax` now. Two
       * of them spread `MAP_DYNAMIC_IMPORT_RESTRICTIONS` back in; the third
       * (`domain-purity`) replaces it with a strictly narrower allowlist, and the
       * fourth (`map-internals`) drops it deliberately, because inside `src/map/**`
       * a dynamic `d3-geo` is the supported spelling.
       *
       * The standing rule for the next editor, which this file keeps re-teaching:
       * **the last block matching a file must carry everything that should apply
       * to it.** If a further block ever sets `no-restricted-syntax` over `src/**`,
       * it must spread `MAP_DYNAMIC_IMPORT_RESTRICTIONS` the way the blocks below
       * spread `NAVIGATION_RESTRICTED_PATTERNS`, or the dynamic boundary
       * disappears from the files it names with nothing to show for it.
       * `tests/lint/map-entry-point.test.ts` lints `src/i18n/navigation.ts` — the
       * module every client component imports — through this rule for that reason,
       * and asserts on the `ruleId` so the static rule cannot stand in for it.
       */
      "no-restricted-syntax": ["error", ...MAP_DYNAMIC_IMPORT_RESTRICTIONS],
    },
  },
  {
    /**
     * The application reaches the content through `@/content/trips` and through
     * nothing else. See {@link CONTENT_FACADE_ONLY} for the measured table of
     * spellings, and {@link NAVIGATION_RESTRICTED_PATTERNS} for why the navigation
     * ban is spread in here rather than assumed to survive: this block *replaces*
     * the options of the global one for every file it matches.
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
     * **Both halves of the map boundary are re-stated here, and that is not
     * belt-and-braces.** `travels-in-world/map-entry-point` above matches the same
     * `src/**` glob, so for every file the two blocks share — `src/app/**`,
     * `src/components/**`, `src/i18n/**`, and any folder added later — this block
     * is the last one to mention `no-restricted-imports` *and* the last one to
     * mention `no-restricted-syntax`, and its options replace theirs outright.
     * Without `...MAP_BOUNDARY_PATTERNS` a page or the photo viewer could import
     * `@/map/world`, `d3-geo` or `world-atlas/countries-110m.json`; without
     * `...MAP_DYNAMIC_IMPORT_RESTRICTIONS` it could `await import()` any of them.
     * Both spellings ship the TopoJSON to the browser past a `server-only` guard
     * they never meet, with a green lint — the exact failure the note on
     * `MAP_DYNAMIC_IMPORT_RESTRICTIONS` describes, and the reason
     * `tests/lint/map-entry-point.test.ts` lints `src/components/map/world-map.tsx`
     * as well as `src/app/[locale]/page.tsx`.
     *
     * The one place that widening is wrong is inside `src/map/**` itself, which
     * this block matches and `map-entry-point` deliberately does not:
     * `src/map/dataset.ts` opens on `d3-geo`, `topojson-client` and
     * `world-atlas/countries-110m.json`, so imposing the map patterns there fails
     * `npm run lint` on code nobody touched. `travels-in-world/map-internals`
     * below is the answer, and it exists for this reason alone.
     *
     * **Why the three `ignores`, one reason each:**
     *
     * - `src/content/**` *owns* the loader: the façade re-exports it and
     *   `validate.ts` imports `collection.ts`. Refusing there would forbid the
     *   rule's own subject from existing. (It stays covered by the map boundary,
     *   which `map-entry-point` still has the last word on there — and
     *   `tests/lint/map-entry-point.test.ts` pins `src/content/loader.ts` refusing
     *   `@/map/world` for exactly that reason.)
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
     * **`src/i18n/navigation.ts` is deliberately *not* in that list, and that is a
     * fix rather than a tidy-up.** An `ignores` entry exempts a file from the whole
     * block, so it switched the content patterns off along with the navigation
     * ones — measured: `src/i18n/navigation.ts` importing `@/content/loader` was
     * **ACCEPTED**. And that file is the one every client component imports; it
     * exists to export `Link`, `useRouter` and `usePathname`. A helper there that
     * needed a slug would have pulled the filesystem reader into the client graph
     * through the most-imported module of the bundle. The opposite trap is real too
     * and was measured: with no exemption at all, this block — being *later* than
     * the old `no-restricted-imports: "off"` one — turned the rule back on there
     * and **refused `next/link`**, which makes the locale-aware wrappers
     * unwritable and kills invariant 2. So the exemption is a block of its own,
     * *after* this one, restoring the map and content patterns only:
     * `travels-in-world/i18n-navigation` below.
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
     *   `no-restricted-syntax` selectors need a `Literal`. Nothing here can fix
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
            ...NAVIGATION_RESTRICTED_PATTERNS,
            ...MAP_BOUNDARY_PATTERNS,
            ...CONTENT_FACADE_RESTRICTED_PATTERNS,
          ],
        },
      ],
      /**
       * The dynamic spelling of both crossings. `no-restricted-imports` sees
       * import *declarations* only — a known blind spot for `next/link`, and a
       * worse one here, because `await import()` is the natural way to load
       * something lazily in a Server Component. Measured before this rule:
       * `await import("@/content/loader")` was **accepted** from a page and from
       * `src/components/**`.
       *
       * `MAP_DYNAMIC_IMPORT_RESTRICTIONS` is spread first for the reason spelled
       * out above and on the block before this one: these options replace that
       * block's for every file the two share, so omitting the spread deletes the
       * dynamic map boundary from all of `src/app/**` and `src/components/**` in
       * silence.
       *
       * The content selector matches the specifier string of an `ImportExpression`,
       * and its regex is anchored on the folder — `(^|/)content/` — so a package
       * called `x-content/y` is not swept in. `(?!trips$)` is what lets the façade
       * through; `@/content/trips.js` is refused, the same accepted false positive
       * `CONTENT_FACADE_ONLY` already makes for the static spelling.
       *
       * Measured through ESLint's Node API: refuses `@/content/loader` and
       * `../content/loader`, accepts `@/content/trips`.
       */
      "no-restricted-syntax": [
        "error",
        ...MAP_DYNAMIC_IMPORT_RESTRICTIONS,
        ...CONTENT_FACADE_DYNAMIC_IMPORT_RESTRICTIONS,
      ],
    },
  },
  {
    /**
     * The map's own modules, and the one block in this file that exists purely
     * because two boundaries drawn independently overlap.
     *
     * `travels-in-world/map-entry-point` exempts `src/map/**` — the folder is
     * where `d3-geo`, `topojson-client` and `world-atlas` are *supposed* to be
     * opened, and where `world.ts` legitimately imports `@/map/iso-3166`.
     * `travels-in-world/content-facade` does **not** exempt it, on purpose: a map
     * module has no more business reading the disk directly than a page does, and
     * `tests/lint/content-facade.test.ts` pins `src/map/world.tsx` refusing
     * `@/content/loader` in every spelling.
     *
     * Those two facts collide, because `content-facade` is the later block: its
     * `...MAP_BOUNDARY_PATTERNS` and `...MAP_DYNAMIC_IMPORT_RESTRICTIONS` — both
     * required for every *other* folder — land on `src/map/**` too and undo the
     * exemption. Measured, that is not a theoretical over-reach:
     *
     *   src/map/dataset.ts    import { geoPath } from "d3-geo";                  -> REFUSED
     *   src/map/dataset.ts    import { feature } from "topojson-client";         -> REFUSED
     *   src/map/dataset.ts    import RAW from "world-atlas/countries-110m.json"; -> REFUSED
     *   src/map/projection.ts import { geoNaturalEarth1 } from "d3-geo";         -> REFUSED
     *   src/map/world.ts      import { NUMERIC_BY_ALPHA2 } from "@/map/iso-3166";-> REFUSED
     *
     * — four real files failing `npm run lint`, and five rows of
     * `tests/lint/map-entry-point.test.ts` turning red, for a boundary that was
     * never meant to point inwards.
     *
     * So this block restates, for `src/map/**` only, exactly the two bans the
     * folder must keep and drops the two it must not: the navigation patterns and
     * the content façade, static and dynamic. It carries no map pattern at all,
     * which is what makes it the exemption rather than a copy of the block above.
     *
     * It is the same shape as `travels-in-world/i18n-navigation` below, for the
     * same reason, and it obeys the rule this file keeps re-teaching: **the last
     * block matching a file must carry everything that should apply to it.**
     *
     * The co-located spec exemption is repeated because `ignores` is per block:
     * `src/map/world.test.ts` may reach for `@/content/loader` and for `d3-geo`,
     * which `tests/lint/content-facade.test.ts` and
     * `tests/lint/map-entry-point.test.ts` both assert.
     */
    name: "travels-in-world/map-internals",
    files: ["src/map/**/*.{ts,tsx,mts,cts}"],
    ignores: ["src/**/*.test.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [...NAVIGATION_RESTRICTED_PATTERNS, ...CONTENT_FACADE_RESTRICTED_PATTERNS],
        },
      ],
      "no-restricted-syntax": ["error", ...CONTENT_FACADE_DYNAMIC_IMPORT_RESTRICTIONS],
    },
  },
  {
    /**
     * The single place allowed to reach for the raw Next.js navigation primitives:
     * this is where the locale-aware wrappers are built, so `next/link` and
     * `next/navigation` must be importable here and nowhere else.
     *
     * **A block, and not an `ignores` entry on the blocks above.** `ignores` is
     * per-block, so exempting this file there switched off the *content* pattern
     * and the *map* pattern along with the navigation ones. Both were measured, and
     * both matter more here than anywhere else, because this is the module every
     * client component imports — `usePathname` and `useRouter` come from it:
     *
     *   import { loadTrips } from "@/content/loader";       -> ACCEPTED
     *   import { buildWorldGeometry } from "@/map/world";   -> ACCEPTED
     *   import { loadWorldDataset } from "../map/dataset";  -> ACCEPTED
     *
     * The first pulls the unguarded filesystem reader into the client graph; the
     * other two pull `d3-geo` and 105 KB of TopoJSON there, past a `server-only`
     * guard they never meet. Lint, typecheck and build all green in each case. The
     * older spelling of this exemption, `"no-restricted-imports": "off"`, is what
     * produced all three: `"off"` forbids nothing.
     *
     * So this block lifts the navigation patterns and **only** those, by restating
     * the two boundaries the file must keep obeying: `MAP_BOUNDARY_PATTERNS` and
     * the content façade group.
     *
     * **Order is load-bearing.** ESLint resolves a rule by last-matching-config
     * wins, replacing the options rather than merging them, so this block must
     * come *after* `map-entry-point` and `content-facade` — before either, that
     * block would reinstate the navigation ban here and the locale-aware wrappers
     * would become unwritable. `tests/lint/content-facade.test.ts` and
     * `tests/lint/map-entry-point.test.ts` pin all three halves in this one file:
     * `next/link` accepted, `@/content/loader` refused, `@/map/world` refused.
     *
     * `no-restricted-syntax` is deliberately **not** overridden: the dynamic bans
     * from `content-facade` — map and content both — still apply here, which is
     * what they are for. That is an inheritance rather than a re-statement, and
     * inheritances in this file are one careless edit from vanishing, so both
     * suites carry a dynamic case on this exact file and assert on the `ruleId`.
     */
    name: "travels-in-world/i18n-navigation",
    files: ["src/i18n/navigation.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...MAP_BOUNDARY_PATTERNS, ...CONTENT_FACADE_RESTRICTED_PATTERNS] },
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
       * `map-entry-point` does *not* ignore `src/domain/**`, so without the copy
       * below the domain would inherit `MAP_DYNAMIC_IMPORT_RESTRICTIONS` from it
       * and nothing else — a selector that says nothing about `node:fs`. The
       * inheritance is real and useless here, which is a worse shape than no
       * inheritance at all: it makes the rule *fire*, on the wrong subject.
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
