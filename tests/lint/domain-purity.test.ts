import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The domain purity boundary, tested through ESLint's own Node API.
 *
 * This exists because the boundary regressed **twice inside the ticket that
 * created it**: the `files` glob covered `.ts` and silently ignored `.tsx`,
 * `.mts` and `.cts`, and the relative-escape pattern caught `"../x"` while
 * `"./../x"` — the same module to the bundler — linted, typechecked and built
 * clean. Both times the rule existed, looked like it was working, and was not.
 *
 * A manual probe deleted after use proves a state; it does not defend an
 * invariant. So every case below is one that actually got through, plus the
 * controls that keep the suite honest.
 *
 * Nothing is written to disk. `lintText` takes the source as a string and a
 * *virtual* `filePath`, which is only used to resolve which blocks of
 * `eslint.config.js` apply — so these fixtures exercise the real config, from
 * the real repository, without leaving a probe behind in `src/domain`.
 *
 * Runs under `npm run test:lint`, not `npm run test`, because it needs
 * `environment: "node"`: under jsdom `import.meta.url` is not a `file:` URL and
 * resolving the repository root throws. `vitest.lint.config.ts` carries that
 * reasoning and the timings. Booting the ESLint config graph is the whole cost —
 * every case after the first costs 1–4 ms, which is why the coverage below is
 * exhaustive rather than representative.
 */

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Both rules, because the boundary is stated twice for one reason: a dynamic
 * import is a call expression, invisible to every `no-restricted-imports` option,
 * so the same wall needs a syntactic selector beside the specifier patterns.
 * Counting only the first would let every case below pass on a domain that can
 * still `await import("node:fs")`.
 */
const PURITY_RULES = ["no-restricted-imports", "no-restricted-syntax"];

type Verdict = {
  /** Violations of the purity rule — what each case is really asserting on. */
  readonly purity: number;
  /** Parse failures, asserted empty everywhere so they can never read as a pass. */
  readonly fatal: readonly string[];
  /** Every rule that fired, so the clean control can demand complete silence. */
  readonly ruleIds: readonly (string | null)[];
};

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: repositoryRoot });
});

/**
 * `warnIgnored: false` keeps an ignored path from answering with a warning
 * instead of a result. An empty result array would mean the file matched no
 * config at all — which is exactly the `.mts`/`.cts` hole — so it is asserted
 * against rather than defaulted away.
 */
async function lint(relativePath: string, source: string): Promise<Verdict> {
  const results = await eslint.lintText(source, {
    filePath: path.join(repositoryRoot, relativePath),
    warnIgnored: false,
  });

  expect(results, `${relativePath} matched no ESLint configuration`).toHaveLength(1);
  const messages = results[0]?.messages ?? [];

  return {
    purity: messages.filter(
      (message) => message.ruleId !== null && PURITY_RULES.includes(message.ruleId)
    ).length,
    fatal: messages.filter((message) => message.fatal === true).map((message) => message.message),
    ruleIds: messages.map((message) => message.ruleId),
  };
}

/** Asserts a rejection, and that it is a *purity* rejection and not a syntax error. */
async function expectRefused(relativePath: string, source: string): Promise<void> {
  const verdict = await lint(relativePath, source);

  expect(verdict.fatal).toEqual([]);
  expect(verdict.purity).toBeGreaterThan(0);
}

describe("the domain purity rule refuses every TypeScript extension", () => {
  /**
   * `tsconfig.json` compiles `src/**\/*.tsx`, so a React component parked in the
   * domain would have shipped. `.mts` and `.cts` matched no block in the config
   * at all, so they answered to no restriction whatsoever.
   */
  it.each([
    { file: "src/domain/probe.ts", source: 'import { z } from "react";\nexport const a = z;' },
    {
      file: "src/domain/probe.tsx",
      source: 'import { useState } from "react";\nexport const a = useState;',
    },
    {
      file: "src/domain/probe.mts",
      source: 'import { readFileSync } from "node:fs";\nexport const a = readFileSync;',
    },
    {
      file: "src/domain/probe.cts",
      source: 'import { readFileSync } from "node:fs";\nexport const a = readFileSync;',
    },
  ])("refuses a forbidden import in $file", async ({ file, source }) => {
    await expectRefused(file, source);
  });
});

describe("the domain purity rule refuses every spelling of leaving the folder", () => {
  /**
   * The patterns match the specifier *string*, unresolved, so a spelling is only
   * refused if some pattern happens to cover it — and `"./../content/trips"`, the
   * same module as `"@/content/trips"`, was accepted for exactly that reason.
   *
   * All six rows are now carried by the single pattern `".."`. That is what makes
   * them worth listing: the four-pattern version they replaced covered only two
   * of these, and nothing said so.
   */
  it.each([
    "../content/trips",
    "./../content/trips",
    ".././content/trips",
    "./../../src/content/trips",
    "..",
    "./..",
  ])("refuses %o", async (specifier) => {
    await expectRefused("src/domain/probe.ts", `import ${JSON.stringify(specifier)};`);
  });
});

