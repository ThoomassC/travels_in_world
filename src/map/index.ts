import "server-only";

/**
 * The map's public surface, and the only module of `src/map/**` that carries the
 * server guard.
 *
 * **Why the guard lives here and nowhere else.** `server-only` is not a
 * dependency of this repository — it ships inside `node_modules/next/dist/compiled/`
 * and resolves only under Next's bundler. Any module carrying it is therefore
 * unloadable by Vitest and by the plain Node scripts in `scripts/**`, which is
 * exactly the problem `src/content/validate.ts` documents at length (see its
 * "On `import \"server-only\"`" note) and resolves with the pattern this file
 * follows: one module, the guard at the top, re-exporting the rest. Putting the
 * guard on `world.ts` or `dataset.ts` would make the geometry untestable outside
 * a Next build, for no additional protection — nothing can reach them from a
 * client bundle without going through a module that imports one of them, and
 * `eslint.config.js` (`travels-in-world/map-entry-point`) is what forces every
 * `src/**` consumer through this file.
 *
 * That ESLint rule is the other half of the guard, and the reason it is not
 * optional: a façade nothing prevents you from bypassing guards nothing. The
 * guard here catches a client component that imports `@/map`; the rule catches
 * the one that imports `@/map/world` to avoid it.
 *
 * Deep modules — `path-context`, `dataset`, `projection`'s internals — are
 * deliberately not re-exported. Tests reach them directly (`tests/**` is not
 * `src/**`, so the rule does not apply there), which is what keeps the rounding
 * and the dataset reader testable in isolation.
 *
 * `NUMERIC_BY_ALPHA2` is not re-exported either, and since TIW-29 it is not even
 * a module of this folder: the ISO 3166-1 transcription moved to `@/iso-3166`,
 * because `src/content/validate.ts` needs the same 249 codes to refuse a country
 * code no map can draw, and nothing behind this façade is reachable from a plain
 * Node script — the guard below fails at *resolution* there. See that module's
 * header for the three ways of sharing it that were measured, and for why the
 * join stays here: what criterion 2 keeps in one place is the join, and the join
 * needs the geometry, which never leaves this folder.
 *
 * **Known blind spot, documented rather than fixed**: `await import("@/map/world")`
 * is a call expression, not an import declaration, so no `no-restricted-imports`
 * option can see it — a dynamic deep import walks past both the ESLint rule and
 * this façade's `server-only` guard. `eslint.config.js` records the identical hole
 * for `next/link`; it is accepted for the same reason, that nothing in this
 * repository dynamically imports internal modules and the pattern would be
 * conspicuous in review.
 */

export { projectPoint, WORLD_VIEW_BOX } from "./projection";
export type { ProjectedPoint } from "./projection";
export { buildWorldGeometry } from "./world";
export type { CountryShape, WorldGeometry } from "./world";
