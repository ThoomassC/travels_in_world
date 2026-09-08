import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Every message that takes an argument is read in a way that provides one.**
 *
 * A message like `"{count} résultats."` is an ICU pattern. Calling `t("key")` on
 * it asks next-intl to *format* it, next-intl looks for a `count` nobody passed,
 * and it fails — not by throwing at the call site, but by handing back
 * `getMessageFallback`, which is the literal string `"search.resultsMany"`. The
 * page renders, the build succeeds, and a screen reader announces the name of a
 * translation key.
 *
 * **Why this is a source sweep and not a runtime test — the part that makes the
 * whole file worth its length.** next-intl validates arguments only under the
 * `development` export condition. Measured on this repository's own catalogue and
 * this repository's own version (next-intl 4.13.7):
 *
 *   node --conditions=development  t("resultsMany")  ->  "search.resultsMany"
 *   node                           t("resultsMany")  ->  "{count} résultats."
 *
 * Vitest and `next build` both resolve the second, forgiving half. So the defect
 * that shipped — `s("resultsMany")` in the header, on every page of the site —
 * was **green in 2208 unit cases, green in 179 end-to-end cases, and broken in
 * `npm run dev`**, where it showed up as a FORMATTING_ERROR overlay. There is no
 * assertion about a rendered string that could have caught it, because in the
 * environment the tests run in, the rendered string was right.
 *
 * What *is* stable across both halves is the pair (call site, catalogue entry).
 * That is what this reads: every `x("key")` in `src/**` whose `x` came from
 * `useTranslations` / `getTranslations`, resolved against every locale.
 *
 * **`t.raw` is the exemption and the fix**, for the one legitimate case: a pattern
 * that has to cross into the browser unformatted because the value is only known
 * there. `src/components/site/site-nav.tsx` is that case and says so.
 *
 * Three further notes on what this can and cannot see:
 *
 * - **Comments are stripped first.** Two doc comments in `src/components/timeline`
 *   quote `t("map.summary")` and `t("transportTerm")` as prose; scanning raw text
 *   reported both as missing keys. A guard whose first run is three false
 *   positives is a guard people learn to ignore.
 * - **Only literal keys.** A computed key (`t(\`step.${kind}\`)`) is invisible
 *   here, by construction — the sweep resolves what it can read.
 * - **The detector is itself tested**, at the bottom, against a synthetic source
 *   holding the exact defect. Otherwise a broken regular expression would report
 *   an empty list of offenders and read as a pass for ever.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const MESSAGES = path.join(ROOT, "src/i18n/messages");
const SOURCE = path.join(ROOT, "src");

/** Every catalogue on disk, keyed by locale — a key must hold in all of them. */
const catalogues: ReadonlyArray<readonly [string, unknown]> = readdirSync(MESSAGES)
  .filter((file) => file.endsWith(".json"))
  .map((file) => [
    file.replace(/\.json$/, ""),
    JSON.parse(readFileSync(path.join(MESSAGES, file), "utf8")) as unknown,
  ]);

/**
 * An ICU argument: `{count}`, `{count, number}`, `{count, plural, …}`. The comma
 * is what separates an argument from a stray brace in prose.
 */
const TAKES_AN_ARGUMENT = /\{\s*[A-Za-z0-9_]+\s*[,}]/;

/**
 * `const t = useTranslations("nav")`, `const s = await getTranslations("search")`,
 * and the namespace-less `useTranslations()` — which addresses the catalogue root.
 */
const BINDING =
  /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)")?\s*\)/g;

/**
 * `t("key")` and `t.raw("key")` — and **only** with that single argument, which is
 * the whole question being asked. `t("key", { count })` does not match this
 * pattern, and needs no case: it provides what the message wants.
 */
const CALL = /\b([A-Za-z_$][\w$]*)(\.raw)?\(\s*"([^"]+)"\s*\)/g;

/**
 * Comments out, so prose that quotes a call is not read as one. Block comments
 * first — checked, and no string literal under `src` closes one — then line
 * comments, with the `//` of a URL spared by the preceding character.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
}

function at(catalogue: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .filter(Boolean)
    .reduce<unknown>(
      (node, key) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      catalogue
    );
}

type Finding = {
  /** `unformatted`: a pattern read with `t()`. `missing`: no such key in a locale. */
  readonly kind: "unformatted" | "missing";
  readonly where: string;
};

type Scan = {
  readonly findings: readonly Finding[];
  /** How many translator calls were actually read — a sweep that reads nothing passes. */
  readonly inspected: number;
  /** The full keys reached, so a case can name one it expects to have been seen. */
  readonly keys: ReadonlySet<string>;
};

function scan(files: ReadonlyArray<readonly [string, string]>): Scan {
  const findings: Finding[] = [];
  const keys = new Set<string>();
  let inspected = 0;

  for (const [label, raw] of files) {
    const source = withoutComments(raw);

    /*
      An identifier can be bound more than once in a file — `trip-timeline.tsx`
      opens `useTranslations("trip")` in three components. Collecting the
      namespaces rather than the last one keeps a second, different namespace on
      the same name from turning every call into a phantom missing key.
    */
    const namespaces = new Map<string, string[]>();
    for (const [, identifier, namespace] of source.matchAll(BINDING)) {
      if (identifier === undefined) {
        continue;
      }
      namespaces.set(identifier, [...(namespaces.get(identifier) ?? []), namespace ?? ""]);
    }
    if (namespaces.size === 0) {
      continue;
    }

    for (const [, identifier, raws, key] of source.matchAll(CALL)) {
      const bound = identifier === undefined ? undefined : namespaces.get(identifier);
      if (bound === undefined || key === undefined) {
        continue;
      }
      inspected += 1;

      for (const [locale, catalogue] of catalogues) {
        const candidates = bound.map((namespace) => [namespace, key].filter(Boolean).join("."));
        const resolved = candidates
          .map((full) => [full, at(catalogue, full)] as const)
          .find(([, value]) => typeof value === "string");

        if (resolved === undefined) {
          findings.push({ kind: "missing", where: `${label}: ${identifier}("${key}") — ${locale}` });
          continue;
        }

        const [full, value] = resolved;
        keys.add(full);
        if (TAKES_AN_ARGUMENT.test(value as string) && raws === undefined) {
          findings.push({
            kind: "unformatted",
            where: `${label}: ${identifier}("${key}") — ${locale} holds ${JSON.stringify(value)}`,
          });
        }
      }
    }
  }

  return { findings, inspected, keys };
}

