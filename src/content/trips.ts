import "server-only";

/**
 * The content façade: the single door the whole of `src/**` goes through to reach
 * a trip. Nothing but the guard above, these re-exports and this comment —
 * deliberately, and the thinness is asserted by
 * `tests/lint/content-facade.test.ts`.
 *
 * **Why the guard is here and not on `src/content/**`.** `server-only` is refused
 * outside a server context, and the rest of `src/content/**` has two consumers
 * that are not React at all: Vitest, and the plain-Node CLI
 * `npm run validate:content` running under
 * `scripts/runtime/register-typescript.mts` (`npm run geocode` joins it with
 * TIW-10; on this branch it is still `scripts/not-implemented.mjs`). Putting the
 * guard there would break both. So all the loading logic lives in `./loader`,
 * unguarded and testable, and exactly one module carries the guard: this one.
 *
 * **Why that split is not a second door.** An ESLint block forbids the whole of
 * `src/**` from importing anything under `@/content/` but this module — minus the
 * folder that owns the rule (`src/content/**`), the one guarded more strictly
 * (`src/domain/**`) and co-located specs, which enter no client bundle. Relative
 * spellings are included, which is the most expensive lesson in this repository,
 * and `tests/lint/content-facade.test.ts` proves the rule refuses rather than
 * merely existing.
 *
 * **What no automated test in this repository proves — and what a deliberate
 * failure did.** The only real executor of `server-only` is the client bundler
 * during `next build`; Vitest builds no client bundle and cannot see it. So the
 * guard was proved by breaking it on purpose, from a client component, both
 * directly and through a relay module:
 *
 *     BUILD EXIT=1
 *     ./src/content/trips.ts:1:1
 *     Error: 'server-only' cannot be imported from a Client Component module
 *     Import traces:
 *       Client Component Browser:
 *         ./src/content/trips.ts
 *         ./src/app/probe/relay.ts
 *         ./src/app/probe/client-probe.tsx
 *         ./src/app/probe/page.tsx
 *
 * The detail worth keeping is the third line of that trace. `relay.ts` imported
 * `@/content/trips` — the *permitted* module — so **ESLint accepted it**, and the
 * bundler alone refused. That is where the frontier between the two guards runs:
 * the lint closes the import path, the bundler closes the client traversal, and
 * neither is sufficient on its own.
 *
 * And the other direction, which was the missing half: a Server Component really
 * calling `listTripSummaries()` prerenders fine (`BUILD EXIT=0`, `cwd` at the
 * repository root, the collection read). Worth stating, because a green build on a
 * module nobody imports proves nothing at all.
 *
 * The automated tests cover what they can: the line above has not been deleted, it
 * is still the first statement, and the ESLint boundary bites
 * (`tests/lint/content-facade.test.ts`, `tests/content/trips.test.ts`).
 */

export { findTrip, listTripSummaries, loadTrips, tripStaticParams } from "./loader";
export type { TripDetail, TripSummary } from "./loader";
