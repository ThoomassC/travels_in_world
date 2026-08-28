import { symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTrip, listTripSummaries, loadTrips, tripStaticParams } from "@/content/loader";
import { fixtureRoots, temporaryContent, tripYaml } from "./support";
import type { TemporaryContent } from "./support";

/**
 * The loading façade: the one seam that makes "content in files" a reversible
 * decision. Four signatures, and nothing else in the application knows where a
 * trip comes from — so the invariants defended here are the ones a swap to
 * PostgreSQL would have to keep, not the ones `fs` happens to give for free.
 *
 * Four of them, each with a failure mode that a green build would not show:
 *
 * 1. **Order is part of the contract**, not a side effect of `readdir`. The list
 *    is the home page, and a home page whose order depends on directory names is
 *    a home page that reorders itself the day someone renames a folder.
 * 2. **`draft: true` never reaches production.** The whole point of the ticket is
 *    writing a trip over several sittings; a draft that leaks into one listing
 *    out of four publishes a half-written trip. Hence the sweep test rather than
 *    four independent ones — four separate tests can each pass while the fifth
 *    listing nobody wrote a test for still leaks.
 * 3. **An unknown slug is an absence, never an exception.** The consumer is a
 *    page that must answer 404; a thrown error there is a 500.
 * 4. **A broken content file is loud.** A trip vanishing in silence from the map
 *    is the defect this project refuses: every unreadable file must name itself
 *    and name `npm run validate:content`.
 *
 * The façade is steered entirely through the environment — `TIW_CONTENT_DIR` and
 * `NODE_ENV`, the convention `content/README.md` documents — so both are saved
 * and restored after **every** test, without exception. Leaking either one
 * poisons the other 480-odd tests of the suite, which read the real
 * `content/trips`.
 *
 * Through `vi.stubEnv` and `vi.unstubAllEnvs`, not by hand, for two reasons.
 * Next declares `readonly NODE_ENV: 'development' | 'production' | 'test'` in
 * `next/types/global.d.ts`, so a plain assignment does not typecheck at all — the
 * alternative would be a cast, which is how a test stops testing what it claims.
 * And restoring by hand means remembering to: `unstubAllEnvs` cannot forget one.
 * `tests/setup.ts` clears mocks but not env stubs, hence the explicit call.
 */

/** Every throwaway root this file created, cleaned up whatever the test did. */
const temporaries: TemporaryContent[] = [];

afterEach(() => {
  for (const created of temporaries.splice(0)) {
    created.cleanup();
  }
  vi.unstubAllEnvs();
  // The draft notice is asserted through a spy on `process.stderr.write`; leaving
  // one installed would silence the rest of the run's output.
  vi.restoreAllMocks();
});

/**
 * Writes a collection to a fresh throwaway root and points the façade at it.
 *
 * A *fresh* root every time, which the memo makes load-bearing: `mkdtempSync`
 * hands out a path no earlier test used, so no test can be served another test's
 * memoised collection. That is also what lets the memo be tested at all, without
 * the façade exposing a reset hook nothing in production would ever call.
 */
function useTrips(trips: Readonly<Record<string, string>>): TemporaryContent {
  const created = temporaryContent(trips);
  temporaries.push(created);
  vi.stubEnv("TIW_CONTENT_DIR", created.contentDir);

  return created;
}

/** The single entry of a list, with the length asserted rather than assumed. */
function only<T>(values: readonly T[]): T {
  expect(values).toHaveLength(1);
  const [first] = values;
  if (first === undefined) {
    throw new Error("expected exactly one entry");
  }

  return first;
}

/**
 * The message of a rejection, so one failure can carry several assertions
 * without calling the façade a second time — the memo may or may not remember a
 * rejection, and this test file has no business depending on which.
 */
