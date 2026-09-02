import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  derivativeSources,
  isDerivativeName,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_EDGE,
} from "@/domain/photo";
import { isInsideDirectory, temporaryFileGlob, writeAtomically } from "./atomic-write";
import { displayPath, readTripCollection, stringAt, valueAt } from "./collection";
import type { TripFile } from "./collection";
import {
  isOversized,
  placeholderFor,
  probeImage,
  shrinkImage,
  writeDerivative,
} from "./photo-files";
import type { ImageFacts } from "./photo-files";
import { writePhotoFields } from "./yaml-edit";
import type { PhotoFieldsEdit } from "./yaml-edit";

/**
 * `npm run index-photos <slug>`, minus the terminal.
 *
 * The command `validate:content` has been naming since TIW-9. Its messages have
 * said « lance `npm run index-photos japon-2024` » from the start, and this is the
 * other end of that promise: three fields per photo and one AVIF per rung of the
 * ladder, so that the validator has nothing left to complain about.
 *
 * **What it borrows from `geocode.ts`, deliberately and to the letter.** The two
 * commands solve the same problem — measure something, write it into a file a
 * human wrote — so the shape is the same on purpose: an outcome value rather than
 * an exit code, an event per photo so the transcript reads in the order things
 * happened, a surgical YAML edit, one atomic write at the end, and *the largest
 * writable subset* rather than all-or-nothing. Every one of those was paid for
 * once in TIW-10; none of them is re-derived here.
 *
 * **Where it differs, and why.**
 *
 * 1. **It probes every photo, every run.** `geocode` skips a place that already
 *    has coordinates, because a latitude written once is true forever. A
 *    photograph is not: an author recrops `tokyo.jpg` in place and the file now
 *    has a different shape, while the YAML still describes the old one — which
 *    reserves the wrong box and produces exactly the layout shift `width` and
 *    `height` exist to prevent. So nothing is trusted and everything is measured;
 *    what makes that cheap is that a probe reads a header, not an image.
 * 2. **Idempotence is by comparison, not by absence.** A field is rewritten only
 *    when the measured value differs from the declared one, and a derivative only
 *    when the file on disk is not already the right size. So a second run on an
 *    indexed trip writes nothing at all — same bytes, same mtime — which is the
 *    property `content/README.md` promises for `geocode` and this command owes for
 *    the same reason: it is run after every batch of photos.
 * 3. **Nothing depends on an mtime.** Staleness is decided by *comparing values*:
 *    the measured dimensions against the declared ones, the derivative's real
 *    width and height against the ones the ladder implies. An mtime comparison
 *    would be one line shorter and would fire spuriously on every fresh
 *    `git clone`, where every file is a few milliseconds old in an arbitrary
 *    order.
 * 4. **It rewrites images.** The one operation in this repository that overwrites
 *    a file the author put there. It is confined to `photo-files.ts`, guarded by
 *    two thresholds, atomic, idempotent and deterministic, and it always produces
 *    a `resized` event naming the file — which is the acceptance criterion, and
 *    the reason the event carries the dimensions *before* as well as after.
 * 5. **There is no prompt.** Every decision here has a right answer that can be
 *    computed, so there is nothing to ask. That is also why there is no `choose`
 *    parameter and no non-interactive escape hatch to test around.
 */

export type IndexPhotosRequest = {
  /** Absolute path of the directory holding one sub-directory per trip. */
  readonly contentDir: string;
  /** Absolute path the `src` of a photo resolves against — the site's `public/`. */
  readonly publicDir: string;
  /** Absolute path used to shorten every path that appears in a message. */
  readonly repoRoot: string;
  readonly slug: string;
  readonly onEvent?: (event: IndexPhotosEvent) => void;
};

export type PhotoRef = {
  /** Index into `photos[]`, so a message can print `photos[1]`. */
  readonly index: number;
  /** The source **as written in the file**, valid or not, so a message can quote it. */
  readonly src: string;
};

/** Why one photo was left alone. Every branch has its own sentence to print. */
export type PhotoFailure =
  | { readonly state: "no-src" }
  | { readonly state: "relative-src" }
  | { readonly state: "escaping-src" }
  | { readonly state: "invalid-escape" }
  | { readonly state: "reserved-name" }
  | { readonly state: "missing-file"; readonly expected: string }
  | { readonly state: "unreadable-image"; readonly reason: string }
  | { readonly state: "resize-failed"; readonly reason: string }
  | { readonly state: "derivative-failed"; readonly width: number; readonly reason: string }
  | { readonly state: "placeholder-failed"; readonly reason: string }
  | { readonly state: "unsupported-yaml"; readonly reason: string };

