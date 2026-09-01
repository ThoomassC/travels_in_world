import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { formatWeightReport, weighFiles } from "@/content/photo-weight";
import type { WeighedFile } from "@/content/photo-weight";
import { isArgumentError, parseArguments } from "./arguments";

/**
 * `npm run check:photo-weight` — the threshold the ticket asks CI to hold.
 *
 * A thin transport layer, like the other three commands: it asks git what is
 * tracked, stats it, and hands the numbers to `src/content/photo-weight.ts`, which
 * is where the arithmetic and every sentence live and where they are tested
 * without a process.
 *
 * **It asks git, not the disk.** What a clone and a build pay for is what is
 * *committed*; the working tree also holds whatever an author is in the middle of
 * doing, and a check that failed on files not yet staged would be a check nobody
 * could satisfy. `git ls-files` also gets `.gitignore` for free, which is what
 * keeps `node_modules` and `.next` out of the count without a second list of
 * exclusions to drift.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Where images live in this repository, and nothing else.
 *
 * Narrow on purpose: this budget is about *content* weight — the photographs an
 * author adds — and widening it to the whole repository would mix in the SVG
 * favicons and the world-atlas data, which are code and do not grow.
 */
const IMAGE_ROOTS = ["public", "content"] as const;

/**
 * Extensions that count. A closed list rather than "anything binary", so that
 * adding a new format is a decision — and so a `.yaml` or a `.md` under `content/`
 * never lands in a photo budget.
 */
const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".heic",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

const USAGE = `Usage : npm run check:photo-weight

Pèse les images suivies par git sous ${IMAGE_ROOTS.join("/ et ")}/ et refuse si le
total dépasse le seuil. Chaque clone et chaque build de la plateforme paient ce
poids, et l'historique git ne le rend pas.

Aucune option : le seuil est une décision de projet, écrit dans
src/content/photo-weight.ts avec l'arithmétique qui le justifie.

Codes de sortie
  0   le total est sous le seuil
  1   le total dépasse le seuil, ou git n'a pas pu être interrogé
  2   erreur d'usage`;

function trackedImages(): readonly WeighedFile[] | { readonly error: string } {
  /**
   * `-z` and a NUL split, not lines: a path may contain a newline, and git quotes
   * such a path when it prints lines — so a line-based read would report a name
   * that does not exist on disk and then fail to stat it.
   */
  const listed = spawnSync("git", ["ls-files", "-z", "--", ...IMAGE_ROOTS], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (listed.status !== 0) {
    return {
      error: `git ls-files a échoué (${listed.status ?? "signal"}) : ${listed.stderr.trim()}`,
    };
  }

  const files: WeighedFile[] = [];

  for (const relative of listed.stdout.split("\0")) {
    if (relative === "" || !IMAGE_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      continue;
    }
    try {
      files.push({ path: relative, bytes: statSync(path.join(REPO_ROOT, relative)).size });
    } catch {
      /**
       * Tracked and not on disk: the ordinary case is a checkout in progress or a
       * sparse one. Skipped rather than failed — this check exists to refuse
       * weight, not to police the working tree, and a missing file weighs nothing.
       */
      continue;
    }
  }

  return files;
}

function main(argv: readonly string[]): number {
  const parsed = parseArguments(argv, { valued: [] });

  if (isArgumentError(parsed)) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}\n`);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (parsed.positionals.length > 0) {
    process.stderr.write(`Cette commande ne prend aucun argument.\n\n${USAGE}\n`);
    return 2;
  }

  const listed = trackedImages();
  if ("error" in listed) {
    process.stderr.write(`${listed.error}\n`);
    return 1;
  }

  const summary = weighFiles(listed);
  process.stdout.write(`${formatWeightReport(summary).join("\n")}\n`);

  return summary.overLimit ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
