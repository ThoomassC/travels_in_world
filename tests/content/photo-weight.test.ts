import { describe, expect, it } from "vitest";
import { formatWeightReport, PHOTO_WEIGHT_LIMIT_BYTES, weighFiles } from "@/content/photo-weight";

/**
 * The repository's own weight, which is a budget like the two the build already
 * carries — and the one the ticket puts a number on: « 200 photos à 400 Ko
 * représentent 80 Mo que la plateforme télécharge à chaque build. Seuil d'alerte
 * en intégration continue à 150 Mo. »
 *
 * It is a guard of the same family as `test:build`'s budgets and it breaks the same
 * way: silently, one commit at a time, until a build is slow and nobody knows when
 * it started. So the arithmetic is a pure function, tested here, and the script
 * around it only asks git which files are tracked.
 */

const MB = 1_000_000;

const file = (path: string, bytes: number) => ({ path, bytes });

describe("the limit", () => {
  it("is the 150 MB the ticket names", () => {
    expect(PHOTO_WEIGHT_LIMIT_BYTES).toBe(150 * MB);
  });
});

describe("weighFiles", () => {
  it("adds up the bytes and counts the files", () => {
    const weighed = weighFiles([file("a.jpg", 400_000), file("b.jpg", 600_000)]);

    expect(weighed).toMatchObject({ totalBytes: 1_000_000, fileCount: 2, overLimit: false });
  });

  it("is empty and under the limit when nothing is tracked yet", () => {
    // The state the repository is really in until TIW-24 lands the first trip.
    expect(weighFiles([])).toMatchObject({ totalBytes: 0, fileCount: 0, overLimit: false });
  });

  /**
   * The exact boundary, both sides. A guard whose comparison is off by one at the
   * threshold is a guard that fires on the commit *after* the one that crossed it,
   * and the diff it accuses is then innocent.
   */
  it("passes exactly at the limit and fails one byte past it", () => {
    expect(weighFiles([file("a.jpg", PHOTO_WEIGHT_LIMIT_BYTES)]).overLimit).toBe(false);
    expect(weighFiles([file("a.jpg", PHOTO_WEIGHT_LIMIT_BYTES + 1)]).overLimit).toBe(true);
  });

  /**
   * The heaviest files, because "the repository is over 150 MB" is a fact and not
   * a repair: what an author can act on is *which* photographs are the weight, and
   * they are almost never spread evenly.
   */
  it("names the heaviest files first, and only a handful of them", () => {
    const weighed = weighFiles([
      file("small.jpg", 1),
      file("huge.jpg", 9_000_000),
      file("big.jpg", 5_000_000),
    ]);

    expect(weighed.heaviest.map((entry) => entry.path)).toEqual([
      "huge.jpg",
      "big.jpg",
      "small.jpg",
    ]);
  });

  it("lists at most ten of them, however many there are", () => {
    const many = Array.from({ length: 40 }, (_value, index) =>
      file(`photo-${index}.jpg`, index * 1000)
    );

    expect(weighFiles(many).heaviest).toHaveLength(10);
    expect(weighFiles(many).heaviest[0]?.path).toBe("photo-39.jpg");
  });
});

describe("the report", () => {
  it("always says what the repository weighs, even when it is fine", () => {
    const lines = formatWeightReport(weighFiles([file("a.jpg", 12_300_000)])).join("\n");

    expect(lines).toContain("12,3 Mo");
    expect(lines).toContain("150");
  });

  /**
   * The roots this guard weighs carry exactly one image today — TIW-23's default
   * share card — and one decimal of a megabyte printed the whole report as
   * « 0,0 Mo », which is a line saying nothing on the one subject it exists for.
   *
   * "The roots this guard weighs", not "the repository": this comment said the
   * latter and it was false. Measured 2026-09-02, `git ls-files` tracks 18 images
   * for 78 351 bytes; seventeen are fixtures and brand icons, outside `IMAGE_ROOTS`
   * on purpose.
   */
  it("counts in kilobytes below a megabyte, so a small repository is still legible", () => {
    const lines = formatWeightReport(weighFiles([file("public/share.png", 84_000)])).join("\n");

    expect(lines).toContain("84 Ko");
    // Not `not.toContain("0,0 Mo")`: the limit itself prints as « 150,0 Mo »,
    // which carries that substring. What must not appear is the *total* rounded
    // to nothing, so the assertion is on the phrase that states it.
    expect(lines).not.toMatch(/,\s*0,0 Mo sur/);
  });

  /**
   * The way out the ticket names, said in the message rather than left in a
   * ticket nobody will find in a year: « au-delà, les images passent sur un
   * stockage externe — le champ source devient une URL absolue, ce qui est un
   * changement de contenu et non de structure ».
   */
  it("names the way out when the limit is passed", () => {
    const weighed = weighFiles([file("public/photos/x/a.jpg", 200 * MB)]);
    const lines = formatWeightReport(weighed).join("\n");

    expect(weighed.overLimit).toBe(true);
    expect(lines).toContain("public/photos/x/a.jpg");
    expect(lines).toMatch(/stockage externe/i);
    expect(lines).toMatch(/URL absolue/i);
  });

  /**
   * The word « de contenu » in the headline, and it is load-bearing rather than
   * decorative — which is why it gets a case of its own.
   *
   * Without it the line reads as a count of the whole repository, and as such it
   * was false: the guard weighs `public/` and `content/` only, so it printed
   * « 1 image suivie par git » in a repository tracking eighteen of them — 66 % of
   * the image bytes here sit in `tests/fixtures/content/**` and in the two brand
   * icons, excluded on purpose because this budget is about content, which grows,
   * and not about code, which does not.
   *
   * A guard whose own report overstates its reach teaches the reader to discount
   * it, and a discounted guard is a guard that no longer guards. Asserted on both
   * branches, because the empty case is the one a fresh clone actually sees.
   */
  it("scopes its count to content, not to every image the repository tracks", () => {
    const one = formatWeightReport(weighFiles([file("public/share.png", 84_000)])).join("\n");
    const none = formatWeightReport(weighFiles([])).join("\n");

    expect(one).toContain("1 image de contenu suivie par git");
    expect(none).toContain("Aucune image de contenu suivie par git");

    // The plural has to agree with the added words, which is exactly the kind of
    // thing an interpolated message gets wrong once and keeps wrong.
    const two = formatWeightReport(
      weighFiles([file("public/a.jpg", 1_000), file("content/b.jpg", 2_000)])
    ).join("\n");

    expect(two).toContain("2 images de contenu suivies par git");
  });

  it("says nothing is tracked yet rather than reporting 0 Mo of photos", () => {
    // "0,0 Mo sur 150" reads as a measurement of something; there is nothing to
    // measure until the first trip lands.
    expect(formatWeightReport(weighFiles([])).join("\n")).toMatch(/aucune image/i);
  });
});
