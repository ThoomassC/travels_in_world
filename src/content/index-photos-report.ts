import { DERIVATIVE_LADDER, MAX_PHOTO_BYTES, MAX_PHOTO_EDGE } from "@/domain/photo";
import { bounded, escapeControls, quoted, runCommand } from "./finding";
import type { ImageFacts } from "./photo-files";
import type { IndexPhotosEvent, IndexPhotosOutcome, PhotoFailure, PhotoRef } from "./index-photos";

/**
 * What `npm run index-photos` says, in French, as a pure function of what
 * happened.
 *
 * Same division of labour as `geocode-report.ts` and, before it, `report.ts`: the
 * module that decides prints nothing and the module that prints decides nothing.
 * So every sentence below is testable without a process, and the script is left
 * with argument parsing and a stream.
 *
 * Three rules inherited from TIW-9 and kept, all three about a *terminal*:
 *
 * - **no ANSI escape comes from here.** `validate:content` earns its colours by
 *   checking `isTTY` and `NO_COLOR`; this command's output is the transcript of a
 *   run, so it stays plain and no code path can leak an escape into a captured
 *   log.
 * - **every value that came from outside is bounded and neutralised.** Here that
 *   means the YAML file above all: a photo's `src` is a string an author edits,
 *   and a folder name carrying an ESC is enough to erase the refusal being shown.
 *   A sentence *this repository* wrote is not such a value — see {@link firstHand}.
 * - **one line per line.** A failure buried in a paragraph is a failure nobody
 *   greps, and the suite asserts no line here contains a newline.
 */

/**
 * A sentence written here or by another module of this repository: neutralised,
 * and deliberately **not** bounded.
 *
 * The same distinction `geocode-report.ts` had to make, for the same measured
 * reason: `bounded()` cuts at 80 code points, which lands in the middle of the
 * wordings `yaml-edit.ts` produces — so the author was told something was wrong
 * and never told what to do about it. Truncating a value drops noise; truncating a
 * sentence drops its verb.
 *
 * The escaping stays, and is what makes this safe: a first-hand sentence can quote
 * a third-party fragment — a YAML key, a slice of the file — so those bytes still
 * reach this line. They are neutralised at the source *and* here, because "the
 * caller took care of it" is how an injection comes back.
 */
function firstHand(sentence: string): string {
  return escapeControls(sentence);
}

/**
 * A path, neutralised but **not** truncated: it has to stay pasteable into an
 * editor, which is the only thing it is printed for. Same body as
 * {@link firstHand} and a different reason, which is why the two are not one
 * function.
 */
function displayed(filePath: string): string {
  return escapeControls(filePath);
}

/**
 * `1,9 Mo`, or `36 Ko` under a megabyte — one decimal, a comma, and a plain space
 * before the unit.
 *
 * Not `Intl.NumberFormat`, for the reason `geocode-report.ts` gives about
 * populations: it groups and spaces with U+202F on current ICU, and an unusual
 * space character is a trap in output that gets grepped.
 *
 * **The kilobyte branch is not decoration.** Measured on the first real run: three
 * AVIF rungs of a 2400 px photograph came to 32 KB, which one decimal of a
 * megabyte prints as « 0,0 Mo » — a number that says nothing at all, on the very
 * line whose job is to say what the derivatives cost. The megabyte stays for
 * originals, where the 1,5 Mo threshold is what the reader is comparing against.
 */
function formatBytes(bytes: number): string {
  return bytes < 1_000_000
    ? `${Math.round(bytes / 1000)} Ko`
    : `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} Mo`;
}

/** `1600 × 1067` — the multiplication sign, not an `x`. */
function formatDimensions(facts: ImageFacts): string {
  return `${facts.width} × ${facts.height}`;
}

