import { tripPath } from "./paths";

/**
 * The register of trip addresses that are no longer current: slugs that were
 * renamed, and slugs whose story was taken offline.
 *
 * WHY THIS FILE EXISTS, and it is the whole ticket in one paragraph. The failure
 * this guards against is not deletion — deletion is loud, somebody notices. It is
 * the **silent rename**: turning `japon-2024` into `japon-printemps-2024` because
 * the second reads better breaks every link already sent, in a message thread
 * nobody can edit, and the site says nothing. The build stays green, the new page
 * works, and the only signal is a reader clicking an old link and landing on a 404
 * six months later. The parade costs one line in the register below; the damage is
 * not recoverable, because the links are in other people's messages.
 *
 * SO THE RULE IS: **the slug of a published trip is final.** Renaming it is
 * allowed, and it costs a `renamed` entry here, forever. Removing that entry later
 * is the same mistake made twice.
 *
 * WHY IT LIVES IN `src/i18n/**` AND NOT IN THE CONTENT. Invariant 2 of AGENTS.md:
 * every internal URL is assembled in this folder. These entries *are* URLs — the
 * redirect they produce is `/fr/voyages/<old>` → `/fr/voyages/<new>`, built on the
 * same `tripPath()` the pages and the map use, so a rename of the `voyages`
 * segment moves the aliases with it. A content file was the other candidate and it
 * is the better long-term home (the author who renames a trip is editing content,
 * not configuration) — see the ticket report: `src/content/**` belongs to TIW-29
 * on this branch, and the `next.config.ts` route is also the one that keeps every
 * page prerendered, since a config redirect is served by the platform's routing
 * layer with no server function involved.
 */

/** One rename. Both slugs, forever: the old one is what somebody's link says. */
export type TripSlugRename = {
  /** The slug the old links carry. Never reused for another trip. */
  readonly from: string;
  /** The slug the trip is published under today. */
  readonly to: string;
};

export type SlugHistory = {
  readonly renamed: readonly TripSlugRename[];
  /**
   * Trips taken offline on purpose. Their `trip.yaml` is gone from the content, so
   * there is nothing left to render — but the URL stays a real address that
   * explains itself instead of a 404 that looks like a mistake.
   */
  readonly withdrawn: readonly string[];
};

/**
 * The register itself. **Empty, and correctly so:** `content/trips/` holds no trip
 * yet, so nothing has been renamed or withdrawn. It is not dead weight — it is the
 * file the first rename has to touch, and the mechanism it feeds is exercised end
 * to end today (see {@link readSlugHistory} on how, and why that is not the same
 * thing as testing an empty array).
 *
 * Sorted by `from` when it fills up, so a duplicate is visible by reading.
 */
export const TRIP_SLUG_HISTORY: SlugHistory = {
  renamed: [],
  withdrawn: [],
};

/**
 * `SLUG_PATTERN` from `src/domain/geo.ts`, transcribed rather than imported.
 *
 * This module is loaded by `next.config.ts`, which Next evaluates before the
 * application's module graph and its `@/` aliases exist; `src/domain/geo.ts` also
 * pulls in Zod, which a config file has no business loading. So the pattern is
 * copied — and `tests/i18n/slug-history.test.ts` asserts the copy against the real
 * `SlugSchema` over a table of spellings, so the two cannot drift without a test
 * going red. Same arrangement, for the same reason, as the `getPathname` fork in
 * `src/i18n/pathname.ts`.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A Next `redirects()` entry, narrowed to the one shape this module produces. */
export type SlugRedirect = {
  readonly source: string;
  readonly destination: string;
  /**
   * **301, and not `permanent: true`.** Next's `permanent` flag emits **308**,
   * which preserves the request method and is the better answer in general. The
   * acceptance criterion asks for 301 and it is right to: the clients that matter
   * here are link unfurlers, crawlers and chat apps following a GET, several of
   * which still treat 308 as an unknown 3xx and refuse to follow it. `statusCode`
   * is Next's documented escape hatch for exactly this, and it may not be combined
   * with `permanent`.
   */
  readonly statusCode: 301;
};

function assertSlug(slug: string, field: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `slug-history: « ${slug} » (${field}) n'est pas un slug valide — minuscules et chiffres séparés par des tirets simples, par exemple « japon-printemps-2024 ».`
    );
  }
}

