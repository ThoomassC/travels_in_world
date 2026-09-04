import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { REPO_ROOT } from "./support";

/**
 * `npm run geocode:places`, end to end (TIW-36).
 *
 * **No network**, on the same terms as `geocode-cli.test.ts`: the endpoint points
 * at a `node:http` server bound to 127.0.0.1 serving payloads captured from real
 * calls, so the whole HTTP path is exercised — `fetch`, the status, the JSON
 * parse, the schema — while nothing leaves the machine.
 *
 * **What this file is really for.** The engine is shared with
 * `npm run geocode`, and that suite already proves the four refusals. What is new
 * and untested by it is everything the two commands do *not* share: this one takes
 * no positional at all, it names one file instead of looking a slug up in a
 * directory, and its own three "the file is not there" outcomes have their own
 * sentences. Those are the assertions below.
 *
 * The homonym asserted on is **Valence**, and not for variety: it is one of the
 * fourteen places this ticket loads, the client listed it under Spain, and the
 * geocoder answers the French one as well. A command that picked `results[0]` would
 * put the marker 700 km away in the wrong country, with nothing to say so.
 */

const PackageManifest = z.object({ scripts: z.record(z.string(), z.string()) });

const manifest = PackageManifest.parse(
  JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"))
);

function script(name: string): string {
  const command = manifest.scripts[name];
  if (command === undefined) {
    throw new Error(`package.json declares no "${name}" script.`);
  }
  return command;
}

type Run = { readonly status: number; readonly output: string };

function run(
  command: string,
  options: { readonly env?: Readonly<Record<string, string>>; readonly input?: string } = {}
): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: REPO_ROOT,
      env: { ...process.env, ...options.env },
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("close", (code) => resolve({ status: code ?? -1, output }));
    child.stdin.end(options.input ?? "");
  });
}

/* --------------------------------------------------------- the local service -- */

/** The Spanish and the French Valence, in the order the service ranks them. */
const VALENCE_PAYLOAD = {
  results: [
    {
      id: 2509954,
      name: "Valence",
      latitude: 39.46975,
      longitude: -0.37739,
      feature_code: "PPLA",
      country_code: "ES",
      population: 814208,
      country: "Espagne",
      admin1: "Communauté valencienne",
    },
    {
      id: 2984114,
      name: "Valence",
      latitude: 44.9333,
      longitude: 4.89178,
      feature_code: "PPLA2",
      country_code: "FR",
      population: 64483,
      country: "France",
      admin1: "Auvergne-Rhône-Alpes",
    },
  ],
  generationtime_ms: 0.4,
};

const ROUEN_PAYLOAD = {
  results: [
    {
      id: 2982652,
      name: "Rouen",
      latitude: 49.44313,
      longitude: 1.09932,
      feature_code: "PPLA2",
      country_code: "FR",
      population: 112321,
      country: "France",
      admin1: "Normandie",
    },
  ],
  generationtime_ms: 0.2,
};

type Answer = { readonly status: number; readonly body: string };

const answers = new Map<string, Answer>([
  ["Valence", { status: 200, body: JSON.stringify(VALENCE_PAYLOAD) }],
  ["Rouen", { status: 200, body: JSON.stringify(ROUEN_PAYLOAD) }],
]);

let server: Server | undefined;
let endpoint = "";
const received: string[] = [];

function handle(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const name = url.searchParams.get("name") ?? "";
  received.push(name);
  const answer = answers.get(name) ?? { status: 200, body: JSON.stringify({}) };
  response.writeHead(answer.status, { "content-type": "application/json; charset=utf-8" });
  response.end(answer.body);
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the local geocoding stub did not bind a port");
  }
  endpoint = `http://127.0.0.1:${address.port}/v1/search`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (server === undefined) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
});

/* ------------------------------------------------------------- the workspace -- */

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) {
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  }
  received.length = 0;
});

function workspace(source?: string): string {
  root = mkdtempSync(path.join(tmpdir(), "tiw-places-"));
  const file = path.join(root, "places.yaml");
  if (source !== undefined) {
    writeFileSync(file, source, "utf8");
  }

  return file;
}

function geocodePlaces(file: string, extra = "", input?: string): Promise<Run> {
  return run(`${script("geocode:places")} --places ${file}${extra}`, {
    env: { TIW_GEOCODING_URL: endpoint },
    ...(input === undefined ? {} : { input }),
  });
}

/**
 * Two dateless places, one of them a homonym across two countries, and a comment
 * plus a blank line so the "it reformats nothing" claim has something to lose.
 */
const TWO_PLACES = `# Les lieux visités : ni date, ni étape, ni récit.
places:
  - slug: rouen
    name: Rouen
    countryCode: FR

  # Valence est aussi une ville française — le pays tranche.
  - slug: valence
    name: Valence
    countryCode: ES
`;

