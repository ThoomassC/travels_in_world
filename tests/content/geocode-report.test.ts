import { describe, expect, it } from "vitest";
import type { GeocodeEvent, GeocodeOutcome, PlaceRef, UnresolvedReason } from "@/content/geocode";
import {
  formatCandidates,
  formatEvent,
  formatOutcome,
  formatPrompt,
} from "@/content/geocode-report";
import type { GeocodingCandidate, SearchFailure } from "@/content/geocoding";

/**
 * Every sentence `npm run geocode` says, tested without a process.
 *
 * `geocode-report.ts` exists so that the module which decides prints nothing and
 * the module which prints decides nothing — and the point of that split is
 * precisely this file: a wording is a pure function of a value, so it is asserted
 * by building the value, not by spawning a command and reading its stdout. The
 * only path that reached these functions before was `geocode-cli.test.ts`, which
 * spawns a process for each case and therefore covered two states of
 * `GeocodeOutcome` not at all.
 *
 * What is asserted is what the author of a trip needs from a line: **which file**
 * it is about, **whether that file was touched**, and **what to do next**. Not the
 * sentence character by character — a wording that gets improved must not turn a
 * suite red, or the wordings stop getting improved.
 *
 * The fixture tables below are typed as `Record<Union["state"], …>`, so the
 * compiler — not a reviewer's memory — is what forces a new outcome, event,
 * reason or service failure to be covered here the day it is added to
 * `geocode.ts`.
 */

const SLUG = "japon-2024";
const FILE = "content/trips/japon-2024/trip.yaml";
const CONTENT_DIR = "content/trips";

/**
 * Built from its code point rather than written as an escape in a regular
 * expression literal: `no-control-regex` refuses the literal form, and this
 * project does not carry `eslint-disable` comments. Same trick as
 * `report.test.ts`.
 */
const ESCAPE = String.fromCodePoint(27);

/**
 * What a hostile value looks like: clear the screen, home the cursor, then lie in
 * red on a second line. Woven into every free-form string of every fixture by the
 * `every*` builders, so the neutralisation is asserted on all branches at once
 * rather than on the one branch someone remembered.
 */
const POISON = `${ESCAPE}[2J${ESCAPE}[31mPWNED\u0000\ndeuxième ligne`;

/** Hex code points of every control character left raw in `text`. */
function controlCharacters(text: string): readonly string[] {
  return [...text]
    .map((character) => character.codePointAt(0) ?? 0)
    .filter(
      (codePoint) =>
        codePoint < 0x20 || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f)
    )
    .map((codePoint) => codePoint.toString(16));
}

/** `lines[index]`, as a string: `noUncheckedIndexedAccess` is on. */
const at = (lines: readonly string[], index: number): string => lines[index] ?? "";

/* ------------------------------------------------------------------ candidates -- */

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

/** The 8 000 km homonym, and the one candidate with no `population` key at all. */
const KYOTO_TZ: GeocodingCandidate = {
  name: "Kyoto",
  latitude: -2.05,
  longitude: 31.68333,
  country_code: "TZ",
  country: "Tanzanie",
  admin1: "Kagera",
  feature_code: "PPL",
};

/** A provider answer stripped to the fields the schema makes mandatory. */
const BARE: GeocodingCandidate = {
  name: "Ville sans pays",
  latitude: -33.5,
  longitude: 1e-7,
  country_code: "XX",
};

const TOKYO_JP: GeocodingCandidate = {
  name: "Tokyo",
  latitude: 35.6895,
  longitude: 139.69171,
  country_code: "JP",
  country: "Japon",
  admin1: "Tokyo",
  population: 8336599,
};

/** Null Island: the answer the domain refuses by name. */
const NULL_ISLAND: GeocodingCandidate = {
  name: "Zéro",
  latitude: 0,
  longitude: 0,
  country_code: "JP",
  country: "Japon",
};

/** The other way `CoordinatesSchema` refuses an answer: outside the bounds. */
const OFF_THE_GLOBE: GeocodingCandidate = {
  name: "Nulle part",
  latitude: 91,
  longitude: 12.5,
  country_code: "JP",
  country: "Japon",
};

/**
 * The shape of sentence `yaml-edit.ts` hands over: written by us, longer than the
 * 80-code-point bound meant for third-party values, and carrying its correction
 * after the arrow. Whether that correction survives the printing is the whole
 * point of the `unsupported-yaml` case below.
 */
const UNSUPPORTED_YAML_REASON =
  "« coordinates » porte « latitude » — les seules clés acceptées sont lat et lon → " +
  "corrige l'orthographe à la main, puis relance";

/** What Zod says about Null Island, in English — the schema's voice, not ours. */
const NULL_ISLAND_MESSAGE =
  "Coordinates (0, 0) are the signature of a failed geocoding, not a place on earth.";

