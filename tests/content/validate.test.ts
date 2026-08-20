import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateContent } from "@/content/validate";
import type { ContentFinding, ContentValidation } from "@/content/validate";
import { describeField } from "@/content/report";
import { fixtureRoots, temporaryContent, tripYaml } from "./support";
import type { TemporaryContent } from "./support";

/**
 * The diagnosis layer: what `validate:content` *finds*, and above all how it
 * says it. The wording is the deliverable of TIW-9, so it is asserted here
 * rather than eyeballed — a message that stops naming the field or the command
 * to run has regressed even though the exit code is unchanged.
 */

const fields = (validation: ContentValidation): readonly string[] =>
  validation.findings.map((finding) => describeField(finding.field));

const single = (validation: ContentValidation): ContentFinding => {
  expect(validation.findings.map((finding) => finding.problem)).toHaveLength(1);
  const [finding] = validation.findings;
  if (finding === undefined) {
    throw new Error("expected exactly one finding");
  }
  return finding;
};

let temporary: TemporaryContent | undefined;

afterEach(() => {
  temporary?.cleanup();
  temporary = undefined;
});

/** Validates a one-off trip written as YAML text, in a throwaway directory. */
function validateSource(source: string, files: readonly string[] = []): ContentValidation {
  temporary = temporaryContent({ "japon-2024": source }, files);
  return validateContent(temporary);
}

describe("a complete, valid trip", () => {
  const validation = validateContent(fixtureRoots("valid-trip"));

  it("reports nothing", () => {
    expect(validation.findings).toEqual([]);
  });

  it("counts the trip as validated", () => {
    expect(validation).toMatchObject({ tripCount: 1, validCount: 1, failedCount: 0 });
  });
});

describe("an empty content directory", () => {
  const validation = validateContent(fixtureRoots("no-trips"));

  it("is not an error: the real trips land with TIW-24", () => {
    expect(validation).toMatchObject({
      tripCount: 0,
      validCount: 0,
      failedCount: 0,
      findings: [],
    });
  });
});

describe("a place without coordinates (acceptance criterion 3)", () => {
  const validation = validateContent(fixtureRoots("place-without-coordinates"));
  const finding = single(validation);

  it("points at the place that lacks them, not at the trip", () => {
    expect(describeField(finding.field)).toBe("places[1].coordinates");
  });

  it("names the city as the author wrote it", () => {
    expect(finding.problem).toContain("Kyoto");
    expect(finding.problem).toContain("coordonnées");
  });

  it("gives the exact command that fills them in", () => {
    expect(finding.command).toBe("npm run geocode japon-2024");
    expect(finding.action).toContain("npm run geocode japon-2024");
  });

  it("points at the line the place is declared on", () => {
    expect(finding.location).toMatchObject({ line: 13 });
  });
});

describe("coordinates at (0, 0)", () => {
  const finding = single(validateContent(fixtureRoots("null-island-coordinates")));

  it("is reported as a failed geocoding, with the command to run again", () => {
    expect(describeField(finding.field)).toBe("places[1].coordinates");
    expect(finding.problem).toContain("(0, 0)");
    expect(finding.command).toBe("npm run geocode japon-2024");
  });
});

describe("an endDate before the startDate (acceptance criterion 4)", () => {
  const validation = validateContent(fixtureRoots("end-date-before-start-date"));
  const finding = single(validation);

  it("explains the inversion in French, with both dates", () => {
    expect(describeField(finding.field)).toBe("endDate");
    expect(finding.problem).toContain("2024-04-10");
    expect(finding.problem).toContain("2024-04-12");
    expect(finding.action).toContain("endDate");
  });

  it("never leaks the schema's own English message", () => {
    expect(finding.problem).not.toContain("The trip ends");
    expect(finding.problem).not.toContain("Invalid");
  });

  /**
   * The domain reports every step as out of range too — correctly, since the
   * range is inverted — and those five lines all accuse healthy steps. An
   * out-of-range check against an impossible range carries no information, so
   * the reporter drops them and keeps the one line that names the fault.
   */
  it("does not accuse the steps that the inverted range makes out of bounds", () => {
    expect(fields(validation)).toEqual(["endDate"]);
  });
});

describe("a duplicated trip slug across the collection (acceptance criterion 5)", () => {
  const validation = validateContent(fixtureRoots("duplicate-trip-slug"));
  const finding = single(validation);

  it("reports the second declaration, naming the first file", () => {
    expect(finding.file).toContain("japon-2024-suite/trip.yaml");
    expect(describeField(finding.field)).toBe("slug");
    expect(finding.problem).toContain("japon-2024");
    expect(finding.problem).toContain("duplicate-trip-slug/trips/japon-2024/trip.yaml");
  });

  it("counts both trips, one of them in error", () => {
    expect(validation).toMatchObject({ tripCount: 2, validCount: 1, failedCount: 1 });
  });
});

