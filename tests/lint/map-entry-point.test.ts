import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The map entry-point boundary, tested through ESLint's own Node API.
 *
 * `src/map/**` computes the world geometry at build time from the whole
 * world-atlas TopoJSON. Only `src/map/index.ts` carries `import "server-only"`,
 * so it is the only module whose reach into a client bundle fails the build; a
 * `'use client'` component importing `@/map/world` directly would drag the
 * dataset to the browser with a green build. The `@/map` façade is therefore the
 * single import path `src/**` outside the map is allowed to use, and the rule
 * named `travels-in-world/map-entry-point` in `eslint.config.js` is what makes
 * that mechanical rather than documentary.
 *
 * This test exists because the sibling boundary — domain purity — regressed
 * **twice inside the ticket that created it** (a glob that missed `.tsx`, then a
 * pattern that let `"./../x"` through where `"../x"` was refused). Both times the
 * rule existed, looked like it worked, and refused nothing. `AGENTS.md` records
 * that history under "Les deux gardes exécutables"; a rule with no test that
 * *watches it refuse something* is a comment.
 *
 * Nothing is written to disk. `lintText` takes the source as a string and a
 * *virtual* `filePath`, only used to resolve which blocks of `eslint.config.js`
 * apply — so these fixtures exercise the real config from the real repository
 * without leaving a probe behind in `src/app`.
 *
 * Runs under `npm run test:lint`, alongside `domain-purity.test.ts`, and for the
 * same reason: it needs `environment: "node"`, where `import.meta.url` is a
 * `file:` URL. `vitest.lint.config.ts` carries that reasoning.
 */

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

const RESTRICTED_IMPORTS_RULE = "no-restricted-imports";

/**
 * The second half of the boundary, and a *different rule* on purpose.
 *
 * `no-restricted-imports` visits `ImportDeclaration` only, so `await import(...)`
 * — an `ImportExpression` — walks past it no matter how its options are written.
 * `travels-in-world/map-entry-point` therefore carries a `no-restricted-syntax`
 * selector alongside it. The two are complementary, not redundant, and the cases
 * below assert on the rule id rather than on a violation count so that neither
 * can silently stand in for the other.
 */
const RESTRICTED_SYNTAX_RULE = "no-restricted-syntax";

type Verdict = {
  /** Violations of the import restriction — what every case here asserts on. */
  readonly restricted: number;
  /** The messages of those violations, so a case can pin *which* ban fired. */
  readonly messages: readonly string[];
  /** Violations of the dynamic-import restriction, counted separately. */
  readonly dynamic: number;
  /** The messages of those, so a dynamic case can pin *which* ban fired too. */
  readonly dynamicMessages: readonly string[];
  /** Parse failures, asserted empty everywhere so they can never read as a pass. */
  readonly fatal: readonly string[];
  /** Every rule that fired, so an "accepted" case can demand complete silence. */
  readonly ruleIds: readonly (string | null)[];
};

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: repositoryRoot });
});

/**
 * `warnIgnored: false` keeps an ignored path from answering with a warning
 * instead of a result. An empty result array would mean the file matched no
 * config block at all — the exact shape of the `.mts`/`.cts` hole the domain rule
 * shipped with — so it is asserted against rather than defaulted away.
 */
async function lint(relativePath: string, source: string): Promise<Verdict> {
  const results = await eslint.lintText(source, {
    filePath: path.join(repositoryRoot, relativePath),
    warnIgnored: false,
  });

  expect(results, `${relativePath} matched no ESLint configuration`).toHaveLength(1);
  const messages = results[0]?.messages ?? [];
  const restricted = messages.filter((message) => message.ruleId === RESTRICTED_IMPORTS_RULE);
  const dynamic = messages.filter((message) => message.ruleId === RESTRICTED_SYNTAX_RULE);

  return {
    restricted: restricted.length,
    messages: restricted.map((message) => message.message),
    dynamic: dynamic.length,
    dynamicMessages: dynamic.map((message) => message.message),
    fatal: messages.filter((message) => message.fatal === true).map((message) => message.message),
    ruleIds: messages.map((message) => message.ruleId),
  };
}

/**
 * The dynamic fixture, kept to a single `await import(...)` for the same reason
 * the static ones hold a single declaration: a bare count of violations then
 * identifies the specifier without depending on the wording of a message.
 *
 * It is an arrow function rather than a top-level `await` because a top-level
 * `await` makes the fixture a module with different parse requirements, and a
 * fixture that fails to parse would satisfy every "refuses" case in this file by
 * accident — which is precisely what `verdict.fatal` is asserted against.
 */
