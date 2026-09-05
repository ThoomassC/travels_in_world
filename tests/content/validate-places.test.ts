import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { describeField, formatReport } from "@/content/report";
import { validateContent } from "@/content/validate";
import type { ContentValidation } from "@/content/validate";
import { placesYaml, temporaryContent, tripYaml } from "./support";
import type { PlaceSource, TemporaryContent } from "./support";

/**
 * `npm run validate:content` on `content/places.yaml` (TIW-36).
 *
 * **Why the validator has to know about this file at all**, rather than leaving it
 * to the loader that already refuses the same things: the two owe different
 * outputs, and TIW-29 measured what happens when only one of them knows. A
 * `countryCode` of `SG` is perfectly assigned and perfectly undrawable, so it
 * cleared validation and then killed `next build` in the middle of prerendering
 * `/fr` — with an error message telling the author to run the very command that
 * had just declared the file sound. A places file outside the validator's reach
 * would reopen that loop exactly, one collection over.
 *
 * So the assertions below are about **lines and sentences**: which field, which
 * line, and which command ends the problem.
 */

const fields = (validation: ContentValidation): readonly string[] =>
  validation.findings.map((finding) => describeField(finding.field));

const problems = (validation: ContentValidation): string =>
  validation.findings.map((finding) => `${finding.problem} → ${finding.action}`).join(" | ");

let temporary: TemporaryContent | undefined;

afterEach(() => {
  temporary?.cleanup();
  temporary = undefined;
});

/** Validates a places file written as YAML text, beside an empty trips folder. */
function validatePlaces(
  places: string,
  trips: Readonly<Record<string, string>> = {}
): ContentValidation {
  temporary = temporaryContent(trips, [], places);

  return validateContent(temporary);
}

const ROUEN: PlaceSource = {
  slug: "rouen",
  name: "Rouen",
  countryCode: "FR",
  coordinates: { lat: 49.4432, lon: 1.0999 },
};

describe("a valid places file", () => {
  it("is reported as validated, with no problem", () => {
    const validation = validatePlaces(
      placesYaml([ROUEN, { ...ROUEN, slug: "gand", name: "Gand", countryCode: "BE" }])
    );

    expect(validation.findings).toEqual([]);
    expect(validation.placeCount).toBe(2);
  });

  /**
   * No file is not a fault, and the count says so rather than the finding list
   * saying nothing. This is the state of every journal that has no dateless place
   * — which is to say, the state this repository was in before TIW-36 and the one
   * it returns to once the last place has been promoted.
   */
  it("counts no place and finds no problem when there is no file", () => {
    const temporaryRoots = temporaryContent({});
    temporary = temporaryRoots;
    const validation = validateContent(temporaryRoots);

    expect(validation.findings).toEqual([]);
    expect(validation.placeCount).toBe(0);
  });
});

describe("a place the schema refuses", () => {
  /**
   * The same sentence and the same command an author already meets on a trip, and
   * that is the point of reusing the diagnosis catalogue rather than writing a
   * second one: `places[].coordinates` is the same field shape in both files, so
   * one rule has one wording. Only the *command* differs, because only the
   * command depends on which file is being repaired.
   */
  it("names the city, the field and the command that fills the coordinates in", () => {
    const validation = validatePlaces(placesYaml([{ slug: "rouen", name: "Rouen" }]));

    expect(fields(validation)).toContain("places[0].coordinates");
    expect(problems(validation)).toContain("Rouen");
    expect(problems(validation)).toContain("npm run geocode:places");
    // And never the trip command, which takes an argument this file has not got.
    expect(problems(validation)).not.toContain("npm run geocode rouen");
  });

  it("points at the line the fault is written on", () => {
    const validation = validatePlaces(placesYaml([ROUEN, { slug: "gand", name: "Gand" }]));
    const [finding] = validation.findings;

    // `places:` is line 1, Rouen's four lines follow, so Gand's entry starts on 8.
    expect(finding?.location?.line).toBe(8);
  });

  it("refuses (0, 0), the signature of a geocoding that already failed", () => {
    const validation = validatePlaces(placesYaml([{ ...ROUEN, coordinates: { lat: 0, lon: 0 } }]));

    expect(problems(validation)).toContain("(0, 0)");
  });

  it("names an unknown key rather than dropping it", () => {
    temporary = temporaryContent(
      {},
      [],
      "places:\n  - slug: rouen\n    name: Rouen\n    countryCode: FR\n    lattitude: 49.4\n"
    );

    expect(problems(validateContent(temporary))).toContain("lattitude");
  });
});

