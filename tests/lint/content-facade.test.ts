import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The content-façade boundary: everything under `src/**` reaches the content
 * through `@/content/trips` and through nothing else — minus the folder that owns
 * the loader (`src/content/**`), the folder guarded harder by `domain-purity`
 * (`src/domain/**`), the single navigation exemption and the co-located specs.
 *
 * Why it needs a test rather than a convention. `src/content/**` is plain Node
 * code — it reads the disk, and `npm run validate:content` and Vitest load it
 * outside React, which is why it deliberately does *not* carry
 * `import "server-only"` (the reasoning is written at the top of
 * `src/content/validate.ts`). Exactly one module carries the guard:
 * `src/content/trips.ts`. So the guard is only worth anything while every
 * consumer goes through that module — and importing `@/content/loader` directly
 * lints, typechecks and builds perfectly clean. Nothing but this rule stands
 * between a client component and the filesystem reader.
 *
 * Three proofs live here, and they are complementary rather than redundant.
 *
 * 1. **The ESLint boundary really refuses**, in every spelling. This is the
 *    lesson the domain-purity rule taught twice in one ticket: a `files` glob
 *    that missed `.tsx`, then a pattern that caught `"../x"` while `"./../x"` —
 *    the same module to the bundler — went through. Both times the rule existed
 *    and guarded nothing.
 * 2. **The `import "server-only";` line is still the first statement** of
 *    `src/content/trips.ts`. An assertion on source text, and stated as such: the
 *    only real executor of that guard is the client bundler during `next build`,
 *    which is what fails when a client component reaches the module. This test
 *    cannot see the bundler; it can only make sure nobody deleted the line, and
 *    that it comes before any other import so the resolution reaches it.
 *    `tests/content/trips.test.ts` covers the behaviour side.
 * 3. **The façade stays thin** — the guard, re-exports, documentation. The moment
 *    logic moves into it, that logic can no longer be unit-tested (importing the
 *    module throws outside `react-server`) and the split loses its reason to
 *    exist.
 *
 * Two more families sit alongside them, both added after a measurement showed the
 * boundary accepting what it claims to refuse. **`await import()`** is invisible to
 * `no-restricted-imports` — it is a call expression, not an import declaration —
 * and it was accepted from a page and from `src/components/**`; a second rule,
 * `no-restricted-syntax`, catches the literal spelling, and the cases are below.
 * **`src/i18n/navigation.ts`** sat in the block's `ignores`, which exempted it from
 * the content pattern as well as the navigation one, in the single module every
 * client component imports; it now has a block of its own and a section of its own
 * here, pinning both halves at once.
 *
 * And a fourth family of cases that is not about the content at all.
 * `eslint.config.js` resolves `no-restricted-imports` by *last matching config
 * wins, per rule* — the `travels-in-world/domain-purity` block says so in a
 * comment. So a new block adding the content patterns for `src/app/**`
 * **replaces** the global options and silently kills the `next/link` and
 * `next/navigation` bans there: invariant 2 of `AGENTS.md`, dead, with a green
 * lint and a 404 for the visitor. Those cases are below.
 *
 * Nothing is written to disk. `lintText` takes the source as a string and a
 * *virtual* `filePath`, used only to decide which blocks of `eslint.config.js`
 * apply — so these fixtures exercise the real config from the real repository
 * without leaving a probe behind.
 *
 * Runs under `npm run test:lint` (`vitest.lint.config.ts`, `environment: "node"`),
 * for the reason that config records: under jsdom `import.meta.url` is not a
 * `file:` URL and resolving the repository root throws. That also makes this
 * suite immune to any `resolve.alias` in `vitest.config.ts`.
 */

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

const FACADE = "src/content/trips.ts";

/**
 * The two rules that enforce a boundary in this configuration, counted together
 * because a case asserts on *the boundary*, not on which rule caught it.
 *
 * `no-restricted-imports` sees import declarations; it is structurally blind to
 * `await import("@/content/loader")`, which is a call expression. That spelling is
 * caught by `no-restricted-syntax`, and it matters more here than the same blind
 * spot does for `next/link`: a dynamic import is the *natural* way to load
 * something lazily in a Server Component.
 */