const dynamicImport = (specifier: string): string =>
  `export const load = async () => await import(${JSON.stringify(specifier)});`;

/**
 * Every fixture below holds exactly **one** import, which is what lets a bare
 * count of `no-restricted-imports` violations identify the specifier without
 * depending on the wording of a message. `export const a = …` keeps
 * `@typescript-eslint/no-unused-vars` quiet so the clean controls can demand
 * total silence.
 */
async function expectRefused(relativePath: string, source: string): Promise<Verdict> {
  const verdict = await lint(relativePath, source);

  expect(verdict.fatal).toEqual([]);
  expect(verdict.restricted).toBeGreaterThan(0);

  return verdict;
}

async function expectAccepted(relativePath: string, source: string): Promise<void> {
  const verdict = await lint(relativePath, source);

  expect(verdict.fatal).toEqual([]);
  expect(verdict.messages).toEqual([]);
  expect(verdict.restricted).toBe(0);
  /**
   * Both halves of the boundary have to stay quiet, not just the one a given
   * case is about. A selector broad enough to trip on a static import — or on
   * `@/map` itself — would otherwise pass unnoticed through every acceptance
   * case in this file.
   */
  expect(verdict.dynamicMessages).toEqual([]);
  expect(verdict.dynamic).toBe(0);
}

/** The dynamic counterparts, keyed on `no-restricted-syntax` rather than on the count. */
async function expectDynamicRefused(relativePath: string, specifier: string): Promise<Verdict> {
  const verdict = await lint(relativePath, dynamicImport(specifier));

  expect(verdict.fatal).toEqual([]);
  expect(verdict.dynamic).toBeGreaterThan(0);

  return verdict;
}

async function expectDynamicAccepted(relativePath: string, specifier: string): Promise<void> {
  await expectAccepted(relativePath, dynamicImport(specifier));
}

describe("the map entry-point rule refuses a deep import from outside src/map", () => {
  /**
   * The violation this rule is here to catch. `@/map/world` pulls the TopoJSON
   * reader in without passing the one module that carries `import "server-only"`,
   * so nothing fails a build when a client component reaches it — the dataset
   * simply ends up in the browser bundle.
   */
  it.each([
    "src/app/[locale]/page.tsx",
    "src/app/[locale]/layout.tsx",
    "src/app/layout.tsx",
    "src/i18n/request.ts",
    "src/content/loader.ts",
    /**
     * The file that will actually be tempted to do this, and the one this list
     * was missing. TIW-13 creates `src/components/**` and puts the map component
     * there — `'use client'`, since it owns the hover and the click — which makes
     * it the single most likely author of a deep map import in the repository,
     * and the one where the mistake costs the most: a client bundle carrying the
     * TopoJSON.
     *
     * It does not exist on disk yet, and it does not need to: `lintText` resolves
     * config blocks against a *virtual* `filePath`, so the net can cover a folder
     * before the folder is written. The rule itself already covers it — its glob
     * is `src/**` — so what this row adds is not coverage of the rule but coverage
     * of *this list*, which is hand-written and therefore ages.
     *
     * That distinction is precisely the regression `AGENTS.md` records twice over:
     * a rule that exists, looks like it works, and guards nothing anyone checks. A
     * frozen list of importing paths that never learns about a new top-level
     * folder is the same defect wearing a test's clothes — green lint, green
     * suite, unprobed folder.
     */
    "src/components/map/world-map.tsx",
  ])("refuses `@/map/world` from %s", async (file) => {
    await expectRefused(
      file,
      'import { buildWorldGeometry } from "@/map/world";\nexport const a = buildWorldGeometry;'
    );
  });

  /**
   * Every other module under the folder, not just `world`. A rule keyed on the
   * single specifier it was written against is the failure mode this row set
   * exists to catch.
   *
   * `@/map/index` is in the list **on purpose**, and it is a decision rather than
   * an oversight: the canonical path to the façade is `@/map`, and admitting a
   * second spelling for the same module means two import styles in the codebase
   * and a rule that has to keep them in step. Reviewers who read this list as a
   * bug should read this sentence instead.
   */
  it.each([
    "@/map/world",
    "@/map/projection",
    "@/map/iso-3166",
    "@/map/dataset",
    "@/map/path-context",
    "@/map/index",
  ])("refuses the deep specifier %o from src/app", async (specifier) => {
    await expectRefused(
      "src/app/[locale]/page.tsx",
      `import ${JSON.stringify(specifier)};\n`.concat("export const a = 1;")
    );
  });

  /**
   * A specifier deeper than one segment, which is worth a case because the reason
   * it is caught is not the obvious one. `*` does **not** cross a `/`, so
   * `"@/map/*"` does not match `"@/map/sub/deep/thing"` by itself — it is caught
   * because a matched directory carries everything beneath it, the way a directory
   * does in `.gitignore`. `eslint.config.js` already documents that behaviour for
   * the domain rule; this row is what keeps the map rule honest about relying on
   * it, rather than on a pattern that would need a `@/map/**` companion.
   */
  it("refuses a specifier nested deeper than one segment", async () => {
    await expectRefused(
      "src/app/[locale]/page.tsx",
      'import "@/map/sub/deep/thing";\nexport const a = 1;'
    );
  });

  /**
   * Leaving the façade by walking the tree relatively is the same module to the
   * bundler and walks past a pattern written against the `@/` spelling alone.
   * This is verbatim the hole the domain rule shipped with: `"../x"` was refused
   * while `"./../x"` linted, typechecked and built clean. All four spellings were
   * measured against the retained group `["@/map/*", "**\/map/*"]`.
   */
  it.each(["../map/world", "./../map/world", ".././map/world", "../../src/map/world"])(
    "refuses the relative spelling %o from src/app",
    async (specifier) => {
      await expectRefused("src/app/[locale]/page.tsx", `import ${JSON.stringify(specifier)};\n`);
    }
  );
});