function tainted(candidate: GeocodingCandidate, poison: string): GeocodingCandidate {
  return {
    ...candidate,
    name: `${candidate.name}${poison}`,
    country_code: `${candidate.country_code}${poison}`,
    ...(candidate.country === undefined ? {} : { country: `${candidate.country}${poison}` }),
    ...(candidate.admin1 === undefined ? {} : { admin1: `${candidate.admin1}${poison}` }),
  };
}

/* ---------------------------------------------------------------------- places -- */

const KYOTO_PLACE: PlaceRef = { index: 0, name: "Kyoto", countryCode: "JP" };
/** The second « Kyoto » of the same file: the reason a prompt needs its index. */
const OTHER_KYOTO_PLACE: PlaceRef = { index: 2, name: "Kyoto", countryCode: "JP" };
const NAMELESS_PLACE: PlaceRef = { index: 1, name: "", countryCode: "JP" };

/* -------------------------------------------------------------- fixture tables -- */

function everyFailure(poison: string): Record<SearchFailure["state"], SearchFailure> {
  return {
    timeout: { state: "timeout", timeoutMs: 10_000 },
    unreachable: { state: "unreachable", reason: `getaddrinfo ENOTFOUND${poison}` },
    "http-error": { state: "http-error", status: 500 },
    malformed: { state: "malformed", reason: `Unexpected token < in JSON${poison}` },
  };
}

function everyReason(poison: string): Record<UnresolvedReason["state"], UnresolvedReason> {
  return {
    "no-name": { state: "no-name" },
    "no-country-code": { state: "no-country-code", declared: `japon${poison}` },
    "no-match": { state: "no-match" },
    "no-choice": { state: "no-choice", count: 3, reason: `réponse illisible${poison}` },
    "country-mismatch": {
      state: "country-mismatch",
      declared: "FR",
      returned: `JP${poison}`,
      candidate: tainted(TOKYO_JP, poison),
    },
    "rejected-coordinates": {
      state: "rejected-coordinates",
      candidate: tainted(NULL_ISLAND, poison),
      reason: NULL_ISLAND_MESSAGE,
    },
    service: { state: "service", failure: { state: "http-error", status: 429 } },
    /**
     * A sentence one of our own modules wrote: long, and carrying the correction
     * at its end. `yaml-edit.ts` neutralises the third-party fragments it quotes
     * (a YAML key, an excerpt of the file) at the source, so what arrives here is
     * a first-hand sentence — which is why it is printed whole.
     */
    "unsupported-yaml": {
      state: "unsupported-yaml",
      reason: `${UNSUPPORTED_YAML_REASON}${poison}`,
    },
  };
}

function everyEvent(poison: string): Record<GeocodeEvent["kind"], GeocodeEvent> {
  const place: PlaceRef = { index: 0, name: `Kyoto${poison}`, countryCode: "JP" };

  return {
    searching: { kind: "searching", place },
    ambiguous: {
      kind: "ambiguous",
      place,
      candidates: [tainted(KYOTO_JP, poison), tainted(KYOTO_TZ, poison), tainted(BARE, poison)],
    },
    resolved: {
      kind: "resolved",
      place,
      candidate: tainted(KYOTO_JP, poison),
      coordinates: { lat: 35.02107, lon: 135.75385 },
    },
    unresolved: { kind: "unresolved", place, reason: everyReason(poison)["no-match"] },
  };
}

/** Every event, including one per unresolved reason and one per service failure. */
function allEvents(poison: string): readonly GeocodeEvent[] {
  const place: PlaceRef = { index: 0, name: `Kyoto${poison}`, countryCode: "JP" };

  return [
    ...Object.values(everyEvent(poison)),
    ...Object.values(everyReason(poison)).map((reason): GeocodeEvent => ({
      kind: "unresolved",
      place,
      reason,
    })),
    ...Object.values(everyFailure(poison)).map((failure): GeocodeEvent => ({
      kind: "unresolved",
      place,
      reason: { state: "service", failure },
    })),
    { kind: "unresolved", place: NAMELESS_PLACE, reason: { state: "no-name" } },
  ];
}

function everyOutcome(poison: string): Record<GeocodeOutcome["state"], GeocodeOutcome> {
  const file = `${FILE}${poison}`;
  const contentDir = `${CONTENT_DIR}${poison}`;

  return {
    "content-dir-missing": { state: "content-dir-missing", contentDir },
    "content-dir-unreadable": {
      state: "content-dir-unreadable",
      contentDir,
      reason: `EACCES: permission denied${poison}`,
    },
    "trip-not-found": {
      state: "trip-not-found",
      slug: SLUG,
      contentDir,
      available: [`perou-2023${poison}`, "japon-2024"],
    },
    "trip-unreadable": {
      state: "trip-unreadable",
      file,
      reason: `EACCES: permission denied${poison}`,
      similarName: `Trip.yaml${poison}`,
    },
    "trip-malformed": { state: "trip-malformed", file, reason: `bad indentation${poison}` },
    "no-places": { state: "no-places", file },
    "write-failed": {
      state: "write-failed",
      file,
      reason: `EROFS: read-only file system${poison}`,
      resolved: 2,
    },
    "file-changed": { state: "file-changed", file, resolved: 2 },
    "file-not-utf8": { state: "file-not-utf8", file, resolved: 2 },
    done: {
      state: "done",
      file,
      placeCount: 4,
      pending: 2,
      resolved: 1,
      failed: 1,
      written: true,
    },
  };
}