const RESTRICTED_RULES: readonly string[] = ["no-restricted-imports", "no-restricted-syntax"];

type Verdict = {
  /** Violations of either boundary rule — what every case really asserts on. */
  readonly restricted: number;
  /** Parse failures, asserted empty everywhere so they can never read as a pass. */
  readonly fatal: readonly string[];
  /** Every rule that fired, so a clean control can demand complete silence. */
  readonly ruleIds: readonly (string | null)[];
};

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: repositoryRoot });
});

/**
 * `warnIgnored: false` keeps an ignored path from answering with a warning
 * instead of a result. An empty result array would mean the file matched no
 * config at all — the `.mts`/`.cts` hole the domain rule fell into — so it is
 * asserted against rather than defaulted away.
 */
async function lint(relativePath: string, source: string): Promise<Verdict> {
  const results = await eslint.lintText(source, {
    filePath: path.join(repositoryRoot, relativePath),
    warnIgnored: false,
  });

  expect(results, `${relativePath} matched no ESLint configuration`).toHaveLength(1);
  const messages = results[0]?.messages ?? [];

  return {
    restricted: messages.filter(
      (message) => message.ruleId !== null && RESTRICTED_RULES.includes(message.ruleId)
    ).length,
    fatal: messages.filter((message) => message.fatal === true).map((message) => message.message),
    ruleIds: messages.map((message) => message.ruleId),
  };
}

/** Asserts a rejection, and that it is a *boundary* rejection, not a syntax error. */
async function expectRefused(relativePath: string, source: string): Promise<void> {
  const verdict = await lint(relativePath, source);

  expect(verdict.fatal).toEqual([]);
  expect(verdict.restricted).toBeGreaterThan(0);
}

async function expectAccepted(relativePath: string, source: string): Promise<void> {
  const verdict = await lint(relativePath, source);

  expect(verdict.fatal).toEqual([]);
  expect(verdict.restricted).toBe(0);
}

/** An import statement plus a use of it, so no unused-vars noise clouds the verdict. */
function importing(specifier: string): string {
  return `import * as probe from ${JSON.stringify(specifier)};\nexport const a = probe;`;
}

/** The two folders the boundary applies to, on every extension `tsconfig.json` compiles. */
const CONSUMER_FILES = [
  "src/app/[locale]/page.tsx",
  "src/app/[locale]/trips/[slug]/page.tsx",
  "src/app/sitemap.ts",
  "src/map/world.tsx",
  "src/map/projection.ts",
];

/* --------------------------------------------------- the façade is the only door -- */

describe("a page or a map module reaching for the content", () => {
  it.each(CONSUMER_FILES)("refuses @/content/loader in %s", async (file) => {
    await expectRefused(file, importing("@/content/loader"));
  });

  it.each(CONSUMER_FILES)("accepts @/content/trips in %s", async (file) => {
    await expectAccepted(file, importing("@/content/trips"));
  });

  /**
   * Complete silence on the one import that is allowed, not merely "no boundary
   * violation". Without this, a rule that refused *everything* under `@/content/`
   * — the façade included — would satisfy every refusal case above and leave the
   * pages with no way to read a trip at all.
   */
  it("leaves a page importing nothing but the façade and the domain entirely clean", async () => {
    const verdict = await lint(
      "src/app/[locale]/page.tsx",
      [
        'import { listTripSummaries } from "@/content/trips";',
        'import { durationOf } from "@/domain/trip";',
        'import { Link } from "@/i18n/navigation";',
        "export const a = [listTripSummaries, durationOf, Link];",
      ].join("\n")
    );

    expect(verdict.fatal).toEqual([]);
    expect(verdict.ruleIds).toEqual([]);
  });
});

