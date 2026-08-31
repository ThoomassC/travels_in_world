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

  it("says nothing is tracked yet rather than reporting 0 Mo of photos", () => {
    // "0,0 Mo sur 150" reads as a measurement of something; there is nothing to
    // measure until the first trip lands.
    expect(formatWeightReport(weighFiles([])).join("\n")).toMatch(/aucune image/i);
  });
});