describe("the domain purity rule refuses the packages the domain must not know", () => {
  /**
   * A bare package name also covers everything beneath it, the way a directory
   * does in `.gitignore`. The three deep specifiers pin that, because it is the
   * reason no `name/*` companion entry is needed — and the day it stops being
   * true, this is what says so.
   */
  it.each([
    "node:fs/promises",
    "next/dist/client/link",
    "d3-geo/src/path/index.js",
    "@/content/trips",
    "react-dom",
    "next",
    "next-intl",
    "fs",
    "path",
    "d3",
    "topojson-client",
    "server-only",
  ])("refuses %o", async (specifier) => {
    await expectRefused("src/domain/probe.ts", `import ${JSON.stringify(specifier)};`);
  });
});

describe("the controls that keep this suite from passing for the wrong reason", () => {
  /**
   * Without this, a rule that refused *everything* — or a fixture that failed to
   * parse — would satisfy every assertion above.
   */
  it("accepts a domain file that imports only Zod and a sibling", async () => {
    const verdict = await lint(
      "src/domain/probe.ts",
      'import { z } from "zod";\nimport { daysBetween } from "./geo";\nexport const a = [z, daysBetween];'
    );

    expect(verdict.fatal).toEqual([]);
    expect(verdict.ruleIds).toEqual([]);
  });

  /**
   * The rule is scoped to the domain, not a project-wide ban on React. A `files`
   * glob widened by accident would fail here rather than in a component nobody
   * links to the config change.
   */
  it("leaves a file outside the domain free to import React", async () => {
    const verdict = await lint(
      "src/app/probe.tsx",
      'import { useState } from "react";\nexport const a = useState;'
    );

    expect(verdict.fatal).toEqual([]);
    expect(verdict.purity).toBe(0);
  });

  /**
   * `vitest.config.ts` allows a spec beside the file it tests, so a co-located
   * spec must stay free to import Vitest and its helpers. Restricting it would
   * turn that option into a trap — on all four extensions.
   */
  it.each(["ts", "tsx", "mts", "cts"])("exempts a co-located spec, in .%s", async (extension) => {
    const verdict = await lint(
      `src/domain/probe.test.${extension}`,
      'import { readFileSync } from "node:fs";\nimport { trips } from "@/content/trips";\nexport const a = [readFileSync, trips];'
    );

    expect(verdict.fatal).toEqual([]);
    expect(verdict.purity).toBe(0);
  });
});

/**
 * The spelling the specifier patterns cannot see, and the reason the block states
 * its boundary twice.
 *
 * `await import("node:fs")` from `src/domain/**` linted, typechecked and built
 * clean until a `no-restricted-syntax` selector was added beside the patterns — a
 * dynamic import is a call expression, and no `no-restricted-imports` option
 * reaches one. `AGENTS.md` documents the same blind spot for `next/link`; this is
 * the half of it that is now closed.
 *
 * The check is an **allowlist**: only a bare flat sibling passes. Translating
 * `DOMAIN_FORBIDDEN_IMPORTS` into a regular expression would declare that list a
 * second time, free to drift from the first — and the domain is flat over Zod, so
 * `./geo` is the only specifier it ever needs.
 */
describe("the domain purity rule refuses a dynamic import too", () => {
  it.each([
    "react",
    "react-dom",
    "next",
    "next-intl",
    "node:fs",
    "node:fs/promises",
    "fs",
    "path",
    "d3-geo",
    "topojson-client",
    "server-only",
    "@/content/loader",
    "@/content/trips",
    "@/domain/geo",
    "../content/loader",
    "./../content/loader",
    ".././content/loader",
    "../../src/content/loader",
    "..",
    "./..",
    /** The domain is flat; a nested sibling is a decision for a review, not for an import. */
    "./sub/deep",
  ])("refuses await import(%o)", async (specifier) => {
    await expectRefused(
      "src/domain/probe.ts",
      `export const a = async () => await import(${JSON.stringify(specifier)});`
    );
  });

  /** The one relative form the domain needs, and the controls that keep this honest. */
  it.each(["./geo", "./schema", "./route", "./trip"])(
    "leaves await import(%o) alone",
    async (specifier) => {
      const verdict = await lint(
        "src/domain/probe.ts",
        `export const a = async () => await import(${JSON.stringify(specifier)});`
      );

      expect(verdict.fatal).toEqual([]);
      expect(verdict.purity).toBe(0);
    }
  );

  /**
   * The exemption is per block, so it covers this rule as well as the patterns —
   * otherwise the Vitest option `vitest.config.ts` offers would become a trap for
   * a lazily-imported helper.
   */
  it("exempts a co-located spec, which may import anything dynamically", async () => {
    const verdict = await lint(
      "src/domain/probe.test.ts",
      'export const a = async () => await import("node:fs");'
    );

    expect(verdict.fatal).toEqual([]);
    expect(verdict.purity).toBe(0);
  });

  /**
   * A **computed** specifier is not a `Literal`, so no syntactic selector can see
   * it. Pinned as a known limit rather than left to be rediscovered: this case
   * asserts the hole, and it is the honest counterpart to the table above.
   */
  it("cannot see a computed specifier, and that limit is deliberate", async () => {
    const verdict = await lint(
      "src/domain/probe.ts",
      "export const a = async (name: string) => await import(name);"
    );

    expect(verdict.fatal).toEqual([]);
    expect(verdict.purity).toBe(0);
  });
});