describe("a photo that matches no file on disk (acceptance criterion 6)", () => {
  const validation = validateContent(fixtureRoots("missing-photo-file"));
  const finding = single(validation);

  it("reports it once, on the declaration, with the path that was expected", () => {
    expect(describeField(finding.field)).toBe("photos[0].src");
    expect(finding.problem).toContain("/photos/japon-2024/tokyo.jpg");
    expect(finding.action).toContain(
      "tests/fixtures/content/missing-photo-file/public/photos/japon-2024/tokyo.jpg"
    );
  });
});

describe("a cover photo that matches no file on disk (acceptance criterion 6)", () => {
  const validation = validateContent(fixtureRoots("missing-cover-photo-file"));

  it("reports the missing file on coverPhotoSrc, with the expected path", () => {
    const missing = validation.findings.filter((finding) => finding.problem.includes("aucun"));

    expect(missing.map((finding) => describeField(finding.field))).toEqual(["coverPhotoSrc"]);
    expect(missing[0]?.action).toContain(
      "tests/fixtures/content/missing-cover-photo-file/public/photos/japon-2024/couverture.jpg"
    );
  });

  it("also says, in French, that it is not one of the trip's photos", () => {
    const problems = validation.findings.map((finding) => finding.problem);

    expect(problems.some((problem) => problem.includes("photos[]"))).toBe(true);
    expect(problems.every((problem) => !problem.includes("cover photo"))).toBe(true);
  });
});

describe("a photo without dimensions", () => {
  const validation = validateContent(fixtureRoots("photo-without-dimensions"));

  it("names both missing fields and the indexing command", () => {
    expect(fields(validation)).toEqual(["photos[0].width", "photos[0].height"]);
    expect(validation.findings.map((finding) => finding.command)).toEqual([
      "npm run index-photos japon-2024",
      "npm run index-photos japon-2024",
    ]);
  });
});

describe("several faults in several files", () => {
  const validation = validateContent(fixtureRoots("several-faults"));

  it("reports them all, grouped file by file in a stable order", () => {
    expect(validation.findings.map((finding) => finding.file)).toEqual([
      "tests/fixtures/content/several-faults/trips/japon-2024/trip.yaml",
      "tests/fixtures/content/several-faults/trips/japon-2024/trip.yaml",
      "tests/fixtures/content/several-faults/trips/perou-2023/trip.yaml",
      "tests/fixtures/content/several-faults/trips/pyrenees-2022/trip.yaml",
    ]);
    expect(fields(validation)).toEqual([
      "places[1].countryCode",
      "steps[1].fromSlug",
      "endDate",
      "places[0].coordinates.lattitude",
    ]);
  });

  it("counts every trip as failed", () => {
    expect(validation).toMatchObject({ tripCount: 3, validCount: 0, failedCount: 3 });
  });

  it("names the step that leaves from the wrong place, and the misspelled key", () => {
    const [, step, , unknownKey] = validation.findings;

    expect(step?.problem).toContain("kyoto");
    expect(step?.problem).toContain("tokyo");
    expect(unknownKey?.problem).toContain("lattitude");
  });
});

describe("a trip directory without a trip.yaml", () => {
  const finding = single(validateContent(fixtureRoots("missing-trip-file")));

  it("names the file that is expected to exist", () => {
    expect(finding.file).toBe(
      "tests/fixtures/content/missing-trip-file/trips/japon-2024/trip.yaml"
    );
    expect(finding.problem).toContain("absent");
  });
});

describe("a trip.yaml that is not valid YAML", () => {
  const validation = validateContent(fixtureRoots("invalid-yaml"));

  it("reports the syntax error on its line, in one line", () => {
    const finding = single(validation);

    expect(finding.problem).toContain("YAML");
    expect(finding.problem).not.toContain("\n");
    expect(finding.location?.line).toBeGreaterThan(1);
  });
});

describe("a content directory that does not exist", () => {
  it("is an error rather than an empty, reassuring run", () => {
    temporary = temporaryContent({});
    const validation = validateContent({
      ...temporary,
      contentDir: `${temporary.contentDir}/nowhere`,
    });

    expect(validation.findings).toHaveLength(1);
    expect(validation.findings[0]?.problem).toContain("introuvable");
  });
});

/**
 * Nothing is skipped in silence. Every case here was found by probing the
 * finished script rather than by reading it, and each one was reported by
 * nothing at all before the check that answers it.
 */