async function rejection(pending: Promise<unknown>): Promise<string> {
  return pending.then(
    () => {
      throw new Error("expected the façade to reject, and it resolved");
    },
    (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
  );
}

/* ---------------------------------------------------------------- YAML input -- */

const TOKYO_ONLY = [
  "places:",
  "  - slug: tokyo",
  "    name: Tokyo",
  "    countryCode: JP",
  "    coordinates:",
  "      lat: 35.6762",
  "      lon: 139.6503",
].join("\n");

type TripOptions = {
  readonly slug: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly title?: string;
  readonly draft?: boolean;
};

/**
 * One place, one stay: the shortest trip `TripSchema` accepts, so a fixture can
 * vary the slug and the dates — the two things ordering and publication depend
 * on — without dragging an itinerary along.
 */
function oneStayTrip(options: TripOptions): string {
  return tripYaml({
    slug: `slug: ${options.slug}`,
    title: `title: ${options.title ?? options.slug}`,
    startDate: `startDate: ${options.startDate}`,
    endDate: `endDate: ${options.endDate}`,
    places: TOKYO_ONLY,
    steps: [
      "steps:",
      "  - kind: stay",
      "    placeSlug: tokyo",
      `    startDate: ${options.startDate}`,
      `    endDate: ${options.endDate}`,
    ].join("\n"),
    ...(options.draft === undefined ? {} : { draft: `draft: ${String(options.draft)}` }),
  });
}

/**
 * Three trips whose directory names, declared slugs and start dates all disagree
 * on purpose.
 *
 * - `cusco-2022` starts a month later than the other two, so it comes first.
 * - `aomori-2024` and `bolivie-2023` **start on the same day**, which is the only
 *   way to observe the slug tie-break at all.
 * - the directories sort `01`, `02`, `03` — a third order again, so a façade that
 *   returns whatever `readdir` gave it cannot pass.
 */
const COLLECTION: Readonly<Record<string, string>> = {
  "01-perou": oneStayTrip({
    slug: "bolivie-2023",
    startDate: "2024-05-01",
    endDate: "2024-05-08",
  }),
  "02-lyon": oneStayTrip({ slug: "cusco-2022", startDate: "2024-06-01", endDate: "2024-06-05" }),
  "03-japon": oneStayTrip({ slug: "aomori-2024", startDate: "2024-05-01", endDate: "2024-05-04" }),
};

/** Descending start date, then ascending slug for the two that tie. */
const PUBLISHED_ORDER = ["cusco-2022", "aomori-2024", "bolivie-2023"];

/** A published trip and a draft, the draft being the *most recent* of the two. */
const WITH_A_DRAFT: Readonly<Record<string, string>> = {
  "japon-2024": oneStayTrip({
    slug: "japon-2024",
    startDate: "2024-04-12",
    endDate: "2024-04-16",
  }),
  "perou-2025": oneStayTrip({
    slug: "perou-2025",
    startDate: "2025-03-01",
    endDate: "2025-03-10",
    draft: true,
  }),
};

/* ------------------------------------------------------------- the four calls -- */

describe("the four functions over a collection of valid trips", () => {
  it("loads one detail per trip", async () => {
    useTrips(COLLECTION);

    const trips = await loadTrips();

    expect(trips.map((trip) => trip.slug)).toEqual(PUBLISHED_ORDER);
    expect(trips.every((trip) => trip.steps.length > 0)).toBe(true);
  });

  it("lists one summary per trip", async () => {
    useTrips(COLLECTION);

    const summaries = await listTripSummaries();

    expect(summaries.map((summary) => summary.slug)).toEqual(PUBLISHED_ORDER);
  });

  it("enumerates one static param per trip", async () => {
    useTrips(COLLECTION);

    await expect(tripStaticParams()).resolves.toEqual([
      { slug: "cusco-2022" },
      { slug: "aomori-2024" },
      { slug: "bolivie-2023" },
    ]);
  });

  it("finds a trip by its slug", async () => {
    useTrips(COLLECTION);

    const trip = await findTrip("aomori-2024");

    expect(trip?.slug).toBe("aomori-2024");
    expect(trip?.startDate).toBe("2024-05-01");
  });

  /**
   * The slug is the URL, and the URL is what the *file* declares. The directory
   * name is a convention `content/README.md` states as such — a façade keyed on
   * it would silently move a published trip's URL the day someone renames a
   * folder, which is a broken link with no error anywhere.
   */
  it("uses the slug declared in the file, never the directory name", async () => {
    useTrips(COLLECTION);

    const slugs = (await tripStaticParams()).map((params) => params.slug);

    expect(slugs).toEqual(PUBLISHED_ORDER);
    expect(slugs).not.toContain("01-perou");
    expect(slugs).not.toContain("02-lyon");
    expect(slugs).not.toContain("03-japon");
  });
});

describe("order", () => {
  /**
   * Descending start date, ascending slug for a tie. The tie is the half nobody
   * writes a test for: `sort` is stable in every engine the project runs on, so a
   * comparator that returns 0 for two same-day trips *looks* deterministic — it
   * just happens to fall back on directory order, which is `03-japon` before
   * `01-perou` for exactly nobody's reason.
   *
   * Asserted on all three listings at once, because "the same order everywhere"
   * is the actual contract: a home page and a sitemap that disagree on the order
   * of two trips is a bug no single-function test can see.
   */
  it("sorts by descending start date and breaks a tie on the ascending slug, identically in the three listings", async () => {
    useTrips(COLLECTION);

    const [details, summaries, params] = await Promise.all([
      loadTrips(),
      listTripSummaries(),
      tripStaticParams(),
    ]);

    expect(details.map((trip) => trip.slug)).toEqual(PUBLISHED_ORDER);
    expect(summaries.map((summary) => summary.slug)).toEqual(PUBLISHED_ORDER);
    expect(params.map((entry) => entry.slug)).toEqual(PUBLISHED_ORDER);
  });
});

/* -------------------------------------------------------------------- drafts -- */

describe("draft: true", () => {
  /**
   * The acceptance criterion of the ticket, as one sweep rather than four tests.
   *
   * Four separate tests can each be green while a fifth listing — the one nobody
   * remembered — still publishes the draft. Sweeping the four calls the façade
   * actually exposes in a single test means adding a fifth exit forces this test
   * to be revisited, which is the whole point.
   */
  it("keeps a draft out of every production listing, and answers absence for its URL", async () => {
    useTrips(WITH_A_DRAFT);
    vi.stubEnv("NODE_ENV", "production");

    const [details, summaries, params, found] = await Promise.all([
      loadTrips(),
      listTripSummaries(),
      tripStaticParams(),
      findTrip("perou-2025"),
    ]);

    expect(details.map((trip) => trip.slug)).toEqual(["japon-2024"]);
    expect(summaries.map((summary) => summary.slug)).toEqual(["japon-2024"]);
    expect(params).toEqual([{ slug: "japon-2024" }]);
    expect(found).toBeUndefined();
  });

  /** The counterpart: in development a draft is a trip like any other. */
  it("shows a draft in every development listing", async () => {
    useTrips(WITH_A_DRAFT);
    vi.stubEnv("NODE_ENV", "development");

    const [details, summaries, params, found] = await Promise.all([
      loadTrips(),
      listTripSummaries(),
      tripStaticParams(),
      findTrip("perou-2025"),
    ]);

    expect(details.map((trip) => trip.slug)).toEqual(["perou-2025", "japon-2024"]);
    expect(summaries.map((summary) => summary.slug)).toEqual(["perou-2025", "japon-2024"]);
    expect(params).toEqual([{ slug: "perou-2025" }, { slug: "japon-2024" }]);
    expect(found?.slug).toBe("perou-2025");
  });

  /**
   * `"production"` and nothing else hides a draft. Under Vitest `NODE_ENV` is
   * `"test"`, and a façade that hid drafts under "not development" would make the
   * whole suite blind to every draft — including the two tests above.
   */
  it("shows a draft under NODE_ENV=test, which is neither production nor development", async () => {
    useTrips(WITH_A_DRAFT);
    vi.stubEnv("NODE_ENV", "test");

    await expect(tripStaticParams()).resolves.toEqual([
      { slug: "perou-2025" },
      { slug: "japon-2024" },
    ]);
  });

  /**
   * The memo keeps *every* trip and the publication filter runs per call, so the
   * two answers below come out of the same cached read. Memoising the filtered
   * list instead is the subtle version of the same bug: whichever environment
   * asked first would decide the answer for the rest of the process.
   */
  it("re-applies the publication filter on every call rather than memoising a filtered list", async () => {
    useTrips(WITH_A_DRAFT);

    vi.stubEnv("NODE_ENV", "development");
    const inDevelopment = await listTripSummaries();

    vi.stubEnv("NODE_ENV", "production");
    const inProduction = await listTripSummaries();

    expect(inDevelopment.map((summary) => summary.slug)).toEqual(["perou-2025", "japon-2024"]);
    expect(inProduction.map((summary) => summary.slug)).toEqual(["japon-2024"]);
  });

  /**
   * **The publication filter is an allowlist, and this is the block that says so.**
   * It used to hide a draft under `NODE_ENV === "production"` alone, so every other
   * value published — a default that is open on the only feature of this ticket
   * touching unpublished content.
   *
   * Measured, and the nuance is worth keeping because it explains why these cases
   * are about something other than `next build`: a probe page really calling
   * `listTripSummaries()`, built with `NODE_ENV=test npm run build`, printed
   * `inlined="production" real="test" NEXT_PHASE="phase-production-build"` and
   * published only the non-draft trip. Next keeps a pre-set `NODE_ENV`
   * (`next/dist/bin/next:84`) but the bundler folds `process.env.NODE_ENV` into a
   * literal in the server bundle (`next/dist/build/define-env.js`), so the leak does
   * not reproduce *through a build*. What it does reproduce through is every
   * consumer that is not bundled — Vitest, and the first plain Node script to call
   * `loadTrips()` for a sitemap or a feed — and `next build --debug-prerender`,
   * which sets `NODE_ENV=development`.
   */
  it("hides a draft under an environment name that is neither of the two allowed", async () => {
    useTrips(WITH_A_DRAFT);

    /**
     * `Reflect.set` rather than `vi.stubEnv`, and not to dodge a rule: Next types
     * `NODE_ENV` as the three-value union in `next/types/global.d.ts`, so the stub
     * helper cannot express "some other value" — which is the whole case here. The
     * previous value is captured and put back in the `finally`, because
     * `unstubAllEnvs` knows nothing about a write it did not make.
     */
    const previous = process.env.NODE_ENV;
    Reflect.set(process.env, "NODE_ENV", "staging");
    try {
      await expect(tripStaticParams()).resolves.toEqual([{ slug: "japon-2024" }]);
    } finally {
      Reflect.set(process.env, "NODE_ENV", previous);
    }
  });

  /**
   * The build signal, which is the one Next sets whatever `NODE_ENV` holds
   * (`next/dist/build/index.js:1212`) and — measured — does *not* inline. It is
   * asserted against `NODE_ENV=development` on purpose: that is the combination
   * `next build --debug-prerender` produces, and the one where reading `NODE_ENV`
   * alone would publish every draft of the site.
   */
  it("hides a draft during a production build even when NODE_ENV says development", async () => {
    useTrips(WITH_A_DRAFT);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");

    await expect(tripStaticParams()).resolves.toEqual([{ slug: "japon-2024" }]);
  });

  /**
   * `TIW_DRAFTS` is the explicit answer, and it wins over both signals — with one
   * cap, asserted separately below: it cannot publish the production deployment.
   *
   * `hidden` is the point of it, and it stays absolute: an author sees what will
   * actually be online without paying for a build, which is the question
   * `content/README.md` used to answer with `npm run build && npm run start`.
   * Asking for *less* can never leak, so nothing caps that direction.
   */
  it.each([
    {
      label: "hidden wins over a development environment",
      asked: "hidden",
      environment: "development",
      phase: undefined,
      expected: [{ slug: "japon-2024" }],
    },
    {
      label: "hidden wins over the test environment",
      asked: "hidden",
      environment: "test",
      phase: undefined,
      expected: [{ slug: "japon-2024" }],
    },
    {
      label: "visible wins over a production environment",
      asked: "visible",
      environment: "production",
      phase: undefined,
      expected: [{ slug: "perou-2025" }, { slug: "japon-2024" }],
    },
    {
      label: "visible wins over the production build phase",
      asked: "visible",
      environment: "development",
      phase: "phase-production-build",
      expected: [{ slug: "perou-2025" }, { slug: "japon-2024" }],
    },
  ] as const)("TIW_DRAFTS=$asked $label", async ({ asked, environment, phase, expected }) => {
    useTrips(WITH_A_DRAFT);
    vi.stubEnv("NODE_ENV", environment);
    vi.stubEnv("NEXT_PHASE", phase);
    vi.stubEnv("TIW_DRAFTS", asked);

    await expect(tripStaticParams()).resolves.toEqual(expected);
  });

  /**
   * **The one cap on the explicit answer, and the reason it exists.**
   *
   * Measured before it did: `TIW_DRAFTS=visible VERCEL_ENV=production npx next
   * build` prerendered the draft and wrote its title into the HTML — the override
   * outranked `NEXT_PHASE` and `VERCEL_ENV` alike. What makes that a hand slip
   * rather than a hypothesis is the Vercel dashboard: its add-a-variable form
   * ticks Production, Preview **and** Development by default, so a variable set
   * once to review a draft on a preview URL publishes it to the live site too,
   * with a green CI and nothing to notice.
   *
   * `VERCEL_ENV` is set by the platform, never by us, and is absent everywhere
   * else — which is why the two rows below that are not `production` still show
   * the draft, and why the whole suite is unaffected.
   */
  it.each([
    { label: "caps the override on the production deployment", vercel: "production", expected: 1 },
    { label: "leaves a preview deployment alone", vercel: "preview", expected: 2 },
    { label: "leaves a machine with no VERCEL_ENV alone", vercel: undefined, expected: 2 },
  ] as const)("VERCEL_ENV=$vercel $label", async ({ vercel, expected }) => {
    useTrips(WITH_A_DRAFT);
    vi.stubEnv("TIW_DRAFTS", "visible");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("VERCEL_ENV", vercel);

    await expect(tripStaticParams()).resolves.toHaveLength(expected);
  });

  /**
   * A value that is neither of the two documented ones is **not** an instruction:
   * it falls through to the environment rules rather than being read as "not
   * hidden". A typo must not be a publication decision, in either direction.
   */
  it("ignores a TIW_DRAFTS value it does not recognise", async () => {
    useTrips(WITH_A_DRAFT);
    vi.stubEnv("TIW_DRAFTS", "peut-être");
    vi.stubEnv("NODE_ENV", "production");

    await expect(tripStaticParams()).resolves.toEqual([{ slug: "japon-2024" }]);

    vi.stubEnv("NODE_ENV", "development");

    await expect(tripStaticParams()).resolves.toEqual([
      { slug: "perou-2025" },
      { slug: "japon-2024" },
    ]);
  });

  /** And the other way round, so neither order of the two calls is privileged. */
  it("answers development correctly after having answered production", async () => {
    useTrips(WITH_A_DRAFT);

    vi.stubEnv("NODE_ENV", "production");
    await listTripSummaries();

    vi.stubEnv("NODE_ENV", "development");

    await expect(findTrip("perou-2025")).resolves.toMatchObject({ slug: "perou-2025" });
  });
});

/* --------------------------------------------------- the notice about drafts -- */

describe("the stderr notice naming the drafts a read is about to serve", () => {
  /**
   * The answer to "how do I know what is a draft" that does **not** put `draft`
   * on `TripSummary`. In production the flag would be `false` for every trip a
   * page can see, so `if (trip.draft)` would work on localhost and never run once
   * online; the notice lives outside the data contract instead, so no consumer
   * writes a condition and no field can mislead one.
   *
   * `content/README.md` already sends the contributor to
   * `npm run build && npm run start` for the truth of what publishes, which is
   * right and is not what anybody runs between two edits. This line closes that
   * daily gap under `next dev`, where a draft is otherwise indistinguishable from
   * a published trip.
   *
   * Asserted on `process.stderr.write` rather than on `console.error`, because
   * that is what the façade calls — a single line, terminated, and nothing on
   * stdout, which a build log has to stay parseable.
   */
  function captureStderr(): readonly string[] {
    const written: string[] = [];

    vi.spyOn(process.stderr, "write").mockImplementation((chunk): boolean => {
      written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));

      return true;
    });

    return written;
  }

  /** Two drafts and no published trip, so the plural and the list both show. */
  const TWO_DRAFTS: Readonly<Record<string, string>> = {
    "japon-2024": oneStayTrip({
      slug: "japon-2024",
      startDate: "2024-04-12",
      endDate: "2024-04-16",
      draft: true,
    }),
    "perou-2025": oneStayTrip({
      slug: "perou-2025",
      startDate: "2025-03-01",
      endDate: "2025-03-10",
      draft: true,
    }),
  };

  /**
   * One line per *read*, not one per draft and not one per door: the four
   * functions all go through the same reading, and three of them can be called
   * for a single page.
   */
  it("writes exactly one line, naming every draft in publication order", async () => {
    useTrips(TWO_DRAFTS);
    vi.stubEnv("NODE_ENV", "development");
    const written = captureStderr();

    await listTripSummaries();

    expect(written).toEqual([
      "2 brouillons, visibles seulement en développement : perou-2025, japon-2024\n",
    ]);
  });

  /** Agreement in number, since the line is French and read by a human. */
  it("agrees in number for a single draft", async () => {
    useTrips(WITH_A_DRAFT);
    vi.stubEnv("NODE_ENV", "development");
    const written = captureStderr();

    await listTripSummaries();

    expect(written).toEqual(["1 brouillon, visible seulement en développement : perou-2025\n"]);
  });

  /**
   * The line names the *cause*, and never says "seulement ici" — the one thing
   * this layer cannot know is who can reach the process it runs in.
   *
   * Measured before this distinction existed, in the log of a production
   * `next start` with the override set: « 1 brouillon, visible seulement ici »,
   * while that draft was being served with a 200 on the public port. The message
   * reassured in precisely the case that deserved a warning, which is why the
   * wording is asserted rather than left to taste.
   */
  it("names the override when that is why the draft is visible", async () => {
    useTrips(WITH_A_DRAFT);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TIW_DRAFTS", "visible");
    const written = captureStderr();

    await listTripSummaries();

    expect(written).toEqual([
      "1 brouillon, visible dans cet environnement (TIW_DRAFTS=visible) : perou-2025\n",
    ]);
  });

  /**
   * Never in production, and the reason is not noise: there the publication
   * filter has already removed every draft, so a line about what "is visible
   * only here" would be a statement about nothing.
   */
  it("says nothing in production, where no draft is served at all", async () => {
    useTrips(TWO_DRAFTS);
    vi.stubEnv("NODE_ENV", "production");
    const written = captureStderr();

    await expect(listTripSummaries()).resolves.toEqual([]);

    expect(written).toEqual([]);
  });

  /**
   * And nothing when the author asked for the production reading with
   * `TIW_DRAFTS=hidden`: the notice says "visible only here", so it must follow
   * the filter rather than the environment. The two answers are one predicate, and
   * this is the case that keeps them one.
   */
  it("says nothing when TIW_DRAFTS=hidden has removed the drafts", async () => {
    useTrips(TWO_DRAFTS);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TIW_DRAFTS", "hidden");
    const written = captureStderr();

    await expect(listTripSummaries()).resolves.toEqual([]);

    expect(written).toEqual([]);
  });

  /** And nothing at all on a collection that has no draft in it. */
  it("says nothing when the collection holds no draft", async () => {
    useTrips(COLLECTION);
    vi.stubEnv("NODE_ENV", "development");
    const written = captureStderr();

    await listTripSummaries();

    expect(written).toEqual([]);
  });

  /**
   * A rejected read announces nothing: the notice is written after the collection
   * has been turned into trips, so a broken file produces the loud error and not
   * a half-truth about what is visible.
   */
  it("says nothing when the read is refused", async () => {
    useTrips({
      "perou-2025": tripYaml({
        slug: "slug: perou-2025",
        endDate: "endDate: 2024-04-01",
        draft: "draft: true",
      }),
    });
    vi.stubEnv("NODE_ENV", "development");
    const written = captureStderr();

    await expect(rejection(loadTrips())).resolves.toContain("npm run validate:content");

    expect(written).toEqual([]);
  });
});

