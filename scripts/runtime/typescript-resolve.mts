import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * An ESM resolve hook, so that a Node script can import this repository's
 * TypeScript the way the rest of the repository writes it.
 *
 * Node 24 runs `.ts` files on its own — type stripping is on by default — but its
 * resolver is the *runtime* one: it knows nothing of `tsconfig.json`. Two forms
 * that every file here uses are therefore unresolvable without this hook, and
 * both were measured before it was written:
 *
 * - `import { isPlainDate } from "./geo"` — extensionless, the way
 *   `src/domain/schema.ts` imports its sibling. Node looked for a file named
 *   `geo`, found none, and threw `ERR_MODULE_NOT_FOUND`. And `src/domain/**` is
 *   not ours to rewrite (`docs/adr/0001-domain-purity.md`).
 * - `import { TripSchema } from "@/domain/schema"` — the alias declared in
 *   `tsconfig.json` and used by every module outside the domain.
 *
 * The alternatives were weighed and rejected: writing `.ts` extensions in
 * specifiers needs `allowImportingTsExtensions` in the shared `tsconfig.json`
 * (which `next build` rewrites) and a different import convention inside
 * `src/content/**` than everywhere else; a build step would put a compiler
 * between an author and their error message. This hook is 40 lines, needs no
 * dependency, and is what every future content script (TIW-10's `geocode` and
 * `index-photos`) will reuse.
 *
 * It only ever *adds* resolutions: anything it does not recognise is handed
 * straight back to Node, so package resolution, `node:` builtins and conditional
 * exports keep behaving exactly as they do without it.
 */

type ResolveContext = {
  readonly conditions: readonly string[];
  readonly importAttributes?: Readonly<Record<string, string>> | undefined;
  readonly parentURL?: string | undefined;
};

type ResolveResult = {
  readonly url: string;
  readonly format?: string | null | undefined;
  readonly importAttributes?: Readonly<Record<string, string>> | undefined;
  readonly shortCircuit?: boolean | undefined;
};

type NextResolve = (
  specifier: string,
  context: ResolveContext
) => ResolveResult | Promise<ResolveResult>;

/** `src/`, resolved from this file: `scripts/runtime/` → repository root. */
const SOURCE_ROOT = new URL("../../src/", import.meta.url);

/** Tried in order, so a directory's `index.ts` loses to a file of that name. */
const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"] as const;

/** Already carries an extension Node can act on — leave it alone. */
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

function firstExistingFile(base: URL): string | undefined {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = new URL(base.href + suffix);
    if (existsSync(fileURLToPath(candidate))) {
      return candidate.href;
    }
  }
  return undefined;
}

function candidateBase(specifier: string, parentURL: string | undefined): URL | undefined {
  if (specifier.startsWith("@/")) {
    return new URL(specifier.slice(2), SOURCE_ROOT);
  }
  /**
   * `file:` parents only. `new URL("./x", "data:…")` throws `TypeError: Invalid
   * URL` on a non-hierarchical parent, which would replace Node's own explanatory
   * error with a meaningless one — and this hook promises to hand back everything
   * it does not recognise.
   */
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    parentURL?.startsWith("file:") === true
  ) {
    return new URL(specifier, parentURL);
  }
  return undefined;
}

export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve
): Promise<ResolveResult> {
  if (!HAS_EXTENSION.test(specifier)) {
    const base = candidateBase(specifier, context.parentURL);
    const found = base === undefined ? undefined : firstExistingFile(base);

    if (found !== undefined) {
      // Resolved through Node again rather than returned raw, so that the format
      // it reports (and therefore the type stripping) stays Node's decision.
      return { ...(await nextResolve(found, context)), shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
