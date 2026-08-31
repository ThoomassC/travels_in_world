import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

/**
 * Photographs for the photo-pipeline suites, **generated** rather than committed.
 *
 * Two reasons, and the second is the one that decides it. A realistic photograph
 * is 300–500 KB, and this suite needs half a dozen of them at four sizes: that is
 * megabytes of binary in a repository whose weight the ticket asks to watch. And
 * a downloaded photograph is a test that leaves the machine, which
 * `README.md` forbids by name.
 *
 * **They are not flat colours.** A uniform image compresses to almost nothing, so
 * every size measurement taken against one is meaningless — an "oversized" 4032 px
 * photograph would weigh 12 KB and never trip the byte threshold the command
 * exists to enforce. So the generator paints low-frequency colour structure (a
 * sky, a horizon, a sun) over high-frequency noise, which is what a photograph
 * actually is to an encoder. Measured: 1600 × 1067 comes out at ~260 KB and
 * 4032 × 3024 at ~1.9 MB, both in the range the thresholds are set against.
 */

export type ImageSpec = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Changes the noise, so two images of one size are not the same bytes. */
  readonly seed?: number;
  /** Defaults to the extension of `name`. */
  readonly format?: "jpeg" | "png" | "webp";
};

/**
 * A deterministic linear congruential generator.
 *
 * `Math.random()` would make every size assertion in these suites flaky by a few
 * percent, and a flaky size assertion is the kind that gets a `toBeGreaterThan`
 * loosened until it stops guarding anything.
 */
function noise(width: number, height: number, seed: number): Buffer {
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);
  let state = (seed * 2654435761) % 0x7fffffff || 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      const grain = ((state >> 16) & 0xff) / 8;

      const horizon = y / height;
      const dx = x - width * 0.7;
      const dy = y - height * 0.25;
      const sun = Math.exp(-(dx * dx + dy * dy) / (2 * (width / 12) ** 2));
      const shore = horizon > 0.72 ? 0.38 : 1;

      buffer[index] = Math.min(255, (40 + 180 * horizon + 200 * sun) * shore + grain);
      buffer[index + 1] = Math.min(255, (90 + 90 * (1 - horizon) + 150 * sun) * shore + grain);
      buffer[index + 2] = Math.min(255, (190 - 120 * horizon + 60 * sun) * shore + grain);
    }
  }

  return buffer;
}

export async function writeImage(target: string, spec: ImageSpec): Promise<void> {
  const format = spec.format ?? (path.extname(spec.name).slice(1) as "jpeg" | "png" | "webp");
  const raw = noise(spec.width, spec.height, spec.seed ?? 1);
  const image = sharp(raw, {
    raw: { width: spec.width, height: spec.height, channels: 3 },
  });

  mkdirSync(path.dirname(target), { recursive: true });

  if (format === "png") {
    await image.png().toFile(target);
    return;
  }
  if (format === "webp") {
    await image.webp({ quality: 88 }).toFile(target);
    return;
  }
  await image.jpeg({ quality: 92 }).toFile(target);
}

export type TemporaryPhotos = {
  /** The `public/` root a `src` resolves against. */
  readonly publicDir: string;
  /** Absolute path of a photo, from its site-absolute `src`. */
  readonly resolve: (src: string) => string;
  readonly sizeOf: (src: string) => number;
  readonly exists: (src: string) => boolean;
  readonly cleanup: () => void;
};

/**
 * A throwaway `public/` holding the given photos, keyed by their site-absolute
 * `src` so a test names files the way the content does.
 */
export async function temporaryPhotos(
  photos: Readonly<Record<string, Omit<ImageSpec, "name">>>
): Promise<TemporaryPhotos> {
  const publicDir = mkdtempSync(path.join(tmpdir(), "tiw-photos-"));
  const resolve = (src: string): string => path.join(publicDir, ...src.split("/").filter(Boolean));

  for (const [src, spec] of Object.entries(photos)) {
    await writeImage(resolve(src), { ...spec, name: path.basename(src) });
  }

  return {
    publicDir,
    resolve,
    sizeOf: (src) => statSync(resolve(src)).size,
    exists: (src) => {
      try {
        return statSync(resolve(src)).isFile();
      } catch {
        return false;
      }
    },
    cleanup: () => rmSync(publicDir, { recursive: true, force: true }),
  };
}