/* ------------------------------------------------------------------ findTrip -- */

describe("findTrip", () => {
  /**
   * `.resolves`, not a returned value: the consumer is a page that renders a 404
   * on absence, and the difference between "resolved to undefined" and "threw"
   * is the difference between a 404 and a 500. Asserting the promise settles the
   * right way is the assertion; reading the value is not.
   */
  it("resolves to undefined for a slug no trip declares", async () => {
    useTrips(COLLECTION);

    await expect(findTrip("nulle-part-2019")).resolves.toBeUndefined();
  });

  /**
   * The slug arrives from a URL segment, so it is attacker-controlled text. None
   * of these may throw, and none may answer anything but absence.
   *
   * `__proto__` and `constructor` are the ones a lookup built on a plain object
   * gets wrong: `{}["constructor"]` is a function, and a façade that tests
   * `if (index[slug])` would hand a page the `Object` constructor to render.
   * `../../etc/passwd` is refused because a slug is compared, never joined onto a
   * path; and the miscased slug pins that the comparison is exact — matching it
   * would serve one trip under two URLs.
   */
  it.each([
    { label: "the empty string", slug: "" },
    { label: "the prototype key", slug: "__proto__" },
    { label: "the constructor key", slug: "constructor" },
    { label: "a prototype-chain key", slug: "toString" },
    { label: "a path traversal", slug: "../../etc/passwd" },
    { label: "an existing slug in the wrong case", slug: "Aomori-2024" },
    { label: "an existing slug with trailing whitespace", slug: "aomori-2024 " },
  ])("resolves to undefined for $label, without throwing", async ({ slug }) => {
    useTrips(COLLECTION);

    await expect(findTrip(slug)).resolves.toBeUndefined();
  });
});

