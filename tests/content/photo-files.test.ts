import { readFileSync, statSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  BLUR_DATA_URL_MAX_LENGTH,
  BLUR_DATA_URL_PATTERN,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_EDGE,
} from "@/domain/photo";
import { placeholderFor, probeImage, shrinkImage, writeDerivative } from "@/content/photo-files";
import { temporaryPhotos } from "./images";
import type { TemporaryPhotos } from "./images";

/**
 * The image work itself, against **real files and the real encoder**.
 *
 * There is no fake toolkit here, and that is a decision rather than an omission:
 * the things that can be wrong at this layer are all questions about bytes — is
 * that really AVIF, did the longest edge really come down, is the placeholder
 * really decodable — and a stub answers every one of them by construction. The
 * repository has the same posture one layer up, where `geocode-cli.test.ts` runs a
 * real `node:http` server rather than stubbing `fetch`.
 *
 * The photographs are generated (`./images.ts`), so nothing leaves the machine and
 * no megabyte of binary enters the repository.
 */

/**
 * These suites drive a **real image encoder** over real files, which is CPU-bound
 * and therefore machine-dependent: ~14 s of test time on this workstation, and
 * enough more on a GitHub runner that Vitest's 5 s default expired mid-encode.
 * Measured there, and the failure was doubly misleading — a timed-out test never
 * runs its `finally`, so one slow case also left a directory read-only and made
 * the teardown fail with `EACCES` on the next one.
 *
 * Raised here and not in `vitest.config.ts`: the rest of the suite is pure logic
 * where 5 s is the right alarm, and a global raise would let a genuinely hung test
 * sit for half a minute.
 */
vi.setConfig({ testTimeout: 30_000 });

let photos: TemporaryPhotos | undefined;

afterEach(() => {
  photos?.cleanup();
  photos = undefined;
});

describe("probeImage", () => {
  it("reads the dimensions and the size of a photograph", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 1600, height: 1067 } });

    const probe = await probeImage(photos.resolve("/photos/t/a.jpg"));

    expect(probe).toEqual({
      state: "read",
      facts: { width: 1600, height: 1067, bytes: photos.sizeOf("/photos/t/a.jpg") },
    });
  });

  it("reads a portrait photograph without transposing it", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 800, height: 1200 } });

    const probe = await probeImage(photos.resolve("/photos/t/a.jpg"));

    expect(probe).toMatchObject({ facts: { width: 800, height: 1200 } });
  });

  it("refuses a file that is not an image, with a reason and no throw", async () => {
    photos = await temporaryPhotos({});

    const probe = await probeImage(photos.resolve("/photos/t/absente.jpg"));

    expect(probe.state).toBe("unreadable");
  });
});

/**
 * The threshold the ticket names, and the only operation in this pipeline that
 * **rewrites the author's own file**. Every case here is about being able to say
 * exactly what it did.
 */
