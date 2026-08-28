import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  geocodeTrip,
  interpretAnswer,
  TEMPORARY_FILE_GLOB,
  TEMPORARY_MARKER,
  TEMPORARY_SUFFIX,
} from "@/content/geocode";
import type { Ambiguity, Choice, GeocodeEvent } from "@/content/geocode";
import type { GeocodingCandidate, GeocodingClient, SearchResult } from "@/content/geocoding";
import { temporaryContent, tripYaml } from "./support";
import type { TemporaryContent } from "./support";

/**
 * The core of `npm run geocode`, without a process and without a socket.
 *
 * The HTTP client and the way an ambiguity is answered are both parameters, so
 * every case here is deterministic and offline (constraint B). What is asserted
 * is the two things that decide whether this command is trustworthy: **what it
 * writes to the file**, and **what it refuses to write**.
 */

const KYOTO_JP: GeocodingCandidate = {
  name: "Kyōto",
  latitude: 35.02107,
  longitude: 135.75385,
  country_code: "JP",
  country: "Japon",
  admin1: "Préfecture de Kyoto",
  population: 1463723,
  feature_code: "PPLA",
};

/** The 8 000 km mistake `results[0]` would make on its own. */
const KYOTO_TZ: GeocodingCandidate = {
  name: "Kyoto",
  latitude: -2.05,
  longitude: 31.68333,
  country_code: "TZ",
  country: "Tanzanie",
  admin1: "Kagera",
  feature_code: "PPL",
};

const TOKYO_JP: GeocodingCandidate = {
  name: "Tokyo",
  latitude: 35.6895,
  longitude: 139.69171,
  country_code: "JP",
  country: "Japon",
  admin1: "Tokyo",
  population: 8336599,
  feature_code: "PPLC",
};

type Searches = {
  readonly search: GeocodingClient;
  readonly queries: readonly string[];
  readonly maxInFlight: () => number;
};

function scriptedSearch(answers: Readonly<Record<string, SearchResult>>): Searches {
  const queries: string[] = [];
  let inFlight = 0;
  let peak = 0;

  return {
    queries,
    maxInFlight: () => peak,
    search: async (name) => {
      queries.push(name);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;

      return answers[name] ?? { state: "no-match" };
    },
  };
}

type Choices = {
  readonly choose: (ambiguity: Ambiguity) => Promise<Choice>;
  readonly asked: readonly Ambiguity[];
};

/** Answers ambiguities in order, the way `--pick <n>` does. */
function picking(...ranks: readonly number[]): Choices {
  const asked: Ambiguity[] = [];
  let next = 0;

  return {
    asked,
    choose: async (ambiguity) => {
      asked.push(ambiguity);
      const rank = ranks[next];
      next += 1;

      return rank === undefined
        ? { state: "unanswered", reason: "aucun choix fourni" }
        : { state: "picked", rank };
    },
  };
}

let workspace: TemporaryContent | undefined;

afterEach(() => {
  workspace?.cleanup();
  workspace = undefined;
});

type RunOptions = {
  readonly yaml: string;
  readonly answers?: Readonly<Record<string, SearchResult>>;
  readonly ranks?: readonly number[];
  readonly slug?: string;
};

async function run(options: RunOptions) {
  workspace = temporaryContent({ "japon-2024": options.yaml });
  const searches = scriptedSearch(options.answers ?? {});
  const choices = picking(...(options.ranks ?? []));
  const events: GeocodeEvent[] = [];

  const outcome = await geocodeTrip({
    contentDir: workspace.contentDir,
    repoRoot: workspace.repoRoot,
    slug: options.slug ?? "japon-2024",
    search: searches.search,
    choose: choices.choose,
    onEvent: (event) => events.push(event),
  });

  const file = path.join(workspace.contentDir, "japon-2024", "trip.yaml");

  return {
    outcome,
    events,
    searches,
    choices,
    file,
    text: () => readFileSync(file, "utf8"),
    mtimeMs: () => statSync(file).mtimeMs,
  };
}

/** The reference trip with Kyoto's coordinates removed — the file to repair. */
const KYOTO_WITHOUT_COORDINATES = tripYaml({
  places: [
    "places:",
    "  - slug: tokyo",
    "    name: Tokyo",
    "    countryCode: JP",
    "    coordinates:",
    "      lat: 35.6762",
    "      lon: 139.6503",
    "  - slug: kyoto",
    "    name: Kyoto",
    "    countryCode: JP",
  ].join("\n"),
});

