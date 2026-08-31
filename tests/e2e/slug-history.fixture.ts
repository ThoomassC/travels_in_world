/**
 * The register the E2E production build is given, through `TIW_SLUG_HISTORY`.
 *
 * WHY THE ENTRIES COME FROM THE ENVIRONMENT AND NOT FROM
 * `src/i18n/slug-history.ts`. The committed register is empty and correctly so —
 * `content/trips/` holds no trip yet, so nothing has been renamed or withdrawn. A
 * spec asserting the 301 against an empty register would have no address to request
 * and would pass by testing nothing, which is the failure shape `tests/build/`
 * exists to refuse. So the suite supplies its own entries, exactly as it supplies
 * its own content directory elsewhere, and asserts the real HTTP answers of a real
 * production server against them. The path from a register entry to a redirect is
 * the same either way — `next.config.ts` calls one function on one value — and
 * `tests/i18n/slug-history.test.ts` covers that the committed register feeds it too.
 *
 * Imported by `playwright.config.ts` (which sets the variable on the web server) and
 * by `durable-urls.spec.ts` (which asserts on the same slugs), so the two cannot
 * disagree about what was configured.
 */

/** The rename this suite exercises: the ticket's own example, verbatim. */
export const RENAMED_TRIP = { from: "japon-2024", to: "japon-printemps-2024" } as const;

/** The withdrawal this suite exercises. */
export const WITHDRAWN_TRIP = "maroc-2022";

export const E2E_SLUG_HISTORY = JSON.stringify({
  renamed: [RENAMED_TRIP],
  withdrawn: [WITHDRAWN_TRIP],
});