/* --------------------------------------------------------------- memoisation -- */

describe("memoisation", () => {
  /**
   * Both cases below are proved through the observable consequence — the disk
   * changes, and the answer either follows or does not — rather than by spying on
   * `fs`. A spy would pin *which* function the façade calls, so swapping
   * `readFileSync` for `fs/promises`, or for a database, would turn them red while
   * the behaviour they name is intact.
   *
   * **And they are two cases, not one, because the memo is production-only.** A
   * module-level `Map` cannot be invalidated by a `trip.yaml` edit: the YAML is
   * not in the module graph, so HMR re-evaluates nothing under `next dev` and the
   * author's edit stays invisible until the server restarts — intermittently at
   * that, since touching any `.ts` re-instantiates the module and empties the memo
   * while touching only the YAML does not. Memoising there would break the one
   * workflow `draft` exists for.
   */
  const FIRST_READING = "Japon, première lecture";
  const REWRITTEN = "Réécrit sur le disque entre les deux appels";

  /** Writes the trip again, under the same slug and dates, with another title. */
  function rewriteTitle(created: TemporaryContent, title: string): void {
    writeFileSync(
      path.join(created.contentDir, "japon-2024", "trip.yaml"),
      oneStayTrip({
        slug: "japon-2024",
        title,
        startDate: "2024-04-12",
        endDate: "2024-04-16",
      }),
      "utf8"
    );
  }

  function useOneJapaneseTrip(): TemporaryContent {
    return useTrips({
      "japon-2024": oneStayTrip({
        slug: "japon-2024",
        title: FIRST_READING,
        startDate: "2024-04-12",
        endDate: "2024-04-16",
      }),
    });
  }

  it("does not read the collection a second time under NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const created = useOneJapaneseTrip();

    const before = await listTripSummaries();
    expect(before.map((summary) => summary.title)).toEqual([FIRST_READING]);

    rewriteTitle(created, REWRITTEN);
    const after = await listTripSummaries();

    expect(after.map((summary) => summary.title)).toEqual([FIRST_READING]);
  });

  /**
   * The counterpart, and the feature rather than the snapshot: in development the
   * rewritten file **is** read again. Without this case the memo could be
   * reinstated for every environment and only the production test above would
   * still be green — which is exactly the state this test was written to end.
   */
  it("reads an edited trip.yaml again under NODE_ENV=development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const created = useOneJapaneseTrip();

    const before = await listTripSummaries();
    expect(before.map((summary) => summary.title)).toEqual([FIRST_READING]);

    rewriteTitle(created, REWRITTEN);
    const after = await listTripSummaries();

    expect(after.map((summary) => summary.title)).toEqual([REWRITTEN]);
  });

  /**
   * The memo is keyed by the resolved content directory, not by "have I run
   * before". A single global slot is the natural implementation and it makes
   * every test after the first one read a directory it never asked for — which
   * is also how a test suite starts passing for reasons nobody can name.
   *
   * Under `NODE_ENV=production`, since that is the only environment where a memo
   * exists at all: under Vitest's `"test"` every read is fresh, so the case would
   * pass without proving anything about the keying.
   */
  it("keys its memo by the resolved content directory", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = temporaryContent({
      "japon-2024": oneStayTrip({
        slug: "japon-2024",
        startDate: "2024-04-12",
        endDate: "2024-04-16",
      }),
    });
    temporaries.push(first);
    const second = temporaryContent({
      "perou-2025": oneStayTrip({
        slug: "perou-2025",
        startDate: "2025-03-01",
        endDate: "2025-03-10",
      }),
    });
    temporaries.push(second);

    vi.stubEnv("TIW_CONTENT_DIR", first.contentDir);
    await expect(tripStaticParams()).resolves.toEqual([{ slug: "japon-2024" }]);

    vi.stubEnv("TIW_CONTENT_DIR", second.contentDir);
    await expect(tripStaticParams()).resolves.toEqual([{ slug: "perou-2025" }]);
  });
});