describe("shrinkImage", () => {
  it("brings a photograph past the edge limit down to it, keeping the aspect ratio", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 4032, height: 3024 } });
    const before = photos.sizeOf("/photos/t/a.jpg");
    expect(before).toBeGreaterThan(MAX_PHOTO_BYTES);

    const result = await shrinkImage(photos.resolve("/photos/t/a.jpg"));

    expect(result.state).toBe("shrunk");
    if (result.state !== "shrunk") return;
    expect(Math.max(result.facts.width, result.facts.height)).toBeLessThanOrEqual(MAX_PHOTO_EDGE);
    expect(result.facts.bytes).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
    // 4:3 in, 4:3 out.
    expect(result.facts.width / result.facts.height).toBeCloseTo(4 / 3, 2);
    // The facts describe the file that is now on disk, not the one that was.
    expect(result.facts.bytes).toBe(photos.sizeOf("/photos/t/a.jpg"));
    expect(result.before).toMatchObject({ width: 4032, height: 3024, bytes: before });
  });

  it("caps the longest edge of a portrait photograph, not its width", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 3024, height: 4032 } });

    const result = await shrinkImage(photos.resolve("/photos/t/a.jpg"));

    expect(result.state).toBe("shrunk");
    if (result.state !== "shrunk") return;
    expect(result.facts.height).toBeLessThanOrEqual(MAX_PHOTO_EDGE);
    expect(result.facts.height).toBeGreaterThan(result.facts.width);
  });

  /**
   * The two thresholds are `OR`, not `AND`. A photograph well inside the edge
   * limit and well over the byte limit is exactly as much dead weight in a git
   * history, and the first version of this only looked at the edge — so a 2 MB
   * photograph at 2000 px sailed through.
   */
  it("shrinks a photograph that is only over the byte limit", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 2800, height: 2100 } });
    expect(photos.sizeOf("/photos/t/a.jpg")).toBeGreaterThan(MAX_PHOTO_BYTES);
    expect(2800).toBeLessThan(MAX_PHOTO_EDGE);

    const result = await shrinkImage(photos.resolve("/photos/t/a.jpg"));

    expect(result.state).toBe("shrunk");
    if (result.state !== "shrunk") return;
    expect(result.facts.bytes).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
  });

  /**
   * The idempotence that makes the command safe to run in a loop: a photograph
   * already inside both thresholds is **not touched at all**. Same bytes, same
   * mtime — so `git status` stays clean and no quality is lost to a re-encode
   * nobody asked for.
   */
  it("leaves a photograph inside both limits completely alone", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 1600, height: 1067 } });
    const file = photos.resolve("/photos/t/a.jpg");
    const before = readFileSync(file);
    const stamp = statSync(file).mtimeMs;

    const result = await shrinkImage(file);

    expect(result.state).toBe("within-limits");
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(statSync(file).mtimeMs).toBe(stamp);
  });

  it("is idempotent: a second run on a shrunk photograph changes nothing", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 4032, height: 3024 } });
    const file = photos.resolve("/photos/t/a.jpg");

    await shrinkImage(file);
    const afterFirst = readFileSync(file);

    const second = await shrinkImage(file);

    expect(second.state).toBe("within-limits");
    expect(readFileSync(file).equals(afterFirst)).toBe(true);
  });

  it("keeps the file's format rather than silently changing what a .png is", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.png": { width: 3600, height: 2400 } });

    const result = await shrinkImage(photos.resolve("/photos/t/a.png"));

    expect(result.state).toBe("shrunk");
    const metadata = await sharp(photos.resolve("/photos/t/a.png")).metadata();
    expect(metadata.format).toBe("png");
  });

  it("refuses a file that is not an image without writing anything", async () => {
    photos = await temporaryPhotos({});

    const result = await shrinkImage(photos.resolve("/photos/t/absente.jpg"));

    expect(result.state).toBe("unreadable");
    expect(photos.exists("/photos/t/absente.jpg")).toBe(false);
  });
});