/**
 * Refuses a register that cannot mean what it says. Called from
 * {@link readSlugHistory}, so it runs during `next config` evaluation — a bad entry
 * fails `next build` and never becomes a redirect that silently matches nothing.
 *
 * Each rule is here because its absence is invisible rather than because it is
 * conceivable:
 *
 * - a malformed slug builds a `source` no request will ever match, so the old link
 *   keeps 404ing and the entry that was supposed to fix it looks present;
 * - `from === to` builds a redirect to itself, which is a loop the platform serves
 *   until the browser gives up;
 * - the same `from` twice means two answers for one address and the first one
 *   silently wins;
 * - a slug both renamed and withdrawn is two contradictory promises about one URL;
 * - a `from` that is also a `to` is a rename chain (`a` → `b`, `b` → `c`): each hop
 *   is a redirect, so an old link pays two round trips and some unfurlers stop
 *   following. Chains are refused rather than flattened, because flattening them
 *   silently would let the register grow a shape nobody can read.
 */
export function assertSlugHistory(history: SlugHistory): void {
  const renamedFrom = new Set<string>();
  const renamedTo = new Set<string>();

  for (const { from, to } of history.renamed) {
    assertSlug(from, "renamed.from");
    assertSlug(to, "renamed.to");

    if (from === to) {
      throw new Error(`slug-history: « ${from} » est renommé vers lui-même.`);
    }
    if (renamedFrom.has(from)) {
      throw new Error(`slug-history: « ${from} » est renommé deux fois.`);
    }
    renamedFrom.add(from);
    renamedTo.add(to);
  }

  for (const slug of history.withdrawn) {
    assertSlug(slug, "withdrawn");
  }

  const withdrawn = new Set(history.withdrawn);
  if (withdrawn.size !== history.withdrawn.length) {
    throw new Error("slug-history: un slug est retiré deux fois.");
  }

  for (const slug of withdrawn) {
    if (renamedFrom.has(slug)) {
      throw new Error(
        `slug-history: « ${slug} » est à la fois renommé et retiré — une adresse ne peut pas rediriger et annoncer un récit retiré.`
      );
    }
    if (renamedTo.has(slug)) {
      throw new Error(
        `slug-history: « ${slug} » est retiré alors qu'un renommage pointe vers lui — les anciens liens redirigeraient vers une page de récit retiré.`
      );
    }
  }

  for (const { from } of history.renamed) {
    if (renamedTo.has(from)) {
      throw new Error(
        `slug-history: « ${from} » est à la fois l'ancienne et la nouvelle adresse d'un renommage — les chaînes de redirection sont refusées, écris l'adresse finale.`
      );
    }
  }
}

/** The name of the test-only variable, exported so the guard's message and the test cite one string. */
export const SLUG_HISTORY_ENVIRONMENT_VARIABLE = "TIW_SLUG_HISTORY";

/**
 * The environment {@link readSlugHistory} reads: `TIW_SLUG_HISTORY` and `VERCEL_ENV`.
 * An index signature and not two named optional properties — a type whose every
 * property is optional shares nothing with `NodeJS.ProcessEnv`, and the call is
 * rejected outright (`TS2559`). Same arrangement in `src/app/site-url.ts`.
 */
export type SlugHistoryEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The register the build actually uses: {@link TRIP_SLUG_HISTORY}, plus whatever
 * `TIW_SLUG_HISTORY` adds.
 *
 * **Why that variable exists, since a register in the repository is the whole
 * point.** The register is empty today, so an end-to-end test of the 301 would
 * have nothing to request and would pass by asserting on nothing — the failure
 * shape `tests/build/` exists to refuse. The variable lets `tests/e2e/` build a
 * production server whose register holds one rename and one withdrawal, and assert
 * the real HTTP answers against it. It is the same arrangement, and the same
 * naming, as `TIW_CONTENT_DIR`: a documented test variable, listed with the others
 * in `docs/deploiement.md` as something that has no business in a deployment.
 *
 * **And why it cannot publish anything in production.** `VERCEL_ENV=production`
 * ignores it, exactly as `TIW_DRAFTS` is capped in `src/content/loader.ts` and for
 * the same measured reason: Vercel's add-a-variable form ticks Production, Preview
 * and Development by default, so a variable set once for a preview applies to the
 * live site with nothing to notice. A real rename is a commit to the register
 * above, which is the only thing a reviewer can see.
 */