describe("a single unambiguous city (criterion 1)", () => {
  it("writes the coordinates into the file", async () => {
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [KYOTO_JP] } },
    });

    expect(result.outcome).toMatchObject({ state: "done", resolved: 1, failed: 0, written: true });
    expect(result.text()).toContain("      lat: 35.02107");
    expect(result.text()).toContain("      lon: 135.75385");
  });

  it("asks nothing when there is only one candidate", async () => {
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [KYOTO_JP] } },
    });

    expect(result.choices.asked).toHaveLength(0);
  });

  it("makes exactly one request, and only for the city that needs it", async () => {
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [KYOTO_JP] } },
    });

    expect(result.searches.queries).toEqual(["Kyoto"]);
  });
});

describe("an ambiguous city (criterion 2)", () => {
  const answers = { Kyoto: { state: "candidates", candidates: [KYOTO_JP, KYOTO_TZ] } } as const;

  it("asks for a numbered choice instead of taking results[0]", async () => {
    const result = await run({ yaml: KYOTO_WITHOUT_COORDINATES, answers, ranks: [1] });

    expect(result.choices.asked).toHaveLength(1);
    expect(result.choices.asked[0]?.candidates).toEqual([KYOTO_JP, KYOTO_TZ]);
    expect(result.choices.asked[0]?.place.name).toBe("Kyoto");
  });

  it("writes the candidate that was picked, not the first one", async () => {
    // Rank 2 is the Tanzanian homonym; the country cross-check refuses it, which
    // is the proof that the pick is honoured rather than silently replaced.
    const result = await run({ yaml: KYOTO_WITHOUT_COORDINATES, answers, ranks: [2] });

    expect(result.outcome).toMatchObject({ state: "done", resolved: 0, failed: 1, written: false });
  });

  it("leaves the file intact when no choice is given", async () => {
    const before = KYOTO_WITHOUT_COORDINATES;
    const result = await run({ yaml: before, answers, ranks: [] });

    expect(result.outcome).toMatchObject({ state: "done", resolved: 0, failed: 1, written: false });
    expect(result.text()).toBe(before);
    expect(
      result.events.some(
        (event) => event.kind === "unresolved" && event.reason.state === "no-choice"
      )
    ).toBe(true);
  });

  it("refuses a rank outside the list rather than wrapping round", async () => {
    const result = await run({ yaml: KYOTO_WITHOUT_COORDINATES, answers, ranks: [3] });

    expect(result.outcome).toMatchObject({ failed: 1, written: false });
  });

  it("announces the ambiguity before asking, with every candidate", async () => {
    const result = await run({ yaml: KYOTO_WITHOUT_COORDINATES, answers, ranks: [1] });
    const announced = result.events.find((event) => event.kind === "ambiguous");

    expect(announced).toBeDefined();
    if (announced?.kind !== "ambiguous") return;
    expect(announced.candidates).toHaveLength(2);
  });
});

describe("the country cross-check (criterion 3)", () => {
  it("refuses a candidate whose country contradicts the content", async () => {
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [KYOTO_TZ] } },
    });

    expect(result.outcome).toMatchObject({ resolved: 0, failed: 1, written: false });
    const refusal = result.events.find(
      (event) => event.kind === "unresolved" && event.reason.state === "country-mismatch"
    );
    expect(refusal).toBeDefined();
    if (refusal?.kind !== "unresolved" || refusal.reason.state !== "country-mismatch") return;
    expect(refusal.reason.declared).toBe("JP");
    expect(refusal.reason.returned).toBe("TZ");
  });

  it("leaves the file byte-identical when the country diverges", async () => {
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [KYOTO_TZ] } },
    });

    expect(result.text()).toBe(KYOTO_WITHOUT_COORDINATES);
  });

  it("refuses to resolve a place with no usable country code, rather than skipping the check", async () => {
    const yaml = tripYaml({
      places: [
        "places:",
        "  - slug: tokyo",
        "    name: Tokyo",
        "    countryCode: JP",
        "    coordinates:",
        "      lat: 35.6762",
        "      lon: 139.6503",
        "  - slug: kyoto",
        "    name: Kyoto",
        "    countryCode: japon",
      ].join("\n"),
    });
    const result = await run({
      yaml,
      answers: { Kyoto: { state: "candidates", candidates: [KYOTO_JP] } },
    });

    expect(result.outcome).toMatchObject({ resolved: 0, failed: 1, written: false });
    expect(
      result.events.some(
        (event) => event.kind === "unresolved" && event.reason.state === "no-country-code"
      )
    ).toBe(true);
  });
});