export type IndexPhotosEvent =
  /** One per photo, before its file is opened. */
  | { readonly kind: "scanning"; readonly photo: PhotoRef }
  /**
   * The file was rewritten, and this is the warning the ticket asks for. `before`
   * is what it was: a warning that only names the file leaves the author unable to
   * tell a 4032 px photograph brought to 3000 from one quietly halved.
   */
  | {
      readonly kind: "resized";
      readonly photo: PhotoRef;
      readonly before: ImageFacts;
      readonly facts: ImageFacts;
      /** The ladder ran out before the byte limit was met — a PNG, in practice. */
      readonly stillOverBytes: boolean;
    }
  | {
      readonly kind: "derived";
      readonly photo: PhotoRef;
      readonly widths: readonly number[];
      readonly bytes: number;
    }
  /** The photo's three fields are about to be written into the file. */
  | {
      readonly kind: "indexed";
      readonly photo: PhotoRef;
      readonly facts: ImageFacts;
      /**
       * How long the placeholder came out, in characters.
       *
       * Carried rather than left to the report, which first printed the *cap*
       * (« 512 caractères au plus ») — a constant, in a line whose whole job is to
       * say what was measured. The real number is the one that tells an author his
       * placeholders are ~130 characters and that the cap is not near.
       */
      readonly placeholderLength: number;
    }
  /** Measured, and already correct in the file: nothing to write. */
  | { readonly kind: "unchanged"; readonly photo: PhotoRef }
  | { readonly kind: "failed"; readonly photo: PhotoRef; readonly reason: PhotoFailure };

export type IndexPhotosOutcome =
  | { readonly state: "content-dir-missing"; readonly contentDir: string }
  | {
      readonly state: "content-dir-unreadable";
      readonly contentDir: string;
      readonly reason: string;
    }
  | {
      readonly state: "trip-not-found";
      readonly slug: string;
      readonly contentDir: string;
      readonly available: readonly string[];
    }
  | {
      readonly state: "trip-unreadable";
      readonly file: string;
      readonly reason: string;
      /**
       * A file in the trip's folder whose name differs from `trip.yaml` only by
       * case, so the refusal can say "rename it" rather than "write it" — an
       * author who reads « introuvable » next to his own `Trip.yaml` writes a
       * second file instead of renaming the first.
       */
      readonly similarName?: string;
    }
  | { readonly state: "trip-malformed"; readonly file: string; readonly reason: string }
  /** Not a failure: `photos` is optional, and most first drafts have none. */
  | { readonly state: "no-photos"; readonly file: string }
  | {
      readonly state: "done";
      readonly file: string;
      readonly photoCount: number;
      /** Photos whose fields were written. */
      readonly indexed: number;
      /** Photos whose file was rewritten because it was over a threshold. */
      readonly resized: number;
      /** Derivative files written this run. */
      readonly derivatives: number;
      readonly failed: number;
      readonly written: boolean;
      /**
       * Where the bytes actually went, when `trip.yaml` is a symlink resolving
       * **outside** the content directory — absent otherwise. Same transparency as
       * `geocode`: git versions a symlink like any other entry, so a run could
       * otherwise report `content/trips/x/trip.yaml — fichier réécrit` while
       * writing to a file outside the repository.
       */
      readonly writtenTo?: string;
    }
  | {
      readonly state: "write-failed";
      readonly file: string;
      readonly reason: string;
      readonly indexed: number;
    }
  /**
   * The trip file was modified on disk while the run was encoding images, so
   * nothing was written to it: the author's save wins. `indexed` says how much
   * work has to be redone, which is the whole cost of the refusal.
   *
   * The derivatives and any resized original **have** been written by then, and
   * that is deliberate: they are correct files whatever the YAML says, and the
   * next run finds them already in place.
   */
  | { readonly state: "file-changed"; readonly file: string; readonly indexed: number }
  /**
   * The trip file is not valid UTF-8, so the text this run computed its edit from
   * is not the file. Nothing is written. See `atomic-write.ts` for the measurement
   * that made this its own state rather than a "changed underfoot".
   */
  | { readonly state: "file-not-utf8"; readonly file: string; readonly indexed: number };