export function readSlugHistory(environment: SlugHistoryEnvironment): SlugHistory {
  const declared = environment.TIW_SLUG_HISTORY?.trim();
  const history =
    declared === undefined || declared === "" || environment.VERCEL_ENV === "production"
      ? TRIP_SLUG_HISTORY
      : mergeSlugHistory(TRIP_SLUG_HISTORY, parseSlugHistory(declared));

  assertSlugHistory(history);

  return history;
}

/**
 * Parses the JSON of {@link SLUG_HISTORY_ENVIRONMENT_VARIABLE}, and throws on
 * anything it does not recognise — including an unknown key, which is how a typo
 * (`renames` for `renamed`) would otherwise be read as an empty register.
 */
export function parseSlugHistory(raw: string): SlugHistory {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `${SLUG_HISTORY_ENVIRONMENT_VARIABLE} n'est pas du JSON : ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `${SLUG_HISTORY_ENVIRONMENT_VARIABLE} doit être un objet { "renamed": [...], "withdrawn": [...] }.`
    );
  }

  for (const key of Object.keys(value)) {
    if (key !== "renamed" && key !== "withdrawn") {
      throw new Error(`${SLUG_HISTORY_ENVIRONMENT_VARIABLE} : clé inconnue « ${key} ».`);
    }
  }

  const renamed = Reflect.get(value, "renamed") ?? [];
  const withdrawn = Reflect.get(value, "withdrawn") ?? [];

  if (!Array.isArray(renamed) || !Array.isArray(withdrawn)) {
    throw new Error(
      `${SLUG_HISTORY_ENVIRONMENT_VARIABLE} : « renamed » et « withdrawn » doivent être des tableaux.`
    );
  }

  return {
    renamed: renamed.map((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) {
        throw new Error(
          `${SLUG_HISTORY_ENVIRONMENT_VARIABLE} : chaque « renamed » est un objet { "from": "...", "to": "..." }.`
        );
      }
      const from = Reflect.get(entry, "from");
      const to = Reflect.get(entry, "to");
      if (typeof from !== "string" || typeof to !== "string") {
        throw new Error(
          `${SLUG_HISTORY_ENVIRONMENT_VARIABLE} : « from » et « to » doivent être des chaînes.`
        );
      }

      return { from, to };
    }),
    withdrawn: withdrawn.map((slug: unknown) => {
      if (typeof slug !== "string") {
        throw new Error(
          `${SLUG_HISTORY_ENVIRONMENT_VARIABLE} : « withdrawn » ne contient que des chaînes.`
        );
      }

      return slug;
    }),
  };
}

/** Concatenation, kept as a named function so the merge order is stated once. */
export function mergeSlugHistory(base: SlugHistory, extra: SlugHistory): SlugHistory {
  return {
    renamed: [...base.renamed, ...extra.renamed],
    withdrawn: [...base.withdrawn, ...extra.withdrawn],
  };
}

/**
 * The `redirects()` entries a renamed slug needs, one per rename.
 *
 * **The locale is matched, not hardcoded, and the match is closed to the active
 * locales.** `/:locale(fr)/voyages/<old>` rather than `/:locale/voyages/<old>`: an
 * open parameter would also match `/de/voyages/<old>` and redirect it to
 * `/de/voyages/<new>`, which is a 404 reached through a 301 — worse than the 404 it
 * replaces, because a crawler records the redirect. Closing the group means an
 * unknown prefix keeps answering 404 where it stands, which is what
 * `tests/e2e/routing.spec.ts` already pins for `/de`.
 *
 * The un-prefixed `/voyages/<old>` is deliberately NOT redirected. This project
 * answers 404 to every un-prefixed deep path (README, "Rendu statique") because
 * every link it emits carries its prefix — and a link somebody actually sent
 * carries it too, so there is nothing to rescue here that is not a hand-typed URL.
 */
export function tripRenameRedirects(
  history: SlugHistory,
  locales: readonly string[]
): readonly SlugRedirect[] {
  const localeGroup = `/:locale(${locales.join("|")})`;

  return history.renamed.map(({ from, to }) => ({
    source: `${localeGroup}${tripPath(from)}`,
    destination: `/:locale${tripPath(to)}`,
    statusCode: 301,
  }));
}