/**
 * THE PACKAGES THE FAÇADE ENCAPSULATES, WHICH LEAK IF ONLY THE MODULES ARE BANNED.
 *
 * Banning `@/map/*` closes the door and leaves the raw ingredients on the step.
 * Measured from `src/app/[locale]/page.tsx` before `MAP_PACKAGE_PATTERNS` existed:
 *
 *   import atlas from "world-atlas/countries-110m.json";  -> ALLOWED
 *   import { geoPath } from "d3-geo";                     -> ALLOWED
 *
 * `resolveJsonModule` is on, so the first line typechecks, lints and builds — and
 * a `'use client'` component doing it ships 105 KB of TopoJSON to the browser
 * without ever meeting the `server-only` guard, because it never touches `@/map`
 * at all. The second hands that same component the whole projection library. Both
 * are invisible to a rule keyed on `@/map/*`, and both defeat criterion 1 of
 * TIW-12 — "0 Ko de bibliothèque côté client".
 *
 * Every case asserts the ban **by its message**, so a case cannot be satisfied by
 * some unrelated restriction happening to fire on the same fixture.
 */
describe("the map boundary refuses the packages, not only the modules", () => {
  /**
   * The JSON first, because it is the one that matters most and the one the
   * domain's own list does not carry: `DOMAIN_FORBIDDEN_IMPORTS` covers `d3-*`
   * and `topojson-*` but has never mentioned `world-atlas`.
   *
   * The bare `world-atlas` row is not redundant with the deep one: it is what
   * proves the gitignore-style behaviour the config relies on — a package name
   * matches everything beneath it — is what makes `world-atlas` alone enough,
   * with no `world-atlas/*` companion pattern.
   */
  const ENCAPSULATED_PACKAGES = [
    "world-atlas/countries-110m.json",
    "world-atlas",
    "d3-geo",
    "topojson-client",
  ];

  /**
   * The three kinds of importer the map boundary has to hold against, and they
   * are guarded by two different config blocks:
   *
   * - `src/app/**`, the pages, and `src/components/**`, where TIW-13 will put the
   *   `'use client'` map — both matched by `travels-in-world/map-entry-point`;
   * - `src/i18n/navigation.ts`, matched by `travels-in-world/i18n-navigation`,
   *   which is declared *after* the map block and therefore replaces its options
   *   outright. That file used to switch the rule `"off"` — see the block below
   *   for what that cost — and now re-states the map patterns instead.
   */
  const IMPORTERS = [
    "src/app/[locale]/page.tsx",
    "src/components/map/world-map.tsx",
    "src/i18n/navigation.ts",
  ];

  it.each(
    IMPORTERS.flatMap((file) => ENCAPSULATED_PACKAGES.map((specifier) => ({ file, specifier })))
  )("refuses $specifier from $file", async ({ file, specifier }) => {
    const verdict = await expectRefused(
      file,
      `import ${JSON.stringify(specifier)};\nexport const a = 1;`
    );

    expect(verdict.messages.join("\n")).toMatch(/build-time only/);
  });

  /**
   * The control, and it is not optional: `src/map/**` is where these packages are
   * *supposed* to be imported — `dataset.ts` opens with all three — so a pattern
   * broad enough to catch a component must stop at the folder that does the work.
   * Without this row, a rule banning `d3-geo` everywhere would satisfy every case
   * above while making the map impossible to build.
   *
   * `tests/map/support.ts` is in the list for the neighbouring reason: `tests/**`
   * is not `src/**`, and the fixture that re-reads the dataset independently of
   * `src/map` has to stay free to reach for it. A `files` glob widened to
   * `**\/*.ts` fails here rather than in a test nobody connects to the config.
   */
  it.each([
    { file: "src/map/dataset.ts", specifier: "world-atlas/countries-110m.json" },
    { file: "src/map/dataset.ts", specifier: "d3-geo" },
    { file: "src/map/dataset.ts", specifier: "topojson-client" },
    { file: "src/map/projection.ts", specifier: "d3-geo" },
    { file: "tests/map/support.ts", specifier: "world-atlas/countries-110m.json" },
  ])("accepts $specifier from $file", async ({ file, specifier }) => {
    await expectAccepted(file, `import ${JSON.stringify(specifier)};\nexport const a = 1;`);
  });
});