describe("resolving the visited places", () => {
  it("asks for the homonym, writes both, and reformats nothing else", async () => {
    const file = workspace(TWO_PLACES);

    const result = await geocodePlaces(file, "", "1\n");

    expect(result.status).toBe(0);
    expect(received).toEqual(["Rouen", "Valence"]);

    const written = readFileSync(file, "utf8");

    // The Spanish Valence, which is the one the file declares.
    expect(written).toContain("lat: 39.46975");
    expect(written).toContain("lon: -0.37739");
    expect(written).toContain("lat: 49.44313");
    // And every byte the author wrote is still there, comments included.
    expect(written).toContain("# Les lieux visités : ni date, ni étape, ni récit.");
    expect(written).toContain("# Valence est aussi une ville française — le pays tranche.");
    expect(written).toContain("\n\n  #");
  });

  /**
   * **The cross-check, which is what makes this command trustworthy with a file.**
   * Every other guard catches a machine being wrong; this one catches a human
   * picking the wrong line out of a list — and Valence is the case it exists for.
   * Answering « 2 » selects the French city while the file says `ES`, so nothing is
   * written for it and the run exits 1.
   */
  it("writes nothing for a place whose country does not match the answer", async () => {
    const file = workspace(TWO_PLACES);

    const result = await geocodePlaces(file, "", "2\n");

    expect(result.status).toBe(1);
    expect(result.output).toContain("ES");
    expect(result.output).toContain("FR");

    const written = readFileSync(file, "utf8");

    // Rouen was resolved and kept; Valence was not touched.
    expect(written).toContain("lat: 49.44313");
    expect(written).not.toContain("lat: 44.9333");
  });

  it("answers an ambiguity from --pick, with no terminal at all", async () => {
    const file = workspace(TWO_PLACES);

    const result = await geocodePlaces(file, " --pick 1");

    expect(result.status).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("lat: 39.46975");
  });

  /**
   * Idempotence, asserted on the **mtime** and not only on the bytes: a command
   * that rewrites an identical file still dirties a build cache and still shows up
   * in a `git status` as a file somebody touched.
   */
  it("does nothing twice, and does not touch the file the second time", async () => {
    const file = workspace(TWO_PLACES);
    await geocodePlaces(file, " --pick 1");
    const before = statSync(file).mtimeMs;
    // The first run's two requests are the setup, not the measurement.
    received.length = 0;

    const again = await geocodePlaces(file, " --pick 1");

    expect(again.status).toBe(0);
    expect(again.output).toContain("déjà");
    expect(statSync(file).mtimeMs).toBe(before);
    // No request was spent either: the places already had their coordinates.
    expect(received).toEqual([]);
  });
});

describe("the ways the file can fail to be there", () => {
  /**
   * **"Nothing to do" is what this must never say.** The loading façade answers an
   * empty collection for the same absence — a journal with no dateless place is an
   * ordinary journal — but somebody who has just typed this command is asking
   * about a file, and a mistyped `--places` that looks like success is the one
   * failure mode a command with a default path really has.
   */
  it("says the file does not exist, and how to point at the right one", async () => {
    const file = workspace();

    const result = await geocodePlaces(file);

    expect(result.status).toBe(1);
    expect(result.output).toContain("n'existe pas");
    expect(result.output).toContain("--places <fichier>");
  });

  it("names a file whose case differs, and says rename rather than write", async () => {
    const file = workspace();
    writeFileSync(file.replace("places.yaml", "Places.yaml"), TWO_PLACES, "utf8");

    const result = await geocodePlaces(file);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Places.yaml");
    expect(result.output).toContain("Renomme");
  });

  it("refuses a file it cannot re-read, and points at the validator", async () => {
    const file = workspace("places:\n\t- slug: rouen\n");

    const result = await geocodePlaces(file);

    expect(result.status).toBe(1);
    expect(result.output).toContain("YAML invalide");
    expect(result.output).toContain("npm run validate:content");
  });

  it("says the file declares no place, rather than reporting success", async () => {
    const file = workspace("places: []\n");

    const result = await geocodePlaces(file);

    expect(result.status).toBe(1);
    expect(result.output).toContain("aucun lieu");
  });
});

describe("the arguments", () => {
  /**
   * The whole difference from `npm run geocode`: there is no slug to give, so a
   * bare positional is an option npm swallowed. The message has to name the option
   * rather than complain about an argument the author never typed.
   */
  it("refuses a positional, and names the option npm swallowed", async () => {
    const result = await run(`${script("geocode:places")} 1`, {
      env: { TIW_GEOCODING_URL: endpoint },
    });

    expect(result.status).toBe(2);
    expect(result.output).toContain("--pick");
  });

  it("prints its own usage, which names no slug", async () => {
    const result = await run(`${script("geocode:places")} --help`);

    expect(result.status).toBe(0);
    expect(result.output).toContain("npm run geocode:places");
    expect(result.output).not.toContain("<slug>");
  });
});