describe("coordinates at (0, 0) (criterion 4)", () => {
  it("refuses a candidate the service places on Null Island", async () => {
    const nowhere: GeocodingCandidate = { ...KYOTO_JP, latitude: 0, longitude: 0 };
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [nowhere] } },
    });

    expect(result.outcome).toMatchObject({ resolved: 0, failed: 1, written: false });
    expect(
      result.events.some(
        (event) => event.kind === "unresolved" && event.reason.state === "rejected-coordinates"
      )
    ).toBe(true);
  });

  it("refuses a latitude outside the globe as well", async () => {
    const impossible: GeocodingCandidate = { ...KYOTO_JP, latitude: 935.02 };
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [impossible] } },
    });

    expect(result.outcome).toMatchObject({ failed: 1, written: false });
  });

  it("treats a place already written at (0, 0) as one to resolve", async () => {
    const yaml = tripYaml({
      places: [
        "places:",
        "  - slug: tokyo",
        "    name: Tokyo",
        "    countryCode: JP",
        "    coordinates:",
        "      lat: 35.6762",
        "      lon: 139.6503",
        "  - slug: kyoto",
        "    name: Kyoto",
        "    countryCode: JP",
        "    coordinates:",
        "      lat: 0",
        "      lon: 0",
      ].join("\n"),
    });
    const result = await run({
      yaml,
      answers: { Kyoto: { state: "candidates", candidates: [KYOTO_JP] } },
    });

    expect(result.searches.queries).toEqual(["Kyoto"]);
    expect(result.text()).toContain("lat: 35.02107");
  });
});

describe("a city the service does not know (criterion 5)", () => {
  const yaml = tripYaml({
    places: [
      "places:",
      "  - slug: tokyo",
      "    name: Tokyo",
      "    countryCode: JP",
      "  - slug: kyoto",
      "    name: Kyoto",
      "    countryCode: JP",
    ].join("\n"),
  });

  it("reports it, and still resolves the other cities", async () => {
    const result = await run({
      yaml,
      answers: {
        Tokyo: { state: "no-match" },
        Kyoto: { state: "candidates", candidates: [KYOTO_JP] },
      },
    });

    expect(result.outcome).toMatchObject({ state: "done", resolved: 1, failed: 1, written: true });
    expect(result.searches.queries).toEqual(["Tokyo", "Kyoto"]);
    expect(result.text()).toContain("lat: 35.02107");
    expect(
      result.events.some(
        (event) => event.kind === "unresolved" && event.reason.state === "no-match"
      )
    ).toBe(true);
  });

  it("leaves the unresolved city exactly as it was", async () => {
    const result = await run({
      yaml,
      answers: {
        Tokyo: { state: "no-match" },
        Kyoto: { state: "candidates", candidates: [KYOTO_JP] },
      },
    });
    const tokyoBlock = result
      .text()
      .split("\n")
      .slice(
        result.text().split("\n").indexOf("  - slug: tokyo"),
        result.text().split("\n").indexOf("  - slug: kyoto")
      );

    expect(tokyoBlock).toEqual(["  - slug: tokyo", "    name: Tokyo", "    countryCode: JP"]);
  });

  it("writes nothing at all when no city could be resolved", async () => {
    const result = await run({ yaml, answers: {} });

    expect(result.outcome).toMatchObject({ resolved: 0, failed: 2, written: false });
    expect(result.text()).toBe(yaml);
  });
});

describe("the file is the only place coordinates live (criterion 6)", () => {
  it("writes them to disk, so the site never calls the service", async () => {
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [KYOTO_JP] } },
    });
    const reparsed = await import("yaml").then((yaml) => yaml.parse(result.text()));
    const places = (reparsed as { places: { coordinates?: { lat: number; lon: number } }[] })
      .places;

    expect(places[1]?.coordinates).toEqual({ lat: 35.02107, lon: 135.75385 });
  });
});