describe("every other module under @/content/ is out of bounds for a page or a map module", () => {
  /**
   * The façade is one module out of eight in `src/content/**`, and every one of
   * the others is a legitimate-looking import: `@/content/validate` is the
   * validator's own entry point, `@/content/collection` is the disk reader, and
   * `@/content/finding` is a pure type module that would look completely harmless
   * in a page. A rule spelled as "forbid `@/content/loader`" leaves all of them
   * open, which is why they are listed rather than assumed.
   */
  it.each([
    "@/content/loader",
    "@/content/validate",
    "@/content/collection",
    "@/content/diagnose",
    "@/content/report",
    "@/content/finding",
    "@/content/loader.js",
  ])("refuses %o in a page", async (specifier) => {
    await expectRefused("src/app/[locale]/page.tsx", importing(specifier));
  });

  it.each([
    "@/content/loader",
    "@/content/validate",
    "@/content/collection",
    "@/content/diagnose",
    "@/content/report",
    "@/content/finding",
  ])("refuses %o in a map module", async (specifier) => {
    await expectRefused("src/map/world.tsx", importing(specifier));
  });
});

describe("every spelling of reaching the content sideways", () => {
  /**
   * The patterns are matched against the specifier *string*, unresolved, so a
   * spelling is only refused if some pattern happens to cover it. This exact
   * table is the most expensive lesson in the repository: on the domain rule,
   * `"../x"` was refused while `"./../x"` — the same module to the bundler —
   * linted, typechecked and built clean, and nothing said so.
   *
   * `".."` on its own is not the answer here, the way it was for the domain: a
   * page legitimately imports `"../../i18n/navigation"`. The pattern has to name
   * the content folder, which is precisely what makes the spellings matter.
   */
  const SIDEWAYS = [
    "../content/loader",
    "./../content/loader",
    ".././content/loader",
    "../../content/loader",
    "../../src/content/loader",
    "./../../src/content/loader",
    "../content/validate",
    "../content/collection",
    "../../src/content/collection",
  ];

  it.each(SIDEWAYS)("refuses %o in a page", async (specifier) => {
    await expectRefused("src/app/[locale]/page.tsx", importing(specifier));
  });

  it.each(SIDEWAYS)("refuses %o in a map module", async (specifier) => {
    await expectRefused("src/map/world.tsx", importing(specifier));
  });
});

/* ------------------------------------- the folders that do not exist yet either -- */

describe("the boundary covers src/**, not only the folders that exist today", () => {
  /**
   * **`src/components/**` does not exist in this branch, and that is the point.**
   * It is the folder TIW-17 creates for the photo viewer — one of the two
   * `'use client'` components milestone 1 allows — and a boundary scoped to
   * `src/app/**` and `src/map/**` would have let it import the unguarded disk
   * reader with a green lint, a green typecheck and a green build. Measured
   * through ESLint's Node API before widening: six cases were accepted that
   * should not have been, and every file below is one of them.
   *
   * A rule that only guards the folders a repository happens to have today is a
   * rule that expires the next time somebody adds one, silently.
   */
  it.each([
    "src/components/photo-viewer.tsx",
    "src/ui/trip-card.tsx",
    "src/lib/sitemap.ts",
    "src/i18n/request.ts",
  ])("refuses @/content/loader in %s", async (file) => {
    await expectRefused(file, importing("@/content/loader"));
  });

  /** The relative spelling, which is the same module to the bundler. */
  it("refuses ../content/loader from src/components/**", async () => {
    await expectRefused("src/components/photo-viewer.tsx", importing("../content/loader"));
  });

  /**
   * Arbitrarily deep, and on a module that is not the loader: the rule names the
   * *folder*, so a nested component reaching for the disk reader under any of its
   * names is refused too.
   */
  it("refuses @/content/collection from a deeply nested component", async () => {
    await expectRefused("src/components/deep/nested/thing.tsx", importing("@/content/collection"));
  });

  it("leaves src/components/** free to import the façade", async () => {
    await expectAccepted("src/components/photo-viewer.tsx", importing("@/content/trips"));
  });

  /**
   * And a spec co-located next to the component, for the reason the whole
   * `ignores` list exists: a spec is never part of a client bundle, and
   * `vitest.config.ts` allows it to sit there.
   */
  it("leaves a spec co-located in src/components/** free to import @/content/loader", async () => {
    await expectAccepted("src/components/photo-viewer.test.tsx", importing("@/content/loader"));
  });

  /**
   * The two folders the widened glob must *not* disturb, and they are not
   * disturbed for two different reasons — which is why they are asserted rather
   * than assumed.
   *
   * `src/content/**` owns the loader: the façade re-exports it and `validate.ts`
   * imports `collection.ts`, so a rule matching it would forbid its own subject
   * from existing. `src/domain/**` is guarded *harder* by the `domain-purity`
   * block, which refuses every `@/*` import there; matching it here would replace
   * that stricter rule with this looser one, since the last matching config wins
   * per rule.
   */
  it.each([
    { file: "src/content/validate.ts", specifier: "@/content/collection" },
    { file: "src/content/loader.ts", specifier: "./collection" },
    { file: "src/domain/trip.ts", specifier: "./geo" },
  ])("leaves $file free to import $specifier", async ({ file, specifier }) => {
    await expectAccepted(file, importing(specifier));
  });

  /**
   * `src/i18n/navigation.ts` is the file the widened glob is hardest on, and it
   * has a section of its own below — "is exempt from the navigation ban and from
   * nothing else" — because both halves of its verdict have to be pinned
   * together: `next/link` accepted, `@/content/loader` refused.
   */
});

