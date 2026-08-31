import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { TEMPORARY_FILE_GLOB, TEMPORARY_MARKER, TEMPORARY_SUFFIX } from "@/content/index-photos";
import { photoWorkspace, tripWithPhotos, unindexedPhoto } from "./photo-support";
import type { PhotoWorkspace } from "./photo-support";
import { REPO_ROOT } from "./support";

/**
 * `npm run index-photos`, end to end: the exit code and the text on the streams.
 *
 * The orchestration and every sentence are covered without a process elsewhere
 * (`index-photos.test.ts`, `index-photos-report.test.ts`), so what is left for
 * this file is only what **cannot be seen from inside the module**: the wiring in
 * `package.json`, the exit code, which stream a line went to, and the `--` npm
 * eats. Cases here cost ~2 s each against ~0.3 s, so there are few of them, and
 * each one is a layer nothing else can reach — the same discipline
 * `cli.test.ts` states for `validate:content`.
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

type Run = { readonly status: number; readonly stdout: string; readonly stderr: string };

function run(args: string, env: Readonly<Record<string, string>> = {}): Run {
  const result = spawnSync(`${script("index-photos")} ${args}`, {
    shell: true,
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

  return {
    // `status` is null when the process was killed by a signal; that is a failure
    // of this suite, not a passing run.
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

let workspace: PhotoWorkspace | undefined;

afterEach(() => {
  workspace?.cleanup();
  workspace = undefined;
});

const ONE_PHOTO = tripWithPhotos(
  ["photos:", unindexedPhoto("/photos/japon-2024/tokyo.jpg", "Une ruelle de Shinjuku")].join("\n")
);

describe("the script is wired into the project", () => {
  /**
   * The line this ticket exists to delete. `scripts/not-implemented.mjs` held the
   * name and exited 1 on purpose, and `validate:content` has been pointing at the
   * command since TIW-9 — so this assertion is the one that says the promise is
   * kept rather than merely planned.
   */
  it("is no longer the placeholder that fails on purpose", () => {
    expect(script("index-photos")).not.toContain("not-implemented");
  });

  it("runs the TypeScript entry point through the shared resolver hook", () => {
    expect(script("index-photos")).toContain("scripts/index-photos.ts");
    expect(script("index-photos")).toContain("register-typescript");
  });
});

describe("on a trip whose photos need indexing", () => {
  it("exits 0, and says what it wrote", async () => {
    workspace = await photoWorkspace({
      yaml: ONE_PHOTO,
      images: { "/photos/japon-2024/tokyo.jpg": { width: 1600, height: 1067 } },
    });

    const result = run("japon-2024", {
      TIW_CONTENT_DIR: workspace.contentDir,
      TIW_PUBLIC_DIR: workspace.publicDir,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 photo indexée");
    expect(result.stdout).toContain("fichier réécrit");
    // The transcript is one stream: a run is a conversation, and splitting it
    // across two makes it unreadable in the order it happened.
    expect(result.stderr).toBe("");
  });

  it("exits 1 when a declared photo could not be indexed", async () => {
    workspace = await photoWorkspace({ yaml: ONE_PHOTO });

    const result = run("japon-2024", {
      TIW_CONTENT_DIR: workspace.contentDir,
      TIW_PUBLIC_DIR: workspace.publicDir,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("introuvable");
  });

  /**
   * A trip with no photos is not a fault: `photos` is optional in the content
   * model. Exiting 1 on one would break any script that chains this command over a
   * collection, which is the whole reason the outcome has its own state.
   */
  it("exits 0 on a trip that declares no photo", async () => {
    workspace = await photoWorkspace({ yaml: tripWithPhotos("") });

    const result = run("japon-2024", {
      TIW_CONTENT_DIR: workspace.contentDir,
      TIW_PUBLIC_DIR: workspace.publicDir,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/aucune photo/i);
  });
});

describe("usage errors", () => {
  it("exits 2 and prints the usage on a missing slug", () => {
    const result = run("");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage : npm run index-photos");
    // A usage error happens before the transcript starts, so it goes to stderr —
    // the one thing this command puts there.
    expect(result.stdout).toBe("");
  });

  it("exits 0 on --help, on stdout", () => {
    const result = run("--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage : npm run index-photos");
    expect(result.stdout).toContain("TIW_CONTENT_DIR");
    expect(result.stdout).toContain("TIW_PUBLIC_DIR");
  });

  /**
   * The help has to say the command **rewrites images on disk**. It is the only
   * command in this repository that touches a file the author deposited, and
   * `--help` is where someone looks before running it the first time.
   */
  it("warns in --help that it rewrites oversized originals", () => {
    const result = run("--help");

    expect(result.stdout).toMatch(/REDIMENSIONNÉE SUR LE DISQUE/);
    expect(result.stdout).toContain("3000");
    expect(result.stdout).toContain("1,5 Mo");
  });

  it("refuses an empty --content instead of indexing the whole repository", () => {
    for (const spelling of ["japon-2024 --content=", 'japon-2024 --content ""']) {
      const result = run(spelling);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("L'option --content attend un dossier.");
    }
  });

  /**
   * The `--` npm eats, in the shape a script *can* detect: a bare positional that
   * looks like the value of an option nobody passed. The `=` spellings leave no
   * trace at all, which is why the documentation is the only defence against them
   * and why `cli.test.ts` checks every published command line.
   */
  it("diagnoses the swallowed --content and prints the line to retype", () => {
    const result = run("japon-2024 /tmp/bac/trips");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("npm l'a avalé");
    expect(result.stderr).toContain("npm run index-photos -- japon-2024 --content /tmp/bac/trips");
  });
});

/**
 * The debris an interrupted write can leave inside `content/trips/`, and the
 * question asked of **git** rather than of `.gitignore`'s text: a pattern that
 * happens to appear in the file is not the same thing as a pattern that matches
 * what this module really writes.
 *
 * Same guard, same reasoning, as `geocode`'s — and it is a separate one rather
 * than a shared assertion, because the two commands write two different markers
 * and either entry could be dropped alone.
 */
describe("the temporary file an interrupted run leaves behind", () => {
  it("is ignored by git, asked of git itself", () => {
    const temporaryName = `.trip.yaml${TEMPORARY_MARKER}${process.pid}${TEMPORARY_SUFFIX}`;
    const inside = path.join("content", "trips", "japon-2024", temporaryName);

    const asked = spawnSync("git", ["check-ignore", "-v", inside], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    expect(asked.status, `git does not ignore ${inside}`).toBe(0);
    expect(asked.stdout).toContain(TEMPORARY_FILE_GLOB);
  });
});