function sourceFiles(directory: string): Array<readonly [string, string]> {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return /\.tsx?$/.test(full)
      ? [[path.relative(ROOT, full), readFileSync(full, "utf8")] as const]
      : [];
  });
}

const REPOSITORY = scan(sourceFiles(SOURCE));

describe("the messages a component asks for", () => {
  /**
   * PROVEN BY DELIBERATE FAILURE, and by a defect that reached the branch.
   *
   *   // src/components/site/site-nav.tsx
   *   -resultsMany: s.raw("resultsMany"),
   *   +resultsMany: s("resultsMany"),
   *
   *   npm test -> 1 failed | 7 passed
   *     expected [ ...(3) ] to deeply equal []
   *       src/components/site/site-nav.tsx: s("resultsMany") - en holds "{count} results."
   *       src/components/site/site-nav.tsx: s("resultsMany") - es holds "{count} resultados."
   *       src/components/site/site-nav.tsx: s("resultsMany") - fr holds "{count} resultats."
   *
   * Three lines, one per locale, which is the right count: the pattern is in all
   * three catalogues and the call is wrong for all three.
   */
  it("never formats a pattern without giving it its argument", () => {
    const offenders = REPOSITORY.findings.filter((finding) => finding.kind === "unformatted");

    expect(offenders.map((finding) => finding.where)).toEqual([]);
  });

  /** A key a component names and a catalogue does not hold renders as its own name. */
  it("names only keys every catalogue holds", () => {
    const missing = REPOSITORY.findings.filter((finding) => finding.kind === "missing");

    expect(missing.map((finding) => finding.where)).toEqual([]);
  });

  /**
   * The case that keeps the two above honest. A regular expression that matched
   * nothing would satisfy both of them in silence; this fails the moment the sweep
   * stops reaching the source it claims to read.
   *
   * Sixty is well under the eighty-eight calls measured when this was written and
   * well over anything a broken pattern would find. And the key named is the one
   * this file exists for: it must be *reached*, not merely absent from the
   * offenders.
   */
  it("actually read the header, and eighty-odd calls besides", () => {
    expect(REPOSITORY.inspected).toBeGreaterThan(60);
    expect(REPOSITORY.keys.has("search.resultsMany")).toBe(true);
    expect(catalogues.length).toBeGreaterThan(1);
  });

  /** Prose that quotes a call is prose. Both of these are real doc comments. */
  it("reads code and not the comments about it", () => {
    const commented = scan([
      [
        "fixture.tsx",
        `/** The caption is \`t("nope.notAKey")\` rendered small. */\n` +
          `const t = useTranslations("search");\n` +
          `// and \`t("also.notAKey")\` on one line\n` +
          `const label = t("field");\n`,
      ],
    ]);

    expect(commented.findings).toEqual([]);
    expect(commented.inspected).toBe(1);
  });
});

/**
 * **The detector, tested against the defect it was written for.** The fixture is
 * the header's own shape — a namespace, a raw read that is correct, and a
 * formatted read that is not.
 */
describe("the sweep itself", () => {
  const FIXTURE = [
    [
      "fixture.tsx",
      `const s = useTranslations("search");\n` +
        `const bad = s("resultsMany");\n` +
        `const good = s.raw("resultsMany");\n` +
        `const fine = s("resultsNone");\n` +
        `const given = s("resultsMany", { count: 2 });\n`,
    ],
  ] as const;

  it("catches a pattern read with t(), in every locale", () => {
    const { findings } = scan([...FIXTURE]);

    expect(findings.every((finding) => finding.kind === "unformatted")).toBe(true);
    expect(findings).toHaveLength(catalogues.length);
    for (const finding of findings) {
      expect(finding.where).toContain('s("resultsMany")');
    }
  });

  it("accepts the same pattern read with t.raw(), and a plain message read plainly", () => {
    const { findings, inspected } = scan([
      ["fixture.tsx", `const s = useTranslations("search");\nconst a = s.raw("resultsMany");\nconst b = s("resultsNone");\n`],
    ]);

    expect(findings).toEqual([]);
    expect(inspected).toBe(2);
  });

  it("says nothing about a call that already provides the argument", () => {
    const { findings, inspected } = scan([
      ["fixture.tsx", `const s = useTranslations("search");\nconst a = s("resultsMany", { count: 2 });\n`],
    ]);

    /*
      Not merely "no finding": the call is not inspected at all, because a
      two-argument call is outside the question. Asserted so that a future
      loosening of `CALL` — one that swallowed the second argument — shows up here
      rather than as a mysterious pass.
    */
    expect(findings).toEqual([]);
    expect(inspected).toBe(0);
  });

  it("reports a key no catalogue holds", () => {
    const { findings } = scan([
      ["fixture.tsx", `const s = useTranslations("search");\nconst a = s("noSuchKey");\n`],
    ]);

    expect(findings).toHaveLength(catalogues.length);
    expect(findings[0]?.kind).toBe("missing");
  });
});