describe("content that would otherwise be ignored", () => {
  it("reports a YAML file loose in the content root", () => {
    temporary = temporaryContent({});
    writeFileSync(path.join(temporary.contentDir, "japon-2024.yaml"), "slug: japon-2024\n", "utf8");

    const validation = validateContent(temporary);
    const finding = single(validation);

    expect(finding.file).toContain("japon-2024.yaml");
    expect(finding.problem).toContain("dossier");
    expect(finding.action).toContain(`japon-2024${path.sep}trip.yaml`);
  });

  it("reads a trip behind a symlinked directory", () => {
    temporary = temporaryContent({});
    const real = path.join(temporary.root, "ailleurs", "japon-2024");
    mkdirSync(real, { recursive: true });
    writeFileSync(path.join(real, "trip.yaml"), tripYaml(), "utf8");
    symlinkSync(real, path.join(temporary.contentDir, "japon-2024"));

    // `readdir` calls a symlink neither a file nor a directory: without the
    // check that follows it, this trip is simply absent from the report.
    expect(validateContent(temporary)).toMatchObject({ tripCount: 1, validCount: 1 });
  });

  it("says so honestly when nothing at all was read as a trip", () => {
    temporary = temporaryContent({});
    const validation = validateContent(temporary);

    expect(validation).toMatchObject({ tripCount: 0, findings: [] });
  });

  it("reports an empty trip.yaml rather than treating it as an empty trip", () => {
    const finding = single(validateSource(""));

    expect(finding.problem).toContain("ne décrit pas un voyage");
  });

  it("translates a list-valued key that is not a list", () => {
    const validation = validateSource(tripYaml({ photos: "photos: oui" }));

    expect(validation.findings[0]?.problem).toContain("n'est pas une liste");
    expect(validation.findings[0]?.problem).not.toContain("array");
  });

  it("translates a cover photo left empty", () => {
    const validation = validateSource(tripYaml({ coverPhotoSrc: 'coverPhotoSrc: ""' }));

    expect(validation.findings.map((finding) => finding.problem)).toContain(
      "la photo de couverture est vide"
    );
  });
});

/**
 * The rest of the catalogue, one throwaway trip per rule. These do not each earn
 * a committed fixture — only the acceptance criteria do — but every one of them
 * is a message Thomas can meet, and none of them may print English or a Zod
 * dump.
 */
