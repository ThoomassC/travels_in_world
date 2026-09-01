import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateContent } from "@/content/validate";
import type { ContentFinding, ContentValidation } from "@/content/validate";
import { describeField } from "@/content/report";
import { BLUR_PLACEHOLDER } from "../domain/fixtures";
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

/**
 * The gap TIW-29 closes, and the reason it is a fixture rather than a throwaway
 * trip: this content used to pass `validate:content` with "1 voyage validé,
 * aucun problème" and fail `next build` mid-prerender, with a message pointing
 * the author back at the command that had just cleared it.
 *
 * `CountryCodeSchema` validates the *shape* of a code and refuses to know the
 * list of countries (`docs/adr/0001-domain-purity.md`), so `XK` is a perfectly
 * valid code as far as the domain is concerned. The registry is the validator's
 * business — the layer that already knows the disk and the whole collection.
 */
describe("a country code of the right shape that no country bears", () => {
  const validation = validateContent(fixtureRoots("unassigned-country-code"));
  const finding = single(validation);

  it("fails the validation instead of clearing the trip", () => {
    expect(validation).toMatchObject({ tripCount: 1, validCount: 0, failedCount: 1 });
  });

  it("names the field, in the form the author has to find in the file", () => {
    expect(describeField(finding.field)).toBe("places[1].countryCode");
  });

  it("names the file, the line and the column the code is written on", () => {
    expect(finding.file).toBe(
      "tests/fixtures/content/unassigned-country-code/trips/balkans-2025/trip.yaml"
    );
    expect(finding.location).toEqual({ line: 21, column: 5 });
  });

  /**
   * The whole point of question 1 of the ticket: an author who writes `XK` has
   * not mistyped anything — it is the code everyone uses for Kosovo — so the
   * message has to say why it is refused, and the reason is the map, not them.
   */
  it("says why XK in particular is refused, naming the place and the code", () => {
    expect(finding.problem).toContain("Prizren");
    expect(finding.problem).toContain("XK");
    expect(finding.problem).toContain("Kosovo");
    expect(finding.problem).toContain("ISO 3166-1");
    expect(finding.problem).toContain("carte");
  });

  it("gives a way out rather than only a refusal", () => {
    expect(finding.action).toMatch(/retire|rattache/);
  });

  it("never leaks the schema's own English message", () => {
    expect(`${finding.problem} ${finding.action}`).not.toMatch(/Expected|Invalid|invalid_/);
  });
});

/**
 * TIW-30, and the case TIW-29 left open on purpose.
 *
 * `SG` is not `XK`. Nothing is misspelled and nothing is unassigned: ISO 3166-1
 * gives Singapore `SG` and numeric `702`, and this validator's registry check
 * clears it. What refuses it is the *basemap*, which at the 110m vintage carries
 * no micro-state at all — measured, 75 of the 249 assigned codes have no shape —
 * so `buildWorldGeometry` threw in the middle of the prerender of `/fr`.
 *
 * The map's message was already good (it never sent the author back here, which
 * was TIW-29's actual defect); it was simply the wrong *moment*. This block is
 * the moment moved earlier.
 */
