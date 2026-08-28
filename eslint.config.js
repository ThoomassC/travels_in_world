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
       * Agent worktrees: other checkouts of *this* repository, on other branches.
       * `eslint .` is a traversal target rather than an anchored glob — unlike
       * `vitest.config.ts`, whose `tests/**` and `src/**` do not match a nested
       * checkout — so without this line a sibling branch's work in progress fails
       * `npm run lint` here, and this branch's fails it there.
       *
       * `.gitignore` carries the same path and does **not** replace this one: the
       * flat config does not read `.gitignore`, and `.gitignore` does not hide
       * anything from ESLint. Removing either one re-opens half the problem.
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
      "no-restricted-imports": [
        "error",
        {
          patterns: [
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
          ],
        },
      ],
    },
  },
  {
    // The single place allowed to reach for the raw Next.js primitives: this is
    // where the locale-aware wrappers are built.
    name: "travels-in-world/i18n-navigation",
    files: ["src/i18n/navigation.ts"],
    rules: {
      "no-restricted-imports": "off",
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