describe("every way the service can fail (constraint E)", () => {
  const failures: readonly SearchResult[] = [
    { state: "timeout", timeoutMs: 10_000 },
    { state: "unreachable", reason: "fetch failed" },
    { state: "http-error", status: 429 },
    { state: "http-error", status: 500 },
    { state: "malformed", reason: "Unexpected token <" },
  ];

  for (const failure of failures) {
    it(`leaves the file intact on ${failure.state} ${"status" in failure ? failure.status : ""}`, async () => {
      const result = await run({ yaml: KYOTO_WITHOUT_COORDINATES, answers: { Kyoto: failure } });

      expect(result.outcome).toMatchObject({ resolved: 0, failed: 1, written: false });
      expect(result.text()).toBe(KYOTO_WITHOUT_COORDINATES);
      expect(
        result.events.some(
          (event) => event.kind === "unresolved" && event.reason.state === "service"
        )
      ).toBe(true);
    });
  }
});

describe("idempotence (constraint F)", () => {
  it("does nothing on a trip that is already complete", async () => {
    const complete = tripYaml();
    const result = await run({ yaml: complete, answers: {} });

    expect(result.outcome).toMatchObject({ state: "done", pending: 0, written: false });
    expect(result.searches.queries).toEqual([]);
    expect(result.text()).toBe(complete);
  });

  it("does not touch the file's timestamp", async () => {
    workspace = temporaryContent({ "japon-2024": tripYaml() });
    const file = path.join(workspace.contentDir, "japon-2024", "trip.yaml");
    const before = statSync(file);

    await geocodeTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
      search: async () => ({ state: "no-match" }),
      choose: async () => ({ state: "unanswered", reason: "jamais demandé" }),
    });

    const after = statSync(file);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
  });

  it("is a no-op the second time round", async () => {
    const first = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [KYOTO_JP] } },
    });
    const written = first.text();
    const stamp = first.mtimeMs();

    const second = await geocodeTrip({
      contentDir: workspace?.contentDir ?? "",
      repoRoot: workspace?.repoRoot ?? "",
      slug: "japon-2024",
      search: async () => {
        throw new Error("the service must not be called on a complete trip");
      },
      choose: async () => ({ state: "unanswered", reason: "jamais demandé" }),
    });

    expect(second).toMatchObject({ state: "done", pending: 0, written: false });
    expect(first.text()).toBe(written);
    expect(first.mtimeMs()).toBe(stamp);
  });
});

describe("being frugal with a free public service (constraint D)", () => {
  it("never has more than two requests in flight", async () => {
    const yaml = tripYaml({
      places: [
        "places:",
        "  - slug: tokyo",
        "    name: Tokyo",
        "    countryCode: JP",
        "  - slug: kyoto",
        "    name: Kyoto",
        "    countryCode: JP",
      ].join("\n"),
    });
    const result = await run({
      yaml,
      answers: {
        Tokyo: { state: "candidates", candidates: [TOKYO_JP] },
        Kyoto: { state: "candidates", candidates: [KYOTO_JP] },
      },
    });

    expect(result.searches.maxInFlight()).toBeLessThanOrEqual(2);
    expect(result.searches.queries).toEqual(["Tokyo", "Kyoto"]);
  });

  it("asks once per city, never twice for the same name", async () => {
    const yaml = tripYaml({
      places: [
        "places:",
        "  - slug: tokyo",
        "    name: Tokyo",
        "    countryCode: JP",
        "  - slug: kyoto",
        "    name: Kyoto",
        "    countryCode: JP",
      ].join("\n"),
    });
    const result = await run({ yaml, answers: {} });

    expect(result.searches.queries).toHaveLength(2);
  });
});

describe("the trip has to exist first", () => {
  it("reports a slug that names no trip, and lists what there is", async () => {
    const result = await run({ yaml: tripYaml(), slug: "perou-2023" });

    expect(result.outcome).toMatchObject({ state: "trip-not-found", slug: "perou-2023" });
    if (result.outcome.state !== "trip-not-found") return;
    expect(result.outcome.available).toEqual(["japon-2024"]);
  });

  it("refuses to guess on a file whose YAML does not parse", async () => {
    const result = await run({ yaml: "slug: a\n\ttitle: b\n" });

    expect(result.outcome.state).toBe("trip-malformed");
  });

  it("reports a content directory that is not there", async () => {
    const outcome = await geocodeTrip({
      contentDir: path.join(process.cwd(), "tests/fixtures/content/nowhere/trips"),
      repoRoot: process.cwd(),
      slug: "japon-2024",
      search: async () => ({ state: "no-match" }),
      choose: async () => ({ state: "unanswered", reason: "" }),
    });

    expect(outcome.state).toBe("content-dir-missing");
  });

  it("accepts the slug declared inside the file when it differs from the folder", async () => {
    workspace = temporaryContent({ "dossier-renomme": KYOTO_WITHOUT_COORDINATES });
    const outcome = await geocodeTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
      search: async () => ({ state: "candidates", candidates: [KYOTO_JP] }),
      choose: async () => ({ state: "unanswered", reason: "" }),
    });

    expect(outcome).toMatchObject({ state: "done", resolved: 1 });
  });
});

