/**
 * How much the repository weighs in images, and the threshold past which that
 * stops being a detail.
 *
 * **Why this is a guard and not a note in a ticket.** The images of this project
 * are versioned like its code, which is the whole content model — and it is the
 * one budget that grows without anyone deciding to spend it. Every clone pays it,
 * every CI job pays it, and every build on the platform pays it *again*, because a
 * build starts from a clone. It also grows in a way git cannot give back: a
 * photograph deleted today is still in the history tomorrow.
 *
 * So it breaks exactly the way the two build budgets break — silently, one commit
 * at a time, until something is slow and nobody can say when it started. That is
 * the family of problem this repository answers with an executable guard rather
 * than with a convention.
 *
 * The arithmetic lives here, as a pure function, so it can be tested without a
 * repository; `scripts/photo-weight.ts` only asks git which files are tracked.
 * Asking **git** rather than walking the disk is the load-bearing part: what costs
 * a clone is what is *committed*, not what happens to be in the working tree — and
 * the derivatives an author is about to add are already there before they are
 * staged.
 */

/**
 * 150 MB, the number the ticket names — and the arithmetic behind it, so that
 * moving it is a decision rather than an edit.
 *
 * 200 photographs at 400 KB are 80 MB of originals. Measured on this pipeline's
 * own output, three AVIF rungs cost between 22 and 150 KB per photograph
 * depending on how compressible it is — call it 80 KB, so ~16 MB across 200. That
 * is ~96 MB for a collection of 200 photographs, which leaves the headroom this
 * threshold is meant to leave: enough that a real trip never trips it, tight
 * enough that a folder of unresized originals does.
 *
 * Past it, the answer is not "compress harder": it is the one the ticket names —
 * the images move to external storage and `src` becomes an absolute URL, which is
 * a change of *content* and not of structure. Nothing in the schema or the pages
 * has to change for that, which is why the threshold can afford to be a hard
 * failure rather than a warning nobody reads.
 */
export const PHOTO_WEIGHT_LIMIT_BYTES = 150_000_000;

/** How many of the heaviest files a report names before it stops. */
const LISTED_FILES = 10;

export type WeighedFile = {
  /** Repository-relative and POSIX-separated, as git reports it. */
  readonly path: string;
  readonly bytes: number;
};

export type WeightSummary = {
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly overLimit: boolean;
  /** The heaviest files, descending — what an author can actually act on. */
  readonly heaviest: readonly WeighedFile[];
};

export function weighFiles(files: readonly WeighedFile[]): WeightSummary {
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);

  return {
    totalBytes,
    fileCount: files.length,
    // `>` and not `>=`: the limit is a limit, and a guard that fires *at* it
    // accuses the commit after the one that crossed it.
    overLimit: totalBytes > PHOTO_WEIGHT_LIMIT_BYTES,
    heaviest: [...files].sort((left, right) => right.bytes - left.bytes).slice(0, LISTED_FILES),
  };
}

/**
 * `12,3 Mo`, or `84 Ko` under a megabyte — the same spelling and the same switch
 * as `index-photos-report.ts`, for the same measured reason.
 *
 * The kilobyte branch is not cosmetic here either: the roots this guard weighs
 * carry exactly one image today (`public/opengraph-default.png`, TIW-23) and one
 * decimal of a megabyte printed it as « 0,0 Mo » — a line whose only job is to say
 * what the repository weighs, saying nothing.
 *
 * "The roots this guard weighs", not "the repository": this comment said the latter
 * and it was false. `git ls-files` tracks 18 images, 78 351 bytes, and seventeen of
 * them sit outside `IMAGE_ROOTS` — fixtures and brand icons, excluded on purpose. The megabyte stays for the total once
 * real photographs land, which is what the 150 Mo threshold is compared against.
 */
function formatWeight(bytes: number): string {
  return bytes < 1_000_000
    ? `${Math.round(bytes / 1000)} Ko`
    : `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} Mo`;
}

/**
 * What the check says, always — including when it passes.
 *
 * A guard that only speaks when it fails is a guard whose number nobody knows, and
 * the number is what tells an author he has 50 MB of room left rather than 5. Same
 * reasoning as `test:build` printing its measurements beside its budgets.
 */
export function formatWeightReport(summary: WeightSummary): readonly string[] {
  const limit = formatWeight(PHOTO_WEIGHT_LIMIT_BYTES);

  if (summary.fileCount === 0) {
    return [
      `Aucune image de contenu suivie par git pour l'instant — rien à peser (seuil : ${limit}).`,
    ];
  }

  /**
   * « de contenu », et le mot fait tout le travail.
   *
   * Sans lui la ligne se lisait comme un décompte du dépôt entier, et elle était
   * fausse : mesuré le 2026-09-02, `git ls-files` suit **18** images pour 78 351
   * octets, dont une seule sous les racines que ce garde pèse. Les dix-sept autres
   * sont les fixtures de `tests/fixtures/content/**` et les deux icônes de marque —
   * **66 % des octets d'image du dépôt sont hors de ce budget**, délibérément (voir
   * `IMAGE_ROOTS` dans `scripts/photo-weight.ts` : ce budget vise le contenu, qui
   * grossit, et non le code, qui ne grossit pas).
   *
   * Un garde qui annonce « 1 image suivie par git » dans un dépôt qui en suit
   * dix-huit apprend au lecteur à ne pas le croire.
   */
  const headline = `${summary.fileCount} image${summary.fileCount > 1 ? "s" : ""} de contenu suivie${summary.fileCount > 1 ? "s" : ""} par git, ${formatWeight(summary.totalBytes)} sur un seuil de ${limit}.`;

  if (!summary.overLimit) {
    return [headline];
  }

  return [
    headline,
    "Chaque clone et chaque build paient ce poids, et l'historique git ne le rend pas : une photo supprimée aujourd'hui y reste demain.",
    "Les plus lourdes :",
    ...summary.heaviest.map((file) => `  ${file.path} — ${formatWeight(file.bytes)}`),
    "Au-delà de ce seuil, les images passent sur un stockage externe : le champ « src » devient une URL absolue.",
    "C'est un changement de contenu et non de structure — ni le schéma ni les pages n'ont à bouger",
  ];
}