/** An outcome per state, plus the variants of the states that have several. */
function allOutcomes(poison: string): readonly GeocodeOutcome[] {
  const file = `${FILE}${poison}`;
  const table = everyOutcome(poison);

  return [
    ...Object.values(table),
    { state: "trip-unreadable", file, reason: `ENOENT${poison}` },
    { state: "trip-not-found", slug: SLUG, contentDir: `${CONTENT_DIR}${poison}`, available: [] },
    // Nothing left to do; one city short; everything found; nothing found.
    { state: "done", file, placeCount: 3, pending: 0, resolved: 0, failed: 0, written: false },
    { state: "done", file, placeCount: 2, pending: 2, resolved: 2, failed: 0, written: true },
    { state: "done", file, placeCount: 2, pending: 2, resolved: 0, failed: 2, written: false },
    // A `trip.yaml` that is a symlink out of the content directory, resolved and
    // not resolved, since both summaries say the file was rewritten.
    {
      state: "done",
      file,
      placeCount: 2,
      pending: 2,
      resolved: 2,
      failed: 0,
      written: true,
      writtenTo: `/ailleurs/trip.yaml${poison}`,
    },
    {
      state: "done",
      file,
      placeCount: 2,
      pending: 2,
      resolved: 1,
      failed: 1,
      written: true,
      writtenTo: `/ailleurs/trip.yaml${poison}`,
    },
  ];
}

/** Every line the module can print, for the cross-cutting invariants. */
function allLines(poison: string): readonly string[] {
  return [
    ...allEvents(poison).flatMap((event) => formatEvent(event)),
    ...allOutcomes(poison).flatMap((outcome) => formatOutcome(outcome, SLUG)),
    ...formatCandidates([
      tainted(KYOTO_JP, poison),
      tainted(KYOTO_TZ, poison),
      tainted(BARE, poison),
    ]),
    formatPrompt({ index: 0, name: `Kyoto${poison}`, countryCode: "JP" }, 3),
  ];
}

/* ------------------------------------------------------------------ the candidates -- */

describe("the candidate list", () => {
  const lines = formatCandidates([KYOTO_JP, KYOTO_TZ, BARE]);

  it("numbers the candidates from 1, because 1 is what the author types back", () => {
    expect(lines).toHaveLength(3);
    expect(at(lines, 0)).toContain("1.");
    expect(at(lines, 1)).toContain("2.");
    expect(at(lines, 2)).toContain("3.");
  });

  it("gives the country, the region and the population that tell two homonyms apart", () => {
    expect(at(lines, 0)).toContain("Kyōto");
    expect(at(lines, 0)).toContain("Japon");
    expect(at(lines, 0)).toContain("JP");
    expect(at(lines, 0)).toContain("Préfecture de Kyoto");
    expect(at(lines, 1)).toContain("Tanzanie");
    expect(at(lines, 1)).toContain("Kagera");
  });

  it("groups the population with plain spaces, not with a narrow no-break one", () => {
    expect(at(lines, 0)).toContain("1 463 723 habitants");
  });

  it("says the population is unknown rather than inventing a zero", () => {
    // The Tanzanian Kyoto comes back with no `population` key at all, and
    // « 0 habitants » would read as a fact about a village that has people in it.
    expect(at(lines, 1)).toContain("population inconnue");
    expect(at(lines, 1)).not.toContain("NaN");
    expect(at(lines, 1)).not.toContain("0 habitants");
  });

  it("falls back to the country code when the answer carries no country name", () => {
    expect(at(lines, 2)).toContain("XX");
    expect(at(lines, 2)).not.toContain("undefined");
  });

  it("leaves no dangling separator when the answer carries no region", () => {
    // `admin1` is optional and `country` is not always absent with it, so the
    // pair "country, no region" is a real answer shape rather than a hypothesis.
    const line = at(formatCandidates([{ ...BARE, country: "Xanadu" }]), 0);

    expect(line).toContain("Xanadu (XX)");
    expect(line).not.toContain("undefined");
    expect(line).not.toContain(" ,");
  });

  it("shows the coordinates that would be written, as plain decimals", () => {
    expect(at(lines, 0)).toContain("35.02107, 135.75385");
    // `String(1e-7)` is "1e-7": YAML reads that as a number and a human does not.
    expect(at(lines, 2)).toContain("-33.5, 0.0000001");
  });

  it("has nothing to list when there is no candidate", () => {
    expect(formatCandidates([])).toEqual([]);
  });

  it("rounds a fractional population instead of printing its decimals", () => {
    expect(at(formatCandidates([{ ...BARE, population: 1234.6 }]), 0)).toContain("1 235 habitants");
  });
});

