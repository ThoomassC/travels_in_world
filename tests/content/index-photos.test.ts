import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  BLUR_DATA_URL_PATTERN,
  DERIVATIVE_LADDER,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_EDGE,
} from "@/domain/photo";
import { indexTripPhotos } from "@/content/index-photos";
import type { IndexPhotosEvent, IndexPhotosOutcome } from "@/content/index-photos";
import { validateContent } from "@/content/validate";
import { photoWorkspace, tripWithPhotos, unindexedPhoto } from "./photo-support";
import type { PhotoWorkspace } from "./photo-support";

/**
 * `npm run index-photos <slug>`, minus the terminal.
 *
 * The suite's centre of gravity is one assertion repeated in several shapes:
 * **after a successful run, `validate:content` has nothing to say.** The two
 * commands are the two halves of one contract — one writes `width`, `height`,
 * `blurDataUrl` and the AVIF derivatives, the other refuses a trip missing any of
 * them — and the failure mode that matters is the two disagreeing. A unit test of
 * either half alone cannot see it.
 *
 * Real photographs and the real encoder throughout, for the reason
 * `photo-files.test.ts` gives at length: everything that can be wrong here is a
 * question about bytes.
 */

let workspace: PhotoWorkspace | undefined;

afterEach(() => {
  workspace?.cleanup();
  workspace = undefined;
});

type Run = {
  readonly outcome: IndexPhotosOutcome;
  readonly events: readonly IndexPhotosEvent[];
};

async function run(current: PhotoWorkspace): Promise<Run> {
  const events: IndexPhotosEvent[] = [];
  const outcome = await indexTripPhotos({
    contentDir: current.contentDir,
    publicDir: current.publicDir,
    repoRoot: current.repoRoot,
    slug: current.slug,
    onEvent: (event) => events.push(event),
  });

  return { outcome, events };
}

/** What `validate:content` says about the workspace as it now stands. */
function findings(current: PhotoWorkspace): readonly string[] {
  return validateContent({
    contentDir: current.contentDir,
    publicDir: current.publicDir,
    repoRoot: current.repoRoot,
  }).findings.map((finding) => finding.problem);
}

const TWO_PHOTOS = tripWithPhotos(
  [
    "photos:",
    unindexedPhoto("/photos/japon-2024/tokyo.jpg", "Une ruelle de Shinjuku sous la pluie", [
      "placeSlug: tokyo",
    ]),
    unindexedPhoto("/photos/japon-2024/kyoto.jpg", "Le chemin des philosophes au petit matin"),
  ].join("\n")
);

describe("a trip whose photos have never been indexed", () => {
  it("writes the measured dimensions and a placeholder for each", async () => {
    workspace = await photoWorkspace({
      yaml: TWO_PHOTOS,
      images: {
        "/photos/japon-2024/tokyo.jpg": { width: 1600, height: 1067 },
        "/photos/japon-2024/kyoto.jpg": { width: 1200, height: 900, seed: 7 },
      },
    });

    const { outcome } = await run(workspace);

    expect(outcome.state).toBe("done");
    const photos = workspace.photos();
    expect(photos[0]).toMatchObject({ width: 1600, height: 1067 });
    expect(photos[1]).toMatchObject({ width: 1200, height: 900 });
    expect(photos[0]?.blurDataUrl).toMatch(BLUR_DATA_URL_PATTERN);
    expect(photos[1]?.blurDataUrl).toMatch(BLUR_DATA_URL_PATTERN);
  });

  it("writes every derivative the ladder offers, and none it does not", async () => {
    workspace = await photoWorkspace({
      yaml: TWO_PHOTOS,
      images: {
        "/photos/japon-2024/tokyo.jpg": { width: 1600, height: 1067 },
        "/photos/japon-2024/kyoto.jpg": { width: 1200, height: 900, seed: 7 },
      },
    });

    await run(workspace);

    for (const width of DERIVATIVE_LADDER) {
      expect(workspace.exists(`/photos/japon-2024/tokyo-${width}.avif`)).toBe(true);
    }
    // Kyoto is 1200 px: the 1440 rung would be an upscale, so it must be absent.
    expect(workspace.exists("/photos/japon-2024/kyoto-480.avif")).toBe(true);
    expect(workspace.exists("/photos/japon-2024/kyoto-960.avif")).toBe(true);
    expect(workspace.exists("/photos/japon-2024/kyoto-1440.avif")).toBe(false);
  });

  /**
   * The assertion this whole suite is built around: the command and the validator
   * are two halves of one contract, and what has to be true is that they agree.
   */
  it("leaves validate:content with nothing to say", async () => {
    workspace = await photoWorkspace({
      yaml: TWO_PHOTOS,
      images: {
        "/photos/japon-2024/tokyo.jpg": { width: 1600, height: 1067 },
        "/photos/japon-2024/kyoto.jpg": { width: 1200, height: 900, seed: 7 },
      },
    });
    // The point of the precondition: before the run it has plenty to say.
    expect(findings(workspace).length).toBeGreaterThan(0);

    await run(workspace);

    expect(findings(workspace)).toEqual([]);
  });

  it("keeps the author's comments, key order and blank lines", async () => {
    const yaml = tripWithPhotos(
      [
        "photos:",
        "  # La photo de couverture.",
        "  - src: /photos/japon-2024/tokyo.jpg",
        "    alt: Une ruelle de Shinjuku sous la pluie # décrite pour un lecteur d'écran",
        "    placeSlug: tokyo",
      ].join("\n")
    );
    workspace = await photoWorkspace({
      yaml,
      images: { "/photos/japon-2024/tokyo.jpg": { width: 1600, height: 1067 } },
    });

    await run(workspace);
    const text = workspace.read();

    expect(text).toContain("  # La photo de couverture.");
    expect(text).toContain("# décrite pour un lecteur d'écran");
    for (const line of yaml.split("\n").filter((line) => line.trim() !== "")) {
      expect(text).toContain(line);
    }
  });

  it("counts what it did", async () => {
    workspace = await photoWorkspace({
      yaml: TWO_PHOTOS,
      images: {
        "/photos/japon-2024/tokyo.jpg": { width: 1600, height: 1067 },
        "/photos/japon-2024/kyoto.jpg": { width: 1200, height: 900, seed: 7 },
      },
    });

    const { outcome } = await run(workspace);

    expect(outcome).toMatchObject({
      state: "done",
      photoCount: 2,
      indexed: 2,
      failed: 0,
      written: true,
      // Three rungs for the 1600 px photo, two for the 1200 px one.
      derivatives: 5,
      resized: 0,
    });
  });
});