describe("the map entry-point rule leaves the legitimate paths alone", () => {
  /**
   * The control without which a rule banning `@/map` outright would satisfy every
   * case above. The façade is the supported import, and it has to stay silent.
   *
   * It passes for a counter-intuitive reason, which is exactly why it needs its
   * own case: the retained group is `["@/map/*", "**\/map/*"]` with no negation, and
   * `@/map` is the *directory* — `@/map/*` needs a segment after the slash, so the
   * bare specifier is not matched at all. Nothing in the config says "except the
   * façade"; the façade simply falls outside the pattern. A reader who "tidies"
   * the group into `@/map*` or `@/map/**` breaks this row and only this row.
   */
  it("accepts `@/map`, the façade, from src/app", async () => {
    await expectAccepted(
      "src/app/[locale]/page.tsx",
      'import { buildWorldGeometry } from "@/map";\nexport const a = buildWorldGeometry;'
    );
  });

  /**
   * The map modules talk to each other. A rule scoped by specifier rather than by
   * *importing file* would break the folder from the inside — and the break would
   * surface as a lint error in code nobody had touched.
   */
  it.each([
    { file: "src/map/world.ts", specifier: "@/map/iso-3166" },
    { file: "src/map/world.ts", specifier: "@/map/projection" },
    { file: "src/map/projection.ts", specifier: "@/map/path-context" },
    { file: "src/map/index.ts", specifier: "@/map/world" },
  ])("accepts $specifier from $file", async ({ file, specifier }) => {
    await expectAccepted(
      file,
      `import { NUMERIC_BY_ALPHA2 } from ${JSON.stringify(specifier)};\n`.concat(
        "export const a = NUMERIC_BY_ALPHA2;"
      )
    );
  });

  /**
   * Sibling imports inside the folder, the relative form the map actually uses.
   * A pattern broad enough to catch `"../map/world"` from outside must not also
   * catch `"./iso-3166"` from inside.
   */
  it.each(["./iso-3166", "./projection", "./dataset"])(
    "accepts the sibling %o from src/map/world.ts",
    async (specifier) => {
      await expectAccepted(
        "src/map/world.ts",
        `import ${JSON.stringify(specifier)};\nexport const a = 1;`
      );
    }
  );
});

describe("the controls that keep this suite from passing for the wrong reason", () => {
  /**
   * Without this, a rule that refused *everything* — or a fixture that failed to
   * parse — would satisfy every "refuses" case above.
   */
  it("leaves an unrelated import in src/app completely alone", async () => {
    const verdict = await lint(
      "src/app/[locale]/page.tsx",
      'import { Link } from "@/i18n/navigation";\nexport const a = Link;'
    );

    expect(verdict.fatal).toEqual([]);
    expect(verdict.ruleIds).toEqual([]);
  });

  /**
   * The rule is about crossing *into* the map from outside, not a project-wide
   * ban on deep aliased imports. A `files` glob or a pattern widened by accident
   * fails here rather than in a component nobody links to the config change.
   */
  it.each(["@/domain/geo", "@/content/validate", "@/i18n/routing"])(
    "leaves the deep specifier %o outside src/map alone",
    async (specifier) => {
      await expectAccepted(
        "src/app/[locale]/page.tsx",
        `import ${JSON.stringify(specifier)};\nexport const a = 1;`
      );
    }
  );
});