/* ---------------------------------------------------------------------- prompt -- */

describe("the prompt", () => {
  it("names the place being asked about, index included", () => {
    // Two cities called « Kyoto » in one file give the same question otherwise,
    // and the prompt is the line under the author's eyes when he decides — the
    // announcement line above has already scrolled past the candidate list.
    const first = formatPrompt(KYOTO_PLACE, 2);
    const second = formatPrompt(OTHER_KYOTO_PLACE, 2);

    expect(first).toContain("places[0]");
    expect(second).toContain("places[2]");
    expect(first).not.toBe(second);
  });

  it("says the range of valid answers and how to give up", () => {
    const prompt = formatPrompt(KYOTO_PLACE, 4);

    expect(prompt).toContain("Kyoto");
    expect(prompt).toContain("[1-4");
    expect(prompt).toContain("« q »");
  });

  it("leaves the cursor after a space, so the answer is not glued to the question", () => {
    expect(formatPrompt(KYOTO_PLACE, 2).endsWith(" ")).toBe(true);
  });
});

/* ----------------------------------------------------------------------- events -- */

describe("the running commentary", () => {
  it("announces one search per city, naming the place and the query", () => {
    const lines = formatEvent({ kind: "searching", place: KYOTO_PLACE });

    expect(lines).toHaveLength(1);
    expect(at(lines, 0)).toContain("places[0]");
    expect(at(lines, 0)).toContain("Kyoto");
    expect(at(lines, 0)).toMatch(/recherche/);
  });

  it("says how many candidates there are and what to compare, then lists them", () => {
    const lines = formatEvent({
      kind: "ambiguous",
      place: KYOTO_PLACE,
      candidates: [KYOTO_JP, KYOTO_TZ],
    });

    expect(lines).toHaveLength(3);
    expect(at(lines, 0)).toContain("2 candidats");
    expect(at(lines, 0)).toMatch(/pays/);
    expect(at(lines, 0)).toMatch(/population/);
    expect(at(lines, 1)).toContain("Kyōto");
    expect(at(lines, 2)).toContain("Kyoto");
  });

  it("does not filter the list it presents", () => {
    // A heliport and a village of no recorded population are both the right
    // answer for somebody, and dropping one on a heuristic is how the right one
    // disappears for the single trip where it mattered.
    const lines = formatEvent({
      kind: "ambiguous",
      place: KYOTO_PLACE,
      candidates: [KYOTO_JP, KYOTO_TZ, BARE],
    });

    expect(lines).toHaveLength(4);
  });

  it("reports a resolution with the coordinates and the place they belong to", () => {
    const lines = formatEvent({
      kind: "resolved",
      place: KYOTO_PLACE,
      candidate: KYOTO_JP,
      coordinates: { lat: 35.02107, lon: 135.75385 },
    });

    expect(lines).toHaveLength(1);
    expect(at(lines, 0)).toContain("places[0]");
    expect(at(lines, 0)).toContain("35.02107, 135.75385");
    expect(at(lines, 0)).toContain("Japon");
  });

  it("gives one line per event, so a failure is never buried in a paragraph", () => {
    const multiline = allEvents("").filter((event) => formatEvent(event).length > 1);

    // Only the ambiguity, which is a headline plus its numbered list.
    expect(multiline.map((event) => event.kind)).toEqual(["ambiguous"]);
  });
});

/* --------------------------------------------------------- why a city was left -- */