describe("a place the command cannot work with", () => {
  it("reports a place with no name rather than searching for an empty string", async () => {
    const yaml = tripYaml({
      places: [
        "places:",
        "  - slug: tokyo",
        "    name: Tokyo",
        "    countryCode: JP",
        "    coordinates:",
        "      lat: 35.6762",
        "      lon: 139.6503",
        "  - slug: kyoto",
        "    countryCode: JP",
      ].join("\n"),
    });
    const result = await run({ yaml });

    expect(result.searches.queries).toEqual([]);
    expect(result.outcome).toMatchObject({ failed: 1, written: false });
    expect(
      result.events.some((event) => event.kind === "unresolved" && event.reason.state === "no-name")
    ).toBe(true);
  });

  it("reports a trip that declares no place at all", async () => {
    const result = await run({ yaml: "slug: japon-2024\ntitle: Japon\n" });

    expect(result.outcome.state).toBe("no-places");
  });
});

describe("reading what the author typed at the prompt", () => {
  it("takes a number in range", () => {
    expect(interpretAnswer("2", 5)).toEqual({ state: "picked", rank: 2 });
    expect(interpretAnswer("  5  ", 5)).toEqual({ state: "picked", rank: 5 });
  });

  it("takes « q » as giving up, in either case", () => {
    expect(interpretAnswer("q", 5)).toEqual({ state: "abandon" });
    expect(interpretAnswer("Q", 5)).toEqual({ state: "abandon" });
  });

  it("asks again on a typo rather than throwing away the request", () => {
    for (const typo of ["", "x", "1x", "deux", "-1", "0", "6", "2.5", "1e1"]) {
      expect(interpretAnswer(typo, 5)).toEqual({ state: "retry" });
    }
  });

  it("never accepts a rank the list does not have", () => {
    expect(interpretAnswer("2", 1)).toEqual({ state: "retry" });
  });
});

describe("a save made by the author while the prompt was waiting", () => {
  /**
   * The prompt blocks on a human for an unbounded time — he compares two Kyotos,
   * goes to look at a map, has lunch. `trip.source` is read before the first
   * request and written after the last answer, so anything he saved in between
   * used to be overwritten in silence, exit 0, "fichier réécrit".
   *
   * The window is the whole interactive run, which is exactly why the check
   * cannot be a read-time fingerprint alone: it has to happen just before the
   * write.
   */
  it("is not overwritten: the run refuses and says so", async () => {
    workspace = temporaryContent({ "japon-2024": KYOTO_WITHOUT_COORDINATES });
    const file = path.join(workspace.contentDir, "japon-2024", "trip.yaml");

    // What the author saved during the prompt: a new title and a third city.
    const savedByHand = KYOTO_WITHOUT_COORDINATES.replace(
      "title: Japon, printemps 2024",
      "title: Japon, printemps 2024 — corrigé à la main"
    );

    const outcome = await geocodeTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
      search: async () => ({ state: "candidates", candidates: [KYOTO_JP, KYOTO_TZ] }),
      choose: async () => {
        writeFileSync(file, savedByHand, "utf8");
        return { state: "picked", rank: 1 };
      },
    });

    expect(outcome.state).toBe("file-changed");
    // Not one byte of his work is gone.
    expect(readFileSync(file, "utf8")).toBe(savedByHand);
  });

  it("still writes when nothing changed under it", async () => {
    workspace = temporaryContent({ "japon-2024": KYOTO_WITHOUT_COORDINATES });
    const outcome = await geocodeTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
      search: async () => ({ state: "candidates", candidates: [KYOTO_JP] }),
      choose: async () => ({ state: "unanswered", reason: "" }),
    });

    expect(outcome).toMatchObject({ state: "done", resolved: 1, written: true });
  });

  it("leaves no temporary file behind", async () => {
    workspace = temporaryContent({ "japon-2024": KYOTO_WITHOUT_COORDINATES });
    await geocodeTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
      search: async () => ({ state: "candidates", candidates: [KYOTO_JP] }),
      choose: async () => ({ state: "unanswered", reason: "" }),
    });

    const { readdirSync } = await import("node:fs");
    expect(readdirSync(path.join(workspace.contentDir, "japon-2024"))).toEqual(["trip.yaml"]);
  });

  /**
   * A run killed between the write and the rename leaves one temporary behind,
   * and it must not then show up as an untracked file in the trip's folder.
   *
   * Asked of **git**, not of the text of `.gitignore`: a pattern can be present
   * in the file and not apply — negated later, scoped to a directory, or simply
   * not matching a name that starts with a dot. `git check-ignore -v` answers
   * the only question that matters and names the line it answered from, so the
   * assertion covers the entry *and* the fact that it bites. Same doctrine as
   * the two executable guards in AGENTS.md: prove it on the real artefact.
   */
  it("is a name git actually ignores, not just a pattern sitting in .gitignore", () => {
    // Built from the module's own constants, so a renamed temporary breaks this
    // test rather than quietly escaping the pattern.
    const temporaryName = `.trip.yaml${TEMPORARY_MARKER}${process.pid}${TEMPORARY_SUFFIX}`;
    const candidate = `content/trips/japon-2024/${temporaryName}`;

    const asked = spawnSync("git", ["check-ignore", "-v", "--no-index", "--", candidate], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(asked.status).toBe(0);
    expect(asked.stdout).toContain(".gitignore:");
    expect(asked.stdout).toContain(TEMPORARY_FILE_GLOB);
    expect(asked.stdout).toContain(temporaryName);
  });
});