describe("the boundary is scoped to the application, and not to what owns the rule", () => {
  /**
   * Without these, a rule widened by accident would forbid the façade from doing
   * its one job — re-exporting the loader — and the CLI from reading the
   * collection at all. The rule would then be enforcing nothing anyone wants.
   */
  it("lets the façade itself import the loader", async () => {
    await expectAccepted(FACADE, 'import "server-only";\nexport * from "./loader";');
  });

  it("lets the façade import the loader through the alias as well", async () => {
    await expectAccepted(FACADE, 'import "server-only";\nexport * from "@/content/loader";');
  });

  it.each([
    "src/content/validate.ts",
    "src/content/report.ts",
    "scripts/validate-content.ts",
    "tests/content/loader.test.ts",
  ])("leaves %s free to import @/content/loader", async (file) => {
    await expectAccepted(file, importing("@/content/loader"));
  });

  /**
   * `tests/**` must stay out of the boundary, and these two say so out loud
   * rather than leaving it to be discovered in CI. The content suites import the
   * *internals* on purpose — that is what a unit test of the disk reader is — and
   * a neighbouring branch (TIW-10) carries some 490 tests reaching for
   * `@/content/geocode`, `@/content/collection`, `@/content/yaml-edit` and
   * `@/content/scaffold`.
   *
   * The glob *is* `src/**` now, and that is precisely why these cases stay: they
   * pin the reason `tests/**` is safe — a glob anchored at `src/` cannot reach it,
   * so no `ignores` entry is needed and none should be added. A rule spelled
   * `**\/*.ts` instead would turn all 490 of them red on merge.
   */
  it.each([
    { file: "tests/content/geocode.test.ts", specifier: "@/content/geocode" },
    { file: "tests/content/collection.test.ts", specifier: "@/content/collection" },
  ])("leaves $file free to import $specifier", async ({ file, specifier }) => {
    await expectAccepted(file, importing(specifier));
  });

  /**
   * A spec co-located under `src/app/**` or `src/map/**`, which `vitest.config.ts`
   * allows (`include: ["src/**\/*.test.{ts,tsx}"]`). A spec is never part of a
   * client bundle, so the failure the boundary defends against cannot happen in
   * one — and refusing it there would turn that Vitest option into a trap, which
   * is the same reasoning the `domain-purity` block records for its own
   * exemption. Measured: without the `ignores`, both of these are refused.
   */
  it.each(["src/app/[locale]/page.test.tsx", "src/map/world.test.ts"])(
    "leaves the co-located spec %s free to import @/content/loader",
    async (file) => {
      await expectAccepted(file, importing("@/content/loader"));
    }
  );
});

