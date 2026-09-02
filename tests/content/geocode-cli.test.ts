import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { REPO_ROOT } from "./support";

/**
 * `npm run geocode` and `npm run new-trip`, end to end — and the loop the two of
 * them plus `npm run validate:content` are supposed to form, which is the real
 * acceptance criterion of TIW-10.
 *
 * **No network.** The geocoding endpoint is pointed at a `node:http` server bound
 * to 127.0.0.1 for the duration of this file (`TIW_GEOCODING_URL`), which serves
 * the payload captured from one real call. That exercises the *whole* HTTP path —
 * `fetch`, the status code, the JSON parse, the schema — instead of stubbing it
 * out, while never leaving the machine.
 *
 * `spawn` and not `spawnSync`: the synchronous version blocks this thread, so the
 * local server could never accept the connection the child process opens.
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

/** The two Kyotos, verbatim from one real call to the Open-Meteo geocoder. */
const KYOTO_PAYLOAD = {
  results: [
    {
      id: 1857910,
      name: "Kyōto",
      latitude: 35.02107,
      longitude: 135.75385,
      feature_code: "PPLA",
      country_code: "JP",
      timezone: "Asia/Tokyo",
      population: 1463723,
      country: "Japon",
      admin1: "Préfecture de Kyoto",
    },
    {
      id: 156100,
      name: "Kyoto",
      latitude: -2.05,
      longitude: 31.68333,
      feature_code: "PPL",
      country_code: "TZ",
      timezone: "Africa/Dar_es_Salaam",
      country: "Tanzanie",
      admin1: "Kagera",
    },
  ],
  generationtime_ms: 0.33,
};

const TOKYO_PAYLOAD = {
  results: [
    {
      id: 1850147,
      name: "Tokyo",
      latitude: 35.6895,
      longitude: 139.69171,
      feature_code: "PPLC",
      country_code: "JP",
      population: 8336599,
      country: "Japon",
      admin1: "Tokyo",
    },
  ],
  generationtime_ms: 0.21,
};

type Answer = { readonly status: number; readonly body: string };

const answers = new Map<string, Answer>([
  ["Kyoto", { status: 200, body: JSON.stringify(KYOTO_PAYLOAD) }],
  ["Tokyo", { status: 200, body: JSON.stringify(TOKYO_PAYLOAD) }],
  ["Trouville-la-Fictive", { status: 200, body: JSON.stringify({ generationtime_ms: 0.1 }) }],
  ["Surcharge", { status: 429, body: "Too Many Requests" }],
  ["Cassé", { status: 200, body: "<html>pas du JSON</html>" }],
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

function workspace(): string {
  root = mkdtempSync(path.join(tmpdir(), "tiw-geocode-"));
  return path.join(root, "trips");
}

function tripFile(contentDir: string, slug: string): string {
  return path.join(contentDir, slug, "trip.yaml");
}

/**
 * Kyoto alone, with no coordinates and nothing else wrong: the one ambiguity
 * every path into an answer has to resolve. Module-level rather than nested in
 * the describe that introduced it, because three describes now need it.
 */
function kyotoOnly(contentDir: string): string {
  const file = tripFile(contentDir, "japon-2024");
  writeFileSync(
    file,
    `slug: japon-2024
title: Japon, printemps 2024
startDate: 2024-04-12
endDate: 2024-04-16
publishedAt: 2024-05-02
places:
  - slug: kyoto
    name: Kyoto
    countryCode: JP
steps:
  - kind: stay
    placeSlug: kyoto
    startDate: 2024-04-12
    endDate: 2024-04-16
`,
    "utf8"
  );
  return file;
}

/** The skeleton `new-trip` writes, with its two placeholder cities named. */
function nameTheCities(file: string): void {
  writeFileSync(
    file,
    readFileSync(file, "utf8")
      .replace("name: Ville de départ", "name: Tokyo")
      .replace("name: Ville d'arrivée", "name: Kyoto")
      .replace(/countryCode: FR/g, "countryCode: JP"),
    "utf8"
  );
}

const geocode = (args: string, options?: { readonly input?: string }): Promise<Run> =>
  run(`${script("geocode")} ${args}`, { env: { TIW_GEOCODING_URL: endpoint }, ...options });

const newTrip = (args: string): Promise<Run> => run(`${script("new-trip")} ${args}`);

const validate = (args: string): Promise<Run> => run(`${script("validate:content")} ${args}`);

/* ------------------------------------------------------------------- the tests -- */

describe("the two scripts are wired into the project", () => {
  it("no longer point at the placeholder that fails on purpose", () => {
    expect(script("geocode")).not.toContain("not-implemented");
    expect(script("new-trip")).not.toContain("not-implemented");
  });

  it("both explain themselves", async () => {
    const [help, trip] = await Promise.all([geocode("--help"), newTrip("--help")]);

    expect(help.status).toBe(0);
    expect(help.output).toContain("--pick");
    expect(help.output).toContain("TIW_CONTENT_DIR");
    expect(trip.status).toBe(0);
    expect(trip.output).toContain("new-trip");
  });

  it("refuse to run without a slug", async () => {
    expect((await geocode("")).status).toBe(2);
    expect((await newTrip("")).status).toBe(2);
  });
});

describe("new-trip", () => {
  it("creates a skeleton and says what to do next", async () => {
    const contentDir = workspace();
    const result = await newTrip(`japon-2024 --content ${contentDir}`);

    expect(result.status).toBe(0);
    expect(result.output).toContain("japon-2024/trip.yaml");
    expect(result.output).toContain("npm run geocode japon-2024");
    expect(readFileSync(tripFile(contentDir, "japon-2024"), "utf8")).toContain("slug: japon-2024");
  });

  it("refuses to overwrite an existing trip", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);
    const before = readFileSync(tripFile(contentDir, "japon-2024"), "utf8");

    const again = await newTrip(`japon-2024 --content ${contentDir}`);

    expect(again.status).toBe(1);
    expect(again.output).toMatch(/existe déjà/);
    expect(readFileSync(tripFile(contentDir, "japon-2024"), "utf8")).toBe(before);
  });

  it("refuses an invalid slug and says what a slug is", async () => {
    const contentDir = workspace();
    const result = await newTrip(`"Japon 2024" --content ${contentDir}`);

    expect(result.status).toBe(2);
    expect(result.output).toContain("minuscules, chiffres et traits d'union");
  });
});