/**
 * Defect measured on a `trip.yaml` saved in latin-1 (`title: Café`, byte 0xE9).
 *
 * Both sides of the anti-clobber guard used to be decoded with `"utf8"`: the
 * source the edit was computed from, and the read-back it was compared against.
 * The same destructive decoding on both sides meant the guard could not
 * structurally see the difference — so the rename wrote U+FFFD over the author's
 * bytes, exit 0, "1 ville géocodée sur 1, fichier réécrit", and
 * `validate:content` stayed green because U+FFFD is a perfectly valid string.
 */
describe("a trip.yaml this command cannot decode", () => {
  const LATIN1_TRIP = [
    "slug: japon-2024",
    "title: Café, printemps 2024",
    "places:",
    "  - slug: kyoto",
    "    name: Kyoto",
    "    countryCode: JP",
    "",
  ].join("\n");

  function withLatin1Trip(): { readonly file: string; readonly bytes: Buffer } {
    workspace = temporaryContent({});
    const directory = path.join(workspace.contentDir, "japon-2024");
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "trip.yaml");
    const bytes = Buffer.from(LATIN1_TRIP, "latin1");
    writeFileSync(file, bytes);

    return { file, bytes };
  }

  async function geocodeIt() {
    return geocodeTrip({
      contentDir: workspace?.contentDir ?? "",
      repoRoot: workspace?.repoRoot ?? "",
      slug: "japon-2024",
      search: async () => ({ state: "candidates", candidates: [KYOTO_JP] }),
      choose: async () => ({ state: "unanswered", reason: "" }),
    });
  }

  it("refuses instead of writing replacement characters over the author's bytes", async () => {
    const { bytes, file } = withLatin1Trip();

    const outcome = await geocodeIt();

    expect(outcome.state).toBe("file-not-utf8");
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  it("says how much work has to be redone once the file is converted", async () => {
    withLatin1Trip();

    expect(await geocodeIt()).toMatchObject({ state: "file-not-utf8", resolved: 1 });
  });

  it("does not confuse it with a save made under the command", async () => {
    withLatin1Trip();
    const outcome = await geocodeIt();

    expect(outcome.state).not.toBe("file-changed");
  });
});

/**
 * Criterion 5, verbatim: "traite tout de même les autres villes". It used to
 * hold for network failures only — `writeCoordinates` is all-or-nothing, so a
 * single place written `{ latitude: … }` threw away every coordinate the run had
 * resolved, **and** gave each innocent city a failure line quoting the other
 * place's problem.
 */
describe("one place in a shape the edit cannot handle", () => {
  const OSAKA_JP: GeocodingCandidate = {
    ...TOKYO_JP,
    name: "Osaka",
    latitude: 34.69374,
    longitude: 135.50218,
  };
  const NARA_JP: GeocodingCandidate = {
    ...TOKYO_JP,
    name: "Nara",
    latitude: 34.685,
    longitude: 135.805,
  };

  const answers = {
    Tokyo: { state: "candidates", candidates: [TOKYO_JP] },
    Osaka: { state: "candidates", candidates: [OSAKA_JP] },
    Nara: { state: "candidates", candidates: [NARA_JP] },
  } as const;

  const withOneBadPlace = tripYaml({
    places: [
      "places:",
      "  - slug: tokyo",
      "    name: Tokyo",
      "    countryCode: JP",
      "  - slug: osaka",
      "    name: Osaka",
      "    countryCode: JP",
      "  - slug: nara",
      "    name: Nara",
      "    countryCode: JP",
      "    coordinates: { latitude: 34.685, longitude: 135.805 }",
    ].join("\n"),
    steps: "",
  });

  it("writes the cities it can, instead of throwing away three resolutions", async () => {
    const result = await run({ yaml: withOneBadPlace, answers });

    expect(result.outcome).toMatchObject({ state: "done", resolved: 2, failed: 1, written: true });
    expect(result.text()).toContain("lat: 35.6895");
    expect(result.text()).toContain("lat: 34.69374");
    expect(result.text()).toContain("coordinates: { latitude: 34.685, longitude: 135.805 }");
  });

  it("blames only the place at fault, never the two that resolved", async () => {
    const result = await run({ yaml: withOneBadPlace, answers });
    const blamed = result.events
      .filter((event) => event.kind === "unresolved")
      .map((event) => (event.kind === "unresolved" ? event.place.index : -1));

    expect(blamed).toEqual([2]);
  });

  it("terminates and reports each faulty place with its own reason", async () => {
    const withTwoBadPlaces = tripYaml({
      places: [
        "places:",
        "  - slug: tokyo",
        "    name: Tokyo",
        "    countryCode: JP",
        "  - slug: osaka",
        "    name: Osaka",
        "    countryCode: JP",
        "    coordinates: 42",
        "  - slug: nara",
        "    name: Nara",
        "    countryCode: JP",
        "    coordinates: { latitude: 34.685 }",
      ].join("\n"),
      steps: "",
    });
    const result = await run({ yaml: withTwoBadPlaces, answers });
    const blamed = result.events.filter((event) => event.kind === "unresolved");

    expect(result.outcome).toMatchObject({ state: "done", resolved: 1, failed: 2, written: true });
    expect(blamed.map((event) => (event.kind === "unresolved" ? event.place.index : -1))).toEqual([
      1, 2,
    ]);
    expect(
      blamed.every(
        (event) => event.kind === "unresolved" && event.reason.state === "unsupported-yaml"
      )
    ).toBe(true);
    // Each sentence describes *its own* place: `42` belongs to Osaka only.
    const osaka = blamed[0];
    const nara = blamed[1];
    if (osaka?.kind !== "unresolved" || osaka.reason.state !== "unsupported-yaml") return;
    if (nara?.kind !== "unresolved" || nara.reason.state !== "unsupported-yaml") return;
    expect(osaka.reason.reason).toContain("42");
    expect(nara.reason.reason).toContain("latitude");
    expect(nara.reason.reason).not.toContain("42");
  });
});

/**
 * `lat: 1e-8, lon: -1e-8` is not (0, 0) to `CoordinatesSchema` and *is* (0, 0)
 * once rounded to the seven decimals the file holds. The command used to write
 * it, exit 0 — and `validate:content` then refused the file and told the author
 * to run the very command that had produced it. A loop with no way out.
 */
describe("a candidate that only becomes (0, 0) once written", () => {
  const TINY: GeocodingCandidate = { ...KYOTO_JP, latitude: 1e-8, longitude: -1e-8 };

  it("is refused, and the file is left exactly as it was", async () => {
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [TINY] } },
    });

    expect(result.outcome).toMatchObject({ resolved: 0, failed: 1, written: false });
    expect(result.text()).toBe(KYOTO_WITHOUT_COORDINATES);
    expect(
      result.events.some(
        (event) => event.kind === "unresolved" && event.reason.state === "rejected-coordinates"
      )
    ).toBe(true);
  });

  it("does not leave the author with « relance geocode » as the only advice", async () => {
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [TINY] } },
    });

    // Not a rewrite the validator would then reject: nothing was written at all.
    expect(result.text()).not.toContain("lat: 0");
  });
});