/* ----------------------------------- the dynamic spelling of the same crossing -- */

/** `await import(...)`, plus a use of the result so no unused-vars noise clouds it. */
function dynamicallyImporting(specifier: string): string {
  return `export const a = async () => await import(${JSON.stringify(specifier)});`;
}

describe("await import() is not a way around the boundary", () => {
  /**
   * `no-restricted-imports` cannot see this at all: an `ImportExpression` is a
   * call, not an import declaration, and no option of that rule reaches it —
   * `eslint.config.js` already records the same blind spot for `next/link`.
   * Measured before the `no-restricted-syntax` rule existed:
   * `await import("@/content/loader")` was **accepted** from a page and from
   * `src/components/**`.
   *
   * It matters more here than it does for navigation. A raw `next/link` written
   * dynamically is a contrivance; a dynamic import is the *natural* spelling of a
   * lazy load in a Server Component, so this is the shape the breach would
   * actually take.
   */
  it.each([
    "src/app/[locale]/page.tsx",
    "src/map/world.tsx",
    "src/components/photo-viewer.tsx",
    "src/i18n/navigation.ts",
  ])("refuses await import(@/content/loader) in %s", async (file) => {
    await expectRefused(file, dynamicallyImporting("@/content/loader"));
  });

  /** The relative spelling, which is the same module to the bundler. */
  it.each(["../content/loader", "./../content/loader", "../../src/content/collection"])(
    "refuses await import(%o) in a page",
    async (specifier) => {
      await expectRefused("src/app/[locale]/page.tsx", dynamicallyImporting(specifier));
    }
  );

  /**
   * The control that keeps the rule from being a ban on lazy loading: the façade
   * itself must stay dynamically importable, or a page that wants to defer the
   * read has no legal spelling left.
   */
  it.each(["src/app/[locale]/page.tsx", "src/components/photo-viewer.tsx"])(
    "accepts await import(@/content/trips) in %s",
    async (file) => {
      await expectAccepted(file, dynamicallyImporting("@/content/trips"));
    }
  );
});

/* ----------------------------- the module every client component imports -- */

describe("src/i18n/navigation.ts is exempt from the navigation ban and from nothing else", () => {
  /**
   * The regression this pair pins. That file used to sit in the `ignores` of the
   * `content-facade` block, and `ignores` exempts a file from the **whole** block:
   * the navigation patterns and the content pattern went out together. Measured:
   *
   *   ACCEPTED  src/i18n/navigation.ts  <-  @/content/loader
   *
   * It is the worst possible file for that hole. Every client component imports it
   * — `Link`, `useRouter`, `usePathname` are its reason to exist — so a helper
   * there needing a slug would have pulled the unguarded filesystem reader into
   * the client graph through the most-imported module of the bundle.
   *
   * And the opposite trap is just as real, which is why both halves are asserted
   * together: with no exemption at all, the `content-facade` block (later in the
   * config than the old `no-restricted-imports: "off"` one) switches the rule back
   * on here and **refuses `next/link`** — the locale-aware wrappers become
   * unwritable and invariant 2 of `AGENTS.md` dies. The fix is a block of its own,
   * *after* the façade block, restoring the content pattern only. These two cases
   * are what say the ordering is right; reading the config file does not.
   */
  it("still lets it import the raw next/link it exists to wrap", async () => {
    await expectAccepted(
      "src/i18n/navigation.ts",
      'import Link from "next/link";\nexport const a = Link;'
    );
  });

  it("refuses @/content/loader there, like everywhere else in src/**", async () => {
    await expectRefused("src/i18n/navigation.ts", importing("@/content/loader"));
  });

  /** And the façade stays reachable: the exemption is about navigation, not content. */
  it("leaves the façade reachable", async () => {
    await expectAccepted("src/i18n/navigation.ts", importing("@/content/trips"));
  });

  /**
   * The dynamic ban reaches this file **by inheritance**, and that is exactly why
   * it needs a case of its own.
   *
   * `navigation-primitives` replaces `no-restricted-imports` and never mentions
   * `no-restricted-syntax`, so the selector from the block above survives here
   * untouched. Measured, and it holds — but it holds because of what this block
   * does *not* say, which is the most fragile way for an invariant to be true.
   * The day somebody adds a `no-restricted-syntax` to this block for any reason,
   * the whole dynamic ban vanishes from the one file every client component
   * imports, in silence. These two cases are what turns red instead.
   */
  it("still refuses a dynamic import of the loader, inherited from the block above", async () => {
    await expectRefused(
      "src/i18n/navigation.ts",
      'export const a = async () => await import("@/content/loader");'
    );
  });

  it("still allows a dynamic import of the façade", async () => {
    await expectAccepted(
      "src/i18n/navigation.ts",
      'export const a = async () => await import("@/content/trips");'
    );
  });
});