/**
 * The slug as it may be printed: bounded to 40 code points and neutralised.
 *
 * It arrives from `argv`, so it is a value from outside like any other — and it
 * ends up **inside a printed command**, which is what makes the bound matter as
 * much as the escaping: `quoted()` truncates the whole command at 80 code points,
 * so a 400-character slug would produce a line that looks like something to paste
 * into a terminal and is not. Same treatment, same number, as `displaySlug` in
 * `validate.ts`, which exists for exactly this.
 *
 * Found by the suite's own guard: the `no-photos` branch interpolated the slug
 * into `public/photos/<slug>/` outside any `quoted()`, and a slug carrying an ESC
 * cleared the terminal. Every other interpolation goes through `quoted()` or
 * `runCommand()`, which bound and neutralise on their own — this is the one that
 * did not, and one is enough.
 */
function safeSlug(slug: string): string {
  const points = [...slug];

  return escapeControls(points.length <= 40 ? slug : `${points.slice(0, 40).join("")}…`);
}

/** How a photo is named at the head of a line: `photos[0] « /photos/… »`. */
function describePhoto(photo: PhotoRef): string {
  return `photos[${photo.index}] ${photo.src === "" ? "sans source" : quoted(photo.src)}`;
}

function plural(count: number, singular: string, many: string): string {
  return `${count} ${count > 1 ? many : singular}`;
}

/**
 * Why a photo was left alone, one sentence each, every one ending in something to
 * do.
 *
 * The `switch` is exhaustive over `PhotoFailure` and has no `default`, which is
 * what makes a new failure state a **compile** error here rather than a photo that
 * fails in silence.
 */
function describeFailure(reason: PhotoFailure): string {
  switch (reason.state) {
    case "no-src":
      return `cette photo n'a pas de source → écris le chemin depuis la racine du site, ${quoted("/photos/<voyage>/<image>.jpg")}`;
    case "relative-src":
      return `la source n'est pas un chemin absolu → écris-la depuis la racine du site, ${quoted("/photos/<voyage>/<image>.jpg")}`;
    case "escaping-src":
      return `la source sort du dossier public → retire les ${quoted("..")} du chemin ; la commande écrit des fichiers, elle ne le fera pas hors de public/`;
    case "invalid-escape":
      return "la source contient un échappement d'URL invalide → écris le chemin tel qu'il est sur le disque";
    /**
     * The one refusal that must **not** name the command. Running `index-photos`
     * on a trip declaring `tokyo-480.jpg` is precisely what would overwrite that
     * file with the 480 px derivative of the neighbouring `tokyo.jpg`, so the way
     * out is a rename by hand — and pointing at the command would be pointing at
     * the damage.
     */
    case "reserved-name":
      return `ce nom est un de ceux que la commande écrit elle-même (un tiret suivi de ${DERIVATIVE_LADDER.join(", ")}) → renomme le fichier sur le disque et dans photos[], sinon l'indexation l'écraserait`;
    case "missing-file":
      return `le fichier est introuvable → dépose l'image en ${displayed(reason.expected)}, ou retire la déclaration de photos[]`;
    case "unreadable-image":
      return `ce fichier n'est pas une image que la commande sait lire (${bounded(reason.reason)}) → vérifie qu'il s'agit bien d'un JPEG, d'un PNG, d'un WebP ou d'un AVIF`;
    case "resize-failed":
      return `l'image dépasse ${MAX_PHOTO_EDGE} px ou ${formatBytes(MAX_PHOTO_BYTES)} et n'a pas pu être redimensionnée (${bounded(reason.reason)}) → réduis-la à la main, puis relance`;
    case "derivative-failed":
      return `la version ${reason.width} px n'a pas pu être écrite (${bounded(reason.reason)}) → vérifie les droits du dossier, puis relance`;
    case "placeholder-failed":
      return `la vignette de préchargement n'a pas pu être produite (${bounded(reason.reason)}) → l'image est peut-être tronquée, ouvre-la pour vérifier`;
    /**
     * `firstHand`: this sentence comes from `yaml-edit.ts`, already carries its own
     * arrow and its own advice, and is the one string here that `bounded()` would
     * decapitate.
     */
    case "unsupported-yaml":
      return firstHand(reason.reason);
  }
}

