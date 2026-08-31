import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { REPO_ROOT } from "./support";

/**
 * `npm run validate:content`, end to end: the exit code and the text of the
 * message, which are the two things acceptance criterion 7 asks for. A green
 * unit suite over a script that exits 0 on broken content would be worthless.
 *
 * The command is read from `package.json` rather than written out here, so this
 * suite runs the same thing CI and `pretest` run — and turns red if the wiring
 * is renamed or dropped. It is then executed through a shell instead of `npm
 * run`, which keeps a case at ~0.3 s instead of ~2 s; one case below still goes
 * through `npm run` to prove that layer.
 */

const PackageManifest = z.object({
  scripts: z.record(z.string(), z.string()),
});

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

const ESCAPE = String.fromCodePoint(27);

type Run = { readonly status: number; readonly output: string };

function run(command: string, env: Readonly<Record<string, string>> = {}): Run {
  const result = spawnSync(command, {
    shell: true,
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

  return {
    // `status` is null when the process was killed by a signal; that is a
    // failure of this suite, not a passing run.
    status: result.status ?? -1,
    output: `${result.stdout}${result.stderr}`,
  };
}

const fixture = (name: string): string =>
  `--content tests/fixtures/content/${name}/trips --public tests/fixtures/content/${name}/public`;

const validate = (args: string, env?: Readonly<Record<string, string>>): Run =>
  run(`${script("validate:content")} ${args}`, env);

describe("the script is wired into the project", () => {
  it("is no longer the placeholder that fails on purpose", () => {
    expect(script("validate:content")).not.toContain("not-implemented");
  });

  it("runs before the test suite", () => {
    expect(script("pretest")).toContain("validate:content");
  });

  /**
   * The gate TIW-29 added, and the reason it is asserted on `package.json` rather
   * than on a workflow file: `.github/workflows/ci.yml` runs `validate:content` in
   * its `checks` job and `npm run build` in a *different* one, so faulty content
   * still reached `next build` there — and a red prerender naming
   * `src/map/world.ts` is not the message this script exists to print.
   * `vercel.json` chains the two in its `buildCommand`, which covers deployment
   * and nothing else: not `npm run build` locally, and not the two builds
   * Playwright's `webServer` and the CI `build` job make.
   *
   * npm's `prebuild` hook covers every one of those at once, from the repository,
   * where a test can read it. Both spellings are pinned because either one alone
   * leaves a path open.
   */
  it("runs before every build, through npm's prebuild hook", () => {
    expect(script("prebuild")).toContain("validate:content");
  });

  it("is still chained into the Vercel build command", () => {
    const vercel = z
      .object({ buildCommand: z.string() })
      .parse(JSON.parse(readFileSync(path.join(REPO_ROOT, "vercel.json"), "utf8")));

    expect(vercel.buildCommand).toContain("validate:content");
  });
});

describe("on valid content", () => {
  const result = validate(fixture("valid-trip"));

  it("exits 0", () => {
    expect(result.status).toBe(0);
  });

  it("says how many trips it validated", () => {
    expect(result.output).toContain("1 voyage validé");
  });
});

describe("on the real content directory, with no argument", () => {
  const result = validate("");

  it("exits 0: content/trips is empty until TIW-24", () => {
    expect(result.status).toBe(0);
    expect(result.output).toContain("content/trips");
  });
});

describe("on invalid content (acceptance criterion 7)", () => {
  const result = validate(fixture("place-without-coordinates"));

  it("fails with a non-zero exit code", () => {
    expect(result.status).toBe(1);
  });

  it("names the file, the field and the command to run", () => {
    expect(result.output).toContain(
      "tests/fixtures/content/place-without-coordinates/trips/japon-2024/trip.yaml"
    );
    expect(result.output).toContain("places[1].coordinates");
    expect(result.output).toContain("Kyoto");
    expect(result.output).toContain("npm run geocode japon-2024");
  });

  it("prints no ANSI escape when its output is captured", () => {
    expect(result.output).not.toContain(ESCAPE);
  });
});

/**
 * The end-to-end half of TIW-29: this exact content used to exit 0 here and fail
 * `next build` afterwards. What is checked is the whole line an author reads —
 * path, line, column, field, and a way out — because that line is the deliverable.
 */
describe("on a country code no country bears", () => {
  const result = validate(fixture("unassigned-country-code"));

  it("fails with a non-zero exit code", () => {
    expect(result.status).toBe(1);
  });

  it("names the file, the position, the field and the reason", () => {
    expect(result.output).toContain(
      "tests/fixtures/content/unassigned-country-code/trips/balkans-2025/trip.yaml:21:5"
    );
    expect(result.output).toContain("places[1].countryCode");
    expect(result.output).toContain("Prizren");
    expect(result.output).toContain("XK");
    expect(result.output).toContain("Kosovo");
  });

  it("prints no ANSI escape when its output is captured", () => {
    expect(result.output).not.toContain(ESCAPE);
  });
});

describe("on several faults in several files", () => {
  const result = validate(fixture("several-faults"));

  it("reports them all rather than stopping at the first", () => {
    expect(result.status).toBe(1);
    expect(result.output).toContain("lattitude");
    expect(result.output).toContain("steps[1].fromSlug");
    expect(result.output).toContain("perou-2023/trip.yaml");
  });

  it("ends on a count of files and trips in error", () => {
    expect(result.output).toContain("3 fichiers en erreur");
    expect(result.output).toContain("4 problèmes");
    expect(result.output).toContain("3 en erreur");
  });
});

describe("a value written to erase the report", () => {
  it("reaches the terminal inert, on one line", () => {
    const result = validate(fixture("escape-sequence-value"));

    expect(result.status).toBe(1);
    // The bytes that would clear the screen never reach the stream.
    expect(result.output).not.toContain(ESCAPE);
    expect(result.output).toContain("\\e[2J");
    expect(result.output.split("\n").filter((line) => line.includes("trip.yaml"))).toHaveLength(1);
  });
});

describe("the content directory can be chosen without touching the real content", () => {
  it("accepts a bare positional argument", () => {
    const result = validate("tests/fixtures/content/no-trips/trips");

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/[Aa]ucun voyage/);
  });

  it("accepts the environment variables", () => {
    const result = validate("", {
      TIW_CONTENT_DIR: "tests/fixtures/content/end-date-before-start-date/trips",
      TIW_PUBLIC_DIR: "tests/fixtures/content/end-date-before-start-date/public",
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain("2024-04-10");
  });

  it("lets an explicit argument win over the environment", () => {
    const result = validate(fixture("valid-trip"), {
      TIW_CONTENT_DIR: "tests/fixtures/content/end-date-before-start-date/trips",
    });

    expect(result.status).toBe(0);
  });

  it("documents both in its help", () => {
    const result = validate("--help");

    expect(result.status).toBe(0);
    expect(result.output).toContain("TIW_CONTENT_DIR");
    expect(result.output).toContain("TIW_PUBLIC_DIR");
  });

  it("fails on a directory that does not exist", () => {
    const result = validate("tests/fixtures/content/nowhere/trips");

    expect(result.status).toBe(1);
    expect(result.output).toContain("introuvable");
  });
});

describe("an option that would silently point somewhere else", () => {
  it("refuses an empty --content instead of validating the whole repository", () => {
    // `path.resolve("")` is the working directory: the script walked `.git`,
    // `node_modules` and `src`, calling each folder an unfinished trip.
    for (const spelling of ["--content=", '--content ""']) {
      const result = validate(spelling);

      expect(result.status).toBe(2);
      expect(result.output).toContain("L'option --content attend un dossier.");
    }
  });

  it("names the two directories in the order they were typed", () => {
    // `--content a b` used to report "(b et a)", which reads as an accusation
    // against the wrong one of the two.
    const result = validate("--content a b");

    expect(result.status).toBe(2);
    expect(result.output).toContain("--content a");
    expect(result.output).toContain("b");
    expect(result.output).not.toContain("(b et a)");
  });

  it("refuses a repeated option instead of keeping the last one", () => {
    for (const spelling of ["--content a --content b", "--content=a --content b"]) {
      const result = validate(spelling);

      expect(result.status).toBe(2);
      expect(result.output).toContain("deux fois");
    }
  });

  it("refuses an empty --public the same way", () => {
    expect(validate("--public=").status).toBe(2);
  });
});

describe("through npm, the way CI and pretest run it", () => {
  it("fails the build on invalid content", () => {
    const result = run(
      `npm run --silent validate:content -- ${fixture("end-date-before-start-date")}`
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain("endDate");
  }, 60_000);
});

/* ------------------------------------------------- the `--` npm needs -------- */

/**
 * Every runnable command line this repository publishes, checked for the `--`
 * that makes npm forward an option instead of keeping it.
 *
 * `npm run geocode japon-2024 --pick 1` does not pass `--pick` to the script:
 * npm consumes it as one of its own config flags (`npm warn Unknown cli config`)
 * and forwards only `1`, which the script then reads as a second trip. The
 * `=` spelling is worse — `npm run new-trip essai --content=/tmp/bac` forwards
 * `essai` alone, so the trip is created in the repository's real `content/trips`
 * without a word. `validate:content` documented the right form from the start;
 * `geocode` and `new-trip` were written without it, in nine places.
 *
 * Nothing in a script can detect the `=` spelling, so the documentation *is* the
 * defence, and this is what keeps it honest.
 *
 * **What counts as a command line here**: a backticked span, and a line of a
 * fenced code block. That is the copy-paste surface. Prose is free to quote a
 * broken form as a counter-example — with guillemets, the way every message in
 * this repository quotes a value — without turning this test red.
 */
const RUNNABLE_SCRIPTS = ["validate:content", "geocode", "new-trip", "index-photos"] as const;

/** Continuations first: a flag on the next line belongs to the same invocation. */
function joinContinuations(text: string): string {
  return text.replace(/\\\n\s*/g, " ");
}

function commandLines(text: string): readonly string[] {
  const joined = joinContinuations(text);
  const found: string[] = [];

  // Backticked spans, anywhere: `npm run geocode japon-2024`.
  for (const match of joined.matchAll(/`(npm run [^`]*)`/g)) {
    found.push(match[1] ?? "");
  }
  // Fenced code blocks, where there are no backticks to delimit anything. The
  // invocation stops at a `#` comment or a table pipe.
  for (const block of joined.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const line of (block[1] ?? "").split("\n")) {
      for (const match of line.matchAll(/npm run [^#|\n]*/g)) {
        found.push(match[0]);
      }
    }
  }

  return found;
}

/** The invocation, when it forwards an option without the `--` that npm eats. */
function missingSeparator(invocation: string): string | undefined {
  const tokens = invocation.trim().split(/\s+/);
  const script = tokens.findIndex((token) =>
    RUNNABLE_SCRIPTS.includes(token as (typeof RUNNABLE_SCRIPTS)[number])
  );
  if (script === -1) {
    return undefined;
  }

  const rest = tokens.slice(script + 1);
  const flag = rest.findIndex((token) => token.startsWith("--") && token !== "--");
  if (flag === -1) {
    return undefined;
  }
  const separator = rest.indexOf("--");

  return separator !== -1 && separator < flag ? undefined : invocation.trim();
}

describe("every command line the project publishes carries the `--` npm needs", () => {
  const documents = [
    ["README.md", readFileSync(path.join(REPO_ROOT, "README.md"), "utf8")],
    ["content/README.md", readFileSync(path.join(REPO_ROOT, "content/README.md"), "utf8")],
  ] as const;

  for (const [name, text] of documents) {
    it(`${name} shows no invocation npm would strip`, () => {
      expect(commandLines(text).map(missingSeparator).filter(Boolean)).toEqual([]);
    });
  }

  /**
   * All four, since TIW-17: `index-photos` joined the list the moment it stopped
   * being `scripts/not-implemented.mjs`. Leaving it out is exactly how the nine
   * unexecutable lines this guard was written for got published in the first
   * place — a command whose `--help` nothing reads.
   */
  for (const name of ["validate:content", "geocode", "new-trip", "index-photos"] as const) {
    it(`the help of ${name} shows no invocation npm would strip`, () => {
      const help = run(`${script(name)} --help`);

      expect(help.status).toBe(0);
      // The help has no backticks, so only its indented example lines qualify.
      const shown = help.output
        .split("\n")
        .filter((line) => /^(\s+|Usage : )npm run /.test(line))
        .map((line) => line.trim());

      expect(shown.length).toBeGreaterThan(0);
      expect(shown.map(missingSeparator).filter(Boolean)).toEqual([]);
    });
  }
});
