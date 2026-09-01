import { chmodSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import type { OutputInfo, Sharp } from "sharp";
import { DERIVATIVE_FORMAT, MAX_PHOTO_BYTES, MAX_PHOTO_EDGE } from "@/domain/photo";

/**
 * Every byte this pipeline reads or writes, and the only module that touches
 * `sharp`.
 *
 * **Why `sharp` is a declared dependency and why it costs nothing.** It was
 * already on disk at every install: `next@16.3.1` carries it as an *optional*
 * dependency for its own image optimiser, so `npm ls sharp` showed it deduped
 * under `next` before this ticket. Declaring it added **zero packages** and moved
 * `node_modules` from 575 MB to 576 MB — the 0.35.3 → 0.35.4 bump and nothing
 * else. What the declaration buys is honesty: depending on a transitive
 * dependency is a dependency that can vanish in a patch release of something
 * else.
 *
 * **Why it never reaches a browser.** Nothing in `src/**` imports this module;
 * its only consumer is `src/content/index-photos.ts`, whose only consumer is
 * `scripts/index-photos.ts`. The ESLint rule `travels-in-world/content-facade`
 * makes that structural rather than a habit — the whole of `src/**` outside
 * `src/content/**` may import `@/content/trips` and nothing else under
 * `@/content/`, and `tests/lint/content-facade.test.ts` proves it refuses. A
 * native module in a client bundle would fail the build loudly anyway; this is
 * why it cannot get that far.
 *
 * **Why there is no injected toolkit here.** The rest of this layer takes its
 * outside world as a parameter — `geocode.ts` receives `search` and `choose` — and
 * this module deliberately does not. Everything that can be wrong at this depth is
 * a question about bytes: is that really AVIF, did the longest edge really come
 * down, does the placeholder decode. A stub answers all of them by construction
 * and tests nothing. So the suite runs the real encoder over generated
 * photographs, the same posture `tests/content/geocode-cli.test.ts` takes with a
 * real `node:http` server rather than a stubbed `fetch`.
 */

/** What a file on disk turns out to be. */
export type ImageFacts = {
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
};

export type ImageProbe =
  | { readonly state: "read"; readonly facts: ImageFacts }
  | { readonly state: "unreadable"; readonly reason: string };

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The formats an original may be in, and the encoder options for re-writing one.
 *
 * A closed list, like `TRANSPORT_MODES`: a format not here has no re-encoding
 * this module knows how to do, and guessing would mean silently turning an
 * author's TIFF into something else. `sharp` reports the format from the file's
 * own bytes, never from its extension, which is what makes a `.jpg` that is
 * really a PNG behave as the PNG it is.
 */
const REWRITABLE_FORMATS = new Set(["jpeg", "png", "webp", "avif"]);

/**
 * Quality for a re-encoded original.
 *
 * 82 rather than the 92 the generator uses: this value only ever applies to a
 * photograph that is *already* over a threshold, where the point is to bring it
 * under one. Measured on a 4032 × 3024 photograph — 1.9 MB in, 0.55 MB out at
 * 3000 px — so the edge cap does most of the work and the quality does the rest.
 */
const REENCODE_QUALITY = 82;

/**
 * The edge caps tried in order when the first one does not get under the byte
 * limit.
 *
 * A photograph can be inside {@link MAX_PHOTO_EDGE} and still over
 * {@link MAX_PHOTO_BYTES} — a 2800 px photograph of foliage is the real case — and
 * for it the first rung changes nothing at all. Stepping down a fixed ladder is
 * preferred to a search on quality for one reason: it is **deterministic**, so two
 * runs of the command on the same file produce the same bytes, and a re-run is a
 * no-op instead of a diff.
 */
const EDGE_LADDER = [MAX_PHOTO_EDGE, 2400, 2000, 1600] as const;

function factsOf(absolutePath: string, width: number, height: number): ImageFacts {
  return { width, height, bytes: statSync(absolutePath).size };
}

export async function probeImage(absolutePath: string): Promise<ImageProbe> {
  try {
    const metadata = await sharp(absolutePath).metadata();
    const { width, height } = metadata;

    if (typeof width !== "number" || typeof height !== "number") {
      return { state: "unreadable", reason: "les dimensions de l'image sont illisibles" };
    }

    return { state: "read", facts: factsOf(absolutePath, width, height) };
  } catch (cause) {
    return { state: "unreadable", reason: errorMessage(cause) };
  }
}

/** Whether a photograph is over either threshold. */
export function isOversized(facts: ImageFacts): boolean {
  return Math.max(facts.width, facts.height) > MAX_PHOTO_EDGE || facts.bytes > MAX_PHOTO_BYTES;
}

export type ShrinkResult =
  /** Nothing was written: the file was already inside both thresholds. */
  | { readonly state: "within-limits"; readonly facts: ImageFacts }
  | {
      readonly state: "shrunk";
      /** The file as it is now on disk. */
      readonly facts: ImageFacts;
      /** The file as it was, for a warning that says what it cost. */
      readonly before: ImageFacts;
      /** True when the ladder ran out before the byte limit was met. */
      readonly stillOverBytes: boolean;
    }
  | { readonly state: "unreadable"; readonly reason: string }
  | { readonly state: "failed"; readonly reason: string };

/**
 * Written to a sibling file and renamed over the target.
 *
 * The same reasoning, and the same three losses to avoid, as
 * `writeAtomically` in `geocode.ts` — an interrupted run must leave either the
 * old photograph or the new one, never a truncated JPEG. The mode is copied
 * before the rename and not after, because after is a window in which the file is
 * readable by more people than it was.
 *
 * There is no anti-clobber comparison here, and that is the one real difference:
 * this command reads the file, encodes, and writes, with no prompt in between, so
 * there is no interval in which an author could save over it. `geocode` blocks on
 * a human for as long as he likes, which is what makes the comparison meaningful
 * there.
 */
function replaceAtomically(absolutePath: string, bytes: Buffer): { readonly reason?: string } {
  const temporary = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}${TEMPORARY_MARKER}${process.pid}${TEMPORARY_SUFFIX}`
  );

  try {
    writeFileSync(temporary, bytes);
    chmodSync(temporary, statSync(absolutePath).mode & 0o7777);
    renameSync(temporary, absolutePath);

    return {};
  } catch (cause) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Nothing useful to say: the caller is already returning a failure, and a
      // stray temporary is covered by TEMPORARY_FILE_GLOB.
    }

    return { reason: errorMessage(cause) };
  }
}

/**
 * The two fixed parts of the temporary name; the variable part is the pid.
 *
 * Exported for the same reason `geocode.ts` exports its own pair: the suite builds
 * the name this module really writes and asks **git** whether it ignores it,
 * rather than asserting that some pattern happens to appear in `.gitignore`.
 */
export const TEMPORARY_MARKER = ".index-photos-";
export const TEMPORARY_SUFFIX = ".tmp";

export const TEMPORARY_FILE_GLOB = `*${TEMPORARY_MARKER}*${TEMPORARY_SUFFIX}`;

/**
 * A photograph brought inside both thresholds, in place.
 *
 * **This is the only operation in the pipeline that rewrites a file the author
 * put there**, so two properties matter more than anything else here. It is
 * *idempotent*: a photograph already inside both thresholds is not touched at
 * all — same bytes, same mtime, so `git status` stays clean and no quality is
 * lost to a re-encode nobody asked for. And it is *deterministic*: the ladder is
 * fixed, so the same input always produces the same output and a second run is a
 * no-op rather than a fresh diff.
 */
export async function shrinkImage(absolutePath: string): Promise<ShrinkResult> {
  const probe = await probeImage(absolutePath);
  if (probe.state === "unreadable") {
    return probe;
  }
  const before = probe.facts;

  if (!isOversized(before)) {
    return { state: "within-limits", facts: before };
  }

  let format: string | undefined;
  try {
    format = (await sharp(absolutePath).metadata()).format;
  } catch (cause) {
    return { state: "unreadable", reason: errorMessage(cause) };
  }

  if (format === undefined || !REWRITABLE_FORMATS.has(format)) {
    return {
      state: "failed",
      reason: `le format ${format ?? "inconnu"} n'est pas réencodé par la commande`,
    };
  }

  /**
   * The encoder options per format, `sharp`'s own defaults everywhere except the
   * quality. `png` takes no quality at all — it is lossless — so an oversized PNG
   * is brought down by the edge cap alone, which is why the ladder can run out on
   * one and why `stillOverBytes` exists rather than a silent failure.
   */
  const encode = (pipeline: Sharp): Sharp => {
    if (format === "png") {
      return pipeline.png({ compressionLevel: 9 });
    }
    if (format === "webp") {
      return pipeline.webp({ quality: REENCODE_QUALITY });
    }
    if (format === "avif") {
      return pipeline.avif({ quality: REENCODE_QUALITY });
    }

    return pipeline.jpeg({ quality: REENCODE_QUALITY, mozjpeg: true });
  };

  let best: { readonly bytes: Buffer; readonly width: number; readonly height: number } | undefined;

  for (const edge of EDGE_LADDER) {
    let produced: { data: Buffer; info: OutputInfo };
    try {
      produced = await encode(
        // `fit: "inside"` with both bounds at `edge` caps the **longest** edge
        // whichever it is, so a portrait photograph is capped on its height. And
        // `withoutEnlargement`, or a rung below the photograph's own size would
        // upscale it: the ladder is only ever allowed to make a file smaller.
        sharp(absolutePath).resize({
          width: edge,
          height: edge,
          fit: "inside",
          withoutEnlargement: true,
        })
      ).toBuffer({ resolveWithObject: true });
    } catch (cause) {
      return { state: "failed", reason: errorMessage(cause) };
    }

    best = { bytes: produced.data, width: produced.info.width, height: produced.info.height };

    if (produced.data.length <= MAX_PHOTO_BYTES) {
      break;
    }
  }

  if (best === undefined) {
    return { state: "failed", reason: "aucune taille n'a pu être produite" };
  }

  const written = replaceAtomically(absolutePath, best.bytes);
  if (written.reason !== undefined) {
    return { state: "failed", reason: written.reason };
  }

  return {
    state: "shrunk",
    facts: factsOf(absolutePath, best.width, best.height),
    before,
    stillOverBytes: best.bytes.length > MAX_PHOTO_BYTES,
  };
}