describe("geocode on the ambiguous case that matters (criterion 2)", () => {
  it("lists the candidates with country, region and population, and asks", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);
    const file = kyotoOnly(contentDir);
    const before = readFileSync(file, "utf8");

    const result = await geocode(`japon-2024 --content ${contentDir}`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Kyōto");
    expect(result.output).toContain("Japon");
    expect(result.output).toContain("Tanzanie");
    expect(result.output).toContain("Préfecture de Kyoto");
    expect(result.output).toContain("Kagera");
    // The population of the Japanese entry, and the honest absence of the other.
    expect(result.output).toContain("1 463 723");
    expect(result.output).toMatch(/population inconnue/);
    expect(result.output).toContain("1.");
    expect(result.output).toContain("2.");
    // Nothing was written: no choice was made.
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("writes the candidate --pick names, not results[0]", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);
    const file = kyotoOnly(contentDir);

    const result = await geocode(`japon-2024 --content ${contentDir} --pick 1`);

    expect(result.status).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("lat: 35.02107");
    expect((await validate(`--content ${contentDir}`)).status).toBe(0);
  });

  it("takes the choice from standard input when one is piped in", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);
    const file = kyotoOnly(contentDir);

    const result = await geocode(`japon-2024 --content ${contentDir}`, { input: "1\n" });

    expect(result.status).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("lat: 35.02107");
  });

  it("refuses the Tanzanian homonym on the country cross-check (criterion 3)", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);
    const file = kyotoOnly(contentDir);
    const before = readFileSync(file, "utf8");

    const result = await geocode(`japon-2024 --content ${contentDir} --pick 2`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("TZ");
    expect(result.output).toContain("JP");
    expect(result.output).toMatch(/pays/);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("geocode when the service does not cooperate", () => {
  function tripWith(contentDir: string, cityName: string): string {
    const file = tripFile(contentDir, "voyage");
    writeFileSync(
      file,
      `slug: voyage
title: Un voyage
startDate: 2024-04-12
endDate: 2024-04-16
publishedAt: 2024-05-02
places:
  - slug: ville
    name: ${cityName}
    countryCode: FR
steps:
  - kind: stay
    placeSlug: ville
    startDate: 2024-04-12
    endDate: 2024-04-16
`,
      "utf8"
    );
    return file;
  }

  const cases = [
    { city: "Trouville-la-Fictive", expected: /introuvable/ },
    { city: "Surcharge", expected: /429/ },
    { city: "Cassé", expected: /illisible|malform/i },
  ] as const;

  for (const { city, expected } of cases) {
    it(`reports ${city} and leaves the file intact`, async () => {
      const contentDir = workspace();
      await newTrip(`voyage --content ${contentDir}`);
      const file = tripWith(contentDir, city);
      const before = readFileSync(file, "utf8");

      const result = await geocode(`voyage --content ${contentDir}`);

      expect(result.status).toBe(1);
      expect(result.output).toMatch(expected);
      expect(readFileSync(file, "utf8")).toBe(before);
    });
  }

  it("never answers with a stack trace, whatever the failure", async () => {
    const contentDir = workspace();
    await newTrip(`voyage --content ${contentDir}`);

    const runs = [
      // A trip that is not there, a YAML file that does not parse, a service
      // that answers 429, and a name nothing matches.
      await geocode(`inconnu --content ${contentDir}`),
      await geocode(`voyage --content ${contentDir}`),
    ];
    writeFileSync(tripFile(contentDir, "voyage"), "slug: voyage\n\tbroken: true\n", "utf8");
    runs.push(await geocode(`voyage --content ${contentDir}`));

    for (const result of runs) {
      expect(result.status).toBe(1);
      // The two shapes a leaked exception takes: a stack frame, and Node's own
      // uncaught-error banner.
      expect(result.output).not.toMatch(/^\s+at .+:\d+:\d+\)?$/m);
      expect(result.output).not.toContain("node:internal");
      expect(result.output).not.toMatch(/\bError:\s/);
    }
  });

  it("says so when the slug names no trip", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);

    const result = await geocode(`perou-2023 --content ${contentDir}`);

    expect(result.status).toBe(1);
    expect(result.output).toContain("perou-2023");
    expect(result.output).toContain("japon-2024");
  });
});