/**
 * The running commentary. One line per event, so the transcript of a run reads in
 * the order things happened and a failure is never buried.
 */
export function formatEvent(event: IndexPhotosEvent): readonly string[] {
  switch (event.kind) {
    case "scanning":
      return [`${describePhoto(event.photo)} : mesure…`];
    /**
     * The acceptance criterion, and the reason it says four numbers rather than
     * one: « un avertissement nomme le fichier » is the floor, but a line that
     * only names the file leaves the author unable to tell a 4032 px photograph
     * brought down to 3000 from one quietly halved. So it says what the file
     * *was*, what it *is*, and — first — that it was **rewritten on disk**, which
     * is the part he would otherwise discover from a dirty `git status`.
     */
    case "resized": {
      const head = `${describePhoto(event.photo)} : image réécrite sur le disque, ${formatDimensions(event.before)} (${formatBytes(event.before.bytes)}) → ${formatDimensions(event.facts)} (${formatBytes(event.facts.bytes)})`;

      return [
        event.stillOverBytes
          ? `${head} — toujours au-dessus de ${formatBytes(MAX_PHOTO_BYTES)} : réduis-la à la main si son poids compte`
          : head,
      ];
    }
    case "derived":
      return [
        `${describePhoto(event.photo)} : ${plural(event.widths.length, "version écrite", "versions écrites")} en AVIF — ${event.widths.map((width) => `${width} px`).join(", ")}, ${formatBytes(event.bytes)} au total`,
      ];
    /**
     * The measurement, and the *measured* placeholder length rather than the cap.
     * The first version printed « vignette de préchargement de 512 caractères au
     * plus » — a constant, on the one line whose job is to report what was found.
     * The cap is stated where it belongs, in `content/README.md`.
     */
    case "indexed":
      return [
        `${describePhoto(event.photo)} → ${formatDimensions(event.facts)}, vignette de préchargement de ${event.placeholderLength} caractères`,
      ];
    case "unchanged":
      return [`${describePhoto(event.photo)} : déjà à jour, rien à écrire`];
    case "failed":
      return [`${describePhoto(event.photo)} : ${describeFailure(event.reason)}`];
  }
}

/**
 * How many trip names a "no such slug" summary spells out before it counts the
 * rest. Same number and same reason as `geocode-report.ts`: sixteen names on one
 * line is a wall rather than a list, and the ninth name has never been what tells
 * an author he misspelt his own slug.
 */
const LISTED_TRIPS = 8;

function listTrips(available: readonly string[]): string {
  const listed = available
    .slice(0, LISTED_TRIPS)
    .map((name) => quoted(name))
    .join(", ");
  const hidden = available.length - LISTED_TRIPS;

  return hidden > 0 ? `${listed} et ${plural(hidden, "autre", "autres")}` : listed;
}

/**
 * Where the bytes really went, and only when that is not where the author would
 * look: `trip.yaml` is a symlink whose target leaves the content directory.
 *
 * Following the link is deliberate — a trip kept in a notes folder is a legitimate
 * setup — but announcing the link's path while writing elsewhere is how a summary
 * becomes a lie the author has no way to catch.
 */
function describeTarget(
  outcome: Extract<IndexPhotosOutcome, { state: "done" }>
): readonly string[] {
  return outcome.writtenTo === undefined
    ? []
    : [
        `trip.yaml est un lien symbolique : les octets sont allés dans ${displayed(outcome.writtenTo)}, hors du dossier de contenu.`,
      ];
}

/**
 * What the derivatives cost, when any were written.
 *
 * Stated in the summary and not only per photo, because it is the number the
 * repository's weight budget is made of: `content/README.md` carries the
 * arithmetic — 200 photos of 400 Ko are 80 Mo of originals, three AVIF rungs add
 * ~27 Mo, and the CI alert sits at 150 Mo.
 */