/** The temporary name this command leaves behind if it is killed mid-rename. */
export const TEMPORARY_MARKER = ".index-photos-";
export const TEMPORARY_SUFFIX = ".tmp";

const TEMPORARY_NAMING = { marker: TEMPORARY_MARKER, suffix: TEMPORARY_SUFFIX } as const;

export const TEMPORARY_FILE_GLOB = temporaryFileGlob(TEMPORARY_NAMING);

/* ------------------------------------------------------------ finding the trip -- */

type ParsedTrip = Extract<TripFile, { state: "parsed" }>;

type Selection =
  | { readonly state: "found"; readonly trip: TripFile }
  | { readonly state: "not-found"; readonly available: readonly string[] };

/**
 * The trip a slug names — the directory first, the declared slug as a fallback.
 *
 * Identical to `geocode`'s selection and identical on purpose: the two commands
 * are run one after the other on the same argument, so a slug that resolves for
 * one and not for the other would be the worst possible surprise. If this ever
 * grows a third case it belongs in a shared module, not in a second copy.
 */
function selectTrip(files: readonly TripFile[], slug: string): Selection {
  const byDirectory = files.find((file) => file.directory === slug);
  if (byDirectory !== undefined) {
    return { state: "found", trip: byDirectory };
  }

  const byDeclaredSlug = files.find(
    (file) => file.state === "parsed" && stringAt(file.value, ["slug"]) === slug
  );
  if (byDeclaredSlug !== undefined) {
    return { state: "found", trip: byDeclaredSlug };
  }

  return { state: "not-found", available: files.map((file) => file.directory) };
}

/* --------------------------------------------------------- resolving a source -- */

type Resolved =
  | { readonly state: "resolved"; readonly absolutePath: string }
  | { readonly state: "refused"; readonly reason: PhotoFailure };

/**
 * A site-absolute `src` turned into a path on disk, or a refusal.
 *
 * **The order of the checks is load-bearing, and it is the order
 * `validate.ts` documents**: decode first, then look for `..`. Decoding *after*
 * the containment check lets `%2e%2e%2f` walk out of `public/` unnoticed — and
 * where the validator would merely have failed to find a file, this command
 * **writes**: a re-encoded original over whatever is there, and a derivative
 * beside it. So the same rule protects rather more here.
 */
function resolveSource(publicDir: string, src: string): Resolved {
  if (!src.startsWith("/")) {
    return { state: "refused", reason: { state: "relative-src" } };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    return { state: "refused", reason: { state: "invalid-escape" } };
  }

  const segments = decoded.split("/").filter((segment) => segment !== "");

  if (segments.some((segment) => segment === ".." || segment === ".")) {
    return { state: "refused", reason: { state: "escaping-src" } };
  }

  /**
   * A name this command writes itself. Refused *before* the file is opened,
   * because the damage is not in reading it: indexing `tokyo-480.jpg` would
   * compute a placeholder from the author's own photograph and then, on the next
   * run of the neighbouring `tokyo.jpg`, overwrite it with a 480 px derivative.
   * The schema refuses it too — the schema stops the page, this stops the loss.
   */
  if (isDerivativeName(decoded)) {
    return { state: "refused", reason: { state: "reserved-name" } };
  }

  return { state: "resolved", absolutePath: path.join(publicDir, ...segments) };
}

/* ------------------------------------------------------------ one photo's work -- */

/** What a rewrite of the original cost, for the warning that names it. */
type Resizing = {
  readonly before: ImageFacts;
  /** The edge ladder ran out before the byte limit was met — a PNG, in practice. */
  readonly stillOverBytes: boolean;
};

type PhotoWork =
  | {
      readonly state: "measured";
      readonly facts: ImageFacts;
      /** Absent when the file was already inside both thresholds. */
      readonly resized?: Resizing;
      readonly blurDataUrl: string;
      readonly derivativesWritten: readonly number[];
      readonly derivativeBytes: number;
    }
  | { readonly state: "refused"; readonly reason: PhotoFailure };

/**
 * Whether a derivative on disk is already the file the ladder asks for.
 *
 * Compared on **dimensions** and not on existence alone: an original recropped
 * from 3:2 to 1:1 keeps the same rung widths, so an existence check would leave
 * three AVIFs of the previous photograph in place and the page would serve them.
 * The height is compared with a one-pixel tolerance, because it is a rounded
 * quotient and `sharp` and this arithmetic may round a half differently.
 */