describe("why a city was left alone", () => {
  const unresolved = (reason: UnresolvedReason, place: PlaceRef = KYOTO_PLACE): string =>
    at(formatEvent({ kind: "unresolved", place, reason }), 0);

  it("says a nameless place has nothing to search for, and asks for the name", () => {
    const line = unresolved({ state: "no-name" }, NAMELESS_PLACE);

    expect(line).toContain("places[1]");
    expect(line).toMatch(/sans nom|n'a pas de nom/);
    expect(line).toMatch(/nom/);
  });

  it("tells an absent country code from a misspelt one", () => {
    const absent = unresolved({ state: "no-country-code", declared: "" });
    const misspelt = unresolved({ state: "no-country-code", declared: "japon" });

    expect(absent).toMatch(/absent/);
    expect(misspelt).toContain("« japon »");
    // Both have to give the shape expected, since neither author knows it.
    expect(absent).toContain("JP");
    expect(misspelt).toContain("JP");
  });

  it("says nothing matched, and suggests qualifying the name", () => {
    const line = unresolved({ state: "no-match" });

    expect(line).toMatch(/introuvable/);
    expect(line).toMatch(/orthographe|précise/);
  });

  it("says how many candidates went unanswered and both ways to answer them", () => {
    const line = unresolved({ state: "no-choice", count: 3, reason: "abandon demandé" });

    expect(line).toContain("3 candidats");
    expect(line).toContain("abandon demandé");
    expect(line).toContain("--pick");
  });

  describe("a country the service contradicts", () => {
    const line = unresolved({
      state: "country-mismatch",
      declared: "FR",
      returned: "JP",
      candidate: TOKYO_JP,
    });

    it("names both countries, the one declared and the one returned", () => {
      expect(line).toContain("Tokyo");
      expect(line).toContain("JP");
      expect(line).toContain("Japon");
      expect(line).toContain("FR");
    });

    it("gives the correction to type, not just the name of the faulty key", () => {
      // « corrige countryCode » leaves the author to work out the value; the
      // value is the one thing this branch already knows.
      expect(line).toContain("countryCode: JP");
    });

    it("keeps the provider's spelling when quoting it, and upper-cases the fix", () => {
      const lowercase = unresolved({
        state: "country-mismatch",
        declared: "FR",
        returned: "jp",
        candidate: { ...TOKYO_JP, country_code: "jp" },
      });

      expect(lowercase).toContain("countryCode: JP");
    });

    it("does not tell the author to pick another candidate", () => {
      // There is one candidate in this branch as often as there are several, and
      // nothing in `UnresolvedReason` says which — so the advice cannot depend on
      // a list that may never have been shown.
      expect(line).not.toMatch(/autre candidat/);
    });
  });

  describe("coordinates the domain refuses", () => {
    it("says (0, 0) in French, and does not echo the schema's English", () => {
      const line = unresolved({
        state: "rejected-coordinates",
        candidate: NULL_ISLAND,
        reason: NULL_ISLAND_MESSAGE,
      });

      expect(line).toContain("(0, 0)");
      expect(line).toMatch(/signature/);
      expect(line).toMatch(/terre/);
      expect(line).not.toContain("Coordinates");
      expect(line).not.toContain("geocoding");
      expect(line).not.toContain("place on earth");
    });

    it("says a coordinate outside the globe is out of bounds, not Null Island", () => {
      const line = unresolved({
        state: "rejected-coordinates",
        candidate: OFF_THE_GLOBE,
        reason: "Too big: expected number to be <=90",
      });

      expect(line).toContain("91, 12.5");
      expect(line).toMatch(/born|hors/);
      expect(line).not.toMatch(/signature/);
      expect(line).not.toContain("expected number");
    });

    it("says the candidate is unusable and what to do instead", () => {
      const line = unresolved({
        state: "rejected-coordinates",
        candidate: NULL_ISLAND,
        reason: NULL_ISLAND_MESSAGE,
      });

      expect(line).toMatch(/inutilisable/);
      expect(line).toMatch(/précise/);
    });
  });

  describe("a service that does not cooperate", () => {
    const service = (failure: SearchFailure): string => unresolved({ state: "service", failure });

    it("says how long it waited on a timeout, in seconds", () => {
      const line = service({ state: "timeout", timeoutMs: 10_000 });

      expect(line).toContain("10 s");
      expect(line).toMatch(/intact/);
    });

    it("blames the connection when the host is unreachable", () => {
      const line = service({ state: "unreachable", reason: "getaddrinfo ENOTFOUND" });

      expect(line).toMatch(/injoignable/);
      expect(line).toContain("ENOTFOUND");
      expect(line).toMatch(/connexion/);
      expect(line).toMatch(/intact/);
    });

    it("tells a rate limit apart from any other HTTP failure", () => {
      const throttled = service({ state: "http-error", status: 429 });
      const broken = service({ state: "http-error", status: 500 });

      expect(throttled).toContain("429");
      expect(throttled).toMatch(/trop de requêtes/);
      expect(throttled).toMatch(/attends/);
      expect(broken).toContain("500");
      expect(broken).not.toMatch(/trop de requêtes/);
    });

    it("says the answer was unreadable, and quotes why", () => {
      const line = service({ state: "malformed", reason: "Unexpected token <" });

      expect(line).toMatch(/illisible/);
      expect(line).toContain("Unexpected token <");
      expect(line).toMatch(/intact/);
    });
  });

  describe("a YAML shape the rewrite will not guess at", () => {
    /**
     * Asserted on the *half after the arrow* rather than on a chosen phrase: the
     * wording of a refusal is `yaml-edit.ts`'s business and gets improved, while
     * "the sentence arrives whole, action included" is the contract this module
     * owes it — and that is what survives the next reformulation.
     */
    it("prints the whole sentence, its actionable half included", () => {
      // The regression this guards: bounding a first-hand sentence at 80 code
      // points cut it exactly where it started saying what to do, so the author
      // learnt that something was wrong with « latitude » and nothing else.
      const action = UNSUPPORTED_YAML_REASON.split("→").slice(1).join("→").trim();
      const line = unresolved({ state: "unsupported-yaml", reason: UNSUPPORTED_YAML_REASON });

      // The fixture has to be long enough for the old bound to have bitten.
      expect([...UNSUPPORTED_YAML_REASON].length).toBeGreaterThan(80);
      expect(action).not.toBe("");
      expect(line).toContain(action);
      expect(line).not.toContain("…");
    });

    it("names the place once, not twice on the same line", () => {
      // `describeReason` prefixes `places[N]`; a sentence that carried its own
      // prefix used to make the line say it twice.
      const line = unresolved({ state: "unsupported-yaml", reason: "aucune clé lisible" });

      expect(line.split("places[0]")).toHaveLength(2);
    });
  });
});

/* --------------------------------------------------------------- the outcomes -- */

describe("the closing lines", () => {
  const outcome = (value: GeocodeOutcome): readonly string[] => formatOutcome(value, SLUG);
  const joined = (value: GeocodeOutcome): string => outcome(value).join("\n");

  it("says a missing content directory can be created or pointed at", () => {
    const lines = joined({ state: "content-dir-missing", contentDir: CONTENT_DIR });

    expect(lines).toContain(CONTENT_DIR);
    expect(lines).toMatch(/introuvable/);
    expect(lines).toContain("--content");
  });

  it("says an unreadable content directory is a rights problem, and why", () => {
    const lines = joined({
      state: "content-dir-unreadable",
      contentDir: CONTENT_DIR,
      reason: "EACCES: permission denied",
    });

    expect(lines).toContain("EACCES");
    expect(lines).toMatch(/droits/);
  });

  describe("a slug that names no trip", () => {
    it("offers to create the trip when nothing has been written yet", () => {
      const lines = joined({
        state: "trip-not-found",
        slug: SLUG,
        contentDir: CONTENT_DIR,
        available: [],
      });

      expect(lines).toMatch(/[Aa]ucun voyage/);
      expect(lines).toContain(`npm run new-trip ${SLUG}`);
    });

    it("offers a spelling check or a creation when other trips exist", () => {
      // A bare list of what exists tells the author his slug is wrong and leaves
      // him there — with no way to tell a typo from a trip he never created.
      const lines = joined({
        state: "trip-not-found",
        slug: SLUG,
        contentDir: CONTENT_DIR,
        available: ["perou-2023", "islande-2022"],
      });

      expect(lines).toContain("« perou-2023 »");
      expect(lines).toContain("« islande-2022 »");
      expect(lines).toMatch(/orthographe/);
      expect(lines).toContain(`npm run new-trip ${SLUG}`);
    });

    it("caps the list instead of printing sixteen trips on one line", () => {
      const available = Array.from({ length: 16 }, (_unused, index) => `voyage-${index + 1}`);
      const lines = joined({
        state: "trip-not-found",
        slug: SLUG,
        contentDir: CONTENT_DIR,
        available,
      });

      expect(lines).toContain("« voyage-1 »");
      expect(lines).not.toContain("« voyage-16 »");
      expect(lines).toMatch(/et 8 autres/);
    });
  });

  describe("a trip file that cannot be read", () => {
    it("says nothing was touched, and why it could not be read", () => {
      const lines = joined({ state: "trip-unreadable", file: FILE, reason: "EACCES" });

      expect(lines).toContain(FILE);
      expect(lines).toContain("EACCES");
      expect(lines).toMatch(/rien n'a été touché/);
    });

    it("tells the author to rename a file that differs only by case", () => {
      // Reading « introuvable » next to his own `Trip.yaml`, an author writes a
      // second file instead of renaming the first.
      const lines = joined({
        state: "trip-unreadable",
        file: FILE,
        reason: "le fichier du voyage est introuvable",
        similarName: "Trip.yaml",
      });

      expect(lines).toContain("« Trip.yaml »");
      expect(lines).toMatch(/casse/);
      expect(lines).toMatch(/[Rr]enomme/);
      expect(lines).toContain("« trip.yaml »");
    });
  });

  it("refuses to rewrite invalid YAML and points at the tool that locates the line", () => {
    const lines = joined({ state: "trip-malformed", file: FILE, reason: "bad indentation" });

    expect(lines).toContain("YAML invalide");
    expect(lines).toContain("bad indentation");
    expect(lines).toContain("npm run validate:content");
  });

  it("says a trip without places has nothing to geocode", () => {
    const lines = joined({ state: "no-places", file: FILE });

    expect(lines).toContain(FILE);
    expect(lines).toContain("places[]");
    expect(lines).toMatch(/aucun lieu/);
  });

  it("keeps the original file when the write itself failed", () => {
    const lines = joined({
      state: "write-failed",
      file: FILE,
      reason: "EROFS: read-only file system",
      resolved: 2,
    });

    expect(lines).toContain("2 villes résolues");
    expect(lines).toContain("EROFS");
    expect(lines).toMatch(/intact/);
    expect(lines).toMatch(/droits/);
  });

  it("reassures first when the author's own save is what stopped the write", () => {
    // The one refusal that costs the author something: his coordinates are gone
    // and he has to answer the prompt again. The fear at that moment is having
    // lost the edit he had just made, so that is what the first line answers.
    const lines = outcome({ state: "file-changed", file: FILE, resolved: 2 });

    expect(at(lines, 0)).toMatch(/rien n'a été écrit/);
    expect(at(lines, 0)).toMatch(/intacte/);
    expect(at(lines, 1)).toContain("2 villes");
    expect(at(lines, 1)).toContain(`npm run geocode ${SLUG}`);
  });

  it("reassures first when the file is not UTF-8, then names the conversion", () => {
    // Same shape as `file-changed`, and for the same reason: nothing was written,
    // so the first thing to say is that the author's own text is untouched. The
    // damage avoided is invisible — a latin-1 `title: Café` rewritten through a
    // lossy decode comes back as a replacement character and stays valid YAML.
    const lines = outcome({ state: "file-not-utf8", file: FILE, resolved: 2 });

    expect(at(lines, 0)).toContain(FILE);
    expect(at(lines, 0)).toContain("UTF-8");
    expect(at(lines, 0)).toMatch(/rien n'a été écrit/);
    expect(at(lines, 0)).toMatch(/intact/);
    expect(at(lines, 1)).toContain("2 villes");
    expect(at(lines, 1)).toMatch(/UTF-8/);
    expect(at(lines, 1)).toContain(`npm run geocode ${SLUG}`);
  });
});

describe("the closing lines of a run that reached the file", () => {
  const done = (fields: Partial<Extract<GeocodeOutcome, { state: "done" }>>): readonly string[] =>
    formatOutcome(
      {
        state: "done",
        file: FILE,
        placeCount: 2,
        pending: 2,
        resolved: 2,
        failed: 0,
        written: true,
        ...fields,
      },
      SLUG
    );

  it("says there was nothing to do, and that the file was left alone", () => {
    const lines = done({ pending: 0, resolved: 0, written: false });

    expect(at(lines, 0)).toMatch(/déjà leurs coordonnées/);
    expect(at(lines, 1)).toMatch(/n'a pas été réécrit/);
    expect(at(lines, 1)).toContain("npm run validate:content");
  });

  it("starts the sentence after a full stop with a capital letter", () => {
    // The most frequent line of the whole command: every idempotent run ends here.
    const lines = done({ pending: 0, resolved: 0, written: false });

    expect(at(lines, 1)).not.toContain(". lance");
    expect(at(lines, 1)).toContain(". Lance");
  });

  it("says the file was rewritten when every city was resolved", () => {
    const lines = done({});

    expect(at(lines, 0)).toContain("2 villes géocodées sur 2");
    expect(at(lines, 0)).toMatch(/fichier réécrit/);
    expect(at(lines, 1)).toContain("npm run validate:content");
  });

  it("says the file was rewritten when only some cities were resolved", () => {
    // Measured: the file *is* rewritten here, and this was the one summary that
    // did not say so — the author read « 1 ville reste en échec », believed his
    // file untouched, and found a dirty `git status`.
    const lines = done({ resolved: 1, failed: 1, written: true });

    expect(at(lines, 0)).toContain("1 ville géocodée sur 2");
    expect(at(lines, 0)).toMatch(/fichier réécrit/);
    expect(at(lines, 0)).toMatch(/1 ville reste sans coordonnées/);
    expect(at(lines, 1)).toMatch(/enregistré|rien n'a été perdu/);
    expect(at(lines, 1)).toContain(`npm run geocode ${SLUG}`);
  });

  it("says the file is unchanged when nothing at all was resolved", () => {
    const lines = done({ resolved: 0, failed: 2, written: false });

    expect(at(lines, 0)).toMatch(/aucune ville géocodée/);
    expect(at(lines, 0)).toContain("2 échecs");
    expect(at(lines, 0)).toMatch(/inchangé/);
    expect(at(lines, 1)).toContain(`npm run geocode ${SLUG}`);
  });

  describe("a trip.yaml that is a symlink out of the content directory", () => {
    // Following the link is deliberate; announcing the link while writing
    // somewhere else is not. `writtenTo` is optional, so nothing in the type
    // system forces this line to exist — only this test does.
    it("says where the bytes really went, on top of the path it was asked about", () => {
      const lines = done({ writtenTo: "/ailleurs/notes/trip.yaml" });

      expect(lines.join("\n")).toContain(FILE);
      expect(lines.join("\n")).toContain("/ailleurs/notes/trip.yaml");
      expect(lines.join("\n")).toMatch(/lien symbolique/);
    });

    it("says it on a partial run too, since that file is rewritten as well", () => {
      const lines = done({ resolved: 1, failed: 1, writtenTo: "/ailleurs/notes/trip.yaml" });

      expect(lines.join("\n")).toContain("/ailleurs/notes/trip.yaml");
    });

    it("stays silent about it for the ordinary trip, which is not a link", () => {
      expect(done({}).join("\n")).not.toMatch(/lien symbolique/);
      expect(done({ resolved: 1, failed: 1 }).join("\n")).not.toMatch(/lien symbolique/);
    });

    it("keeps the action on the last line, where the eye lands", () => {
      const lines = done({ writtenTo: "/ailleurs/notes/trip.yaml" });

      expect(at(lines.slice(-1), 0)).toContain("npm run validate:content");
    });
  });

  it("agrees in number, singular and plural alike", () => {
    expect(at(done({ pending: 1, resolved: 1 }), 0)).toContain("1 ville géocodée sur 1");
    expect(at(done({ pending: 3, resolved: 3 }), 0)).toContain("3 villes géocodées sur 3");
    expect(at(done({ resolved: 1, failed: 1, written: true }), 0)).toContain("1 ville reste");
    expect(at(done({ pending: 3, resolved: 1, failed: 2, written: true }), 0)).toContain(
      "2 villes restent"
    );
  });
});

/* ------------------------------------------------- the three standing invariants -- */

describe("every line this module can print", () => {
  it("carries no ANSI escape, whatever the values it was given", () => {
    // The output is a transcript that gets captured and pasted; `validate:content`
    // earns its colours by checking `isTTY`, this command deliberately has none.
    const escaped = allLines(POISON).filter((line) => line.includes(ESCAPE));

    expect(escaped).toEqual([]);
  });

  it("carries no raw control character, even when a value it was given does", () => {
    // A value holding ESC [ 2 J clears the screen: the report the author is
    // supposed to read erases itself, and the exit code is all that is left.
    const offenders = allLines(POISON).flatMap((line) => controlCharacters(line));

    expect(offenders).toEqual([]);
  });

  it("stays one line per line, so the output remains greppable", () => {
    const broken = allLines(POISON).filter((line) => line.includes("\n"));

    expect(broken).toEqual([]);
  });

  it("escapes an ANSI sequence that arrives through a first-hand sentence", () => {
    // The sentences `yaml-edit.ts` writes are printed whole, no longer truncated
    // by `bounded()`. Truncation was never what made them safe, but it was what
    // neutralised them — so this asserts the neutralisation directly, and stops
    // the next cleanup from reopening the hole.
    const line = at(
      formatEvent({
        kind: "unresolved",
        place: KYOTO_PLACE,
        reason: { state: "unsupported-yaml", reason: `lo${ESCAPE}[2J${ESCAPE}[31mPWNED` },
      }),
      0
    );

    expect(line).not.toContain(ESCAPE);
    expect(line).toContain("\\e[2J");
  });
});

describe("every outcome that names a trip file", () => {
  const namesFile = (outcome: GeocodeOutcome): boolean =>
    formatOutcome(outcome, SLUG).join("\n").includes(FILE);

  it("says whether that file was touched or not", () => {
    // The one question the author has at the end of a run. Left unanswered, the
    // silence reads as « nothing happened » — which is wrong half the time.
    const said = /intact|touché|réécrit|inchangé|écrit|perdu/;
    const silent = allOutcomes("")
      .filter(namesFile)
      .map((outcome) => formatOutcome(outcome, SLUG).join("\n"))
      .filter((lines) => !said.test(lines));

    expect(silent).toEqual([]);
  });

  it("prints a path whole, so it can be pasted into an editor", () => {
    const outcomes = allOutcomes("").filter(namesFile);

    expect(outcomes.length).toBeGreaterThan(0);
    expect(
      outcomes.filter((outcome) => !formatOutcome(outcome, SLUG).join("\n").includes(FILE))
    ).toEqual([]);
  });
});

describe("the punctuation of a summary", () => {
  it("closes every outcome on an action rather than on a full stop", () => {
    // Three of seven summaries used to end on a period and the rest did not; the
    // last line is always the thing to do, and an imperative takes no full stop.
    const endings = allOutcomes("").map((outcome) => at(formatOutcome(outcome, SLUG).slice(-1), 0));

    expect(endings.filter((line) => line.endsWith("."))).toEqual([]);
  });

  it("gives every outcome at least one line, and never an empty one", () => {
    const lines = allOutcomes("").flatMap((outcome) => formatOutcome(outcome, SLUG));

    expect(lines.filter((line) => line.trim() === "")).toEqual([]);
  });
});
