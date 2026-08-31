import { describe, expect, it } from "vitest";
import { formatEvent, formatOutcome } from "@/content/index-photos-report";
import type { IndexPhotosEvent, IndexPhotosOutcome, PhotoRef } from "@/content/index-photos";

/**
 * What `npm run index-photos` says, as a pure function of what happened.
 *
 * Same division of labour as `geocode-report.ts` and, before it, `report.ts`: the
 * module that decides prints nothing and the module that prints decides nothing.
 * So every sentence is testable without a process, and the script is left with
 * argument parsing and a stream.
 *
 * Two rules inherited from TIW-9 hold on every line here and are asserted on all
 * of them at once at the bottom of this file: **no ANSI escape ever comes out**,
 * and **every value that came from outside is neutralised**. A photo's `src` is a
 * string out of a YAML file an author edits, and `content/trips/` holding a name
 * with an ESC in it is enough to clear the terminal showing the refusal.
 */

const ESCAPE = String.fromCodePoint(27);
const SLUG = "japon-2024";

const photo = (index: number, src: string): PhotoRef => ({ index, src });

const TOKYO = photo(0, "/photos/japon-2024/tokyo.jpg");

const facts = (width: number, height: number, bytes: number) => ({ width, height, bytes });

describe("the running commentary", () => {
  it("names the photo by its index and its source", () => {
    const lines = formatEvent({ kind: "scanning", photo: TOKYO });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("photos[0]");
    expect(lines[0]).toContain("/photos/japon-2024/tokyo.jpg");
  });

  it("says what it measured when a photo is indexed", () => {
    const lines = formatEvent({
      kind: "indexed",
      photo: TOKYO,
      facts: facts(1600, 1067, 262_301),
      placeholderLength: 127,
    });

    expect(lines[0]).toContain("1600");
    expect(lines[0]).toContain("1067");
    // The measurement, not the cap: printing « 512 caractères au plus » on the one
    // line whose job is to report what was found says nothing at all.
    expect(lines[0]).toContain("127");
    expect(lines[0]).not.toContain("512");
  });

  /**
   * The acceptance criterion, verbatim: « un avertissement nomme le fichier ». And
   * the dimensions *before* as well as after, because a warning that only names the
   * file leaves the author unable to tell a 4032 px photograph brought down to
   * 3000 from one quietly halved — which is the difference between a tool he keeps
   * using and one he stops trusting.
   */
  describe("the resize warning", () => {
    const resized: IndexPhotosEvent = {
      kind: "resized",
      photo: photo(1, "/photos/japon-2024/osaka.jpg"),
      before: facts(4032, 3024, 1_879_028),
      facts: facts(3000, 2250, 548_112),
      stillOverBytes: false,
    };

    it("names the file", () => {
      expect(formatEvent(resized)[0]).toContain("/photos/japon-2024/osaka.jpg");
    });

    it("says what it was and what it became, in both dimensions and bytes", () => {
      const line = formatEvent(resized)[0] ?? "";

      expect(line).toContain("4032");
      expect(line).toContain("3000");
      expect(line).toContain("1,9 Mo");
      // Megabytes for the original it was, kilobytes for what it became — the
      // switch is what keeps a 548 000-byte result from printing as « 0,5 Mo ».
      expect(line).toContain("548 Ko");
    });

    it("says the file on disk was rewritten, not just described", () => {
      // The one operation in this pipeline that touches a file the author put
      // there. A line that reads like a measurement rather than a write is how an
      // author later discovers his original is gone.
      expect(formatEvent(resized)[0]).toMatch(/réécrit|redimensionné/);
    });

    /**
     * A PNG cannot be brought under the byte limit by quality, only by size, so
     * the edge ladder can run out on one. Saying so is the difference between a
     * warning and a lie: the file was rewritten *and* is still heavy.
     */
    it("says so when the file is still over the byte limit afterwards", () => {
      const line =
        formatEvent({ ...resized, stillOverBytes: true, facts: facts(1600, 1200, 2_100_000) })[0] ??
        "";

      expect(line).toContain("1,5 Mo");
    });
  });

  it("lists the widths it cut, and their total weight", () => {
    const lines = formatEvent({
      kind: "derived",
      photo: TOKYO,
      widths: [480, 960, 1440],
      bytes: 104_000,
    });

    expect(lines[0]).toContain("480");
    expect(lines[0]).toContain("960");
    expect(lines[0]).toContain("1440");
    // Kilobytes under a megabyte: « 0,1 Mo » is a number that says nothing, and
    // three AVIF rungs of a real photograph came to 32 KB on the first live run.
    expect(lines[0]).toContain("104 Ko");
  });

  it("says nothing was needed for a photo that is already current", () => {
    expect(formatEvent({ kind: "unchanged", photo: TOKYO })[0]).toMatch(/déjà|rien/i);
  });
});