async function derivativeIsCurrent(
  absolutePath: string,
  width: number,
  facts: ImageFacts
): Promise<boolean> {
  const probe = await probeImage(absolutePath);
  if (probe.state !== "read") {
    return false;
  }
  const expectedHeight = Math.round((width * facts.height) / facts.width);

  return probe.facts.width === width && Math.abs(probe.facts.height - expectedHeight) <= 1;
}

async function workOnPhoto(
  photo: PhotoRef,
  publicDir: string,
  emit: (event: IndexPhotosEvent) => void
): Promise<PhotoWork> {
  if (photo.src === "") {
    return { state: "refused", reason: { state: "no-src" } };
  }

  const resolved = resolveSource(publicDir, photo.src);
  if (resolved.state === "refused") {
    return resolved;
  }
  const { absolutePath } = resolved;

  emit({ kind: "scanning", photo });

  const probe = await probeImage(absolutePath);
  if (probe.state === "unreadable") {
    /**
     * A missing file and a file that is not an image are told apart, because the
     * repairs are opposite: one is "drop the photograph here", the other is "this
     * is not a photograph". `probeImage` cannot make the distinction — `sharp`
     * reports both as an input error — so the question is asked of the filesystem.
     */
    const missing = !fileExists(absolutePath);

    return {
      state: "refused",
      reason: missing
        ? { state: "missing-file", expected: absolutePath }
        : { state: "unreadable-image", reason: probe.reason },
    };
  }

  let facts = probe.facts;
  let resized: Resizing | undefined;

  if (isOversized(facts)) {
    const shrunk = await shrinkImage(absolutePath);

    if (shrunk.state === "unreadable" || shrunk.state === "failed") {
      return { state: "refused", reason: { state: "resize-failed", reason: shrunk.reason } };
    }
    if (shrunk.state === "shrunk") {
      facts = shrunk.facts;
      resized = { before: shrunk.before, stillOverBytes: shrunk.stillOverBytes };
      emit({
        kind: "resized",
        photo,
        before: shrunk.before,
        facts: shrunk.facts,
        stillOverBytes: shrunk.stillOverBytes,
      });
    }
  }

  const placeholder = await placeholderFor(absolutePath);
  if (placeholder.state === "failed") {
    return {
      state: "refused",
      reason: { state: "placeholder-failed", reason: placeholder.reason },
    };
  }

  const written: number[] = [];
  let derivativeBytes = 0;

  for (const derivative of derivativeSources({ src: photo.src, width: facts.width })) {
    const target = path.join(publicDir, ...derivative.src.split("/").filter(Boolean));

    if (await derivativeIsCurrent(target, derivative.width, facts)) {
      continue;
    }

    // The original's own folder always exists — its file is in it — but a `src`
    // may nest deeper than the file that was found, so the directory is ensured
    // rather than assumed.
    mkdirSync(path.dirname(target), { recursive: true });

    const result = await writeDerivative(absolutePath, target, derivative.width);
    if (result.state === "failed") {
      return {
        state: "refused",
        reason: {
          state: "derivative-failed",
          width: derivative.width,
          reason: result.reason,
        },
      };
    }
    written.push(derivative.width);
    derivativeBytes += result.bytes;
  }

  if (written.length > 0) {
    emit({ kind: "derived", photo, widths: written, bytes: derivativeBytes });
  }

  return {
    state: "measured",
    facts,
    ...(resized === undefined ? {} : { resized }),
    blurDataUrl: placeholder.dataUrl,
    derivativesWritten: written,
    derivativeBytes,
  };
}

/**
 * Whether a path is a file, asked of the filesystem rather than inferred.
 *
 * It exists so that {@link workOnPhoto} can tell a missing photograph from a file
 * that is not a photograph: `sharp` reports both as an input error, and the two
 * repairs are opposite — "drop the image here" against "this is not an image".
 */