export type DerivativeResult =
  | { readonly state: "written"; readonly bytes: number }
  | { readonly state: "failed"; readonly reason: string };

/**
 * Quality for a derivative.
 *
 * 55 in AVIF, which is not the same scale as JPEG's: measured over four
 * photographs, an AVIF at 55 is visually indistinguishable from the JPEG source at
 * roughly a third of its bytes (a 1600 px original of 262 KB gives 36 KB at
 * 960 px). Raising it is a decision about the repository's weight, which
 * `src/domain/photo.ts` does the arithmetic for.
 */
const DERIVATIVE_QUALITY = 55;

/**
 * One rung of the ladder, written next to its original.
 *
 * **Written whole to a sibling and renamed**, which matters more here than it
 * looks. `validate:content` checks that a derivative *exists*, not that it
 * decodes — so a run interrupted mid-write would leave a truncated AVIF that the
 * validator reports as present and the browser refuses to draw. That is precisely
 * the failure this whole check exists to prevent, arriving through the back door.
 */
export async function writeDerivative(
  from: string,
  to: string,
  width: number
): Promise<DerivativeResult> {
  let produced: Buffer;
  try {
    produced = await sharp(from)
      // No height, so the ratio is whatever the original's is — a derivative that
      // cropped or letterboxed would be a different photograph at another width,
      // and the browser picks between the rungs assuming they are one picture.
      .resize({ width, withoutEnlargement: true })
      .toFormat(DERIVATIVE_FORMAT, { quality: DERIVATIVE_QUALITY })
      .toBuffer();
  } catch (cause) {
    return { state: "failed", reason: errorMessage(cause) };
  }

  const temporary = path.join(
    path.dirname(to),
    `.${path.basename(to)}${TEMPORARY_MARKER}${process.pid}${TEMPORARY_SUFFIX}`
  );

  try {
    writeFileSync(temporary, produced);
    renameSync(temporary, to);

    return { state: "written", bytes: produced.length };
  } catch (cause) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Already returning a failure; a stray temporary is covered by
      // TEMPORARY_FILE_GLOB, which `.gitignore` carries.
    }

    return { state: "failed", reason: errorMessage(cause) };
  }
}

