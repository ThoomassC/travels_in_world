import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWishlist, wishlistPathFor, WISHLIST_FILE_NAME } from "@/content/wishlist";

/**
 * **`content/wishlist.yaml` — the countries the journal wants to reach** (TIW-39).
 *
 * A second hand-written content file beside `content/trips/`, and it is judged
 * the way a trip is: one reader, producing findings rather than throwing, so that
 * `npm run validate:content` can print them with a file and a field and the build
 * can refuse on the same verdict. `src/content/loader.ts` names that split at
 * length; this module is the smallest possible instance of it.
 *
 * **The one decision worth arguing is the absent file.** No wishlist is the
 * ordinary state of a journal — it is the state of every fixture in this
 * repository and of the repository itself until this ticket — so a missing file
 * is an empty list and not a finding. Everything else fails: an unreadable file, a
 * file that is not YAML, a `countries` that is not a list, an entry that is not a
 * country code, a code the map cannot draw, a code written twice.
 *
 * That asymmetry is the fail-open direction, so it is pinned by a case of its own
 * rather than left as a consequence: the day someone renames the file, the
 * wishlist silently empties, and the only thing that would say so is a test that
 * says an *empty* file is not the same as no file.
 */

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A content root holding a trips directory and, optionally, a wishlist beside it. */
function contentRoot(wishlist?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "tiw-wishlist-"));
  roots.push(root);
  mkdirSync(path.join(root, "trips"), { recursive: true });

  if (wishlist !== undefined) {
    writeFileSync(path.join(root, WISHLIST_FILE_NAME), wishlist, "utf8");
  }

  return path.join(root, "trips");
}

const read = (wishlist?: string) => readWishlist(contentRoot(wishlist));

describe("where the file is looked for", () => {
  /**
   * Beside the trips directory, not inside it. `TIW_CONTENT_DIR` and
   * `--content <dossier>` both name the *trips* directory — that is the published
   * interface `content/README.md` documents — so the wishlist is its sibling, and
   * a fixture that points the trips directory elsewhere gets that fixture's
   * wishlist rather than the repository's.
   */
  it("sits beside the trips directory, not in it", () => {
    expect(wishlistPathFor("/somewhere/content/trips")).toBe("/somewhere/content/wishlist.yaml");
  });
});

describe("a wishlist that is fine", () => {
  it("reads the codes in the order the file writes them", () => {
    const { countryCodes, problems } = read("countries:\n  - HR\n  - IT\n  - ME\n  - PT\n");

    expect(problems).toEqual([]);
    expect(countryCodes).toEqual(["HR", "IT", "ME", "PT"]);
  });

  it("accepts a file with an empty list", () => {
    const { countryCodes, problems } = read("countries: []\n");

    expect(problems).toEqual([]);
    expect(countryCodes).toEqual([]);
  });

  it("accepts comments, which is most of what this file is", () => {
    const { countryCodes, problems } = read("# les pays à venir\ncountries:\n  - HR # la Croatie\n");

    expect(problems).toEqual([]);
    expect(countryCodes).toEqual(["HR"]);
  });
});

describe("no wishlist at all", () => {
  /**
   * The fail-open case, and the only one. Pinned as a pair with the next: absent
   * is silence, present-and-broken is a finding, and confusing the two is how a
   * renamed file empties the map without a word.
   */
  it("is an empty list and not a problem", () => {
    const { countryCodes, problems } = read();

    expect(problems).toEqual([]);
    expect(countryCodes).toEqual([]);
  });

  it("but an empty file is a problem, because someone wrote it", () => {
    const { problems } = read("");

    expect(problems).toHaveLength(1);
    expect(problems[0]?.problem).toMatch(/countries/);
  });
});

describe("a wishlist the map cannot honour", () => {
  it("refuses a code that is not two capitals", () => {
    const { countryCodes, problems } = read("countries:\n  - HR\n  - croatie\n");

    expect(countryCodes).toEqual(["HR"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.problem).toMatch(/croatie/);
    expect(problems[0]?.field).toEqual(["countries", 1]);
  });

  /**
   * The casing slip is worth its own answer for the reason `src/map/world.ts`
   * gives about `jp`: "no country bears this code" is both false and a dead end
   * when the code is right and the shift key was not.
   */
  it("tells a casing slip apart from a code that does not exist", () => {
    const lowercase = read("countries:\n  - hr\n").problems[0];
    const nonsense = read("countries:\n  - ZZ\n").problems[0];

    expect(lowercase?.action).toMatch(/HR/);
    expect(nonsense?.problem).toMatch(/ISO 3166-1/);
    expect(nonsense?.action).not.toMatch(/ZZ/);
  });

  it("refuses a real country the shipped basemap has no shape for", () => {
    const { problems } = read("countries:\n  - GI\n");

    expect(problems).toHaveLength(1);
    expect(problems[0]?.problem).toMatch(/GI/);
    expect(problems[0]?.problem).toMatch(/50m/);
  });

  it("refuses the same country written twice, naming the line", () => {
    const { countryCodes, problems } = read("countries:\n  - IT\n  - PT\n  - IT\n");

    expect(countryCodes).toEqual(["IT", "PT"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.field).toEqual(["countries", 2]);
    expect(problems[0]?.problem).toMatch(/IT/);
  });

  it("refuses a `countries` that is not a list", () => {
    expect(read("countries: HR\n").problems).toHaveLength(1);
    expect(read("pays:\n  - HR\n").problems).toHaveLength(1);
  });

  it("refuses a file that is not YAML at all", () => {
    const { problems } = read("countries:\n\t- HR\n");

    expect(problems).toHaveLength(1);
    expect(problems[0]?.problem.length).toBeGreaterThan(0);
  });

  it("reports every bad entry, not just the first", () => {
    const { problems } = read("countries:\n  - ZZ\n  - GI\n  - nope\n");

    expect(problems).toHaveLength(3);
  });
});

describe("what every finding carries", () => {
  it("names the file as a path a reader can paste, and gives a line", () => {
    const contentDir = contentRoot("countries:\n  - HR\n  - ZZ\n");
    const { problems } = readWishlist(contentDir);
    const finding = problems[0];

    expect(finding?.file.endsWith(WISHLIST_FILE_NAME)).toBe(true);
    expect(finding?.location?.line).toBe(3);
    expect(finding?.action.length).toBeGreaterThan(0);
  });
});