describe("idempotence through the command (constraint F)", () => {
  it("says everything is done and does not touch the file", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);
    const file = tripFile(contentDir, "japon-2024");
    nameTheCities(file);

    const first = await geocode(`japon-2024 --content ${contentDir} --pick 1`);
    expect(first.status).toBe(0);

    const written = readFileSync(file, "utf8");
    const stamp = statSync(file).mtimeMs;

    const second = await geocode(`japon-2024 --content ${contentDir}`);

    expect(second.status).toBe(0);
    expect(second.output).toMatch(/déjà leurs coordonnées/);
    expect(readFileSync(file, "utf8")).toBe(written);
    expect(statSync(file).mtimeMs).toBe(stamp);
    // Not one request went out on the second run.
    expect(received).toEqual(["Tokyo", "Kyoto"]);
  });
});

describe("the loop this ticket exists to create", () => {
  it("goes new-trip → validate (red, says geocode) → geocode → validate (green)", async () => {
    const contentDir = workspace();

    const created = await newTrip(`japon-2024 --content ${contentDir}`);
    expect(created.status).toBe(0);

    const file = tripFile(contentDir, "japon-2024");

    // What Thomas does between the two commands: he names his cities. The
    // skeleton cannot guess them, and « Ville de départ » is not a place.
    nameTheCities(file);

    const before = await validate(`--content ${contentDir}`);
    expect(before.status).toBe(1);
    expect(before.output).toContain("npm run geocode japon-2024");

    const resolved = await geocode(`japon-2024 --content ${contentDir} --pick 1`);
    expect(resolved.status).toBe(0);

    const after = await validate(`--content ${contentDir}`);
    expect(after.status).toBe(0);
    expect(after.output).toContain("1 voyage validé");
  }, 60_000);

  it("keeps every comment of the skeleton through the rewrite (constraint A)", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);
    const file = tripFile(contentDir, "japon-2024");

    nameTheCities(file);
    const before = readFileSync(file, "utf8");

    await geocode(`japon-2024 --content ${contentDir} --pick 1`);
    const after = readFileSync(file, "utf8");

    const lost = before.split("\n").filter((line) => !after.includes(line));
    expect(lost).toEqual([]);

    const added = after.split("\n").filter((line) => !before.includes(line));
    expect(added).toEqual([
      "    coordinates:",
      "      lat: 35.6895",
      "      lon: 139.69171",
      "    coordinates:",
      "      lat: 35.02107",
      "      lon: 135.75385",
    ]);
  }, 60_000);
});

