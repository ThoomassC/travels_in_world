import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { escapeControls, quoted } from "@/content/finding";
import { validateContent } from "@/content/validate";
import type { ContentFinding, ContentValidation } from "@/content/validate";
import { describeField } from "@/content/report";
import { BLUR_PLACEHOLDER } from "../domain/fixtures";
import { temporaryContent, tripYaml } from "./support";
import type { TemporaryContent } from "./support";

/**
 * One case per defect an adversarial review reproduced on the finished script.
 *
 * They are gathered here rather than spread through the suite because they share
 * a single property: each one was **green** before. The script exited 0, or
 * exited 1 with a message that sent the author to the wrong line, to the wrong
 * fault, or — twice — to a command that would have destroyed a real trip.
 *
 * Control characters are written as escapes throughout: a test file holding a
 * literal ESC is a test file nobody can review in a terminal.
 */

const ESCAPE = String.fromCodePoint(27);
const NUL = String.fromCodePoint(0);
const BELL = String.fromCodePoint(7);
const CSI = String.fromCodePoint(0x9b);

let temporary: TemporaryContent | undefined;

afterEach(() => {
  temporary?.cleanup();
  temporary = undefined;
});

function validate(
  trips: Readonly<Record<string, string>>,
  files?: readonly string[]
): ContentValidation {
  temporary = temporaryContent(trips, files);
  return validateContent(temporary);
}

const findingAt = (validation: ContentValidation, field: string): ContentFinding | undefined =>
  validation.findings.find((finding) => describeField(finding.field) === field);

const lineOf = (validation: ContentValidation, field: string): number | undefined =>
  findingAt(validation, field)?.location?.line;

/** The line a piece of source sits on, so no expectation is a magic number. */
const lineIn = (source: string, text: string): number => source.split("\n").indexOf(text) + 1;

/* ------------------------------------------------------- the position itself -- */

describe("a finding points at the line the field is written on", () => {
  it("names the key, not the first line of its value (a forgotten plural)", () => {
    const source = tripYaml({ photos: "photo:\n  - src: /photos/x.jpg" });
    const validation = validate({ "japon-2024": source });

    // The value starts on the next line, where the word "photo" does not appear.
    expect(lineOf(validation, "photo")).toBe(lineIn(source, "photo:"));
  });

  it("is not pushed down by a comment between the key and its value", () => {
    const source = tripYaml({
      photos: "photo:\n  # relevé plus tard\n  # à trier\n  - src: /photos/x.jpg",
    });

    expect(lineOf(validate({ "japon-2024": source }), "photo")).toBe(lineIn(source, "photo:"));
  });

  it("finds a key YAML parsed as a number, instead of blaming line 1", () => {
    const source = `${tripYaml()}2024: une note\n`;
    const validation = validate({ "japon-2024": source });

    // The path carries the string "2024", the document a number: the lookup used
    // to fail, walk up to the document, and report the first line of the file.
    expect(lineOf(validation, "2024")).toBe(lineIn(source, "2024: une note"));
    expect(lineOf(validation, "2024")).not.toBe(1);
  });

  it("omits the position rather than pointing at an unrelated line", () => {
    // `steps` absent: nothing in the document carries that name, and the file as
    // a whole is the context. No position is the honest answer.
    const validation = validate({ "japon-2024": tripYaml({ steps: "" }) });

    expect(findingAt(validation, "steps")?.location).toBeUndefined();
  });

  it("still steps up one level for a key that was never written", () => {
    // The legitimate walk-up: `places[1].coordinates` has no node of its own, and
    // the line of the `places[1]` entry is where the author has to look.
    const source = tripYaml({
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

    expect(lineOf(validate({ "japon-2024": source }), "places[1].coordinates")).toBe(
      lineIn(source, "  - slug: kyoto")
    );
  });
});

/* -------------------------------------------------------------- false greens -- */

describe("nothing passes that should not", () => {
  it("refuses a __proto__ key, which no schema can see", () => {
    // Assigning `__proto__` sets a prototype instead of creating an own property,
    // so `z.strictObject` found nothing to complain about: exit 0, "1 voyage
    // validé", and the value went on to the loader.
    const validation = validate({ "japon-2024": `${tripYaml()}__proto__: pollué\n` });

    expect(validation.findings).toHaveLength(1);
    expect(validation.findings[0]?.problem).toContain("__proto__");
    expect(validation.findings[0]?.problem).toContain("prototype");
  });

  it("compares a photo path to the real name on disk, case included", () => {
    const validation = validate(
      { "japon-2024": tripYaml({ photos: photosBlock("/photos/japon-2024/Tokyo.JPG") }) },
      ["photos/japon-2024/tokyo.jpg"]
    );

    // Green on macOS, 404 on the Linux CDN. And the near-miss is worth naming.
    const finding = findingAt(validation, "photos[0].src");
    expect(finding?.problem).toContain("tokyo.jpg");
    expect(finding?.action).toContain("casse");
  });

  it("compares the trip file name too, and asks for a rename rather than a rewrite", () => {
    temporary = temporaryContent({});
    const directory = path.join(temporary.contentDir, "japon-2024");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "Trip.yaml"), tripYaml(), "utf8");

    const validation = validateContent(temporary);

    expect(validation.findings[0]?.problem).toContain("Trip.yaml");
    expect(validation.findings[0]?.action).toContain("renomme");
  });

  it("decodes an URL-escaped photo path before looking for it", () => {
    const validation = validate(
      { "japon-2024": tripYaml({ photos: photosBlock("/photos/japon-2024/tokyo%20matin.jpg") }) },
      ["photos/japon-2024/tokyo matin.jpg"]
    );

    // Undecoded, the file was never found *and* the action told the author to
    // create one whose name contains a literal "%20".
    expect(validation.findings).toEqual([]);
  });

  it("still refuses to leave the public directory through an encoded ..", () => {
    const validation = validate({
      "japon-2024": tripYaml({ photos: photosBlock("/%2e%2e/%2e%2e/etc/passwd") }),
    });

    expect(findingAt(validation, "photos[0].src")?.problem).toContain("sort du dossier public");
  });

  it("reports a broken symlink instead of dropping the trip", () => {
    temporary = temporaryContent({});
    symlinkSync("/nowhere/at/all", path.join(temporary.contentDir, "japon-2024"));

    const validation = validateContent(temporary);

    // `readdir` calls it neither a file nor a directory: the trip used to vanish
    // and the run to exit 0 with "aucun voyage".
    expect(validation.tripCount).toBe(1);
    expect(validation.findings[0]?.problem).toContain("lien symbolique cassé");
  });

  it("ignores hidden entries instead of calling them unfinished trips", () => {
    temporary = temporaryContent({});
    mkdirSync(path.join(temporary.contentDir, ".Spotlight-V100"), { recursive: true });
    writeFileSync(path.join(temporary.contentDir, ".gitkeep"), "", "utf8");

    expect(validateContent(temporary)).toMatchObject({ tripCount: 0, findings: [] });
  });
});

