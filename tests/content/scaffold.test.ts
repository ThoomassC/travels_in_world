import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TRANSPORT_MODES, TripSchema } from "@/domain/schema";
import { createTrip, tripSkeleton } from "@/content/scaffold";
import { validateContent } from "@/content/validate";
import { temporaryContent } from "./support";
import type { TemporaryContent } from "./support";

/**
 * `npm run new-trip <slug>`: the file Thomas starts from.
 *
 * The skeleton has one job beyond being valid — it has to hand him the *next*
 * command. So the two things asserted hardest here are that it is refused by
 * `validate:content` for exactly one reason (the missing coordinates), and that
 * the reason names `npm run geocode`.
 */

const TODAY = "2026-08-20";

let workspace: TemporaryContent | undefined;

afterEach(() => {
  workspace?.cleanup();
  workspace = undefined;
});

describe("the skeleton itself", () => {
  const skeleton = tripSkeleton({ slug: "japon-2024", today: TODAY });

  it("carries the slug it was asked for", () => {
    expect(skeleton).toContain("slug: japon-2024");
  });

  it("is valid YAML describing a trip, apart from the coordinates", async () => {
    const { parse } = await import("yaml");
    const parsed = parse(skeleton) as Record<string, unknown>;
    const result = TripSchema.safeParse(parsed);

    expect(result.success).toBe(false);
    if (result.success) return;
    // Every issue is about coordinates and nothing else.
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "places.0.coordinates",
      "places.1.coordinates",
    ]);
  });

  it("declares both step forms, so neither has to be looked up", () => {
    expect(skeleton).toContain("kind: stay");
    expect(skeleton).toContain("kind: move");
  });

  it("lists the closed set of transport modes, in full", () => {
    for (const mode of TRANSPORT_MODES) {
      expect(skeleton).toContain(mode);
    }
  });

  it("explains itself in French, one line per field", () => {
    expect(skeleton).toContain("npm run geocode japon-2024");
    expect(skeleton).toMatch(/minuscules, chiffres et traits d'union/);
    expect(skeleton).toMatch(/ISO 3166-1 alpha-2/);
    expect(skeleton).toMatch(/AAAA-MM-JJ/);
  });

  it("dates the trip on the day it is created, so nothing is out of range", () => {
    expect(skeleton).toContain(`startDate: ${TODAY}`);
    expect(skeleton).toContain(`endDate: ${TODAY}`);
  });
});

describe("the skeleton, seen by validate:content", () => {
  it("is refused for the coordinates only, and names the command that fills them", () => {
    workspace = temporaryContent({});
    const created = createTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
      today: TODAY,
    });
    expect(created.state).toBe("created");

    const validation = validateContent({
      contentDir: workspace.contentDir,
      publicDir: workspace.publicDir,
      repoRoot: workspace.repoRoot,
      placesFile: workspace.placesFile,
    });

    expect(validation.findings).toHaveLength(2);
    for (const finding of validation.findings) {
      expect(finding.action).toContain("npm run geocode japon-2024");
    }
  });
});

describe("creating the trip on disk", () => {
  it("writes content/trips/<slug>/trip.yaml", () => {
    workspace = temporaryContent({});
    const outcome = createTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "perou-2023",
      today: TODAY,
    });

    expect(outcome.state).toBe("created");
    const file = path.join(workspace.contentDir, "perou-2023", "trip.yaml");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("slug: perou-2023");
  });

  it("refuses to overwrite an existing trip", () => {
    workspace = temporaryContent({ "japon-2024": "slug: japon-2024\n" });
    const outcome = createTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
      today: TODAY,
    });

    expect(outcome.state).toBe("exists");
    expect(readFileSync(path.join(workspace.contentDir, "japon-2024", "trip.yaml"), "utf8")).toBe(
      "slug: japon-2024\n"
    );
  });

  it("refuses a file that differs from trip.yaml only by case", () => {
    workspace = temporaryContent({});
    const directory = path.join(workspace.contentDir, "japon-2024");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "Trip.yaml"), "slug: japon-2024\n", "utf8");

    expect(
      createTrip({
        contentDir: workspace.contentDir,
        repoRoot: workspace.repoRoot,
        slug: "japon-2024",
        today: TODAY,
      }).state
    ).toBe("exists");
  });

  it("fills an existing folder that has no trip.yaml yet", () => {
    workspace = temporaryContent({});
    mkdirSync(path.join(workspace.contentDir, "japon-2024"), { recursive: true });

    expect(
      createTrip({
        contentDir: workspace.contentDir,
        repoRoot: workspace.repoRoot,
        slug: "japon-2024",
        today: TODAY,
      }).state
    ).toBe("created");
  });
});

describe("the slug is checked by the domain before anything is written", () => {
  const refused = ["Japon-2024", "japon_2024", "japon 2024", "-japon", "japon--2024", "", "é"];

  for (const slug of refused) {
    it(`refuses ${JSON.stringify(slug)} without creating a folder`, () => {
      workspace = temporaryContent({});
      const outcome = createTrip({
        contentDir: workspace.contentDir,
        repoRoot: workspace.repoRoot,
        slug,
        today: TODAY,
      });

      expect(outcome.state).toBe("invalid-slug");
      // Nothing at all was written — checked on the directory listing rather
      // than on the joined path, because `path.join(dir, "")` *is* `dir`.
      expect(readdirSync(workspace.contentDir)).toEqual([]);
    });
  }

  it("refuses a slug that would escape the content directory", () => {
    workspace = temporaryContent({});
    const outcome = createTrip({
      contentDir: workspace.contentDir,
      repoRoot: workspace.repoRoot,
      slug: "../../etc/passwd",
      today: TODAY,
    });

    expect(outcome.state).toBe("invalid-slug");
  });

  it("accepts the slugs content/README.md documents", () => {
    for (const slug of ["japon-2024", "perou-2023", "pyrenees-2022", "a1"]) {
      workspace?.cleanup();
      workspace = temporaryContent({});
      expect(
        createTrip({
          contentDir: workspace.contentDir,
          repoRoot: workspace.repoRoot,
          slug,
          today: TODAY,
        }).state
      ).toBe("created");
    }
  });
});