/* ------------------------------------------------------------ empty and loud -- */

describe("an empty collection", () => {
  /**
   * `content/trips/` holds nothing but a `.gitkeep` until TIW-24 lands the real
   * trips, so this is the state of the repository today: the façade must answer
   * "no trips", not throw, and not report the `.gitkeep` as a trip.
   */
  it("answers empty from the four functions, without throwing", async () => {
    vi.stubEnv("TIW_CONTENT_DIR", fixtureRoots("no-trips").contentDir);

    await expect(loadTrips()).resolves.toEqual([]);
    await expect(listTripSummaries()).resolves.toEqual([]);
    await expect(tripStaticParams()).resolves.toEqual([]);
    await expect(findTrip("japon-2024")).resolves.toBeUndefined();
  });
});

describe("a content file the façade cannot load", () => {
  /**
   * Loud, always. A trip that disappears from the map in silence is the defect
   * this whole content pipeline exists to prevent, and the message has to carry
   * the two things the author needs: *which file*, and *the command that
   * explains it*. Anything less and the reflex is to re-run the build.
   *
   * The path is matched with either separator: the message is produced by code
   * that joins paths, and this suite has to say the same thing on macOS and on
   * the Linux CI.
   */
  it.each([
    { label: "YAML that cannot be parsed at all", fixture: "invalid-yaml" },
    { label: "a trip the schema refuses", fixture: "end-date-before-start-date" },
    { label: "a trip directory with no trip.yaml in it", fixture: "missing-trip-file" },
  ])("refuses to load $label, naming the file and the command", async ({ fixture }) => {
    vi.stubEnv("TIW_CONTENT_DIR", fixtureRoots(fixture).contentDir);

    const message = await rejection(loadTrips());

    expect(message).toMatch(/japon-2024[/\\]trip\.yaml/);
    expect(message).toContain("npm run validate:content");
  });

  /**
   * `__proto__` cannot be caught by `TripSchema`: assigning it never creates an
   * own property, so `z.strictObject` never sees the key and the trip validates
   * green while the loaded value carries the key. It is the one hole in "an unknown
   * key is an error", and the façade is the last place it can be closed before the
   * value reaches a page.
   *
   * **One case per spelling, because the check is keyed on the key's text and YAML
   * has a dozen ways to write the same text.** The last two are the ones that were
   * measured getting through, and they are what the second, value-based check
   * exists for:
   *
   * - the **alias** spelling below. `collection.ts` identifies a key through
   *   `key.value`, which an Alias node does not have, so the document walk answers
   *   `undefined` and skips the branch — while `toJS()` resolves the alias and puts
   *   the key down. Measured on this very input: `unsafeKeys: []`,
   *   `hasOwn __proto__: true`, `schema ok: true`, **loader ACCEPTED**, and
   *   `npm run validate:content` printing « 1 voyage validé, aucun problème. ».
   * - the **recursive anchor**, which is not about `__proto__` at all: it is the
   *   input that made the value-based walk necessary *and* dangerous.
   *   `parse("a: &x\n  b: *x")` succeeds and returns a cyclic object, so a walk
   *   without a visited-set never returns and the build hangs with no message.
   */
  /**
   * Annotated rather than inferred: each case overrides a *different* block of
   * `tripYaml`, so inference produces a union in which every key absent from one
   * member is typed `undefined` — and `Readonly<Record<string, string>>` rejects
   * it. The annotation is what keeps the table free to name only the block each
   * spelling needs.
   */
  const unsafeKeyCases: readonly {
    readonly label: string;
    readonly trip: Readonly<Record<string, string>>;
    readonly at: string;
  }[] = [
    { label: "a block key", trip: { unsafe: "__proto__: { pollue: true }" }, at: "" },
    { label: "a flow map key", trip: { unsafe: "pollue: { __proto__: { x: 1 } }" }, at: "pollue" },
    { label: "a double-quoted key", trip: { unsafe: '"__proto__": { pollue: true }' }, at: "" },
    { label: "a single-quoted key", trip: { unsafe: "'__proto__': { pollue: true }" }, at: "" },
    { label: "an explicit key", trip: { unsafe: "? __proto__\n: { pollue: true }" }, at: "" },
    {
      label: "a key nested in places[0]",
      trip: {
        places: [
          "places:",
          "  - slug: tokyo",
          "    name: Tokyo",
          "    countryCode: JP",
          "    __proto__: { pollue: true }",
          "    coordinates:",
          "      lat: 35.6762",
          "      lon: 139.6503",
        ].join("\n"),
      },
      at: "places[0].__proto__",
    },
    {
      label: "a key nested in steps[0]",
      trip: {
        steps: [
          "steps:",
          "  - kind: stay",
          "    placeSlug: tokyo",
          "    __proto__: { pollue: true }",
          "    startDate: 2024-04-12",
          "    endDate: 2024-04-16",
        ].join("\n"),
      },
      at: "steps[0].__proto__",
    },
    {
      label: "a key reached through a merge key",
      trip: {
        unsafe: ["base: &base", "  __proto__: { pollue: true }", "merged:", "  <<: *base"].join(
          "\n"
        ),
      },
      at: "base.__proto__",
    },
    {
      label: "a key written as an alias, which the YAML document walk cannot see",
      trip: { title: "title: &k __proto__", unsafe: "*k :\n  polluted: yes" },
      at: "",
    },
  ];

  it.each(unsafeKeyCases)("refuses $label, which no schema can see", async ({ trip, at }) => {
    useTrips({ "japon-2024": tripYaml(trip) });

    const message = await rejection(loadTrips());

    expect(message).toMatch(/japon-2024[/\\]trip\.yaml/);
    expect(message).toContain("__proto__");
    expect(message).toContain("npm run validate:content");
    if (at !== "") {
      // A nested key needs to say *where*: this layer has no line and column to
      // offer, unlike the validator's finding for the same rule.
      expect(message).toContain(at);
    }
  });

  /**
   * A self-referencing value: refused, and above all *answered*. The assertion
   * that matters is not the wording, it is that this test terminates — a walk over
   * the materialised value without a visited-set spins forever here, and a build
   * that hangs is worse than a build that fails.
   */
  it("answers on a recursive anchor instead of walking it forever", async () => {
    useTrips({ "japon-2024": tripYaml({ unsafe: "a: &x\n  b: *x" }) });

    const message = await rejection(loadTrips());

    expect(message).toContain("npm run validate:content");
  });

  /**
   * The witness that keeps the two checks from being a ban on anchors. Aliasing a
   * *value* is legitimate YAML and a contributor's shortest way to say "the same
   * coordinates" — and it makes one object reachable by two paths, which is the
   * shape the visited-set has to survive without losing the trip.
   */
  it("loads a trip that shares a subtree through an anchor", async () => {
    useTrips({
      "japon-2024": tripYaml({
        places: [
          "places:",
          "  - slug: tokyo",
          "    name: Tokyo",
          "    countryCode: JP",
          "    coordinates: &c",
          "      lat: 35.6762",
          "      lon: 139.6503",
          "  - slug: kyoto",
          "    name: Kyoto",
          "    countryCode: JP",
          "    coordinates: *c",
        ].join("\n"),
      }),
    });

    const detail = await findTrip("japon-2024");

    expect(detail?.places.map((place) => place.slug)).toEqual(["tokyo", "kyoto"]);
    expect(detail?.places[1]?.coordinates).toEqual({ lat: 35.6762, lon: 139.6503 });
  });

  /**
   * A trip directory that is a dangling symlink. `readdir` calls it neither a
   * file nor a directory, so the trip behind it is absent from every listing
   * with nothing said — the exact silence this façade must not reproduce.
   */
  it("refuses a trip directory that is a broken symlink", async () => {
    const created = useTrips({});
    symlinkSync(
      path.join(created.root, "nulle-part"),
      path.join(created.contentDir, "japon-2024"),
      "dir"
    );

    const message = await rejection(loadTrips());

    expect(message).toContain("japon-2024");
    expect(message).toContain("npm run validate:content");
  });

  /**
   * All four entry points, not just `loadTrips`. Three of the four are what the
   * pages call, and a façade that only checks on the "load everything" path
   * hands a page a partial collection — the failure being silent again.
   */
  it("refuses through each of the four functions, not only through loadTrips", async () => {
    useTrips({ "japon-2024": tripYaml({ endDate: "endDate: 2024-04-01" }) });

    await expect(loadTrips()).rejects.toThrow(/npm run validate:content/);
    await expect(listTripSummaries()).rejects.toThrow(/npm run validate:content/);
    await expect(tripStaticParams()).rejects.toThrow(/npm run validate:content/);
    await expect(findTrip("japon-2024")).rejects.toThrow(/npm run validate:content/);
  });

  /**
   * A draft is validated exactly like a published trip, in every environment.
   * Validating only what gets published would let a draft pile up its mistakes
   * in silence until the day it goes live — the worst possible moment to find
   * them, and the reason `content/README.md` states the rule.
   */
  it("refuses a broken draft in production too, rather than skipping what it would not publish", async () => {
    useTrips({
      "perou-2025": tripYaml({
        slug: "slug: perou-2025",
        endDate: "endDate: 2024-04-01",
        draft: "draft: true",
      }),
    });
    vi.stubEnv("NODE_ENV", "production");

    const message = await rejection(loadTrips());

    expect(message).toContain("npm run validate:content");
  });
});