/**
 * Following the symlink is deliberate and covered above — a `trip.yaml` linked
 * into a notes folder is a legitimate setup. What is not acceptable is naming
 * the link in the summary while the bytes land somewhere else entirely: a link
 * pointing out of `content/` is versioned by git like any other (mode 120000)
 * and recreated by `git clone`, target included.
 */
describe("a symlink whose target sits outside the content directory", () => {
  it("reports the file the bytes actually went to", async () => {
    workspace = temporaryContent({});
    const tripDir = path.join(workspace.contentDir, "japon-2024");
    const elsewhere = path.join(workspace.root, "hors-contenu.yaml");
    mkdirSync(tripDir, { recursive: true });
    writeFileSync(elsewhere, KYOTO_WITHOUT_COORDINATES, "utf8");
    symlinkSync(elsewhere, path.join(tripDir, "trip.yaml"));

    const outcome = await geocodeTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
      search: async () => ({ state: "candidates", candidates: [KYOTO_JP] }),
      choose: async () => ({ state: "unanswered", reason: "" }),
    });

    expect(outcome).toMatchObject({ state: "done", written: true });
    if (outcome.state !== "done") return;
    expect(outcome.writtenTo).toContain("hors-contenu.yaml");
  });

  it("says nothing extra when the real file is inside the content directory", async () => {
    workspace = temporaryContent({});
    const tripDir = path.join(workspace.contentDir, "japon-2024");
    const inside = path.join(workspace.contentDir, "reel.yaml");
    mkdirSync(tripDir, { recursive: true });
    writeFileSync(inside, KYOTO_WITHOUT_COORDINATES, "utf8");
    symlinkSync(inside, path.join(tripDir, "trip.yaml"));

    const outcome = await geocodeTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
      search: async () => ({ state: "candidates", candidates: [KYOTO_JP] }),
      choose: async () => ({ state: "unanswered", reason: "" }),
    });

    expect(outcome).toMatchObject({ state: "done", written: true });
    if (outcome.state !== "done") return;
    expect(outcome.writtenTo).toBeUndefined();
  });
});