/* ------------------------------------------------- advice that must not harm -- */

describe("no finding advises destroying content", () => {
  /** Runs the validation with `target` unreadable, and restores it whatever happens. */
  function whileUnreadable(target: string, roots: TemporaryContent): ContentValidation {
    chmodSync(target, 0o000);
    try {
      return validateContent(roots);
    } finally {
      chmodSync(target, 0o755);
    }
  }

  it("says a trip directory is unreadable rather than empty", () => {
    temporary = temporaryContent({ "japon-2024": tripYaml() });
    const validation = whileUnreadable(path.join(temporary.contentDir, "japon-2024"), temporary);

    // `existsSync` swallowed the EACCES, so an unreadable trip was reported as
    // "trip.yaml is absent — remove the folder". Following that deletes a trip.
    const [finding] = validation.findings;
    expect(finding?.problem).toContain("n'est pas lisible");
    expect(finding?.action).not.toContain("retire");
  });

  it("reports an unreadable content root without a stack trace", () => {
    temporary = temporaryContent({ "japon-2024": tripYaml() });
    const validation = whileUnreadable(temporary.contentDir, temporary);

    expect(validation.findings).toHaveLength(1);
    expect(validation.findings[0]?.problem).toContain("n'est pas lisible");
    expect(validation.structuralCount).toBe(1);
  });
});

/* ------------------------------------------------------ messages that mislead -- */

describe("a message says the fault that was made", () => {
  it("does not read a fallback into the value slot for an empty date", () => {
    const validation = validate({ "japon-2024": tripYaml({ startDate: "startDate:" }) });

    // Was "la date est absente n'est pas écrite AAAA-MM-JJ": a sentence
    // contradicting itself, from a suggestion injected where a value belongs.
    expect(findingAt(validation, "startDate")?.problem).toBe("la date n'est pas renseignée");
  });

  it("calls a decimal comma a number problem, not an out-of-range coordinate", () => {
    const validation = validate({ "japon-2024": tripYaml({ places: placesBlock("35,0116") }) });
    const problem = findingAt(validation, "places[1].coordinates.lat")?.problem ?? "";

    expect(problem).toContain("n'est pas un nombre");
    expect(problem).not.toContain("bornes");
  });

  it("says a coordinate is missing rather than out of range", () => {
    const validation = validate({ "japon-2024": tripYaml({ places: placesBlock("") }) });

    expect(findingAt(validation, "places[1].coordinates.lat")?.problem).toContain(
      "n'a pas de latitude"
    );
  });

  it("agrees in number when a step references two undeclared places", () => {
    const validation = validate({
      "japon-2024": tripYaml({ steps: stepsWith("    fromSlug: osaka", "    toSlug: nara") }),
    });
    const problem = findingAt(validation, "steps[1]")?.problem ?? "";

    expect(problem).toContain("aux lieux");
    expect(problem).toContain("absents");
    expect(problem).toContain("« osaka » et « nara »");
  });

  it("numbers a step the way the field path numbers it", () => {
    const validation = validate({
      "japon-2024": tripYaml({ steps: stepsWith("    fromSlug: kyoto", "    toSlug: tokyo") }),
    });

    // "l'étape 1" read as the first step while it meant the second.
    expect(findingAt(validation, "steps[1].fromSlug")?.problem).toContain("l'étape steps[1]");
  });

  it("reports an empty cover once, not twice at the same position", () => {
    const validation = validate({ "japon-2024": tripYaml({ coverPhotoSrc: 'coverPhotoSrc: ""' }) });

    expect(validation.findings.map((finding) => finding.problem)).toEqual([
      "la photo de couverture est vide",
    ]);
  });

  it("keeps one YAML syntax error, and counts the ones it caused", () => {
    const source = tripYaml().replace("  - slug: tokyo", "\t- slug: tokyo");
    const validation = validate({ "japon-2024": source });

    // A single tab produced ten findings, nine of them lines the parser could no
    // longer read.
    expect(validation.findings).toHaveLength(1);
    expect(validation.findings[0]?.problem).toContain("Tab");
    expect(validation.findings[0]?.action).toContain("espaces");
    expect(validation.findings[0]?.action).toContain("en aval");
  });

  it("advises on duplicate keys without lecturing about indentation", () => {
    const validation = validate({ "japon-2024": `${tripYaml()}slug: encore\n` });

    expect(validation.findings[0]?.action).not.toContain("indentation");
    expect(validation.findings[0]?.action).toContain("doublon");
  });
});