describe("a country the ISO assigns but the shipped basemap cannot draw", () => {
  const validation = validateContent(fixtureRoots("undrawable-country-code"));
  const finding = single(validation);

  it("fails the validation instead of leaving it to the prerender", () => {
    expect(validation).toMatchObject({ tripCount: 1, validCount: 0, failedCount: 1 });
  });

  it("names the field, in the form the author has to find in the file", () => {
    expect(describeField(finding.field)).toBe("places[1].countryCode");
  });

  it("names the file, the line and the column the code is written on", () => {
    expect(finding.file).toBe(
      "tests/fixtures/content/undrawable-country-code/trips/asie-du-sud-est-2025/trip.yaml"
    );
    expect(finding.location).toEqual({ line: 21, column: 5 });
  });

  /**
   * The whole difficulty of the ticket, in one assertion: the author has to be
   * told that the code is *right* and the map is what is missing. Told "this code
   * is assigned to no country" — the `XK` sentence — they would go looking for a
   * typo that is not there.
   */
  it("says the code is valid and the basemap is what lacks the shape", () => {
    expect(finding.problem).toContain("Singapour");
    expect(finding.problem).toContain("SG");
    expect(finding.problem).toContain("110m");
    expect(finding.problem).not.toMatch(/n'attribue|aucun pays/);
  });

  it("does not tell the author to run the validator that just refused them", () => {
    expect(finding.action).not.toContain("validate:content");
    expect(finding.command ?? "").not.toContain("validate:content");
  });

  it("gives a way out rather than only a refusal", () => {
    expect(finding.action).toMatch(/retire|rattache/);
  });

  /**
   * The escape route is a budget decision, so it is quoted with its price. A
   * finer vintage of the same package does draw Singapore — measured 182.5 KB
   * brotli of paths against a 34 KB ceiling — and an action that mentioned the
   * switch without the number would be an invitation to blow the budget.
   */
  it("prices the finer vintage rather than merely naming it", () => {
    expect(finding.action).toContain("50m");
    expect(finding.action).toMatch(/34|182/);
  });

  it("never leaks the schema's own English message", () => {
    expect(`${finding.problem} ${finding.action}`).not.toMatch(/Expected|Invalid|invalid_/);
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

/**
 * A photo the author declared and never indexed. All three machine-written
 * fields are absent, and each earns its own line naming the one command that
 * writes them — the same contract `coordinates` has with `npm run geocode`.
 */
describe("a photo that has never been indexed", () => {
  const validation = validateContent(fixtureRoots("photo-without-dimensions"));

  it("names the three missing fields, and the indexing command for each", () => {
    expect(fields(validation)).toEqual([
      "photos[0].width",
      "photos[0].height",
      "photos[0].blurDataUrl",
    ]);
    expect(validation.findings.map((finding) => finding.command)).toEqual([
      "npm run index-photos japon-2024",
      "npm run index-photos japon-2024",
      "npm run index-photos japon-2024",
    ]);
  });
});

/**
 * The derivative files, which are the one photo check no schema can make and the
 * one whose absence is *invisible* on the page.
 *
 * A `<picture>` commits to the `<source>` a browser selects: if the AVIF 404s the
 * browser shows a broken image and does **not** fall through to the `<img>`. So a
 * declared photo whose derivatives are missing is a hole in the page that
 * `next build` reports nothing about — exactly the shape of fault this validator
 * exists for, and the same reasoning as the original-file check beside it.
 */
describe("a photo whose derivatives have not been written", () => {
  const photo = [
    "photos:",
    "  - src: /photos/japon-2024/tokyo.jpg",
    "    alt: Une ruelle de Shinjuku sous la pluie",
    "    width: 1600",
    "    height: 1067",
    `    blurDataUrl: ${BLUR_PLACEHOLDER}`,
  ].join("\n");

  it("names the widths that are missing, once, and the command that writes them", () => {
    const finding = single(
      validateSource(tripYaml({ photos: photo }), ["photos/japon-2024/tokyo.jpg"])
    );

    expect(describeField(finding.field)).toBe("photos[0].src");
    expect(finding.problem).toContain("480");
    expect(finding.problem).toContain("960");
    expect(finding.problem).toContain("1440");
    expect(finding.command).toBe("npm run index-photos japon-2024");
  });

  /**
   * One line, not three. The three files are written by one run of one command,
   * so three findings would be the same repair said three times — the noise
   * `deduplicate` and the derived-rule filter exist to keep out of this report.
   */
  it("reports one line for the three widths, not one per width", () => {
    const validation = validateSource(tripYaml({ photos: photo }), ["photos/japon-2024/tokyo.jpg"]);

    expect(validation.findings).toHaveLength(1);
  });

  it("says nothing once every derivative is on disk", () => {
    const validation = validateSource(tripYaml({ photos: photo }), [
      "photos/japon-2024/tokyo.jpg",
      "photos/japon-2024/tokyo-480.avif",
      "photos/japon-2024/tokyo-960.avif",
      "photos/japon-2024/tokyo-1440.avif",
    ]);

    expect(validation.findings).toEqual([]);
  });

  /**
   * A photo narrower than the first rung has no derivative to look for, so the
   * check has to be silent rather than demand a file the command will never
   * write. Measured as a real trap in the first version: the loop asked for every
   * rung unconditionally and refused every thumbnail on the site.
   */
  it("asks for nothing from a photo narrower than the first rung", () => {
    const small = [
      "photos:",
      "  - src: /photos/japon-2024/vignette.jpg",
      "    alt: Une vignette",
      "    width: 320",
      "    height: 213",
      `    blurDataUrl: ${BLUR_PLACEHOLDER}`,
    ].join("\n");

    const validation = validateSource(tripYaml({ photos: small }), [
      "photos/japon-2024/vignette.jpg",
    ]);

    expect(validation.findings).toEqual([]);
  });

  it("names only the widths that are absent when some are already there", () => {
    const finding = single(
      validateSource(tripYaml({ photos: photo }), [
        "photos/japon-2024/tokyo.jpg",
        "photos/japon-2024/tokyo-480.avif",
      ])
    );

    expect(finding.problem).not.toContain("480");
    expect(finding.problem).toContain("960");
    expect(finding.problem).toContain("1440");
  });
});

describe("a photo attached to a place the trip does not declare", () => {
  it("names the slug, the photo and what to write instead", () => {
    const photo = [
      "photos:",
      "  - src: /photos/japon-2024/tokyo.jpg",
      "    alt: Une ruelle de Shinjuku sous la pluie",
      "    placeSlug: osaka",
      "    width: 400",
      "    height: 267",
      `    blurDataUrl: ${BLUR_PLACEHOLDER}`,
    ].join("\n");

    const finding = single(
      validateSource(tripYaml({ photos: photo }), ["photos/japon-2024/tokyo.jpg"])
    );

    expect(describeField(finding.field)).toBe("photos[0].placeSlug");
    expect(finding.problem).toContain("osaka");
    // The places that *are* declared, so the repair is a copy rather than a hunt.
    expect(finding.action).toContain("tokyo");
    expect(finding.action).toContain("kyoto");
  });
});

/**
 * The name collision, said in French. `tokyo-480.jpg` is exactly where
 * `index-photos` writes the 480 px derivative of `tokyo.jpg`, so one of the two
 * files is doomed — and the refusal has to say *rename it*, never "run the
 * command", because running the command is what would destroy the original.
 */
describe("a photo named the way the pipeline names its own output", () => {
  it("asks for a rename and does not offer the indexing command", () => {
    const photo = [
      "photos:",
      "  - src: /photos/japon-2024/tokyo-480.jpg",
      "    alt: Une ruelle de Shinjuku sous la pluie",
      "    width: 400",
      "    height: 267",
      `    blurDataUrl: ${BLUR_PLACEHOLDER}`,
    ].join("\n");

    const finding = single(
      validateSource(tripYaml({ photos: photo }), ["photos/japon-2024/tokyo-480.jpg"])
    );

    expect(describeField(finding.field)).toBe("photos[0].src");
    expect(finding.problem).toContain("480");
    expect(finding.action).toContain("renomme");
    expect(finding.command).toBeUndefined();
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

  /**
   * The country-code family, in the three shapes an author meets it. The fixture
   * above covers `XK` end to end; these pin the wording of the other two, and the
   * third case is the one that would rot silently — two findings on one field say
   * the same thing twice, and `deduplicate` cannot merge them because it keys on
   * the field *and* the problem.
   */
  const placeWith = (code: string): string =>
    [
      "places:",
      "  - slug: tokyo",
      "    name: Tokyo",
      `    countryCode: ${code}`,
      "    coordinates:",
      "      lat: 35.6762",
      "      lon: 139.6503",
    ].join("\n");

  it("refuses a well-formed country code that no country bears", () => {
    const report = problemOf(tripYaml({ places: placeWith("ZZ"), steps: steps(STAY_TOKYO) }));

    expect(report).toContain("places[0].countryCode ::");
    expect(report).toContain("Tokyo");
    expect(report).toContain("ZZ");
    expect(report).toContain("ISO 3166-1");
    expect(report).toContain("carte");
  });

  it("answers UK with the code ISO actually assigns, rather than with a spelling lecture", () => {
    const report = problemOf(tripYaml({ places: placeWith("UK"), steps: steps(STAY_TOKYO) }));

    expect(report).toContain("places[0].countryCode ::");
    expect(report).toContain("GB");
    expect(report).not.toContain("majuscules");
  });

  it("says a withdrawn code was withdrawn, and what replaced it", () => {
    const report = problemOf(tripYaml({ places: placeWith("ZR"), steps: steps(STAY_TOKYO) }));

    expect(report).toContain("Zaïre");
    expect(report).toContain("CD");
  });

  it("reports a malformed code once, and leaves it to the schema", () => {
    const validation = validateSource(
      tripYaml({ places: placeWith("JPN"), steps: steps(STAY_TOKYO) })
    );

    expect(fields(validation)).toEqual(["places[0].countryCode"]);
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
