import { Buffer } from "node:buffer";
import {
  chmodSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Overwriting a `trip.yaml` an author wrote, without ever leaving it damaged.
 *
 * **Why this is its own module.** It was written for `npm run geocode` (TIW-10)
 * and every one of its branches is a bug that actually shipped there — the
 * symlink, the mode, the save-in-the-meantime, and the not-UTF-8 clobber that
 * silently replaced a `title: Café` with a replacement character. `npm run
 * index-photos` writes the same file for the same reason, and a second copy of
 * sixty lines of this would be a second copy of four bugs waiting to be
 * re-introduced one at a time.
 *
 * The only thing parameterised is the temporary file's marker, so each command's
 * debris is recognisable and each can assert that `.gitignore` covers **its own**
 * pattern rather than a shared one that could stop matching either.
 */

export type AtomicWriteResult =
  /** `target` is the real file the bytes went to, symlinks resolved. */
  | { readonly state: "written"; readonly target: string }
  /** The bytes on disk are no longer the ones the edit was computed from. */
  | { readonly state: "changed-underfoot" }
  /**
   * The bytes on disk differ from `expected` and yet decode to it: `expected` is
   * a lossy decoding of this very file, not a copy of it.
   *
   * Measured on a `trip.yaml` saved in latin-1 (`title: Café`, byte 0xE9):
   * `readFileSync(…, "utf8")` replaced the undecodable byte with U+FFFD, so both
   * sides of a *decoded* comparison carried the same U+FFFD and the guard could
   * not, structurally, see anything wrong. The rename went through — exit 0,
   * « fichier réécrit » — and `validate:content` stayed green, because U+FFFD is
   * a perfectly valid string. The title was gone without a word.
   */
  | { readonly state: "not-utf8" }
  | { readonly state: "failed"; readonly reason: string };

/** The two fixed parts of a temporary name; the variable part is the pid. */
export type TemporaryNaming = {
  readonly marker: string;
  readonly suffix: string;
};

/**
 * The shape of the debris an interrupted write can leave behind, as a gitignore
 * pattern.
 *
 * Built from the same two constants as the name itself, so the entry in
 * `.gitignore` cannot drift away from what is really written — and each command's
 * suite asserts the repository carries its own entry, by asking **git** rather
 * than by grepping the file.
 *
 * A run killed between `writeFileSync` and `renameSync` leaves one of these next
 * to the trip. It is dead weight, not damage — nothing reads it, and the next run
 * overwrites it — but an untracked file appearing inside `content/trips/` after a
 * Ctrl+C is exactly the debris that makes an author distrust the command that put
 * it there.
 */
export function temporaryFileGlob(naming: TemporaryNaming): string {
  return `*${naming.marker}*${naming.suffix}`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Best-effort cleanup: a failure to tidy up must not mask the real failure. */
function discard(temporary: string): void {
  try {
    rmSync(temporary, { force: true });
  } catch {
    // Nothing useful to say: the caller is already returning a failure, and a
    // stray temporary is covered by `temporaryFileGlob`.
  }
}

/**
 * Written to a sibling file and renamed over the target.
 *
 * `rename` within a directory is atomic on every filesystem this runs on, so an
 * interrupted run leaves either the old file or the new one — never a truncated
 * trip. A plain `writeFileSync` is one line shorter and can lose the file, which
 * is not a trade a content command gets to make.
 *
 * A naive `rename` over the target loses three things the author would notice, so
 * all three are handled here rather than patched later:
 *
 * - **the symlink.** `trip.yaml` may be a link into a notes folder or a synced
 *   drive; renaming over the *link* replaces it with a regular file and silently
 *   detaches the trip from the file being edited. So the link is resolved first
 *   and the swap happens around the real file.
 * - **the mode.** A fresh temporary is created at `0o666 & ~umask`, so a trip
 *   kept at `0o600` would come back world-readable. The mode is copied over
 *   before the rename, not after: after is a window where the file is readable.
 * - **a save made in the meantime.** `expected` is the text the edit offsets were
 *   computed against, and it was read *before* the work began — a prompt, or a
 *   few seconds of image encoding, sits in between. Comparing the bytes here, one
 *   syscall before the rename, is the only place the comparison means anything: a
 *   fingerprint taken at read time answers a question about the past.
 *
 * The window between that comparison and the rename is a few microseconds of
 * kernel work with no I/O in it. Closing it entirely needs an advisory lock the
 * author's editor would have to take too, which is not on offer; narrowing it to
 * this is.
 *
 * That last comparison is on **bytes**, and that is not a detail — see
 * `not-utf8` above. Comparing buffers separates the two questions the guard has
 * to answer: *did the file change* (the decoded texts differ) and *was our copy
 * of it lossy* (the decoded texts match but the bytes do not).
 */
export function writeAtomically(
  absolutePath: string,
  expected: string,
  text: string,
  naming: TemporaryNaming
): AtomicWriteResult {
  let target: string;
  try {
    target = realpathSync(absolutePath);
  } catch (cause) {
    return { state: "failed", reason: errorMessage(cause) };
  }

  // Sibling of the *real* file, because `rename` is only atomic within one
  // filesystem and a symlink can cross one.
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}${naming.marker}${process.pid}${naming.suffix}`
  );

  try {
    writeFileSync(temporary, text, "utf8");
    chmodSync(temporary, statSync(target).mode & 0o7777);

    const raw = readFileSync(target);

    if (!raw.equals(Buffer.from(expected, "utf8"))) {
      discard(temporary);

      return raw.toString("utf8") === expected
        ? { state: "not-utf8" }
        : { state: "changed-underfoot" };
    }

    renameSync(temporary, target);

    return { state: "written", target };
  } catch (cause) {
    discard(temporary);

    return { state: "failed", reason: errorMessage(cause) };
  }
}

/**
 * Whether `file` is under `directory`, both symlinks resolved.
 *
 * `directory` is resolved too because it very often is a link itself — on macOS
 * `os.tmpdir()` is `/var/folders/…`, a symlink to `/private/var/folders/…`, so
 * comparing a resolved file against an unresolved root answers "outside" for
 * every trip in the test suite.
 */
export function isInsideDirectory(directory: string, file: string): boolean {
  let root = directory;
  try {
    root = realpathSync(directory);
  } catch {
    // Unresolvable: compare against the path as given rather than give up. The
    // answer only decides whether one extra line is printed.
  }
  const relative = path.relative(root, file);

  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
