/**
 * The fragment the skip link targets, and the `id` every page under this layout
 * must put on its `<main>`.
 *
 * **Why it is a shared constant and not two string literals.** The layout owns
 * the link and the pages own the `<main>` — there is exactly one `<main>` per
 * document and it is rendered by the page, not by the layout, so the layout
 * cannot carry the target itself. A page that spells the `id` differently leaves
 * the link pointing at nothing, and a fragment that matches nothing fails in the
 * quietest way a browser has: it does nothing.
 *
 * **A plain module and not an export of `layout.tsx`.** A file under `app/` whose
 * name is not a reserved one is colocated code, never a route; exporting this
 * from the layout would instead make every page import the layout module, which
 * is not a dependency direction Next's route graph is meant to carry.
 *
 * The value is French like every other reader-facing URL fragment of this site —
 * `src/i18n/paths.ts` spells its segments the same way, for the same reason.
 */
export const MAIN_CONTENT_ID = "contenu";