/**
 * THE NON-REGRESSION NET, and the reason this file is not optional.
 *
 * This block is the only thing standing between a `no-restricted-imports` block
 * added later and the silent decapitation of invariant 2 — «la dernière config
 * qui matche gagne», per rule, as the `travels-in-world/domain-purity` comment in
 * `eslint.config.js` already states; and this repository has paid for that class
 * of defect twice.
 *
 * Concretely: invariant 2 of `AGENTS.md` — internal navigation goes through
 * `@/i18n/navigation`, never `next/link` or `next/navigation` — lives in the
 * global `travels-in-world/rules` block as `no-restricted-imports` *options*. A
 * new block scoping that same rule over `src/**` does not add to those options,
 * it **replaces** them for every file it matches. `next/link` then lints clean,
 * the `[locale]` segment is dropped at runtime, and the visitor gets a 404, with
 * a green build and a green lint. No type and no review catches it.
 *
 * Every case asserts the navigation ban **by its message**, not merely that some
 * restriction fired: a map rule tripping on an unrelated specifier must not be
 * able to stand in for the navigation ban.
 */
describe("invariant 2 survives whatever the map rule adds", () => {
  const NAVIGATION_FIXTURES = [
    {
      label: "next/link",
      source: 'import Link from "next/link";\nexport const a = Link;',
    },
    /**
     * The `.js` spelling is the same module to `require.resolve`, and the rule is
     * keyed on the specifier string — which is why `nextModuleSpellings` in
     * `eslint.config.js` lists both. A replacement block that kept only the bare
     * form would leave this one open.
     */
    {
      label: "next/link.js",
      source: 'import Link from "next/link.js";\nexport const a = Link;',
    },
    {
      label: "redirect from next/navigation",
      source: 'import { redirect } from "next/navigation";\nexport const a = redirect;',
    },
    {
      label: "permanentRedirect from next/navigation",
      source:
        'import { permanentRedirect } from "next/navigation";\nexport const a = permanentRedirect;',
    },
    /**
     * The nastiest half of the invariant: Next's `usePathname` returns the pathname
     * *with* the `/fr` prefix and next-intl's returns it without. Same name, same
     * shape, opposite value, and nothing warns.
     */
    {
      label: "usePathname from next/navigation",
      source: 'import { usePathname } from "next/navigation";\nexport const a = usePathname;',
    },
    {
      label: "useRouter from next/navigation",
      source: 'import { useRouter } from "next/navigation";\nexport const a = useRouter;',
    },
  ];

  /**
   * Both sides of the new boundary. `src/app/**` is the folder the map block is
   * aimed away from; `src/map/**` is the folder it has to carve an exemption for,
   * and an exemption written as a whole-rule `"off"` would take the navigation ban
   * down with it inside the map.
   */
  it.each(
    ["src/app/[locale]/page.tsx", "src/map/world.ts"].flatMap((file) =>
      NAVIGATION_FIXTURES.map((fixture) => ({ file, ...fixture }))
    )
  )("still refuses $label from $file", async ({ file, source }) => {
    const verdict = await expectRefused(file, source);

    expect(verdict.messages.join("\n")).toMatch(/@\/i18n\/navigation/);
  });

  /**
   * The positive control, and it matters as much as the refusals above: a test
   * that only checked refusals would be perfectly happy with a config that
   * forbade everything to everyone. `src/i18n/navigation.ts` is the single file
   * allowed to reach the raw Next primitives — it is where the locale-aware
   * wrappers are built — and that exemption must not be overridden by a block
   * declared after it.
   */
  it.each(NAVIGATION_FIXTURES)(
    "keeps src/i18n/navigation.ts free to import $label",
    async ({ source }) => {
      await expectAccepted("src/i18n/navigation.ts", source);
    }
  );

  /**
   * THE OTHER HALF OF THAT EXEMPTION, AND THE HALF THAT WAS MISSING.
   *
   * The exemption above used to be spelled `"no-restricted-imports": "off"` —
   * total, not scoped to the navigation patterns — in a block declared *after*
   * the map block, so it switched the map boundary off along with the navigation
   * ban. Measured in that state, from this very file:
   *
   *   import { buildWorldGeometry } from "@/map/world";   -> ALLOWED
   *   import { loadWorldDataset } from "../map/dataset";  -> ALLOWED
   *
   * Of all the files in the repository this is the worst one to leave open:
   * `@/i18n/navigation` exports `usePathname` and `useRouter`, so *every* client
   * component imports it. A deep map import here reaches a client bundle with
   * lint, typecheck and build all green, dragging the TopoJSON and `d3-geo` past
   * a `server-only` guard it never meets.
   *
   * The config now re-states the map patterns instead of switching the rule off,
   * and these rows are what keeps it that way. They are the negative half of the
   * pair the case above forms: `next/link` still allowed here, `@/map/*` no
   * longer. Either half alone can be satisfied by a config that is wrong in the
   * other direction.
   *
   * Both spellings, aliased and relative, because "off" hid both and a
   * re-statement that covered only `@/map/*` would look identical from the
   * outside — the same hole the domain rule shipped with.
   */
  it.each(["@/map/world", "../map/dataset"])(
    "refuses the deep map import %o from src/i18n/navigation.ts",
    async (specifier) => {
      const verdict = await expectRefused(
        "src/i18n/navigation.ts",
        `import ${JSON.stringify(specifier)};\nexport const a = 1;`
      );

      expect(verdict.messages.join("\n")).toMatch(/Import from "@\/map" instead/);
    }
  );

  /**
   * The ban on `next/navigation` is scoped to the navigation members, not to the
   * module: `notFound` has no locale-aware counterpart and is the supported way to
   * render the 404. A replacement block that banned `next/**` wholesale would break
   * this without breaking any case above.
   */
  it("leaves notFound from next/navigation available in src/app", async () => {
    await expectAccepted(
      "src/app/[locale]/page.tsx",
      'import { notFound } from "next/navigation";\nexport const a = notFound;'
    );
  });
});