/* --------------------------------------------------------------- projections -- */

describe("the projections the façade hands to the pages", () => {
  /**
   * One fixture that excludes both wrong readings of `firstArrival` at once.
   *
   * It declares Kyoto first in `places[]` and opens on a **flight from Kyoto to
   * Tokyo**. So the right answer is Tokyo, and the two plausible mistakes both
   * answer Kyoto: reading `places[0]` — declarative order, which reordering the
   * YAML must never change — and reading the first step's *departure*, which is
   * the reading that puts a trip to Japan on the map at the traveller's home
   * airport.
   */
  const ARRIVES_SOMEWHERE_ELSE = {
    places: [
      "places:",
      "  - slug: kyoto",
      "    name: Kyoto",
      "    countryCode: JP",
      "    coordinates:",
      "      lat: 35.0116",
      "      lon: 135.7681",
      "  - slug: tokyo",
      "    name: Tokyo",
      "    countryCode: JP",
      "    coordinates:",
      "      lat: 35.6762",
      "      lon: 139.6503",
    ].join("\n"),
    steps: [
      "steps:",
      "  - kind: move",
      "    fromSlug: kyoto",
      "    toSlug: tokyo",
      "    mode: train",
      "    date: 2024-04-12",
      "  - kind: stay",
      "    placeSlug: tokyo",
      "    startDate: 2024-04-12",
      "    endDate: 2024-04-16",
    ].join("\n"),
  };

  it("takes firstArrival from where the first step arrives, not from places[0] and not from its departure", async () => {
    useTrips({ "japon-2024": tripYaml(ARRIVES_SOMEWHERE_ELSE) });

    const summary = only(await listTripSummaries());
    const detail = await findTrip("japon-2024");

    // The fixture is only worth anything if the three readings really differ.
    expect(detail?.places[0]?.slug).toBe("kyoto");
    expect(summary.firstArrival.slug).toBe("tokyo");
    expect(summary.firstArrival.name).toBe("Tokyo");
    expect(summary.firstArrival.coordinates).toEqual({ lat: 35.6762, lon: 139.6503 });
  });

  it("carries the derived duration and countries on the summary", async () => {
    useTrips({ "japon-2024": tripYaml() });

    const summary = only(await listTripSummaries());

    expect(summary.slug).toBe("japon-2024");
    expect(summary.title).toBe("Japon, printemps 2024");
    expect(summary.startDate).toBe("2024-04-12");
    expect(summary.endDate).toBe("2024-04-16");
    expect(summary.duration).toEqual({ nights: 4, days: 5 });
    expect(summary.countryCodes).toEqual(["JP"]);
  });

  /**
   * The list page never needs the itinerary, the photos or the budget, and the
   * summary deliberately does not carry `draft` either: in production it would
   * always be `false`, which is a field whose only possible use is to mislead
   * whoever reads it.
   */
  it("leaves steps, photos, budget and draft off the summary", async () => {
    useTrips({ "japon-2024": tripYaml({ draft: "draft: false" }) });

    const summary = only(await listTripSummaries());

    expect(summary).not.toHaveProperty("steps");
    expect(summary).not.toHaveProperty("photos");
    expect(summary).not.toHaveProperty("budget");
    expect(summary).not.toHaveProperty("budgetPerPerson");
    expect(summary).not.toHaveProperty("draft");
  });

  /**
   * **And the detail is free of `draft` too**, which the summary test above does
   * not imply: `detailOf` adds five fields to the summary and could add a sixth.
   * The docblock on both projections promises "neither of them carries `draft`",
   * and only half of that was asserted.
   *
   * Read on a trip that really is a draft, in the environment that really serves
   * one — a `draft: false` fixture would pass against a projection that copied the
   * field faithfully, which is the version of this bug that ships.
   */
  it("leaves draft off the detail as well, for a trip that is one", async () => {
    useTrips({ "japon-2024": tripYaml({ draft: "draft: true" }) });
    vi.stubEnv("NODE_ENV", "development");

    const detail = await findTrip("japon-2024");

    expect(detail).toBeDefined();
    expect(detail).not.toHaveProperty("draft");
    expect(Object.keys(detail ?? {})).not.toContain("draft");
  });

  it("carries the itinerary, the photos and both budget readings on the detail", async () => {
    useTrips({
      "japon-2024": tripYaml({
        photos: [
          "photos:",
          "  - src: /photos/japon-2024/tokyo.jpg",
          "    alt: Une ruelle de Shinjuku sous la pluie",
          "    width: 1600",
          "    height: 1067",
        ].join("\n"),
        coverPhotoSrc: "coverPhotoSrc: /photos/japon-2024/tokyo.jpg",
        budget: ["budget:", "  totalCents: 420000", "  currency: EUR", "  travellers: 2"].join(
          "\n"
        ),
      }),
    });

    const detail = await findTrip("japon-2024");

    expect(detail?.places.map((place) => place.slug)).toEqual(["tokyo", "kyoto"]);
    expect(detail?.steps.map((step) => step.kind)).toEqual(["stay", "move"]);
    expect(detail?.photos.map((photo) => photo.src)).toEqual(["/photos/japon-2024/tokyo.jpg"]);
    expect(detail?.coverPhotoSrc).toBe("/photos/japon-2024/tokyo.jpg");
    expect(detail?.budget).toEqual({ totalCents: 420000, currency: "EUR", travellers: 2 });
    expect(detail?.budgetPerPerson).toEqual({ amountCents: 210000, currency: "EUR" });
  });

  /**
   * Null, not zero, and not an absent key: "no budget recorded" and "cost
   * nothing" are different statements and the trip page renders them
   * differently.
   */
  it("reports a null per-person budget for a trip that records none", async () => {
    useTrips({ "japon-2024": tripYaml() });

    const detail = await findTrip("japon-2024");

    expect(detail?.budget).toBeUndefined();
    expect(detail?.budgetPerPerson).toBeNull();
  });

  /** The detail is a superset of the summary: the trip page needs both halves. */
  it("carries every summary field on the detail as well", async () => {
    useTrips({ "japon-2024": tripYaml() });

    const summary = only(await listTripSummaries());
    const detail = await findTrip("japon-2024");

    expect(detail).toMatchObject({
      slug: summary.slug,
      title: summary.title,
      startDate: summary.startDate,
      endDate: summary.endDate,
      duration: summary.duration,
      countryCodes: summary.countryCodes,
      firstArrival: summary.firstArrival,
      tags: summary.tags,
    });
  });
});

