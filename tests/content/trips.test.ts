import { describe, expect, it } from "vitest";

/**
 * The `server-only` guard on the content façade, observed rather than read.
 *
 * `src/content/trips.ts` is the single module the rest of `src/**` may import to
 * reach the content, and it carries `import "server-only";`. Importing
 * the façade outside a server context therefore fails, and that failure is what
 * this file observes.
 *
 * **What the failure actually is here, measured, because it is not what the
 * package's documentation describes.** Under Vitest the rejection is
 * `ERR_MODULE_NOT_FOUND — Cannot find package 'server-only'`: the package is not
 * installed at all in this repository, Next resolving the specifier from
 * `next/dist/compiled/server-only` at build time. So this test does not see a
 * module that throws on the wrong condition — it sees a specifier that does not
 * resolve. Both regimes reject, and both name `server-only`, which is why the
 * matcher is on that name: it stays true if the package is ever installed for
 * real, and it stops the case from passing on any unrelated error — a typo in the
 * path, a syntax error in the loader — which is exactly what a bare
 * `rejects.toThrow()` was doing.
 *
 * **Why a dynamic import.** A static `import "@/content/trips"` at the top of
 * this file would throw while the module graph is being loaded, which takes the
 * whole test file down before a single `it` runs — reported as a collection
 * error, not as a passing assertion. `await import(...)` moves the failure inside
 * the test, where it is the thing being asserted.
 *
 * **What this test does not prove, and what does.** Vitest builds no client
 * bundle, so nothing here exercises the bundler that enforces the boundary. That
 * half has been proved by a deliberate failure instead — the trace is quoted at
 * the top of `src/content/trips.ts`, and its interesting detail is that the client
 * component reached the façade through a *relay* module which ESLint accepted. The
 * lint closes the import path; the bundler closes the client traversal; neither
 * alone is enough. The two companion proofs live in
 * `tests/lint/content-facade.test.ts`.
 */

describe("the content façade", () => {
  it("refuses to be imported outside a server context", async () => {
    await expect(import("@/content/trips")).rejects.toThrow(/server-only/);
  });
});