/**
 * One sentence per way a photo can be left alone, each ending in something to do.
 * The table is exhaustive by construction — a state added to `PhotoFailure` with
 * no row here fails to compile in `describeFailure`.
 */
describe("why a photo was left alone", () => {
  const failure = (reason: Extract<IndexPhotosEvent, { kind: "failed" }>["reason"]): string =>
    formatEvent({ kind: "failed", photo: TOKYO, reason })[0] ?? "";

  it("names the file it expected when the photo is not on disk", () => {
    const line = failure({ state: "missing-file", expected: "/tmp/x/public/photos/a.jpg" });

    expect(line).toContain("/tmp/x/public/photos/a.jpg");
    expect(line).toMatch(/dépose|ajoute/i);
  });

  it("tells a file that is not an image apart from one that is not there", () => {
    const notThere = failure({ state: "missing-file", expected: "/tmp/a.jpg" });
    const notAnImage = failure({ state: "unreadable-image", reason: "unsupported image format" });

    // The two repairs are opposite — "drop the image here" against "this is not an
    // image" — so the two sentences have to be different sentences.
    expect(notAnImage).not.toBe(notThere);
    expect(notAnImage).toMatch(/image/i);
  });

  it("says what a site-absolute path looks like when the src is relative", () => {
    expect(failure({ state: "relative-src" })).toContain("/photos/");
  });

  it("refuses an escaping path without repeating it as advice", () => {
    const line = failure({ state: "escaping-src" });

    expect(line).toContain("..");
    expect(line).toMatch(/public/i);
  });

  /**
   * The refusal that must **not** offer the command. Running `index-photos` on a
   * trip declaring `tokyo-480.jpg` is exactly what would overwrite that file with
   * the 480 px derivative of `tokyo.jpg`, so the way out is a rename by hand.
   */
  it("asks for a rename on a name the pipeline writes itself, and offers no command", () => {
    const line = failure({ state: "reserved-name" });

    expect(line).toMatch(/renomme/i);
    expect(line).not.toContain("npm run index-photos");
  });

  it("carries a first-hand refusal from the YAML writer through whole", () => {
    const line = failure({
      state: "unsupported-yaml",
      reason:
        "la clé « width » porte « px: 1600 » au lieu d'une valeur simple → remplace-la par « width: » seul, l'indexation écrira la valeur",
    });

    // Not truncated: `bounded()` cuts at 80 code points, which lands in the middle
    // of these wordings and drops the verb. Same lesson as `firstHand` in
    // `geocode-report.ts`.
    expect(line).toContain("l'indexation écrira la valeur");
  });

  it.each([
    { state: "no-src" } as const,
    { state: "invalid-escape" } as const,
    { state: "resize-failed", reason: "boom" } as const,
    { state: "derivative-failed", width: 960, reason: "boom" } as const,
    { state: "placeholder-failed", reason: "boom" } as const,
  ])("ends %o on something to do", (reason) => {
    expect(failure(reason)).toContain("→");
  });
});

