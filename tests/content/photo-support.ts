import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { writeImage } from "./images";
import type { ImageSpec } from "./images";

/**
 * A throwaway repository for the photo-pipeline suites: one trip, real
 * photographs, and the two directories the commands take as arguments.
 *
 * It exists because these suites assert on **both** sides of one run — what the
 * YAML says afterwards *and* what is on disk — so a helper that only wrote the
 * trip, or only the images, would leave every test doing half the setup by hand.
 *
 * `content/trips/` and `public/photos/` of the real repository are never touched:
 * every path here is under a `mkdtemp` root, which is also what lets the suite run
 * in parallel with itself.
 */

export type PhotoWorkspace = {
  readonly root: string;
  readonly contentDir: string;
  readonly publicDir: string;
  readonly repoRoot: string;
  readonly slug: string;
  /** The trip file's absolute path, for an mtime or a permission change. */
  readonly tripFile: string;
  /** The trip file as it is now on disk. */
  readonly read: () => string;
  /** The trip file, parsed — for asserting on values rather than on text. */
  readonly parsed: () => Record<string, unknown>;
  readonly photos: () => readonly Record<string, unknown>[];
  readonly resolve: (src: string) => string;
  readonly exists: (src: string) => boolean;
  readonly sizeOf: (src: string) => number;
  readonly cleanup: () => void;
};

export type WorkspaceOptions = {
  readonly slug?: string;
  readonly yaml: string;
  /** Real photographs, keyed by the site-absolute `src` the content declares. */
  readonly images?: Readonly<Record<string, Omit<ImageSpec, "name">>>;
  /** Files written verbatim under `public/`, for a "this is not an image" case. */
  readonly rawFiles?: Readonly<Record<string, string>>;
};

export async function photoWorkspace(options: WorkspaceOptions): Promise<PhotoWorkspace> {
  const slug = options.slug ?? "japon-2024";
  const root = mkdtempSync(path.join(tmpdir(), "tiw-photo-ws-"));
  const contentDir = path.join(root, "trips");
  const publicDir = path.join(root, "public");
  const tripFile = path.join(contentDir, slug, "trip.yaml");

  mkdirSync(path.dirname(tripFile), { recursive: true });
  writeFileSync(tripFile, options.yaml, "utf8");
  mkdirSync(publicDir, { recursive: true });

  const resolve = (src: string): string => path.join(publicDir, ...src.split("/").filter(Boolean));

  for (const [src, spec] of Object.entries(options.images ?? {})) {
    await writeImage(resolve(src), { ...spec, name: path.basename(src) });
  }

  for (const [src, body] of Object.entries(options.rawFiles ?? {})) {
    const target = resolve(src);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body, "utf8");
  }

  const parsed = (): Record<string, unknown> =>
    (parse(readFileSync(tripFile, "utf8")) ?? {}) as Record<string, unknown>;

  return {
    root,
    contentDir,
    publicDir,
    repoRoot: root,
    slug,
    tripFile,
    read: () => readFileSync(tripFile, "utf8"),
    parsed,
    photos: () => {
      const value = parsed().photos;

      return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    },
    resolve,
    exists: (src) => {
      try {
        return statSync(resolve(src)).isFile();
      } catch {
        return false;
      }
    },
    sizeOf: (src) => statSync(resolve(src)).size,
    /**
     * Made writable again before it is removed.
     *
     * One case chmods the trip's directory to `0o500` to reach the `write-failed`
     * outcome, and restores it in a `finally`. A test that *times out* never runs
     * its `finally` — measured on CI, where the image encoding is slower than the
     * timeout allowed: the mode stayed at `0o500` and this `afterEach` failed with
     * `EACCES`, turning one slow test into a second, unrelated-looking failure.
     *
     * So the teardown restores the mode itself rather than trusting the test to.
     * Best effort: a failure to tidy up must not mask the real failure.
     */
    cleanup: () => {
      try {
        chmodSync(path.join(contentDir, slug), 0o700);
      } catch {
        // Already gone, or never chmodded — nothing to say either way.
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * A trip whose only interesting part is its `photos:` block.
 *
 * The places and steps are the minimum `TripSchema` accepts, so a test about
 * photos does not have to restate an itinerary — and so `validate:content` can be
 * pointed at the result and be expected to say nothing at all, which is the
 * strongest assertion these suites make.
 */
export function tripWithPhotos(photos: string, overrides: readonly string[] = []): string {
  return [
    "slug: japon-2024",
    "title: Japon, printemps 2024",
    "startDate: 2024-04-12",
    "endDate: 2024-04-16",
    "publishedAt: 2024-05-02",
    "",
    "places:",
    "  - slug: tokyo",
    "    name: Tokyo",
    "    countryCode: JP",
    "    coordinates:",
    "      lat: 35.6762",
    "      lon: 139.6503",
    "",
    "steps:",
    "  - kind: stay",
    "    placeSlug: tokyo",
    "    startDate: 2024-04-12",
    "    endDate: 2024-04-16",
    "",
    photos,
    ...overrides,
    "",
  ].join("\n");
}

/** One photo entry, with only the keys an author writes by hand. */
export function unindexedPhoto(src: string, alt: string, extra: readonly string[] = []): string {
  return [`  - src: ${src}`, `    alt: ${alt}`, ...extra.map((line) => `    ${line}`)].join("\n");
}