/* -------------------------------------------------- the report stays readable -- */

describe("a written value cannot damage the report", () => {
  it("renders control characters inert and visible", () => {
    // ESC [ 2 J clears the screen and homes the cursor: the report erases itself.
    expect(quoted(`${ESCAPE}[2J${ESCAPE}[H`)).toBe("« \\e[2J\\e[H »");
    expect(quoted("avant\napres")).toBe("« avant\\napres »");
    expect(quoted(`${NUL}${BELL}${CSI}`)).toBe("« \\0\\a\\x9b »");
    expect(escapeControls("propre")).toBe("propre");
  });

  it("truncates a long value with a visible mark", () => {
    const rendered = quoted("x".repeat(400));

    // 80 code points, the ellipsis, and the four of « » and their spaces.
    expect(rendered).toContain("…");
    expect([...rendered]).toHaveLength(85);
  });

  it("keeps one finding on one line, whatever the file holds", () => {
    const validation = validate({
      "japon-2024": tripYaml({ slug: 'slug: "a\\nb\\e[2J"' }),
    });

    expect(validation.findings.length).toBeGreaterThan(0);
    for (const finding of validation.findings) {
      expect(finding.problem).not.toContain("\n");
      expect(finding.problem).not.toContain(ESCAPE);
      expect(finding.action).not.toContain(ESCAPE);
    }
  });
});

/* --------------------------------------------------------- an honest summary -- */

describe("the summary does not contradict itself", () => {
  it("counts a problem that belongs to no trip apart", () => {
    temporary = temporaryContent({ "japon-2024": tripYaml() });
    writeFileSync(path.join(temporary.contentDir, "perou-2023.yaml"), "slug: perou\n", "utf8");

    const validation = validateContent(temporary);

    // Was: "1 fichier en erreur, 1 problème." above "1 voyage validé, 0 en erreur."
    expect(validation).toMatchObject({
      tripCount: 1,
      validCount: 1,
      failedCount: 0,
      structuralCount: 1,
    });
  });
});

/* ------------------------------------------------------------------ helpers -- */

/**
 * A photo declaration, deliberately **narrower than the first derivative rung**.
 *
 * Every test using this helper is about resolving the `src` — case, URL escapes,
 * path traversal — and a 1600 px width would have each of them also report three
 * missing AVIF derivatives. The one test that asserts `findings` is empty would
 * then fail for a reason that has nothing to do with what it is checking. The
 * derivative check has its own fixture (`photo-without-derivatives`) and its own
 * cases in `tests/content/validate.test.ts`.
 */
function photosBlock(source: string): string {
  return [
    "photos:",
    `  - src: ${source}`,
    "    alt: Une ruelle de Shinjuku sous la pluie",
    "    width: 400",
    "    height: 267",
    `    blurDataUrl: ${BLUR_PLACEHOLDER}`,
  ].join("\n");
}

/** The reference places, with Kyoto's latitude written as the caller wants it. */
function placesBlock(latitude: string): string {
  return [
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
    `      lat: ${latitude}`,
    "      lon: 135.7681",
  ].join("\n");
}

/** A stay in Tokyo, then a move whose two ends the caller chooses. */
function stepsWith(fromLine: string, toLine: string): string {
  return [
    "steps:",
    "  - kind: stay",
    "    placeSlug: tokyo",
    "    startDate: 2024-04-12",
    "    endDate: 2024-04-16",
    "  - kind: move",
    fromLine,
    toLine,
    "    mode: train",
    "    date: 2024-04-16",
  ].join("\n");
}