describe("the message catalogue", () => {
  const problemOf = (source: string, files: readonly string[] = []): string =>
    validateSource(source, files)
      .findings.map(
        (finding) => `${describeField(finding.field)} :: ${finding.problem} :: ${finding.action}`
      )
      .join("\n");

  const STAY_TOKYO = [
    "  - kind: stay",
    "    placeSlug: tokyo",
    "    startDate: 2024-04-12",
    "    endDate: 2024-04-16",
  ];
  const MOVE_TOKYO_KYOTO = [
    "  - kind: move",
    "    fromSlug: tokyo",
    "    toSlug: kyoto",
    "    mode: train",
    "    date: 2024-04-16",
  ];
  const steps = (...blocks: readonly (readonly string[])[]): string =>
    ["steps:", ...blocks.flat()].join("\n");
  const replacing = (block: readonly string[], from: string, to: string): readonly string[] =>
    block.map((line) => line.replace(from, to));

  it("translates a malformed date", () => {
    const report = problemOf(tripYaml({ endDate: "endDate: 2024-4-1" }));

    expect(report).toContain("endDate ::");
    expect(report).toContain("2024-4-1");
    expect(report).toContain("AAAA-MM-JJ");
  });

  it("translates a day that does not exist on the calendar", () => {
    expect(problemOf(tripYaml({ endDate: "endDate: 2024-02-30" }))).toContain("calendrier");
  });

  it("translates an invalid slug", () => {
    const report = problemOf(tripYaml({ slug: "slug: Japon 2024" }));

    expect(report).toContain("slug ::");
    expect(report).toContain("Japon 2024");
  });

  it("translates an invalid country code", () => {
    const report = problemOf(
      tripYaml({
        places: [
          "places:",
          "  - slug: tokyo",
          "    name: Tokyo",
          "    countryCode: JPN",
          "    coordinates:",
          "      lat: 35.6762",
          "      lon: 139.6503",
        ].join("\n"),
        steps: steps(STAY_TOKYO),
      })
    );

    expect(report).toContain("places[0].countryCode ::");
    expect(report).toContain("JPN");
    expect(report).toContain("ISO 3166");
  });

  it("translates an unknown transport mode, listing the ones that exist", () => {
    const report = problemOf(
      tripYaml({
        steps: steps(STAY_TOKYO, replacing(MOVE_TOKYO_KYOTO, "mode: train", "mode: teleport")),
      })
    );

    expect(report).toContain("steps[1].mode ::");
    expect(report).toContain("teleport");
    expect(report).toContain("train");
  });

  it("translates an unknown step kind", () => {
    const report = problemOf(
      tripYaml({ steps: steps(replacing(STAY_TOKYO, "kind: stay", "kind: flight")) })
    );

    expect(report).toContain("steps[0].kind ::");
    expect(report).toContain("flight");
  });

  it("translates a step that references an undeclared place", () => {
    const report = problemOf(
      tripYaml({
        steps: steps(STAY_TOKYO, replacing(MOVE_TOKYO_KYOTO, "toSlug: kyoto", "toSlug: osaka")),
      })
    );

    expect(report).toContain("osaka");
    expect(report).toContain("places[]");
  });

  it("translates a place no step ever reaches", () => {
    const report = problemOf(tripYaml({ steps: steps(STAY_TOKYO) }));

    expect(report).toContain("places[1] ::");
    expect(report).toContain("kyoto");
  });

  it("translates a step dated outside the trip", () => {
    const report = problemOf(
      tripYaml({
        steps: steps(
          STAY_TOKYO,
          replacing(MOVE_TOKYO_KYOTO, "date: 2024-04-16", "date: 2024-05-30")
        ),
      })
    );

    expect(report).toContain("steps[1] ::");
    expect(report).toContain("2024-04-12");
    expect(report).toContain("2024-04-16");
  });

  it("translates two stays with the missing move between them", () => {
    const report = problemOf(
      tripYaml({
        steps: steps(replacing(STAY_TOKYO, "endDate: 2024-04-16", "endDate: 2024-04-14"), [
          "  - kind: stay",
          "    placeSlug: kyoto",
          "    startDate: 2024-04-14",
          "    endDate: 2024-04-16",
        ]),
      })
    );

    expect(report).toContain("steps[1].placeSlug ::");
    expect(report).toContain("déplacement");
  });

  it("translates a move that arrives where it left from", () => {
    const report = problemOf(
      tripYaml({
        places: [
          "places:",
          "  - slug: tokyo",
          "    name: Tokyo",
          "    countryCode: JP",
          "    coordinates:",
          "      lat: 35.6762",
          "      lon: 139.6503",
        ].join("\n"),
        steps: steps(STAY_TOKYO, replacing(MOVE_TOKYO_KYOTO, "toSlug: kyoto", "toSlug: tokyo")),
      })
    );

    expect(report).toContain("steps[1].toSlug ::");
    expect(report).toContain("tokyo");
  });

  it("translates a stay that ends before it starts", () => {
    const report = problemOf(
      tripYaml({
        steps: steps(
          [
            "  - kind: stay",
            "    placeSlug: tokyo",
            "    startDate: 2024-04-16",
            "    endDate: 2024-04-12",
          ],
          MOVE_TOKYO_KYOTO
        ),
      })
    );

    expect(report).toContain("steps[0].endDate ::");
  });

  it("translates a blank title", () => {
    expect(problemOf(tripYaml({ title: 'title: "   "' }))).toContain("titre");
  });

  it("translates a photo without alternative text", () => {
    const report = problemOf(
      tripYaml({
        photos: [
          "photos:",
          "  - src: /photos/japon-2024/tokyo.jpg",
          '    alt: ""',
          "    width: 1600",
          "    height: 1067",
        ].join("\n"),
      }),
      ["photos/japon-2024/tokyo.jpg"]
    );

    expect(report).toContain("photos[0].alt ::");
  });

  it("translates a duplicated tag", () => {
    const report = problemOf(tripYaml({ tags: ["tags:", "  - asie", "  - asie"].join("\n") }));

    expect(report).toContain("tags[1] ::");
    expect(report).toContain("asie");
  });

  it("translates a budget with a fractional total and no traveller", () => {
    const report = problemOf(
      tripYaml({
        budget: ["budget:", "  totalCents: 4200.5", "  currency: eur", "  travellers: 0"].join(
          "\n"
        ),
      })
    );

    expect(report).toContain("budget.totalCents ::");
    expect(report).toContain("budget.currency ::");
    expect(report).toContain("budget.travellers ::");
    expect(report).toContain("EUR");
  });

  it("translates a file that does not describe a trip at all", () => {
    const report = problemOf("- juste une liste\n");

    expect(report).toContain("voyage");
  });

  it("never prints a Zod code or an English sentence", () => {
    const everything = [
      problemOf(tripYaml({ endDate: "endDate: 2024-4-1" })),
      problemOf(tripYaml({ slug: "slug: Japon 2024" })),
      problemOf(tripYaml({ title: "title: 42" })),
      problemOf("- juste une liste\n"),
    ].join("\n");

    expect(everything).not.toMatch(/invalid_|too_small|too_big|unrecognized_keys/);
    expect(everything).not.toMatch(/Invalid input|Expected|Unrecognized/);
  });
});