/**
 * THE DYNAMIC HALF OF THE BOUNDARY, WHICH THE STATIC RULE CANNOT SEE AT ALL.
 *
 * `no-restricted-imports` visits `ImportDeclaration` and nothing else.
 * `await import("@/map/world")` is an `ImportExpression` — a call expression —
 * and **no option of that rule can be made to match it**. The comment on
 * `MAP_ENTRY_POINT_PATTERNS` in `eslint.config.js` used to call this a known and
 * accepted blind spot, aligned with the one the `next/link` ban carries; it is
 * not accepted any more, because `no-restricted-syntax` reaches it.
 *
 * Measured against the real config, `new ESLint({ cwd })` with no
 * `overrideConfig`, before the selector existed — from `src/app/[locale]/page.tsx`
 * and from `src/i18n/navigation.ts` alike:
 *
 *   await import("@/map/world")                        -> ALLOWED
 *   await import("../map/dataset")                     -> ALLOWED
 *   await import("world-atlas/countries-110m.json")    -> ALLOWED
 *   await import("d3-geo")                             -> ALLOWED
 *   import { buildWorldGeometry } from "@/map/world";  -> REFUSED   <- the witness
 *
 * The witness line is what gives the four ALLOWEDs their meaning: the block was
 * live on that file, it refused the declaration, and it let every dynamic
 * spelling of the same module through. A `'use client'` component writing four
 * extra characters shipped `d3-geo` and 105 KB of TopoJSON to the browser without
 * meeting `import "server-only"`, with lint and build both green — criterion 1 of
 * TIW-12, "0 Ko de bibliothèque côté client", defeated in silence.
 *
 * This suite is the reason the fix cannot quietly rot back: the selector is a
 * regex transcription of two globs, and a regex that drifts from
 * `["@/map/*", "**\/map/*"]` is exactly the failure this repository has already
 * paid for twice under "Les deux gardes exécutables".
 */