/* --------------------------------- the limits, pinned as limits and not as coverage -- */

describe("what the boundary does not cover", () => {
  /**
   * Three holes, measured and left open. They are asserted **accepted** on
   * purpose: a limit that lives only in a comment is a limit somebody later
   * mistakes for coverage, and a limit with a test says out loud that the silence
   * is known. If one of these ever starts being refused, the case turns red and
   * the reader is told the boundary moved.
   */

  /**
   * A computed specifier is out of reach of any lint: `no-restricted-syntax` needs
   * a `Literal`, and there is nothing to match. Unfixable here — a rule that tried
   * would have to evaluate the expression.
   */
  it("cannot see a computed specifier", async () => {
    await expectAccepted(
      "src/app/[locale]/page.tsx",
      [
        'const name = "loader";',
        "export const a = async () => await import(`@/content/${name}`);",
      ].join("\n")
    );
  });

  /**
   * A relay **outside** `src/` is not covered, because every glob in the block is
   * anchored at `src/`. Contrived — nothing imports `scripts/` from a page today —
   * but it is the honest answer to "is the intermediate relay closed?": inside
   * `src/`, yes; outside, no. For a *client* component the bundler still closes it,
   * which is the split `src/content/trips.ts` documents: the lint closes the import
   * path, the bundler closes the client traversal, and neither alone is enough.
   */
  it("does not reach a relay outside src/", async () => {
    await expectAccepted("src/app/[locale]/page.tsx", importing("../../../scripts/relay"));
  });

  /**
   * The bare `@/content` is accepted. Harmless today — there is no
   * `src/content/index.ts` for it to resolve to — and latent the day one appears.
   * Measured, and this is why it is documented instead of closed: adding
   * `"@/content"` to the pattern group makes it an ancestor of the façade and the
   * `!@/content/trips` negation does not recover it, so `@/content/trips` itself
   * becomes **refused** — the one import the boundary exists to allow.
   */
  it("does not refuse the bare @/content, which resolves to nothing today", async () => {
    await expectAccepted("src/app/[locale]/page.tsx", importing("@/content"));
  });
});

/* ------------------------------------------- the guard nobody may delete quietly -- */

