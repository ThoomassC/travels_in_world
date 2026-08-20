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

const PURITY_RULE = "no-restricted-imports";

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
    purity: messages.filter((message) => message.ruleId === PURITY_RULE).length,
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