/**
 * The layer every other case in this file skips.
 *
 * Everything above runs the *node* command read from `package.json`, which is
 * ~0.3 s a case instead of ~2 s — and which is exactly why the whole class of
 * defect below stayed invisible: `npm run geocode japon-2024 --pick 1` never
 * reaches the script with `--pick`. npm keeps it as one of its own config flags
 * and forwards only its value. So these cases, and only these, pay for `npm run`.
 */
describe("through npm, the way it is typed by hand", () => {
  const npm = (command: string): Promise<Run> =>
    run(`npm run --silent ${command}`, { env: { TIW_GEOCODING_URL: endpoint } });

  it("geocode: names the symptom when npm swallowed --pick", async () => {
    const result = await npm("geocode japon-2024 --pick 1");

    // The old message accused its author of naming two trips, which is the one
    // thing he had not done.
    expect(result.status).toBe(2);
    expect(result.output).toContain("le second argument est « 1 »");
    expect(result.output).toContain("npm run geocode -- japon-2024 --pick 1");
  }, 60_000);

  it("geocode: forwards --content and --pick when the `--` is there", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);
    const file = kyotoOnly(contentDir);

    const result = await npm(`geocode -- japon-2024 --content ${contentDir} --pick 1`);

    expect(result.status).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("lat: 35.02107");
  }, 60_000);

  it("new-trip: writes under --content, and never into the repository's content", async () => {
    const contentDir = workspace();

    const result = await npm(`new-trip -- essai-npm --content ${contentDir}`);

    expect(result.status).toBe(0);
    expect(readFileSync(tripFile(contentDir, "essai-npm"), "utf8")).toContain("slug: essai-npm");
    // The grave half of the same defect: without the `--`, npm drops
    // `--content=…` entirely and the trip lands in the real content/trips
    // without a word. Nothing in the script can see that, so the refusal below
    // and the README are the whole defence — this asserts the documented form
    // at least honours the directory it is given.
    expect(existsSync(path.join(REPO_ROOT, "content", "trips", "essai-npm"))).toBe(false);
  }, 60_000);

  it("new-trip: names the symptom when npm swallowed --content", async () => {
    const result = await npm("new-trip essai-npm --content /tmp/tiw-nowhere");

    expect(result.status).toBe(2);
    expect(result.output).toContain("le second argument est « /tmp/tiw-nowhere »");
    expect(result.output).toContain("npm run new-trip -- essai-npm --content /tmp/tiw-nowhere");
    expect(existsSync(path.join(REPO_ROOT, "content", "trips", "essai-npm"))).toBe(false);
  }, 60_000);
});

/**
 * Standard input has to be a contract, not a coincidence.
 *
 * `printf '1\n' | geocode` passed because the byte was already in the pipe when
 * the script looked. With a producer that takes a moment it exited 1 on "aucun
 * choix retenu", file untouched, request already spent: reading
 * `process.stdin.isTTY` instantiates the stream, which switches fd 0 to
 * non-blocking, and the `readFileSync(0)` that followed threw EAGAIN into a
 * `catch {}` that read as "no answer".
 */
describe("standard input, when the producer is not instantaneous", () => {
  it("waits for the choice instead of calling it unanswered", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);
    const file = kyotoOnly(contentDir);

    const result = await run(
      `( sleep 1; printf '1\\n' ) | ${script("geocode")} japon-2024 --content ${contentDir}`,
      { env: { TIW_GEOCODING_URL: endpoint } }
    );

    expect(result.status).toBe(0);
    expect(result.output).not.toMatch(/entrée standard/);
    expect(readFileSync(file, "utf8")).toContain("lat: 35.02107");
  }, 60_000);

  it("still answers nothing when nothing is piped in", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);
    const file = kyotoOnly(contentDir);
    const before = readFileSync(file, "utf8");

    const result = await run(
      `${script("geocode")} japon-2024 --content ${contentDir} < /dev/null`,
      {
        env: { TIW_GEOCODING_URL: endpoint },
      }
    );

    expect(result.status).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("no secret is needed, and none is sent", () => {
  it("reaches the service with a bare query string", async () => {
    const contentDir = workspace();
    await newTrip(`japon-2024 --content ${contentDir}`);
    const file = tripFile(contentDir, "japon-2024");
    nameTheCities(file);

    await geocode(`japon-2024 --content ${contentDir} --pick 1`);

    expect(received).toEqual(["Tokyo", "Kyoto"]);
  });
});