describe("the country codes of a place", () => {
  /**
   * **The TIW-29 loop, closed for this collection too.** `XK` is what everyone
   * writes for Kosovo and ISO assigns it to nobody; `SG` is perfectly assigned and
   * has no shape at the 110m vintage. Both used to reach `buildWorldGeometry` and
   * throw inside the prerender of `/fr`. A places file the validator did not read
   * would put both of them back there.
   */
  it("refuses a code ISO assigns to nobody, and says it is not a typo", () => {
    const validation = validatePlaces(placesYaml([{ ...ROUEN, countryCode: "XK" }]));

    expect(fields(validation)).toContain("places[0].countryCode");
    expect(problems(validation)).toContain("XK");
  });

  it("refuses a code the basemap cannot draw, even though ISO assigns it", () => {
    const validation = validatePlaces(placesYaml([{ ...ROUEN, countryCode: "SG" }]));

    expect(fields(validation)).toContain("places[0].countryCode");
    expect(problems(validation)).toContain("world-atlas");
  });
});

describe("two places sharing a slug", () => {
  it("reports the second declaration, which is the line to delete", () => {
    const validation = validatePlaces(placesYaml([ROUEN, { ...ROUEN, name: "Rouen encore" }]));

    expect(fields(validation)).toContain("places[1].slug");
    expect(problems(validation)).toContain("rouen");
  });
});

describe("the same place in both collections", () => {
  /**
   * **The refusal `docs/lieux-visites.md` rests its whole argument on.** Two
   * sources of places is the real cost of this design; what makes it payable is
   * that a city declared in both is refused, so promoting a place into a trip
   * cannot half-happen. The finding therefore has to name *both* files — the one
   * to edit and the one that explains why.
   */
  it("names the trip that already declares it, and says what to do", () => {
    const validation = validatePlaces(placesYaml([{ ...ROUEN, slug: "tokyo" }]), {
      "japon-2024": tripYaml(),
    });

    expect(fields(validation)).toContain("places[0].slug");
    expect(problems(validation)).toContain("tokyo");
    expect(problems(validation)).toContain("japon-2024");
  });

  it("reports it on the places file, since that is the file to edit", () => {
    const validation = validatePlaces(placesYaml([{ ...ROUEN, slug: "tokyo" }]), {
      "japon-2024": tripYaml(),
    });

    expect(validation.findings.map((finding) => finding.file)).toEqual(["places.yaml"]);
  });

  /**
   * A trip *slug* matching a place slug is a different namespace — `/voyages/x`
   * against `#lieu-x` — and refusing it would be this layer inventing a rule.
   */
  it("accepts a place whose slug matches a trip's own slug", () => {
    const validation = validatePlaces(placesYaml([{ ...ROUEN, slug: "japon-2024" }]), {
      "japon-2024": tripYaml(),
    });

    expect(validation.findings).toEqual([]);
  });
});

describe("the file itself", () => {
  it("reports invalid YAML with the line the parser stopped on", () => {
    temporary = temporaryContent({}, [], "places:\n\t- slug: rouen\n");
    const validation = validateContent(temporary);

    expect(problems(validation)).toContain("YAML invalide");
    expect(validation.findings[0]?.location?.line).toBe(2);
  });

  /**
   * The near-miss on the name: macOS opens `Places.yaml` for a request for
   * `places.yaml` and the CI does not, so the file that works locally is the file
   * that is missing online. "Rename it" and "write it" are different instructions
   * and only one of them is destructive.
   */
  it("names a file whose case differs, rather than reporting nothing at all", () => {
    const temporaryRoots = temporaryContent({});
    temporary = temporaryRoots;
    writeFileSync(
      temporaryRoots.placesFile.replace("places.yaml", "Places.yaml"),
      placesYaml([ROUEN]),
      "utf8"
    );

    expect(problems(validateContent(temporaryRoots))).toContain("Places.yaml");
  });

  it("refuses a bare list, which is the likeliest shape to write by hand", () => {
    temporary = temporaryContent({}, [], "- slug: rouen\n  name: Rouen\n");

    expect(validateContent(temporary).findings.length).toBeGreaterThan(0);
  });
});

describe("the report's summary", () => {
  /**
   * **The sentence that would have become a lie.** « rien à valider » over
   * fourteen places read, parsed and checked is exactly the kind of quiet
   * inaccuracy this repository pays for: an author reads it and believes the file
   * is not being looked at.
   */
  it("says the places were validated even when no trip was read", () => {
    const validation = validatePlaces(placesYaml([ROUEN]));

    expect(formatReport(validation, { color: false })).toBe(
      "Aucun voyage dans trips, 1 lieu visité validé, aucun problème."
    );
  });

  it("keeps the original sentence, to the byte, on a journal with no places file", () => {
    const roots = temporaryContent({ "japon-2024": tripYaml() });
    temporary = roots;

    expect(formatReport(validateContent(roots), { color: false })).toBe(
      "1 voyage validé dans trips, aucun problème."
    );
  });

  it("counts the two collections apart, never as one total", () => {
    const roots = temporaryContent({ "japon-2024": tripYaml() }, [], placesYaml([ROUEN]));
    temporary = roots;

    expect(formatReport(validateContent(roots), { color: false })).toBe(
      "1 voyage validé, 1 lieu visité dans trips, aucun problème."
    );
  });
});