function describeDerivatives(count: number): string {
  return count === 0
    ? "aucune nouvelle version à écrire"
    : `${plural(count, "version AVIF écrite", "versions AVIF écrites")}`;
}

function formatDone(
  outcome: Extract<IndexPhotosOutcome, { state: "done" }>,
  /** Already bounded and neutralised by {@link formatOutcome}. */
  slug: string
): readonly string[] {
  const file = displayed(outcome.file);

  /**
   * The idempotent run, and the sentence that has to make it recognisable at a
   * glance: an author reruns this command after every batch of photos, so "nothing
   * to do" must not read like a summary of work. Same shape as `geocode`'s
   * « toutes les villes ont déjà leurs coordonnées ».
   */
  if (!outcome.written && outcome.indexed === 0 && outcome.failed === 0) {
    return [
      `${file} — ${plural(outcome.photoCount, "photo est déjà à jour", "photos sont déjà à jour")}, rien à faire.`,
      // `runCommand()` builds « lance « … » » to be pasted after an arrow; here it
      // lands after a full stop, so the verb is capitalised at the call site.
      `Le fichier n'a pas été réécrit. ${runCommand("npm run validate:content", "Lance")} pour le vérifier`,
    ];
  }

  const counted = `${plural(outcome.indexed, "photo indexée", "photos indexées")} sur ${outcome.photoCount}`;
  const resized =
    outcome.resized === 0
      ? ""
      : `, ${plural(outcome.resized, "image redimensionnée", "images redimensionnées")}`;

  if (outcome.failed === 0) {
    return [
      `${file} — ${counted}${resized}, ${describeDerivatives(outcome.derivatives)}, fichier réécrit.`,
      ...describeTarget(outcome),
      `→ ${runCommand("npm run validate:content", "vérifie avec")}`,
    ];
  }

  if (!outcome.written) {
    return [
      `${file} — aucune photo indexée, ${plural(outcome.failed, "échec", "échecs")} ; le fichier est inchangé.`,
      ...(outcome.derivatives === 0
        ? []
        : [`${describeDerivatives(outcome.derivatives)} malgré tout : elles restent valables.`]),
      `Les lignes ci-dessus disent quoi corriger, puis ${runCommand(`npm run index-photos ${slug}`, "relance")}`,
    ];
  }

  /**
   * The partial run, and the one summary where "did my file move?" is a real
   * question: it did. Saying only that some photos failed let an author of
   * `geocode` believe his trip untouched until a dirty `git status` said otherwise,
   * so the rewrite is stated and the next line answers the fear that comes with
   * it — nothing measured was lost.
   */
  return [
    `${file} — ${counted}${resized}, ${describeDerivatives(outcome.derivatives)}, fichier réécrit ; ${plural(outcome.failed, "photo en échec", "photos en échec")}.`,
    ...describeTarget(outcome),
    `Ce qui a été mesuré est enregistré, rien n'a été perdu → ${runCommand(`npm run index-photos ${slug}`, "relance")}`,
  ];
}

/**
 * The closing lines, and the only place that says what the file now contains.
 *
 * Two rules hold across every branch, and the suite asserts both on all of them at
 * once: a summary that names the trip file says whether that file was touched, and
 * the **last** line is the thing to do — an imperative, with no full stop, so the
 * eye lands on it.
 */