describe("writeDerivative", () => {
  it("writes a real AVIF at the width it was asked for", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 1600, height: 1067 } });

    const result = await writeDerivative(
      photos.resolve("/photos/t/a.jpg"),
      photos.resolve("/photos/t/a-960.avif"),
      960
    );

    expect(result).toEqual({ state: "written", bytes: photos.sizeOf("/photos/t/a-960.avif") });
    const metadata = await sharp(photos.resolve("/photos/t/a-960.avif")).metadata();
    /**
     * `format` is `"heif"` and not `"avif"`, which is not a defect: AVIF *is* an
     * HEIF container, and that is what `sharp` reports when it reads one back.
     * The codec is what distinguishes the two, so the assertion is on
     * `compression` — a file that came back `heif` with any other codec would be
     * an HEIC, which no browser displays.
     */
    expect(metadata.format).toBe("heif");
    expect(metadata.compression).toBe("av1");
    expect(metadata.width).toBe(960);
    // The height follows from the ratio; nothing declares it.
    expect(metadata.height).toBe(640);
  });

  /**
   * The whole reason for the format: an AVIF at a smaller width has to be
   * *smaller* than the JPEG it came from, or the derivative costs the reader
   * bytes instead of saving them.
   */
  it("produces a file smaller than the original it came from", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 1600, height: 1067 } });

    await writeDerivative(
      photos.resolve("/photos/t/a.jpg"),
      photos.resolve("/photos/t/a-960.avif"),
      960
    );

    expect(photos.sizeOf("/photos/t/a-960.avif")).toBeLessThan(photos.sizeOf("/photos/t/a.jpg"));
  });

  it("reports a failure rather than throwing when the source is not an image", async () => {
    photos = await temporaryPhotos({});

    const result = await writeDerivative(
      photos.resolve("/photos/t/absente.jpg"),
      photos.resolve("/photos/t/absente-960.avif"),
      960
    );

    expect(result.state).toBe("failed");
    expect(photos.exists("/photos/t/absente-960.avif")).toBe(false);
  });
});

describe("placeholderFor", () => {
  it("produces a base64 WebP data URI the schema accepts", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 1600, height: 1067 } });

    const result = await placeholderFor(photos.resolve("/photos/t/a.jpg"));

    expect(result.state).toBe("made");
    if (result.state !== "made") return;
    expect(result.dataUrl).toMatch(BLUR_DATA_URL_PATTERN);
    expect(result.dataUrl.length).toBeLessThanOrEqual(BLUR_DATA_URL_MAX_LENGTH);
  });

  /**
   * The measurement the cap is set against, asserted so a change of format or
   * quality that quadruples it cannot pass unnoticed: a placeholder goes into the
   * HTML of every page showing the photo, and 200 of them at 512 characters would
   * be the entire document budget.
   */
  it("stays around the measured 130 characters, far under the cap", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 1600, height: 1067 } });

    const result = await placeholderFor(photos.resolve("/photos/t/a.jpg"));

    expect(result.state).toBe("made");
    if (result.state !== "made") return;
    expect(result.dataUrl.length).toBeLessThan(300);
  });

  it("decodes back to a real image, so the browser will not show nothing", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 1600, height: 1067 } });

    const result = await placeholderFor(photos.resolve("/photos/t/a.jpg"));
    expect(result.state).toBe("made");
    if (result.state !== "made") return;

    const bytes = Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(",") + 1), "base64");
    const metadata = await sharp(bytes).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(16);
  });

  /**
   * A placeholder is a *blur*, so it must not carry recognisable content — and,
   * more practically, two different photographs must not get the same one. A
   * constant would pass every other assertion here.
   */
  it("differs between two different photographs", async () => {
    photos = await temporaryPhotos({
      "/photos/t/a.jpg": { width: 1600, height: 1067, seed: 1 },
      "/photos/t/b.jpg": { width: 1600, height: 1067, seed: 99 },
    });

    const first = await placeholderFor(photos.resolve("/photos/t/a.jpg"));
    const second = await placeholderFor(photos.resolve("/photos/t/b.jpg"));

    expect(first.state).toBe("made");
    expect(second.state).toBe("made");
    if (first.state !== "made" || second.state !== "made") return;
    expect(first.dataUrl).not.toBe(second.dataUrl);
  });

  it("is deterministic, so a second run produces no diff", async () => {
    photos = await temporaryPhotos({ "/photos/t/a.jpg": { width: 1600, height: 1067 } });

    const first = await placeholderFor(photos.resolve("/photos/t/a.jpg"));
    const second = await placeholderFor(photos.resolve("/photos/t/a.jpg"));

    expect(first).toEqual(second);
  });

  it("reports a failure rather than throwing on a file that is not an image", async () => {
    photos = await temporaryPhotos({});

    expect((await placeholderFor(photos.resolve("/photos/t/absente.jpg"))).state).toBe("failed");
  });
});
