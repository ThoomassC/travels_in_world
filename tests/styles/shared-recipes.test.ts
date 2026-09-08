import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ruleBodies, stripComments } from "@thomascaron/ui/contract";

/**
 * The recipes this repository copies out of `@thomascaron/ui`, checked against
 * the library rather than against a comment.
 *
 * **Why a guard and not an import.** The shared library ships two stylesheets.
 * `tokens.css` is imported — it carries the palette, the reset, the
 * `:focus-visible` recipe and the reduced-motion block, and
 * `src/styles/tokens.css` is one `@import` line. `ui.css` is **not**, and that is
 * a measured decision rather than an omission: it is 7 700 bytes brotli, of which
 * 3 467 are `.tc-doc-*` — the stylesheet of the library's own documentation page,
 * which this site will never render. Paying it on every document of every locale
 * to reach one utility class is not a trade this project's budgets make.
 *
 * So the class is copied, nine times, into the CSS Modules that need it. Copying
 * is the right call here and it is also exactly how a palette drifts: the header
 * of `@thomascaron/ui/contract` records that `portfolio` and `travels_in_world`
 * both carried a comment promising their palettes were identical, that six tokens
 * diverged anyway, and that nothing said a word — because a comment is not a
 * guard. This file is the guard for the copies.
 *
 * What it cannot do, said plainly: it proves the nine declarations *say* what the
 * library says. Whether a browser then hides the text is what
 * `tests/e2e/**` measures, by reading accessible names off a served page.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

const LIBRARY_SHEET = path.join(ROOT, "node_modules/@thomascaron/ui/dist/ui.css");

/**
 * Read as text, like the colour contract reads the token sheet. Importing the
 * stylesheet would mean bundling it, which is the very thing this file exists to
 * avoid — and a test that changed what ships would be measuring itself.
 *
 * **`stripComments` before `ruleBodies`, and it is not tidiness.** The library's
 * parser walks braces, and this repository's stylesheets argue at length in
 * comments that themselves contain braces — measured, `ruleBodies` on a raw CSS
 * Module throws « accolade non refermée après `.intro` », and on the library's own
 * `ui.css` it quietly finds zero rules. Stripped first, both answer correctly.
 */
const sheet = (file: string): string => stripComments(readFileSync(file, "utf8"));

/**
 * Declarations as a map, comments removed first.
 *
 * The stripping is not cosmetic: three of the nine copies carry a paragraph
 * *between* two declarations, and a naive split on `;` glues that paragraph to
 * the property name after it. Written before this note existed, this helper
 * reported three files as diverging on `clip-path` when all nine were identical —
 * a guard that cries wolf is a guard nobody reads twice.
 */
function declarationsOf(body: string): Readonly<Record<string, string>> {
  const entries = stripComments(body)
    .split(";")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line): readonly [string, string] => {
      const colon = line.indexOf(":");

      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    });

  return Object.fromEntries(entries);
}

function cssFilesUnder(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      return cssFilesUnder(full);
    }

    return full.endsWith(".css") ? [full] : [];
  });
}

/** The library's own `.tc-visually-hidden`, which is the reference. */
function libraryRecipe(): Readonly<Record<string, string>> {
  const bodies = ruleBodies(sheet(LIBRARY_SHEET), ".tc-visually-hidden");
  const [body] = bodies;

  expect(
    body,
    "`.tc-visually-hidden` is gone from @thomascaron/ui/ui.css — this guard has lost its reference, and the nine copies below now answer to nobody."
  ).toBeDefined();

  return declarationsOf(body ?? "");
}

/** Every local copy, by the file that holds it. */
function localRecipes(): ReadonlyMap<string, Readonly<Record<string, string>>> {
  const found = new Map<string, Readonly<Record<string, string>>>();

  for (const file of cssFilesUnder(path.join(ROOT, "src"))) {
    const [body] = ruleBodies(sheet(file), ".visuallyHidden");

    if (body !== undefined) {
      found.set(path.relative(ROOT, file), declarationsOf(body));
    }
  }

  return found;
}

describe("the visually-hidden recipe", () => {
  /**
   * **Nine, and the number is asserted rather than derived**, so a copy that
   * appears in a tenth module has to be added here on purpose. That is the whole
   * point: the cost of copying is that nobody counts the copies, and this makes
   * somebody count them.
   */
  it("is copied into every module that needs it, and nowhere else", () => {
    expect([...localRecipes().keys()].sort()).toEqual([
      "src/app/[locale]/page.module.css",
      "src/components/map/world-map.module.css",
      "src/components/photos/photo-gallery.module.css",
      "src/components/photos/photo-lightbox.module.css",
      "src/components/site/site-nav.module.css",
      "src/components/timeline/trip-header.module.css",
      "src/components/timeline/trip-mini-map.module.css",
      "src/components/timeline/trip-timeline.module.css",
      "src/components/trips/trip-panel.module.css",
    ]);
  });

  /**
   * The comparison itself, property by property in both directions: a copy that
   * *added* a declaration would pass a one-way check and would still be a second
   * recipe.
   */
  it("says exactly what the shared library says, in every copy", () => {
    const reference = libraryRecipe();

    // Guards the guard: an empty reference would make every comparison below
    // vacuously true, which is how this kind of test rots.
    expect(Object.keys(reference).length).toBeGreaterThan(5);
    expect(reference["clip-path"]).toBe("inset(50%)");

    for (const [file, local] of localRecipes()) {
      expect(local, `${file} has drifted from @thomascaron/ui`).toEqual(reference);
    }
  });

  /**
   * **`clip-path` and never `display: none` nor `visibility: hidden`**, called out
   * on its own because it is the one substitution that looks like a
   * simplification and is a defect: both of those remove the text from the
   * accessibility tree, and the elements this class dresses — a gallery link, the
   * viewer's glyph buttons, a panel's « voir en grand » — go back to being named
   * by their image or by nothing at all.
   *
   * Three of the nine copies say so in a comment of their own. This says it once
   * where it cannot be deleted along with the rule it explains.
   */
  it("hides by clipping, so the text stays in the accessibility tree", () => {
    for (const [file, local] of localRecipes()) {
      expect(local["clip-path"], `${file} must clip rather than remove`).toBe("inset(50%)");
      expect(local["display"], `${file} must not use display`).toBeUndefined();
      expect(local["visibility"], `${file} must not use visibility`).toBeUndefined();
    }
  });
});
