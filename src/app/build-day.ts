import { isPlainDate } from "@/domain/geo";
import type { PlainDate } from "@/domain/geo";

/**
 * The day the site was built — **the only clock this project reads on the render
 * path**, and the sibling of `./site-url.ts` in every respect that matters.
 *
 * WHY IT EXISTS. TIW-19's badge is a claim about *now*, and `src/domain/**` may
 * not read a clock (`docs/adr/0001-domain-purity.md`) — nor should it, since a
 * derivation that reads the time is a derivation nobody can write a boundary test
 * for. So `freshestTrip(trips, today)` takes the day as an argument, and this
 * module is where that argument comes from.
 *
 * WHY IT IS A BUILD INPUT AND NOT A REQUEST-TIME READING. Invariant 1: every
 * route is prerendered, so the badge is bytes written to disk during
 * `next build`. Reading the reader's clock would mean a client component, and
 * reading a request would de-statify the tree — the same reasoning `site-url.ts`
 * gives about the `Host` header, and the same conclusion.
 *
 * **WHAT THAT COSTS, AND IT IS NOT SMALL.** The freshness window therefore has
 * the granularity of a *deployment*: a badge expires at the first build after its
 * sixtieth day, not at midnight on it. `docs/fraicheur-au-prerendu.md` is the
 * arbitration — it records the measured reason a CSS-only expiry cannot exist,
 * why a third `'use client'` island was refused, and what
 * `.github/workflows/refresh.yml` buys back. Read it before "fixing" this module.
 *
 * WHY A FUNCTION AND NOT A CONSTANT, unlike `SITE_URL` next door. An origin does
 * not change while a process lives; a day does. Under `next dev` the server runs
 * for hours and must see midnight pass, and under Vitest a stubbed
 * `TIW_BUILD_DATE` has to be visible to the test that stubs it — a value frozen
 * at module load would be neither. It costs one `Date` per page.
 */

/**
 * The explicit override, and the one thing that makes every rendered assertion
 * about the badge reproducible.
 *
 * Read by `playwright.content.config.ts` (so the populated end-to-end run pins
 * itself one day after the fixture's newest publication) and available to anyone
 * inspecting a build "as of" a given day — `TIW_BUILD_DATE=2026-06-01 npm run build`
 * is how you see what the site will look like in June without waiting for June.
 */
const BUILD_DATE_VARIABLE = "TIW_BUILD_DATE";

/** The environment shape this module reads — the same index signature `site-url.ts` explains. */
export type BuildDayEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Resolves the day, and **throws** rather than falling back when the override is
 * present but unusable.
 *
 * The throw is the point, and it is `siteUrlFrom`'s argument word for word: a
 * mistyped `TIW_BUILD_DATE` silently replaced by the real clock produces a build
 * whose freshness nobody can reason about, with a green exit code. The check is
 * `isPlainDate` and not `new Date(...)`, because `new Date("2026-2")` parses
 * happily into something that is not the day anybody meant.
 *
 * `toISOString().slice(0, 10)` is the UTC calendar day and never the machine's
 * own: at 23:30 UTC the build machine in Paris is already on tomorrow, and a
 * local reading would put its timezone into published HTML. Same trap, same
 * answer as `src/components/timeline/dates.ts` and `src/domain/geo.ts`.
 */
export function buildDayFrom(environment: BuildDayEnvironment, now: Date): PlainDate {
  const declared = environment[BUILD_DATE_VARIABLE]?.trim();

  if (declared !== undefined && declared !== "") {
    if (!isPlainDate(declared)) {
      throw new Error(
        `${BUILD_DATE_VARIABLE} n'est pas un jour du calendrier écrit AAAA-MM-JJ : « ${declared} ». Attendu par exemple « 2026-03-01 ».`
      );
    }

    return declared;
  }

  const iso = Number.isNaN(now.getTime()) ? undefined : now.toISOString();
  if (iso === undefined) {
    throw new Error(
      "L'horloge du build n'a pas rendu une date utilisable. Le badge « nouveau récit » et le flux RSS en dépendent."
    );
  }

  return iso.slice(0, 10);
}

/** The resolved build day, read on every call — see the note on why this is not a constant. */
export function buildDay(): PlainDate {
  return buildDayFrom(process.env, new Date());
}