describe("the file the author actually keeps", () => {
  it("stays a symlink, and the real file behind it gets the content", async () => {
    workspace = temporaryContent({});
    const tripDir = path.join(workspace.contentDir, "japon-2024");
    const elsewhere = path.join(workspace.root, "ailleurs.yaml");
    mkdirSync(tripDir, { recursive: true });
    writeFileSync(elsewhere, KYOTO_WITHOUT_COORDINATES, "utf8");
    symlinkSync(elsewhere, path.join(tripDir, "trip.yaml"));

    const outcome = await geocodeTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
      search: async () => ({ state: "candidates", candidates: [KYOTO_JP] }),
      choose: async () => ({ state: "unanswered", reason: "" }),
    });

    expect(outcome).toMatchObject({ state: "done", resolved: 1, written: true });
    expect(lstatSync(path.join(tripDir, "trip.yaml")).isSymbolicLink()).toBe(true);
    expect(readFileSync(elsewhere, "utf8")).toContain("lat: 35.02107");
  });

  it("keeps the permissions it was given", async () => {
    workspace = temporaryContent({ "japon-2024": KYOTO_WITHOUT_COORDINATES });
    const file = path.join(workspace.contentDir, "japon-2024", "trip.yaml");
    chmodSync(file, 0o600);

    await geocodeTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
      search: async () => ({ state: "candidates", candidates: [KYOTO_JP] }),
      choose: async () => ({ state: "unanswered", reason: "" }),
    });

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe("the country cross-check does not turn on the provider's spelling", () => {
  it("accepts a lowercase country code from the service", async () => {
    const lowercased: GeocodingCandidate = { ...KYOTO_JP, country_code: "jp" };
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [lowercased] } },
    });

    expect(result.outcome).toMatchObject({ resolved: 1, written: true });
  });

  it("still refuses a genuinely different country, whatever the case", async () => {
    const lowercased: GeocodingCandidate = { ...KYOTO_TZ, country_code: "tz" };
    const result = await run({
      yaml: KYOTO_WITHOUT_COORDINATES,
      answers: { Kyoto: { state: "candidates", candidates: [lowercased] } },
    });

    expect(result.outcome).toMatchObject({ resolved: 0, failed: 1, written: false });
  });
});