describe("the map boundary refuses the dynamic import the static rule cannot see", () => {
  /**
   * `src/app/**` and `src/components/**` are matched by
   * `travels-in-world/map-entry-point` directly.
   *
   * `src/i18n/navigation.ts` is the row that matters most, and it is covered by a
   * mechanism worth naming: the `travels-in-world/i18n-navigation` block declared
   * after it *replaces* `no-restricted-imports` for that file — which is why the
   * map patterns are re-stated there — but it never mentions
   * `no-restricted-syntax`, so the selector survives into it untouched. That is an
   * inheritance, not a re-statement, and inheritances in this file are one careless
   * edit from vanishing. These rows are what would go red.
   *
   * It is also the worst file in the repository to leave open: `@/i18n/navigation`
   * exports `usePathname` and `useRouter`, so *every* client component imports it.
   */
  const IMPORTERS = [
    "src/app/[locale]/page.tsx",
    "src/components/map/world-map.tsx",
    "src/i18n/navigation.ts",
  ];

  /**
   * Every module under the folder, plus a path nested deeper than one segment.
   * `@/map/index` is refused deliberately, for the reason the static cases above
   * record: one module, one greppable spelling.
   */
  const DEEP_MODULES = [
    "@/map/world",
    "@/map/projection",
    "@/map/iso-3166",
    "@/map/dataset",
    "@/map/path-context",
    "@/map/index",
    "@/map/sub/deep/thing",
  ];

  it.each(IMPORTERS.flatMap((file) => DEEP_MODULES.map((specifier) => ({ file, specifier }))))(
    "refuses await import($specifier) from $file",
    async ({ file, specifier }) => {
      const verdict = await expectDynamicRefused(file, specifier);

      expect(verdict.dynamicMessages.join("\n")).toMatch(/Import from "@\/map" instead/);
    }
  );

  /**
   * The relative spellings, which are the same module to the bundler. This is
   * verbatim the hole the domain rule shipped with — `"../x"` refused while
   * `"./../x"` linted clean — and the reason the selector's leading segments are
   * written generically rather than as an `@/` prefix.
   */
  it.each([
    "../map/world",
    "../../map/dataset",
    "./../map/world",
    ".././map/world",
    "../../src/map/world",
  ])("refuses the relative spelling await import(%o) from src/app", async (specifier) => {
    const verdict = await expectDynamicRefused("src/app/[locale]/page.tsx", specifier);

    expect(verdict.dynamicMessages.join("\n")).toMatch(/Import from "@\/map" instead/);
  });

  /**
   * The packages the façade encapsulates. Banning the modules and leaving these
   * open ships the projection library — or the whole TopoJSON — anyway, and
   * neither ever touches `@/map`, so neither meets the `server-only` guard.
   *
   * `d3-geo/src/path/index.js` is here because the reason it is caught is not the
   * obvious one: the selector admits a `/…` tail on a banned package name, the way
   * a `.gitignore` entry carries its subtree — which is what lets
   * `MAP_PACKAGE_PATTERNS` stay a list of bare names with no `/*` companions.
   */
  it.each(
    IMPORTERS.flatMap((file) =>
      [
        "world-atlas",
        "world-atlas/countries-110m.json",
        "d3-geo",
        "topojson-client",
        "d3-geo/src/path/index.js",
      ].map((specifier) => ({ file, specifier }))
    )
  )("refuses await import($specifier) from $file", async ({ file, specifier }) => {
    const verdict = await expectDynamicRefused(file, specifier);

    expect(verdict.dynamicMessages.join("\n")).toMatch(/build-time only/);
  });

  /**
   * `d3-*` does not stop at one hyphen: `d3-geo-projection` is d3, and the glob
   * `"d3-*"` refuses it. The selector has to agree — measured, it does.
   */
  it("refuses a multi-word d3 package", async () => {
    await expectDynamicRefused("src/app/[locale]/page.tsx", "d3-geo-projection");
  });
});

describe("the dynamic selector leaves the legitimate paths alone", () => {
  /**
   * The façade, and it passes for the same counter-intuitive reason the static
   * pattern lets it through: the selector requires a segment *after* `map/`, and
   * `@/map` has none. A reader who "tidies" the regex into something anchored on
   * `map` rather than on `map/` breaks these two rows and only these two.
   */
  it.each(["@/map", "../../map"])(
    "accepts await import(%o), the façade, from src/app",
    async (specifier) => {
      await expectDynamicAccepted("src/app/[locale]/page.tsx", specifier);
    }
  );

  it.each(["@/domain/geo", "@/i18n/navigation", "react", "next-intl", "node:path"])(
    "leaves await import(%o) alone in src/app",
    async (specifier) => {
      await expectDynamicAccepted("src/app/[locale]/page.tsx", specifier);
    }
  );

  /**
   * THE FALSE POSITIVES, AND THEY ARE A DECISION RATHER THAN AN ACCIDENT.
   *
   * A prefix test would be shorter — `^(world-atlas|d3|topojson)` — and it would
   * refuse an unrelated `world-atlas-lite` or `topojsonesque` on nothing but a
   * shared prefix. That is not a harmless over-reach in a boundary rule: a rule
   * that cries wolf on a legitimate package is a rule the next person switches
   * off. So the hyphen is written into the pattern instead — `world-atlas` admits
   * no suffix at all, because `MAP_PACKAGE_PATTERNS` has no `world-atlas-*` glob,
   * while `d3` and `topojson` admit `-<anything>` because it has `d3-*` and
   * `topojson-*`.
   *
   * `@/mapper/thing` and `sourcemap/x` are the same decision on the module half:
   * the path segment must be exactly `map`.
   *
   * Measured: `no-restricted-imports` allows all four of these too. The selector
   * is a faithful transcription including where it says no.
   */
  it.each(["world-atlas-lite", "topojsonesque", "@/mapper/thing", "sourcemap/x"])(
    "does not trap the unrelated package %o",
    async (specifier) => {
      await expectDynamicAccepted("src/app/[locale]/page.tsx", specifier);
    }
  );

  /**
   * `src/map/**` is where these modules and packages are *supposed* to be
   * reached, dynamically included. Without these rows, a selector broad enough to
   * catch a component would satisfy every refusal above while making the map
   * impossible to build — and the break would surface in code nobody had touched.
   */
  it.each([
    { file: "src/map/world.ts", specifier: "@/map/iso-3166" },
    { file: "src/map/world.ts", specifier: "./dataset" },
    { file: "src/map/dataset.ts", specifier: "world-atlas/countries-110m.json" },
    { file: "src/map/dataset.ts", specifier: "d3-geo" },
    { file: "src/map/index.ts", specifier: "@/map/world" },
  ])("accepts await import($specifier) from $file", async ({ file, specifier }) => {
    await expectDynamicAccepted(file, specifier);
  });

  /**
   * Co-located specs, exempted by the same `ignores` glob as the static rule —
   * `vitest.config.ts` allows a spec next to the file it tests, and such a spec
   * legitimately reaches its deep neighbours. Restricting it would make that
   * option a trap. `tests/**` is not `src/**` and is untouched for the same
   * reason.
   */
  it.each([
    { file: "src/app/probe.test.ts", specifier: "@/map/world" },
    { file: "src/app/probe.test.ts", specifier: "d3-geo" },
    { file: "src/map/world.test.ts", specifier: "d3-geo" },
    { file: "tests/map/support.ts", specifier: "world-atlas/countries-110m.json" },
  ])("accepts await import($specifier) from $file", async ({ file, specifier }) => {
    await expectDynamicAccepted(file, specifier);
  });
});