describe("the server-only guard on the façade", () => {
  /**
   * Read from disk, deliberately. This is the one assertion in the suite made on
   * source *text*, and it is worth being honest about what it is: the real
   * executor of `server-only` is the client bundler during `next build`, which
   * throws when a client component reaches the module. Vitest builds no client
   * bundle and cannot see that. What this test does is stop the line from being
   * deleted in silence — because a guard nobody's test defends is not a guard,
   * which is the lesson written into `AGENTS.md`.
   */
  const facadeSource = (): string => readFileSync(path.join(repositoryRoot, FACADE), "utf8");

  /** Comments removed, so an assertion about code cannot be satisfied by prose. */
  const facadeCode = (): string =>
    facadeSource()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("imports the server-only package at all", () => {
    expect(facadeCode()).toMatch(/^\s*import\s+["']server-only["'];/m);
  });

  /**
   * *First* statement, before any other import. Next reaches the guard while
   * resolving the module graph, so a `server-only` import sitting under a
   * re-export of the loader is reached after the filesystem reader has already
   * been pulled in — and the error a contributor then gets names the wrong
   * module.
   */
  it("carries it as the very first statement, before any other import", () => {
    const firstStatement = facadeCode()
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "");

    expect(firstStatement).toMatch(/^import\s+["']server-only["'];?$/);
  });

  /**
   * A thin façade: the guard, re-exports, documentation. If the loading logic
   * moved in here it would become untestable — importing this module outside
   * `react-server` throws — and the whole point of the two-module split
   * (`loader.ts` testable, `trips.ts` guarded) would be gone.
   */
  it("reaches for no Node built-in of its own", () => {
    const code = facadeCode();

    expect(code).not.toMatch(/["']node:/);
    expect(code).not.toMatch(/\bfrom\s+["'](?:fs|path|fs\/promises)["']/);
  });

  it("holds no logic of its own", () => {
    const code = facadeCode();

    expect(code).not.toMatch(/\bfunction\b/);
    expect(code).not.toMatch(/=>/);
    expect(code).not.toMatch(/\bawait\b/);
  });
});

/* --------------------------- the invariant a new config block silently replaces -- */

describe("the internal-navigation ban survives in the folders the new rule touches", () => {
  /**
   * `eslint.config.js` resolves a rule by *last matching config wins*, replacing
   * its options rather than merging them — its own `domain-purity` block says so
   * in a comment. So the block that adds the content patterns for `src/app/**`
   * and `src/map/**` wipes out the `next/link` and `next/navigation` patterns
   * there unless it carries them too.
   *
   * That is invariant 2 of `AGENTS.md`: a raw `next/link` drops the `[locale]`
   * segment, and the visitor gets a 404 while the build stays green. The rule
   * would be replaced by a rule that guards the content and abandons the URLs —
   * which is exactly the shape of the two regressions the domain rule already
   * suffered.
   *
   * These cases assert *behaviour*, not the shape of the config: whether the
   * patterns end up in a shared constant, a spread, or a duplicated array is the
   * implementer's call.
   */
  const NAVIGATION_CASES = [
    { label: "next/link", source: 'import Link from "next/link";\nexport const a = Link;' },
    { label: "next/link.js", source: 'import Link from "next/link.js";\nexport const a = Link;' },
    {
      label: "redirect from next/navigation",
      source: 'import { redirect } from "next/navigation";\nexport const a = redirect;',
    },
    {
      label: "permanentRedirect from next/navigation",
      source:
        'import { permanentRedirect } from "next/navigation";\nexport const a = permanentRedirect;',
    },
    {
      label: "usePathname from next/navigation",
      source: 'import { usePathname } from "next/navigation";\nexport const a = usePathname;',
    },
    {
      label: "useRouter from next/navigation",
      source: 'import { useRouter } from "next/navigation";\nexport const a = useRouter;',
    },
  ];

  it.each(NAVIGATION_CASES)("still refuses $label in a page", async ({ source }) => {
    await expectRefused("src/app/[locale]/page.tsx", source);
  });

  it.each(NAVIGATION_CASES)("still refuses $label in a map module", async ({ source }) => {
    await expectRefused("src/map/world.tsx", source);
  });

  /**
   * The positive control on the other side: `src/i18n/navigation.ts` is the one
   * place allowed to reach for the raw Next primitives — it is where the
   * locale-aware wrappers are built. An `ignores` or a block ordering that
   * overwrote that exemption would make the wrappers unwritable.
   */
  it.each(NAVIGATION_CASES)(
    "leaves src/i18n/navigation.ts free to import $label",
    async ({ source }) => {
      await expectAccepted("src/i18n/navigation.ts", source);
    }
  );

  /**
   * And the exemption is not a blanket one — the navigation module has no business
   * reading the disk either. That half is asserted in its own section below, where
   * the two verdicts that have to hold at once live side by side.
   */
});
