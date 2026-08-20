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
