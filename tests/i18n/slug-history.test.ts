import { describe, expect, it } from "vitest";
import { SlugSchema } from "@/domain/geo";
import { tripPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import {
  assertSlugHistory,
  mergeSlugHistory,
  parseSlugHistory,
  readSlugHistory,
  SLUG_HISTORY_ENVIRONMENT_VARIABLE,
  TRIP_SLUG_HISTORY,
  tripRenameRedirects,
} from "@/i18n/slug-history";
import type { SlugHistory } from "@/i18n/slug-history";

/**
 * The register of renamed and withdrawn trip addresses.
 *
 * WHAT THIS SUITE IS FOR, since the register is empty today. Not the array — an
 * empty array asserts nothing. It covers the two things that go silently wrong:
 * the *shape* of the redirect the register produces (a `source` that never matches
 * is indistinguishable from no entry at all), and the refusals that stop a
 * nonsense entry from becoming a redirect nobody notices. The end-to-end half —
 * the old address really answering 301 against a production build — is
 * `tests/e2e/durable-urls.spec.ts`.
 */

const history = (partial: Partial<SlugHistory>): SlugHistory => ({
  renamed: [],
  withdrawn: [],
  ...partial,
});

describe("the register that ships", () => {
  it("is internally consistent", () => {
    // The real one, every time the suite runs: the first rename someone writes is
    // checked here before it reaches a build.
    expect(() => assertSlugHistory(TRIP_SLUG_HISTORY)).not.toThrow();
  });

  it("is empty, and the day it is not this test says what to re-read", () => {
    /**
     * Not a tautology, and not a lock on the register. It is the pointer: the day
     * this goes red, a trip has been renamed or withdrawn, and the two things worth
     * re-reading before touching it are the E2E spec (which injects its own
     * entries and so keeps passing regardless) and `docs/deploiement.md`, whose
     * "Renommer ou retirer un voyage" section is the procedure this file implements.
     * Update the numbers here; never delete an entry from the register.
     */
    expect(TRIP_SLUG_HISTORY).toEqual({ renamed: [], withdrawn: [] });
  });
});

describe("the redirect a rename produces", () => {
  const [redirect, ...rest] = tripRenameRedirects(
    history({ renamed: [{ from: "japon-2024", to: "japon-printemps-2024" }] }),
    routing.locales
  );

  it("emits one entry per rename", () => {
    expect(rest).toEqual([]);
    expect(redirect).toBeDefined();
  });

  it("is a 301 and not Next's 308", () => {
    /**
     * The acceptance criterion says 301. `permanent: true` — the field everyone
     * reaches for — emits 308, and `statusCode` is the documented way to say 301
     * instead. The two fields may not be combined, so this also pins that only one
     * of them is present.
     */
    expect(redirect).toMatchObject({ statusCode: 301 });
    expect(redirect).not.toHaveProperty("permanent");
  });

  it("is built on tripPath, so the `voyages` segment has one definition", () => {
    expect(redirect?.source).toContain(tripPath("japon-2024"));
    expect(redirect?.destination).toContain(tripPath("japon-printemps-2024"));
  });

  it("matches the active locales and nothing else", () => {
    /**
     * `/:locale(fr)` and not `/:locale`. An open parameter would also match
     * `/de/voyages/japon-2024` and redirect it to `/de/voyages/japon-printemps-2024`
     * — a 404 reached through a 301, which is worse than the 404 it replaces
     * because a crawler records the hop. `tests/e2e/routing.spec.ts` pins that `/de`
     * 404s where it stands; this keeps the aliases from undoing that.
     */
    expect(redirect?.source).toBe(`/:locale(${routing.locales.join("|")})/voyages/japon-2024`);
    expect(redirect?.destination).toBe("/:locale/voyages/japon-printemps-2024");
  });

  it("carries the locale through to the destination", () => {
    // `:locale` and not a hardcoded `/fr`: the day `en` is active, an old `/en/…`
    // link must land on the English new address and not be moved to French.
    expect(redirect?.destination.startsWith("/:locale/")).toBe(true);
  });

  it("returns nothing for an empty register", () => {
    expect(tripRenameRedirects(history({}), routing.locales)).toEqual([]);
  });
});

/**
 * The transcribed `SLUG_PATTERN`, checked against the real `SlugSchema` it is a copy
 * of. `src/i18n/slug-history.ts` cannot import it — the module is loaded by
 * `next.config.ts`, before the `@/` aliases exist and where Zod has no business
 * being — so this is the alarm that goes red when the two drift. Same arrangement,
 * for the same reason, as the differential in `tests/i18n/pathname.test.ts`.
 */
describe("the slug pattern agrees with the domain's", () => {
  const spellings = [
    "japon-2024",
    "japon-printemps-2024",
    "a",
    "2024",
    "Japon-2024",
    "japon--2024",
    "-japon",
    "japon-",
    "japon_2024",
    "japon 2024",
    "japon.2024",
    "japón-2024",
    "",
    "japon/2024",
  ];

  it.each(spellings)("answers the same as SlugSchema for %j", (spelling) => {
    const domainAccepts = SlugSchema.safeParse(spelling).success;
    const registerAccepts = (() => {
      try {
        assertSlugHistory(history({ withdrawn: [spelling] }));

        return true;
      } catch {
        return false;
      }
    })();

    expect(registerAccepts).toBe(domainAccepts);
  });
});

describe("a register that cannot mean what it says is refused", () => {
  it("refuses a malformed slug", () => {
    // The interesting failure: a bad slug builds a `source` no request ever
    // matches, so the old link keeps 404ing while the fix looks present.
    expect(() =>
      assertSlugHistory(history({ renamed: [{ from: "Japon 2024", to: "japon-2024" }] }))
    ).toThrowError(/n'est pas un slug valide/);
  });

  it("refuses a rename to itself", () => {
    expect(() =>
      assertSlugHistory(history({ renamed: [{ from: "japon-2024", to: "japon-2024" }] }))
    ).toThrowError(/renommé vers lui-même/);
  });

  it("refuses the same old address twice", () => {
    expect(() =>
      assertSlugHistory(
        history({
          renamed: [
            { from: "japon-2024", to: "japon-printemps-2024" },
            { from: "japon-2024", to: "japon-avril-2024" },
          ],
        })
      )
    ).toThrowError(/renommé deux fois/);
  });

  it("refuses a slug both renamed and withdrawn", () => {
    expect(() =>
      assertSlugHistory(
        history({
          renamed: [{ from: "japon-2024", to: "japon-printemps-2024" }],
          withdrawn: ["japon-2024"],
        })
      )
    ).toThrowError(/à la fois renommé et retiré/);
  });

  it("refuses a rename pointing at a withdrawn slug", () => {
    // Otherwise an old link redirects, 301, onto a page saying the story is gone —
    // two hops to reach a dead end.
    expect(() =>
      assertSlugHistory(
        history({
          renamed: [{ from: "japon-2024", to: "japon-printemps-2024" }],
          withdrawn: ["japon-printemps-2024"],
        })
      )
    ).toThrowError(/un renommage pointe vers lui/);
  });

  it("refuses a redirect chain", () => {
    expect(() =>
      assertSlugHistory(
        history({
          renamed: [
            { from: "japon-2024", to: "japon-printemps-2024" },
            { from: "japon-printemps-2024", to: "japon-avril-2024" },
          ],
        })
      )
    ).toThrowError(/chaînes de redirection sont refusées/);
  });

  it("refuses the same withdrawal twice", () => {
    expect(() =>
      assertSlugHistory(history({ withdrawn: ["maroc-2022", "maroc-2022"] }))
    ).toThrowError(/retiré deux fois/);
  });
});

describe(SLUG_HISTORY_ENVIRONMENT_VARIABLE, () => {
  const injected = JSON.stringify({
    renamed: [{ from: "japon-2024", to: "japon-printemps-2024" }],
    withdrawn: ["maroc-2022"],
  });

  it("adds its entries to the register", () => {
    expect(readSlugHistory({ TIW_SLUG_HISTORY: injected })).toEqual({
      renamed: [{ from: "japon-2024", to: "japon-printemps-2024" }],
      withdrawn: ["maroc-2022"],
    });
  });

  it("is ignored on the production deployment", () => {
    /**
     * The `TIW_DRAFTS` cap, same shape and same measured reason: Vercel's
     * add-a-variable form ticks Production, Preview and Development by default, so a
     * variable set once to exercise a preview would apply to the live site. A real
     * rename is a commit to the register, which is the only thing a reviewer sees.
     */
    expect(readSlugHistory({ TIW_SLUG_HISTORY: injected, VERCEL_ENV: "production" })).toEqual(
      TRIP_SLUG_HISTORY
    );

    // …and it still applies on a preview, which is what makes the cap a cap and
    // not a removal.
    expect(
      readSlugHistory({ TIW_SLUG_HISTORY: injected, VERCEL_ENV: "preview" }).renamed
    ).toHaveLength(1);
  });

  it("treats absent and blank alike", () => {
    expect(readSlugHistory({})).toEqual(TRIP_SLUG_HISTORY);
    expect(readSlugHistory({ TIW_SLUG_HISTORY: "   " })).toEqual(TRIP_SLUG_HISTORY);
  });

  it("validates what it injects", () => {
    // The env path goes through the same refusals as the register — otherwise it
    // would be a way to build a redirect the committed file could not.
    expect(() =>
      readSlugHistory({ TIW_SLUG_HISTORY: '{"withdrawn":["Maroc 2022"]}' })
    ).toThrowError(/n'est pas un slug valide/);
  });

  it("refuses an unknown key rather than reading an empty register", () => {
    // `renames` for `renamed` is the typo, and silently answering "nothing was
    // renamed" is the failure it would otherwise produce.
    expect(() => parseSlugHistory('{"renames":[{"from":"a","to":"b"}]}')).toThrowError(
      /clé inconnue/
    );
  });

  it("refuses malformed JSON and wrong shapes", () => {
    expect(() => parseSlugHistory("{")).toThrowError(/n'est pas du JSON/);
    expect(() => parseSlugHistory("[]")).toThrowError(/doit être un objet/);
    expect(() => parseSlugHistory('{"renamed":{}}')).toThrowError(/doivent être des tableaux/);
    expect(() => parseSlugHistory('{"renamed":[{"from":"a"}]}')).toThrowError(
      /doivent être des chaînes/
    );
    expect(() => parseSlugHistory('{"withdrawn":[3]}')).toThrowError(/que des chaînes/);
  });
});

describe("mergeSlugHistory", () => {
  it("concatenates without dropping the base", () => {
    expect(
      mergeSlugHistory(
        history({ renamed: [{ from: "a-un", to: "a-deux" }], withdrawn: ["b-un"] }),
        history({ renamed: [{ from: "c-un", to: "c-deux" }], withdrawn: ["d-un"] })
      )
    ).toEqual({
      renamed: [
        { from: "a-un", to: "a-deux" },
        { from: "c-un", to: "c-deux" },
      ],
      withdrawn: ["b-un", "d-un"],
    });
  });
});