export function formatOutcome(outcome: IndexPhotosOutcome, rawSlug: string): readonly string[] {
  const slug = safeSlug(rawSlug);

  switch (outcome.state) {
    case "content-dir-missing":
      return [
        `${displayed(outcome.contentDir)} — le répertoire de contenu est introuvable → crée-le, ou indique le bon avec ${quoted("--content <dossier>")}`,
      ];
    case "content-dir-unreadable":
      return [
        `${displayed(outcome.contentDir)} — le répertoire de contenu n'est pas lisible : ${bounded(outcome.reason)} → vérifie les droits du dossier`,
      ];
    case "trip-not-found":
      return outcome.available.length === 0
        ? [
            `Aucun voyage ${quoted(slug)} dans ${displayed(outcome.contentDir)}.`,
            `Aucun voyage n'est encore écrit → ${runCommand(`npm run new-trip ${slug}`)}`,
          ]
        : [
            `Aucun voyage ${quoted(slug)} dans ${displayed(outcome.contentDir)}.`,
            `Voyages présents : ${listTrips(outcome.available)}.`,
            `Vérifie l'orthographe, ou ${runCommand(`npm run new-trip ${slug}`, "crée-le avec")}`,
          ];
    case "trip-unreadable":
      return outcome.similarName === undefined
        ? [`${displayed(outcome.file)} — ${bounded(outcome.reason)} → rien n'a été touché`]
        : [
            `${displayed(outcome.file)} — ${bounded(outcome.reason)}, mais ${quoted(outcome.similarName)} est là : seule la casse diffère.`,
            `Renomme-le en ${quoted("trip.yaml")} plutôt que d'en écrire un second → rien n'a été touché`,
          ];
    case "trip-malformed":
      return [
        `${displayed(outcome.file)} — YAML invalide : ${bounded(outcome.reason)}`,
        `L'indexation ne réécrit pas un fichier qu'elle ne sait pas relire → ${runCommand("npm run validate:content")} pour la ligne fautive`,
      ];
    /**
     * Not a failure, and the wording has to make that unmistakable: `photos` is
     * optional in the content model and most first drafts have none, so this line
     * must not read like something went wrong. It is also the one place that says
     * where photos go, because an author who runs the command on a trip with none
     * is usually about to add some.
     */
    case "no-photos":
      return [
        `${displayed(outcome.file)} — ce voyage ne déclare aucune photo, rien à faire.`,
        `Dépose les images dans public/photos/${slug}/, déclare-les dans photos[] avec leur texte alternatif, puis ${runCommand(`npm run index-photos ${slug}`, "relance")}`,
      ];
    case "write-failed":
      return [
        `${displayed(outcome.file)} — ${plural(outcome.indexed, "photo mesurée", "photos mesurées")}, mais le fichier n'a pas pu être écrit : ${bounded(outcome.reason)}`,
        "Le fichier d'origine est intact → vérifie les droits, puis relance",
      ];
    /**
     * The refusal that costs the author his encoding time. It says *why* first —
     * his own save is the reason — then that nothing was overwritten, because the
     * fear at that moment is having lost the edit he had just made. And it says the
     * images are still there: they are, and a second run must not look like it will
     * redo minutes of work.
     */
    case "file-changed":
      return [
        `${displayed(outcome.file)} — le fichier a changé sur le disque pendant l'indexation : rien n'a été écrit dedans, ta version est intacte.`,
        `${plural(outcome.indexed, "photo avait été mesurée", "photos avaient été mesurées")} sur l'ancienne version ; les images produites, elles, sont bien là → ${runCommand(`npm run index-photos ${slug}`, "relance")}`,
      ];
    /**
     * Nothing was written either, and the wording is careful not to sound like
     * `file-changed`: the author did nothing wrong, his file simply is not UTF-8 —
     * latin-1 typically, a `title: Café` whose `é` is the single byte 0xE9. Telling
     * him the file changed under the command would send him looking for a culprit
     * that does not exist.
     */
    case "file-not-utf8":
      return [
        `${displayed(outcome.file)} — ce fichier n'est pas encodé en UTF-8 : rien n'a été écrit dedans, ton texte est intact.`,
        `${plural(outcome.indexed, "photo avait été mesurée", "photos avaient été mesurées")}, mais l'écriture aurait détruit les caractères accentués → enregistre-le en UTF-8, puis ${runCommand(`npm run index-photos ${slug}`, "relance")}`,
      ];
    case "done":
      return formatDone(outcome, slug);
  }
}