/* ------------------------------------------------------------------ defaults -- */

describe("the content root", () => {
  /**
   * `TIW_CONTENT_DIR` when it is set and **not blank**, `content/trips`
   * otherwise. The *empty* variable is the first trap: it is "set" as far as
   * `!== undefined` and `??` are concerned, so the natural
   * `process.env.TIW_CONTENT_DIR ?? fallback` resolves the content root to `""`
   * and reads a directory that is not the one anybody meant.
   *
   * The **blank** variable is the second, and it is a divergence rather than a
   * mistake: `content/README.md` documents this variable, so it is a published
   * interface, and `scripts/validate-content.ts` reads it through a
   * `fromEnvironment` that treats `value.trim() === ""` as unset. A façade testing
   * `=== ""` instead gave the same variable two contracts — `TIW_CONTENT_DIR=" "`
   * had the command validate `content/trips` while the build read `<cwd>/ `. One
   * command and one build must never read two different collections, so the third
   * case below is the one that pins the alignment.
   */
  it.each([
    {
      label: "absent",
      apply: (): void => {
        vi.stubEnv("TIW_CONTENT_DIR", undefined);
      },
    },
    {
      label: "set to the empty string",
      apply: (): void => {
        vi.stubEnv("TIW_CONTENT_DIR", "");
      },
    },
    {
      label: "set to blanks only, exactly as the CLI reads it",
      apply: (): void => {
        vi.stubEnv("TIW_CONTENT_DIR", " ");
      },
    },
  ])(
    "reads content/trips when TIW_CONTENT_DIR is $label, exactly as an explicit path to it would",
    async ({ apply }) => {
      vi.stubEnv("TIW_CONTENT_DIR", path.join(process.cwd(), "content", "trips"));
      const explicit = await tripStaticParams();

      apply();
      const byDefault = await tripStaticParams();

      // Compared against the explicit read rather than against `[]`, so this stays
      // true once TIW-24 lands the real trips. A façade resolving the empty string
      // to `path.join("")` reads the working directory instead — where every
      // sub-directory lacks a `trip.yaml`, so it rejects and this fails loudly.
      expect(byDefault).toEqual(explicit);
    }
  );

  /**
   * A directory that does not exist is not an empty collection. Answering "no
   * trips" for a mistyped path is how a deployment ships an empty site with a
   * green build — the failure mode this project has a whole test suite about.
   */
  it("refuses a content directory that does not exist rather than answering empty", async () => {
    const created = useTrips({});
    vi.stubEnv("TIW_CONTENT_DIR", path.join(created.contentDir, "nulle-part"));

    const message = await rejection(loadTrips());

    expect(message).toContain("nulle-part");
  });
});