export type PlaceholderResult =
  | { readonly state: "made"; readonly dataUrl: string }
  | { readonly state: "failed"; readonly reason: string };

/**
 * The preloading placeholder's width, in pixels.
 *
 * 16, and the number is a measurement rather than a round guess. Measured on a
 * real photograph at WebP quality 45: 8 px and 16 px both come out at ~76 bytes
 * because the container dominates, and 20 px jumps to 102. So 16 is the widest
 * thumbnail that is still free, and a wider one buys detail nobody sees behind a
 * blur.
 */
const PLACEHOLDER_WIDTH = 16;

/**
 * WebP, and this is the measurement that chose the format outright.
 *
 * At this size the container is the file. Measured on the same photograph at
 * 16 px: **WebP 76 bytes**, AVIF 307, JPEG 305 — a factor of four, almost all of
 * it header. So the placeholder is the one place in this pipeline where AVIF is
 * the wrong answer, and the reason is written here rather than left to look like
 * an inconsistency with {@link DERIVATIVE_FORMAT}.
 */
const PLACEHOLDER_QUALITY = 45;

export async function placeholderFor(absolutePath: string): Promise<PlaceholderResult> {
  try {
    const bytes = await sharp(absolutePath)
      .resize({ width: PLACEHOLDER_WIDTH })
      .webp({ quality: PLACEHOLDER_QUALITY })
      .toBuffer();

    return { state: "made", dataUrl: `data:image/webp;base64,${bytes.toString("base64")}` };
  } catch (cause) {
    return { state: "failed", reason: errorMessage(cause) };
  }
}