/**
 * "Il ne fait rien deux fois", the property `content/README.md` promises for
 * `geocode` and this command owes for the same reason: an author runs it after
 * every batch of photos, and a command that rewrites the file each time makes
 * every run a diff to read.
 */
describe("a second run on a trip that is already indexed", () => {
  it("writes nothing: same bytes, same mtime", async () => {
    workspace = await photoWorkspace({
      yaml: TWO_PHOTOS,
      images: {
        "/photos/japon-2024/tokyo.jpg": { width: 1600, height: 1067 },
        "/photos/japon-2024/kyoto.jpg": { width: 1200, height: 900, seed: 7 },
      },
    });

    await run(workspace);
    const after = readFileSync(workspace.tripFile);
    const stamp = statSync(workspace.tripFile).mtimeMs;

    const { outcome } = await run(workspace);

    expect(outcome).toMatchObject({ state: "done", indexed: 0, written: false, derivatives: 0 });
    expect(readFileSync(workspace.tripFile).equals(after)).toBe(true);
    expect(statSync(workspace.tripFile).mtimeMs).toBe(stamp);
  });

  it("does not rewrite the derivatives it already produced", async () => {
    workspace = await photoWorkspace({
      yaml: TWO_PHOTOS,
      images: {
        "/photos/japon-2024/tokyo.jpg": { width: 1600, height: 1067 },
        "/photos/japon-2024/kyoto.jpg": { width: 1200, height: 900, seed: 7 },
      },
    });

    await run(workspace);
    const stamp = statSync(workspace.resolve("/photos/japon-2024/tokyo-960.avif")).mtimeMs;

    await run(workspace);

    expect(statSync(workspace.resolve("/photos/japon-2024/tokyo-960.avif")).mtimeMs).toBe(stamp);
  });

  /**
   * The staleness this command has to notice and `geocode` does not: a coordinate
   * is written once and is true forever, but a photograph can be recropped in
   * place — leaving the YAML describing a picture that no longer exists, and the
   * derivatives describing it too. Reserving the wrong box is a layout shift, which
   * is the whole thing `width`/`height` are here to prevent.
   */
  it("notices a photograph replaced on disk and re-measures it", async () => {
    workspace = await photoWorkspace({
      yaml: TWO_PHOTOS,
      images: {
        "/photos/japon-2024/tokyo.jpg": { width: 1600, height: 1067 },
        "/photos/japon-2024/kyoto.jpg": { width: 1200, height: 900, seed: 7 },
      },
    });
    await run(workspace);
    const oldPlaceholder = workspace.photos()[0]?.blurDataUrl;

    // Recropped: a different shape and different pixels, same file name.
    const recropped = await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: { r: 10, g: 90, b: 40 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    writeFileSync(workspace.resolve("/photos/japon-2024/tokyo.jpg"), recropped);

    const { outcome } = await run(workspace);

    expect(outcome).toMatchObject({ state: "done", indexed: 1, written: true });
    expect(workspace.photos()[0]).toMatchObject({ width: 1000, height: 1000 });
    expect(workspace.photos()[0]?.blurDataUrl).not.toBe(oldPlaceholder);
    // And the derivatives are re-cut to the new shape, so the `srcset` is honest.
    const metadata = await sharp(workspace.resolve("/photos/japon-2024/tokyo-960.avif")).metadata();
    expect(metadata.height).toBe(960);
  });
});

/**
 * The threshold the ticket names, and the acceptance criterion it comes with: the
 * warning has to **name the file**.
 */
describe("a photograph past the size limits", () => {
  const oneBigPhoto = tripWithPhotos(
    ["photos:", unindexedPhoto("/photos/japon-2024/osaka.jpg", "Le château d'Osaka")].join("\n")
  );

  it("resizes it and records the dimensions it now has, not the ones it had", async () => {
    workspace = await photoWorkspace({
      yaml: oneBigPhoto,
      images: { "/photos/japon-2024/osaka.jpg": { width: 4032, height: 3024 } },
    });
    expect(workspace.sizeOf("/photos/japon-2024/osaka.jpg")).toBeGreaterThan(MAX_PHOTO_BYTES);

    const { outcome } = await run(workspace);

    expect(outcome).toMatchObject({ state: "done", resized: 1, indexed: 1 });
    const photo = workspace.photos()[0] as { width: number; height: number };
    expect(Math.max(photo.width, photo.height)).toBeLessThanOrEqual(MAX_PHOTO_EDGE);
    expect(workspace.sizeOf("/photos/japon-2024/osaka.jpg")).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
    // The declared box has to be the box the file really is, or the whole point
    // of writing dimensions is lost.
    const metadata = await sharp(workspace.resolve("/photos/japon-2024/osaka.jpg")).metadata();
    expect(metadata.width).toBe(photo.width);
    expect(metadata.height).toBe(photo.height);
  });

  it("warns, and the warning names the file", async () => {
    workspace = await photoWorkspace({
      yaml: oneBigPhoto,
      images: { "/photos/japon-2024/osaka.jpg": { width: 4032, height: 3024 } },
    });

    const { events } = await run(workspace);
    const resized = events.filter((event) => event.kind === "resized");

    expect(resized).toHaveLength(1);
    expect(resized[0]?.photo.src).toBe("/photos/japon-2024/osaka.jpg");
    expect(resized[0]?.before).toMatchObject({ width: 4032, height: 3024 });
  });

  it("leaves validate:content with nothing to say afterwards", async () => {
    workspace = await photoWorkspace({
      yaml: oneBigPhoto,
      images: { "/photos/japon-2024/osaka.jpg": { width: 4032, height: 3024 } },
    });

    await run(workspace);

    expect(findings(workspace)).toEqual([]);
  });
});

describe("photos the command refuses to touch", () => {
  it("reports a declared photo whose file is not there, and writes the others", async () => {
    workspace = await photoWorkspace({
      yaml: TWO_PHOTOS,
      images: { "/photos/japon-2024/tokyo.jpg": { width: 1600, height: 1067 } },
    });

    const { outcome, events } = await run(workspace);

    expect(outcome).toMatchObject({ state: "done", indexed: 1, failed: 1, written: true });
    // The good photo is written even though its neighbour failed: exiting without
    // writing would make the author re-run the encoding he already paid for.
    expect(workspace.photos()[0]).toMatchObject({ width: 1600 });
    const failure = events.find((event) => event.kind === "failed");
    expect(failure?.photo.src).toBe("/photos/japon-2024/kyoto.jpg");
    expect(failure?.kind === "failed" && failure.reason.state).toBe("missing-file");
  });

  it("refuses a src that is not a site-absolute path", async () => {
    workspace = await photoWorkspace({
      yaml: tripWithPhotos(["photos:", unindexedPhoto("photos/x/a.jpg", "Une image")].join("\n")),
    });

    const { events } = await run(workspace);
    const failure = events.find((event) => event.kind === "failed");

    expect(failure?.kind === "failed" && failure.reason.state).toBe("relative-src");
  });

  /**
   * `/photos/../../etc/passwd` resolves outside `public/`, and the command would
   * otherwise **write** beside it — a derivative and a re-encoded original. It is
   * refused before any path is resolved, and the `%2e%2e` spelling with it, for
   * the reason `validate.ts` documents: decoding after the containment check lets
   * the escape through.
   */
  it.each(["/photos/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd"])(
    "refuses the escaping src %s without writing anything",
    async (src) => {
      workspace = await photoWorkspace({
        yaml: tripWithPhotos(["photos:", unindexedPhoto(src, "Une image")].join("\n")),
      });

      const { outcome, events } = await run(workspace);
      const failure = events.find((event) => event.kind === "failed");

      expect(failure?.kind === "failed" && failure.reason.state).toBe("escaping-src");
      expect(outcome).toMatchObject({ written: false });
    }
  );

  /**
   * A photo already named the way this command names its own output. Running on it
   * is what would **overwrite the author's original** with a derivative of another
   * file, so it is refused here as well as in the schema: the schema stops the
   * page, this stops the damage.
   */
  it("refuses a src that is one of the names it writes", async () => {
    workspace = await photoWorkspace({
      yaml: tripWithPhotos(
        ["photos:", unindexedPhoto("/photos/japon-2024/tokyo-480.jpg", "Une image")].join("\n")
      ),
      images: { "/photos/japon-2024/tokyo-480.jpg": { width: 1600, height: 1067 } },
    });

    const { outcome, events } = await run(workspace);
    const failure = events.find((event) => event.kind === "failed");

    expect(failure?.kind === "failed" && failure.reason.state).toBe("reserved-name");
    expect(outcome).toMatchObject({ written: false, failed: 1 });
  });

  it("reports a file that is not an image rather than throwing", async () => {
    workspace = await photoWorkspace({
      yaml: tripWithPhotos(
        ["photos:", unindexedPhoto("/photos/japon-2024/notes.jpg", "Une image")].join("\n")
      ),
      rawFiles: { "/photos/japon-2024/notes.jpg": "ceci n'est pas une image\n" },
    });

    const { outcome, events } = await run(workspace);
    const failure = events.find((event) => event.kind === "failed");

    expect(failure?.kind === "failed" && failure.reason.state).toBe("unreadable-image");
    expect(outcome).toMatchObject({ failed: 1, written: false });
  });
});

describe("trips the command cannot work on", () => {
  it("says the content directory is missing rather than reading nothing", async () => {
    workspace = await photoWorkspace({ yaml: TWO_PHOTOS });

    const outcome = await indexTripPhotos({
      contentDir: `${workspace.contentDir}-nowhere`,
      publicDir: workspace.publicDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
    });

    expect(outcome.state).toBe("content-dir-missing");
  });

  it("says which trips exist when the slug names none", async () => {
    workspace = await photoWorkspace({ yaml: TWO_PHOTOS });

    const outcome = await indexTripPhotos({
      contentDir: workspace.contentDir,
      publicDir: workspace.publicDir,
      repoRoot: workspace.repoRoot,
      slug: "perou-2023",
    });

    expect(outcome).toMatchObject({ state: "trip-not-found", available: ["japon-2024"] });
  });

  it("reports a trip whose YAML does not parse, without touching it", async () => {
    workspace = await photoWorkspace({ yaml: "photos:\n\t- src: a\n" });

    const outcome = await indexTripPhotos({
      contentDir: workspace.contentDir,
      publicDir: workspace.publicDir,
      repoRoot: workspace.repoRoot,
      slug: "japon-2024",
    });

    expect(outcome.state).toBe("trip-malformed");
  });

  /**
   * A trip with no photos is not an error: `photos` is optional in the content
   * model, and the great majority of a first draft has none. It gets its own
   * outcome so the transcript can say so in one line instead of reporting "0
   * photos indexed" as though something had gone wrong.
   */
  it("treats a trip with no photos as nothing to do, not as a failure", async () => {
    workspace = await photoWorkspace({ yaml: tripWithPhotos("") });

    const { outcome } = await run(workspace);

    expect(outcome).toMatchObject({ state: "no-photos" });
  });

  /**
   * The anti-clobber guard, inherited from the shared `writeAtomically`. This
   * command spends seconds encoding images, which is exactly the window in which
   * an author saves the file — and his save has to win over measurements taken
   * against the version before it.
   */
  it("writes nothing when the trip file changed while it was encoding", async () => {
    workspace = await photoWorkspace({
      yaml: TWO_PHOTOS,
      images: {
        "/photos/japon-2024/tokyo.jpg": { width: 1600, height: 1067 },
        "/photos/japon-2024/kyoto.jpg": { width: 1200, height: 900, seed: 7 },
      },
    });

    const outcome = await indexTripPhotos({
      contentDir: workspace.contentDir,
      publicDir: workspace.publicDir,
      repoRoot: workspace.repoRoot,
      slug: workspace.slug,
      onEvent: (event) => {
        // The author's editor saves, once, between the first measurement and the
        // write at the end of the run.
        if (event.kind === "indexed" && workspace !== undefined) {
          appendFileSync(workspace.tripFile, "# une note ajoutée pendant la commande\n");
        }
      },
    });

    expect(outcome.state).toBe("file-changed");
    expect(workspace.read()).toContain("# une note ajoutée pendant la commande");
    expect(workspace.photos()[0]?.width).toBeUndefined();
  });
});
