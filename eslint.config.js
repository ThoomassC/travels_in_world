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
];

export default config;