/**
 * THE CASE THAT TELLS THE TWO RULES APART.
 *
 * Everything above counts violations of one rule id or the other, but a reader —
 * or a refactor — could still believe a single mechanism is doing all the work.
 * It is not, and the distinction is load bearing: **each rule is blind to exactly
 * what the other catches**. Delete the `no-restricted-syntax` entry and the
 * static cases stay green; delete the `no-restricted-imports` options and the
 * dynamic cases stay green. Only a case that asserts *which* rule fired, and that
 * the other stayed silent, fails when one of the two halves is removed.
 */
describe("the static and dynamic bans are two rules, and each is blind to the other's case", () => {
  it("attributes the static deep import to no-restricted-imports alone", async () => {
    const verdict = await lint(
      "src/app/[locale]/page.tsx",
      'import { buildWorldGeometry } from "@/map/world";\nexport const a = buildWorldGeometry;'
    );

    expect(verdict.fatal).toEqual([]);
    expect(verdict.ruleIds).toContain(RESTRICTED_IMPORTS_RULE);
    expect(verdict.ruleIds).not.toContain(RESTRICTED_SYNTAX_RULE);
  });

  it("attributes the dynamic deep import to no-restricted-syntax alone", async () => {
    const verdict = await lint("src/app/[locale]/page.tsx", dynamicImport("@/map/world"));

    expect(verdict.fatal).toEqual([]);
    expect(verdict.ruleIds).toContain(RESTRICTED_SYNTAX_RULE);
    expect(verdict.ruleIds).not.toContain(RESTRICTED_IMPORTS_RULE);
  });

  /**
   * The same split on the package half, and on the file where it costs the most.
   * `src/i18n/navigation.ts` reaches `no-restricted-imports` through a re-statement
   * in its own block and `no-restricted-syntax` through plain inheritance — two
   * different mechanisms, one of which is invisible in that block. If either
   * breaks, exactly one of these two expectations goes red, which is what names
   * the culprit.
   */
  it("attributes both halves correctly from src/i18n/navigation.ts", async () => {
    const dynamic = await lint("src/i18n/navigation.ts", dynamicImport("d3-geo"));
    const statically = await lint(
      "src/i18n/navigation.ts",
      'import { geoPath } from "d3-geo";\nexport const a = geoPath;'
    );

    expect(dynamic.fatal).toEqual([]);
    expect(dynamic.ruleIds).toContain(RESTRICTED_SYNTAX_RULE);
    expect(dynamic.ruleIds).not.toContain(RESTRICTED_IMPORTS_RULE);

    expect(statically.fatal).toEqual([]);
    expect(statically.ruleIds).toContain(RESTRICTED_IMPORTS_RULE);
    expect(statically.ruleIds).not.toContain(RESTRICTED_SYNTAX_RULE);
  });
});