function fileExists(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------- the writable subset -- */

/** One photo dropped from the write, with the refusal that names *it*. */
type Refusal = { readonly photoIndex: number; readonly reason: string };

type Subset =
  | {
      readonly state: "writable";
      readonly edits: readonly PhotoFieldsEdit[];
      readonly text: string;
      readonly refused: readonly Refusal[];
    }
  /** A refusal about the document itself: no subset of the edits would fare better. */
  | {
      readonly state: "unusable";
      readonly reason: string;
      readonly blocked: readonly PhotoFieldsEdit[];
      readonly refused: readonly Refusal[];
    };

/**
 * The largest subset of `edits` that can actually be written, and the photos
 * dropped on the way.
 *
 * `writePhotoFields` is all-or-nothing by design — it computes every splice before
 * applying any of them — and taking its refusal as a verdict on the whole run is
 * the bug `geocode` measured and fixed: one photo written in a shape the editor
 * will not guess at threw away every measurement the run had made, and gave
 * *every* photo a failure line quoting that one photo's problem.
 *
 * The loop terminates because every iteration either returns or drops one edit; a
 * refusal naming an edit that is not in the set is treated as a document-level one
 * rather than retried forever.
 */
function writableSubset(source: string, edits: readonly PhotoFieldsEdit[]): Subset {
  const refused: Refusal[] = [];
  let remaining: readonly PhotoFieldsEdit[] = edits;

  for (;;) {
    const result = writePhotoFields(source, remaining);

    if (result.state === "edited") {
      return { state: "writable", edits: remaining, text: result.text, refused };
    }

    const photoIndex = result.entryIndex;
    if (photoIndex === undefined) {
      return { state: "unusable", reason: result.reason, blocked: remaining, refused };
    }

    const shorter = remaining.filter((edit) => edit.photoIndex !== photoIndex);
    if (shorter.length === remaining.length) {
      return { state: "unusable", reason: result.reason, blocked: remaining, refused };
    }

    refused.push({ photoIndex, reason: result.reason });
    remaining = shorter;
  }
}

/* -------------------------------------------------------------------- the run -- */

export async function indexTripPhotos(request: IndexPhotosRequest): Promise<IndexPhotosOutcome> {
  const emit = request.onEvent ?? (() => undefined);
  const collection = readTripCollection(request.contentDir);
  const contentDir = displayPath(request.repoRoot, request.contentDir);

  if (collection.state === "missing-directory") {
    return { state: "content-dir-missing", contentDir };
  }
  if (collection.state === "unreadable-directory") {
    return { state: "content-dir-unreadable", contentDir, reason: collection.reason };
  }

  const selection = selectTrip(collection.files, request.slug);
  if (selection.state === "not-found") {
    return {
      state: "trip-not-found",
      slug: request.slug,
      contentDir,
      available: selection.available,
    };
  }

  const trip = selection.trip;
  const file = displayPath(request.repoRoot, trip.absolutePath);

  if (trip.state === "absent" || trip.state === "broken-link") {
    return {
      state: "trip-unreadable",
      file,
      reason: "le fichier du voyage est introuvable",
      ...(trip.state === "absent" && trip.similarName !== undefined
        ? { similarName: trip.similarName }
        : {}),
    };
  }
  if (trip.state === "unreadable") {
    return { state: "trip-unreadable", file, reason: trip.reason };
  }
  if (trip.state === "malformed") {
    return {
      state: "trip-malformed",
      file,
      reason: trip.problems[0]?.message ?? "le fichier YAML ne se relit pas",
    };
  }

  return indexParsedTrip(trip, file, request, emit);
}

async function indexParsedTrip(
  trip: ParsedTrip,
  file: string,
  request: IndexPhotosRequest,
  emit: (event: IndexPhotosEvent) => void
): Promise<IndexPhotosOutcome> {
  const photos = valueAt(trip.value, ["photos"]);
  if (!Array.isArray(photos) || photos.length === 0) {
    return { state: "no-photos", file };
  }

  const edits: PhotoFieldsEdit[] = [];
  let failed = 0;
  let resizedCount = 0;
  let derivativeCount = 0;

  /**
   * Strictly sequential, one photo at a time.
   *
   * `sharp` releases the event loop while libvips works, so a `Promise.all` over
   * the photos would genuinely run in parallel — and it is still the wrong shape
   * here. Two reasons, and the first is the one that decides it: the transcript is
   * a conversation, and interleaved lines from four photos at once are unreadable
   * in the order they happened, which is the same argument `geocode` makes for its
   * own sequential loop. The second is that libvips already uses a thread pool per
   * operation, so the wall-clock gain on a handful of photographs is small.
   *
   * This line used to claim "0.73 s per photograph, measured on four realistic
   * ones at three rungs each", and that figure contradicted itself: the same
   * ticket reported 1.7 s for the four, and 0.73 x 4 is 2.9. TIW-33 re-measured
   * and got 1.45 s total on three runs, about 0.31 s of conversion per photograph
   * once startup is taken out; two attempts to reproduce it from the main session
   * used a faulty harness and are not offered as a third figure.
   *
   * So no per-photograph number is quoted here any more. The argument above does
   * not need one — it needs the order of magnitude, which is "under two seconds
   * for four photographs", and that much every run agrees on. A precise figure
   * nobody can reproduce is worse than an honest bound: it invites the reader to
   * trust an arithmetic that never held.
   */
  for (const [index] of photos.entries()) {
    const photo: PhotoRef = {
      index,
      src: stringAt(trip.value, ["photos", index, "src"]) ?? "",
    };

    const work = await workOnPhoto(photo, request.publicDir, emit);

    if (work.state === "refused") {
      failed += 1;
      emit({ kind: "failed", photo, reason: work.reason });
      continue;
    }

    if (work.resized !== undefined) {
      resizedCount += 1;
    }
    derivativeCount += work.derivativesWritten.length;

    /**
     * Written only when it differs from what is declared. This is what makes a
     * second run a no-op instead of a diff — and it is compared field by field
     * rather than as a whole, so a photo whose dimensions are right and whose
     * placeholder is missing still gets one edit.
     */
    const declared = {
      width: valueAt(trip.value, ["photos", index, "width"]),
      height: valueAt(trip.value, ["photos", index, "height"]),
      blurDataUrl: valueAt(trip.value, ["photos", index, "blurDataUrl"]),
    };
    const current =
      declared.width === work.facts.width &&
      declared.height === work.facts.height &&
      declared.blurDataUrl === work.blurDataUrl;

    if (current) {
      emit({ kind: "unchanged", photo });
      continue;
    }

    emit({
      kind: "indexed",
      photo,
      facts: work.facts,
      placeholderLength: work.blurDataUrl.length,
    });
    edits.push({
      photoIndex: index,
      width: work.facts.width,
      height: work.facts.height,
      blurDataUrl: work.blurDataUrl,
    });
  }

  const summary = { file, photoCount: photos.length } as const;

  /**
   * Nothing to write. The file keeps its bytes *and* its timestamp, so a re-run is
   * free and `git status` stays clean — including on a run where every photo
   * failed, which must not leave the trip looking edited.
   */
  if (edits.length === 0) {
    return {
      state: "done",
      ...summary,
      indexed: 0,
      resized: resizedCount,
      derivatives: derivativeCount,
      failed,
      written: false,
    };
  }

  const subset = writableSubset(trip.source, edits);
  const refusals: readonly Refusal[] =
    subset.state === "unusable"
      ? [
          ...subset.refused,
          ...subset.blocked.map((edit) => ({ photoIndex: edit.photoIndex, reason: subset.reason })),
        ]
      : subset.refused;

  /**
   * One line per refused photo, carrying **its own** reason — the defect `geocode`
   * documents, where the same sentence was printed under every entry.
   */
  for (const { photoIndex, reason } of refusals) {
    emit({
      kind: "failed",
      photo: {
        index: photoIndex,
        src: stringAt(trip.value, ["photos", photoIndex, "src"]) ?? "",
      },
      reason: { state: "unsupported-yaml", reason },
    });
  }

  if (subset.state !== "writable" || subset.edits.length === 0) {
    return {
      state: "done",
      ...summary,
      indexed: 0,
      resized: resizedCount,
      derivatives: derivativeCount,
      failed: failed + refusals.length,
      written: false,
    };
  }

  /**
   * `trip.source` is the text the splices were computed against, so it is both
   * what has to be on disk for the offsets to still mean anything and what tells
   * whether the author saved over it while the images were being encoded.
   */
  const indexed = subset.edits.length;
  const written = writeAtomically(trip.absolutePath, trip.source, subset.text, TEMPORARY_NAMING);

  if (written.state === "changed-underfoot") {
    return { state: "file-changed", file, indexed };
  }
  if (written.state === "not-utf8") {
    return { state: "file-not-utf8", file, indexed };
  }
  if (written.state === "failed") {
    return { state: "write-failed", file, reason: written.reason, indexed };
  }

  const outside = !isInsideDirectory(request.contentDir, written.target);

  return {
    state: "done",
    ...summary,
    indexed,
    resized: resizedCount,
    derivatives: derivativeCount,
    failed: failed + refusals.length,
    written: true,
    ...(outside ? { writtenTo: displayPath(request.repoRoot, written.target) } : {}),
  };
}

/** Re-exported so a report can name the thresholds without reaching the domain. */
export { MAX_PHOTO_BYTES, MAX_PHOTO_EDGE };