describe("the closing summary", () => {
  const done = (over: Partial<Extract<IndexPhotosOutcome, { state: "done" }>>) =>
    formatOutcome(
      {
        state: "done",
        file: "content/trips/japon-2024/trip.yaml",
        photoCount: 2,
        indexed: 2,
        resized: 0,
        derivatives: 5,
        failed: 0,
        written: true,
        ...over,
      },
      SLUG
    );

  it("says how many photos it indexed and that the file was written", () => {
    const lines = done({});

    expect(lines.join("\n")).toContain("content/trips/japon-2024/trip.yaml");
    expect(lines.join("\n")).toMatch(/2 photos/);
    expect(lines.join("\n")).toMatch(/réécrit/);
  });

  /**
   * The idempotent run, and the sentence that makes it recognisable: an author who
   * reruns the command needs to read "nothing to do" rather than a summary that
   * looks like work.
   */
  it("says the file was not touched when there was nothing to write", () => {
    const lines = done({ indexed: 0, derivatives: 0, written: false }).join("\n");

    expect(lines).toMatch(/déjà|rien/i);
    // The affirmative claim, not the word: « n'a pas été réécrit » contains
    // « réécrit », and matching the bare word made this assertion unfalsifiable.
    expect(lines).not.toMatch(/, fichier réécrit/);
    expect(lines).toMatch(/n'a pas été réécrit/);
  });

  it("counts the derivatives it cut", () => {
    expect(done({}).join("\n")).toContain("5");
  });

  it("counts the failures, and the last line says what to do next", () => {
    const lines = done({ indexed: 1, failed: 1 });

    expect(lines.join("\n")).toMatch(/1 (photo )?en échec|1 échec/i);
    expect(lines.at(-1)).not.toMatch(/\.$/);
  });

  it("names the real file when the trip is a symlink pointing out of the repository", () => {
    const lines = done({ writtenTo: "/Users/t/notes/japon/trip.yaml" }).join("\n");

    expect(lines).toContain("/Users/t/notes/japon/trip.yaml");
  });

  it("treats a trip with no photos as nothing to do", () => {
    const lines = formatOutcome(
      { state: "no-photos", file: "content/trips/japon-2024/trip.yaml" },
      SLUG
    ).join("\n");

    expect(lines).toMatch(/aucune photo/i);
    expect(lines).not.toMatch(/erreur|échec/i);
  });

  it("lists the trips that exist when the slug names none", () => {
    const lines = formatOutcome(
      {
        state: "trip-not-found",
        slug: "perou-2023",
        contentDir: "content/trips",
        available: ["japon-2024", "pyrenees-2022"],
      },
      "perou-2023"
    ).join("\n");

    expect(lines).toContain("japon-2024");
    expect(lines).toContain("pyrenees-2022");
  });

  it("offers new-trip when the collection is empty", () => {
    const lines = formatOutcome(
      { state: "trip-not-found", slug: SLUG, contentDir: "content/trips", available: [] },
      SLUG
    ).join("\n");

    expect(lines).toContain(`npm run new-trip ${SLUG}`);
  });

  it("sends a malformed trip to the validator rather than guessing", () => {
    const lines = formatOutcome(
      { state: "trip-malformed", file: "content/trips/x/trip.yaml", reason: "Tab as indent" },
      SLUG
    ).join("\n");

    expect(lines).toContain("npm run validate:content");
  });

  /**
   * The two refusals that cost the author his encoding work. Both have to say
   * plainly that the trip file was **not** overwritten — the fear at that moment
   * is having lost the edit one had just made — and both have to say that the
   * images produced along the way are still there, because they are, and a second
   * run must not look like it will redo minutes of work.
   */
  it.each(["file-changed", "file-not-utf8"] as const)(
    "says nothing was overwritten on %s",
    (state) => {
      const lines = formatOutcome(
        { state, file: "content/trips/x/trip.yaml", indexed: 3 },
        SLUG
      ).join("\n");

      expect(lines).toMatch(/pas (été )?(ré)?écrit|intact/i);
      expect(lines).toContain("3");
    }
  );

  it("says the original file is intact when the write itself failed", () => {
    const lines = formatOutcome(
      { state: "write-failed", file: "content/trips/x/trip.yaml", reason: "EACCES", indexed: 2 },
      SLUG
    ).join("\n");

    expect(lines).toMatch(/intact/i);
    expect(lines).toContain("EACCES");
  });

  it("says how to point the command elsewhere when the content directory is missing", () => {
    const lines = formatOutcome(
      { state: "content-dir-missing", contentDir: "content/trips" },
      SLUG
    ).join("\n");

    expect(lines).toContain("--content");
  });

  it("tells a miscased trip file apart from a missing one", () => {
    const lines = formatOutcome(
      {
        state: "trip-unreadable",
        file: "content/trips/x/trip.yaml",
        reason: "le fichier du voyage est introuvable",
        similarName: "Trip.yaml",
      },
      SLUG
    ).join("\n");

    expect(lines).toContain("Trip.yaml");
    expect(lines).toMatch(/renomme/i);
  });
});

/**
 * The two properties that hold across every line this module can produce, checked
 * over every branch at once rather than one assertion per case — a new state with
 * a new interpolation would otherwise slip through.
 */
describe("what no line may ever do", () => {
  const HOSTILE = `${ESCAPE}[2J/photos/x/${String.fromCodePoint(7)}a.jpg`;

  const everyEvent: readonly IndexPhotosEvent[] = [
    { kind: "scanning", photo: photo(0, HOSTILE) },
    {
      kind: "resized",
      photo: photo(0, HOSTILE),
      before: facts(4032, 3024, 1_879_028),
      facts: facts(3000, 2250, 548_112),
      stillOverBytes: true,
    },
    { kind: "derived", photo: photo(0, HOSTILE), widths: [480], bytes: 6000 },
    {
      kind: "indexed",
      photo: photo(0, HOSTILE),
      facts: facts(1600, 1067, 1),
      placeholderLength: 127,
    },
    { kind: "unchanged", photo: photo(0, HOSTILE) },
    { kind: "failed", photo: photo(0, HOSTILE), reason: { state: "no-src" } },
    { kind: "failed", photo: photo(0, HOSTILE), reason: { state: "relative-src" } },
    { kind: "failed", photo: photo(0, HOSTILE), reason: { state: "escaping-src" } },
    { kind: "failed", photo: photo(0, HOSTILE), reason: { state: "invalid-escape" } },
    { kind: "failed", photo: photo(0, HOSTILE), reason: { state: "reserved-name" } },
    {
      kind: "failed",
      photo: photo(0, HOSTILE),
      reason: { state: "missing-file", expected: HOSTILE },
    },
    {
      kind: "failed",
      photo: photo(0, HOSTILE),
      reason: { state: "unreadable-image", reason: HOSTILE },
    },
    {
      kind: "failed",
      photo: photo(0, HOSTILE),
      reason: { state: "resize-failed", reason: HOSTILE },
    },
    {
      kind: "failed",
      photo: photo(0, HOSTILE),
      reason: { state: "derivative-failed", width: 960, reason: HOSTILE },
    },
    {
      kind: "failed",
      photo: photo(0, HOSTILE),
      reason: { state: "placeholder-failed", reason: HOSTILE },
    },
    {
      kind: "failed",
      photo: photo(0, HOSTILE),
      reason: { state: "unsupported-yaml", reason: HOSTILE },
    },
  ];

  const everyOutcome: readonly IndexPhotosOutcome[] = [
    { state: "content-dir-missing", contentDir: HOSTILE },
    { state: "content-dir-unreadable", contentDir: HOSTILE, reason: HOSTILE },
    { state: "trip-not-found", slug: HOSTILE, contentDir: HOSTILE, available: [HOSTILE] },
    { state: "trip-unreadable", file: HOSTILE, reason: HOSTILE },
    { state: "trip-unreadable", file: HOSTILE, reason: HOSTILE, similarName: HOSTILE },
    { state: "trip-malformed", file: HOSTILE, reason: HOSTILE },
    { state: "no-photos", file: HOSTILE },
    {
      state: "done",
      file: HOSTILE,
      photoCount: 1,
      indexed: 1,
      resized: 1,
      derivatives: 3,
      failed: 1,
      written: true,
      writtenTo: HOSTILE,
    },
    { state: "write-failed", file: HOSTILE, reason: HOSTILE, indexed: 1 },
    { state: "file-changed", file: HOSTILE, indexed: 1 },
    { state: "file-not-utf8", file: HOSTILE, indexed: 1 },
  ];

  const allLines = [
    ...everyEvent.flatMap((event) => formatEvent(event)),
    ...everyOutcome.flatMap((outcome) => formatOutcome(outcome, HOSTILE)),
  ];

  it("produces a line for every state, so this table is not empty", () => {
    // Guards the guard: a `formatEvent` that returned `[]` for a branch would make
    // both assertions below pass by reading nothing.
    expect(allLines.length).toBeGreaterThanOrEqual(everyEvent.length + everyOutcome.length);
  });

  it("lets no ANSI escape or control character reach the stream", () => {
    for (const line of allLines) {
      expect(line).not.toContain(ESCAPE);
      expect(line).not.toContain(String.fromCodePoint(7));
    }
  });

  /**
   * The other half of the same guard, and it is not redundant: a report that
   * *dropped* the hostile value entirely would satisfy the assertion above while
   * telling the author nothing about which photo is at fault. So the escaped
   * spelling has to be present — the value reached the line, neutralised.
   *
   * Asserted on the whole transcript rather than line by line, because several
   * branches legitimately produce a second line that interpolates nothing (« →
   * rien n'a été touché »).
   */
  it("shows the hostile value, escaped, rather than dropping it", () => {
    expect(allLines.join("\n")).toContain("\\e[2J");
  });

  it("stays on one line per line, so a transcript stays greppable", () => {
    for (const line of allLines) {
      expect(line).not.toContain("\n");
    }
  });
});
