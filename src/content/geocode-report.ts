import { bounded, escapeControls, quoted, runCommand } from "./finding";
import type {
  GeocodeEvent,
  GeocodeOutcome,
  PlaceRef,
  PlacesGeocodeOutcome,
  UnresolvedReason,
} from "./geocode";
import type { GeocodingCandidate } from "./geocoding";
import { formatCoordinate } from "./yaml-edit";

/**
 * What `npm run geocode` says, in French, as a pure function of what happened.
 *
 * Same division of labour as `report.ts` for `validate:content`: the module that
 * decides prints nothing, and the module that prints decides nothing. So every
 * sentence below is testable without a process, and the script is left with
 * argument parsing and a stream.
 *
 * Two rules inherited from TIW-9 and kept here, both about a *terminal*:
 *
 * - **no ANSI escape comes from here.** `validate:content` earns its colours by
 *   checking `isTTY` and `NO_COLOR`; this command's output is the transcript of a
 *   conversation, so it stays plain and no code path can leak an escape sequence
 *   into a captured log. (`readline`'s own line editor does emit cursor moves
 *   while it draws a prompt — on a real terminal, and only there. That is the
 *   editor, not the report.)
 * - **every value that came from outside is bounded and neutralised.** Here that
 *   means the HTTP response as much as the YAML file: a city name is a string a
 *   third party sent us, and `bounded()` is what stops it clearing the screen.
 *   A sentence *this repository* wrote is not such a value — see
 *   {@link firstHand}.
 */

/**
 * A sentence written here or by another module of this repository: neutralised,
 * and deliberately **not** bounded.
 *
 * `bounded()` is the right treatment for a value that came from outside and the
 * wrong one for a sentence we wrote ourselves. Measured: the 80-code-point cut it
 * applies landed in the middle of the wordings `yaml-edit.ts` produces, so
 * `places[0] « Tokyo » : les coordonnées portent « latitude »…` told the author
 * that something was wrong and never told him what to do about it. Truncating a
 * value drops noise; truncating a sentence drops its verb.
 *
 * The escaping stays, and is what makes this safe: a first-hand sentence can
 * quote a third-party fragment — a YAML key, an excerpt of the file — so those
 * bytes still reach this line. They are neutralised at the source *and* here,
 * because "the caller took care of it" is how an injection comes back.
 *
 * Same body as {@link displayed} and a different reason, which is why the two are
 * not one function: a path is not truncated because it has to stay pasteable, a
 * sentence because it has to stay a sentence.
 */
function firstHand(sentence: string): string {
  return escapeControls(sentence);
}

/**
 * `1 463 723`, grouped with plain spaces.
 *
 * Not `Intl.NumberFormat("fr-FR")`, deliberately: it groups with U+202F (a narrow
 * no-break space) on current ICU, and `finding.ts` already documents why an
 * unusual space character is a trap in output that gets grepped. It would also
 * make this function depend on the machine's ICU data for a number that has to
 * read the same everywhere.
 */
function formatPopulation(population: number | undefined): string {
  if (population === undefined) {
    return "population inconnue";
  }
  const digits = Math.round(population).toString();
  let grouped = "";
  for (const [index, digit] of [...digits].entries()) {
    const fromEnd = digits.length - index;
    grouped += index > 0 && fromEnd % 3 === 0 ? ` ${digit}` : digit;
  }

  return `${grouped} habitants`;
}

/** `35.02107, 135.75385` — the same digits that get written to the file. */
function formatCoordinates(candidate: GeocodingCandidate): string {
  return `${formatCoordinate(candidate.latitude)}, ${formatCoordinate(candidate.longitude)}`;
}

/**
 * Who a candidate is: the country and the region are what tell Kyōto in Japan
 * from Kyoto in Tanzania, and the population is what tells a city from the
 * heliport of the same name two lines below it.
 */
function describeIdentity(candidate: GeocodingCandidate): string {
  const place =
    candidate.country === undefined
      ? bounded(candidate.country_code)
      : `${bounded(candidate.country)} (${bounded(candidate.country_code)})`;
  const region = candidate.admin1 === undefined ? "" : `, ${bounded(candidate.admin1)}`;

  return `${bounded(candidate.name)} — ${place}${region} — ${formatPopulation(candidate.population)}`;
}

/** A candidate in the numbered list, where the coordinates are part of the choice. */
function describeCandidate(candidate: GeocodingCandidate): string {
  return `${describeIdentity(candidate)} — ${formatCoordinates(candidate)}`;
}

/** How a place is named at the head of a line: `places[1] « Kyoto »`. */
function describePlace(place: PlaceRef): string {
  const name = place.name === "" ? "sans nom" : quoted(place.name);

  return `places[${place.index}] ${name}`;
}

/**
 * The numbered list. 1-based, because the number is what the author types back,
 * and a 0-based prompt is a coordinate in the wrong hemisphere waiting to happen.
 */
export function formatCandidates(candidates: readonly GeocodingCandidate[]): readonly string[] {
  return candidates.map((candidate, index) => `  ${index + 1}. ${describeCandidate(candidate)}`);
}

/**
 * The question, naming the place the way every other line does.
 *
 * The index is not decoration: two cities called « Kyoto » in one file produced
 * the same prompt, and the prompt is the line under the author's eyes when he
 * decides — the announcement line has scrolled past the candidate list by then.
 */
export function formatPrompt(place: PlaceRef, count: number): string {
  return `  Quel numéro pour ${describePlace(place)} ? [1-${count}, ou « q » pour abandonner] `;
}

function describeReason(place: PlaceRef, reason: UnresolvedReason): string {
  const head = describePlace(place);

  switch (reason.state) {
    case "no-name":
      return `${head} : ce lieu n'a pas de nom, il n'y a rien à chercher → donne-lui son nom, tel qu'il s'affichera sur la carte`;
    case "no-country-code":
      return `${head} : le code pays ${reason.declared === "" ? "est absent" : `${quoted(reason.declared)} n'est pas un code ISO 3166-1 alpha-2`}, la contre-vérification du pays est donc impossible → écris-le sur deux lettres majuscules, « JP » pour le Japon`;
    case "no-match":
      return `${head} : introuvable, le service ne connaît aucun lieu de ce nom → vérifie l'orthographe, ou précise-la (« Kyoto, Japon »)`;
    /**
     * `reason.reason` stays `bounded()` even though a module of ours writes it:
     * one of its shapes interpolates the answer read from stdin
     * (`scripts/geocode.ts`), which is a value from outside and has no length
     * limit. The bound cannot destroy the advice here, since the advice is
     * outside the parentheses.
     */
    case "no-choice":
      return `${head} : ${reason.count} candidats et aucun choix retenu (${bounded(reason.reason)}) → relance et choisis un numéro, ou passe « --pick <n> »`;
    /**
     * The advice is the correction itself, and it comes with the value: the code
     * to write is the one the service returned, upper-cased because that is the
     * only spelling `CountryCodeSchema` accepts. `reason.returned` keeps the
     * provider's own case where it is *quoted*, since a message that paraphrases
     * what the service said cannot be checked against it.
     *
     * "Choisis un autre candidat" is deliberately absent: this branch is reached
     * with a single candidate as often as with a list, and `UnresolvedReason`
     * does not say which — so the advice cannot rest on a list that may never
     * have been printed. Qualifying the name is the way out that always works.
     */
    case "country-mismatch":
      return `${head} : le service place ${quoted(reason.candidate.name)} en ${bounded(reason.returned)}${reason.candidate.country === undefined ? "" : ` (${bounded(reason.candidate.country)})`} alors que le contenu déclare le pays ${bounded(reason.declared)} → si c'est bien ce pays, écris ${quoted(`countryCode: ${reason.returned.trim().toUpperCase()}`)} ; sinon précise le nom du lieu, le service a trouvé un homonyme`;
    /**
     * Said in French, rather than echoing `reason.reason` — which is Zod's
     * English, straight out of `src/domain/geo.ts`, and was the one place in this
     * toolbox where the voice broke mid-transcript. `validate:content` states the
     * same rule in French, so this states it too.
     *
     * Two shapes because `CoordinatesSchema` refuses two things: the pair (0, 0),
     * and a number outside the bounds of a latitude or a longitude. They are not
     * the same news — the first says the service failed and hid it, the second
     * says the answer is not a point on the globe at all.
     */
    case "rejected-coordinates":
      return `${head} : le service répond (${formatCoordinates(reason.candidate)}), ${reason.candidate.latitude === 0 && reason.candidate.longitude === 0 ? "la signature d'un géocodage raté, pas un endroit sur terre" : "hors des bornes d'une latitude et d'une longitude"} → ce candidat est inutilisable, précise le nom de la ville`;
    case "service":
      return `${head} : ${describeFailure(reason)}`;
    case "unsupported-yaml":
      return `${head} : ${firstHand(reason.reason)}`;
  }
}

function describeFailure(reason: Extract<UnresolvedReason, { state: "service" }>): string {
  const { failure } = reason;

  switch (failure.state) {
    case "timeout":
      return `le service de géocodage n'a pas répondu en ${Math.round(failure.timeoutMs / 1000)} s → réessaie, le fichier est intact`;
    case "unreachable":
      return `le service de géocodage est injoignable (${bounded(failure.reason)}) → vérifie la connexion, le fichier est intact`;
    case "http-error":
      return failure.status === 429
        ? `le service de géocodage répond 429 : trop de requêtes → attends une minute et relance`
        : `le service de géocodage répond ${failure.status} → réessaie plus tard, le fichier est intact`;
    case "malformed":
      return `la réponse du service est illisible (${bounded(failure.reason)}) → réessaie plus tard, le fichier est intact`;
  }
}

/**
 * The running commentary. One line per event, so the transcript of a run stays
 * greppable and a failure is never buried in a paragraph.
 */
export function formatEvent(event: GeocodeEvent): readonly string[] {
  switch (event.kind) {
    case "searching":
      return [`${describePlace(event.place)} : recherche de ${quoted(event.place.name)}…`];
    case "ambiguous":
      /**
       * The headline says what to *compare*, and says it once per city rather
       * than retelling the Kyoto anecdote (which lives in `--help`) on every
       * ambiguity. The list is not filtered — a heliport and a village of no
       * recorded population are both plausible answers for someone, and dropping
       * a candidate on a heuristic is how the right one disappears for the one
       * trip where it mattered.
       */
      return [
        `${describePlace(event.place)} : ${event.candidates.length} candidats — le premier n'est pas forcément le bon, compare le pays, la région et la population.`,
        ...formatCandidates(event.candidates),
      ];
    case "resolved":
      // The coordinates once, not twice: they are the outcome, and `describeIdentity`
      // is what says *which* place they belong to.
      return [
        `${describePlace(event.place)} → ${formatCoordinate(event.coordinates.lat)}, ${formatCoordinate(event.coordinates.lon)} — ${describeIdentity(event.candidate)}`,
      ];
    case "unresolved":
      return [describeReason(event.place, event.reason)];
  }
}

/**
 * A path, neutralised but **not** truncated.
 *
 * `report.ts` escapes at render time rather than at the call sites, and for the
 * reason it documents: a value that clears the screen destroys the very report it
 * appears in, and "remember to escape this one" is a rule that gets forgotten.
 * The paths here are built on a directory name read from disk, so `content/trips/`
 * holding a folder whose name carries an ESC is enough — the same attack
 * `finding.ts` was written against.
 *
 * Not `bounded()`, which truncates: a path cut at 80 characters can no longer be
 * pasted into an editor, which is the only thing it is printed for.
 */
function displayed(filePath: string): string {
  return escapeControls(filePath);
}

function plural(count: number, singular: string, many: string): string {
  return `${count} ${count > 1 ? many : singular}`;
}

/**
 * How many trip names a "no such slug" summary spells out before it counts the
 * rest. Measured on a real collection: sixteen names went onto one line, which is
 * a wall rather than a list — and the ninth name has never been what tells an
 * author that he misspelt his own slug.
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
 * The closing lines, and the only place that says what the file now contains.
 *
 * Two rules hold across every branch, and the suite asserts both on all of them
 * at once: a summary that names the trip file says whether that file was touched,
 * and the **last** line is the thing to do — an imperative, with no full stop, so
 * the eye lands on it.
 */
export function formatOutcome(outcome: GeocodeOutcome, slug: string): readonly string[] {
  switch (outcome.state) {
    case "content-dir-missing":
      return [
        `${displayed(outcome.contentDir)} — le répertoire de contenu est introuvable → crée-le, ou indique le bon avec ${quoted("--content <dossier>")}`,
      ];
    case "content-dir-unreadable":
      return [
        `${displayed(outcome.contentDir)} — le répertoire de contenu n'est pas lisible : ${bounded(outcome.reason)} → vérifie les droits du dossier`,
      ];
    /**
     * A list of what exists is an answer to "which trips are there", not to "why
     * did my command fail": either the slug is a typo, or the trip was never
     * created, and both have a command. So the list is followed by the two ways
     * out, the same way the empty-directory branch already offered one.
     */
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
        `Le géocodage ne réécrit pas un fichier qu'il ne sait pas relire → ${runCommand("npm run validate:content")} pour la ligne fautive`,
      ];
    case "no-places":
      return [
        `${displayed(outcome.file)} — le voyage ne déclare aucun lieu, rien n'a été écrit → déclare au moins une ville dans places[] (content/README.md)`,
      ];
    case "write-failed":
      return [
        `${displayed(outcome.file)} — ${plural(outcome.resolved, "ville résolue", "villes résolues")}, mais le fichier n'a pas pu être écrit : ${bounded(outcome.reason)}`,
        "Le fichier d'origine est intact → vérifie les droits, puis relance",
      ];
    /**
     * The one refusal that costs the author something: his coordinates are gone
     * and he has to answer the prompt again. So the sentence says *why* first —
     * his own save is the reason — and it says plainly that nothing was
     * overwritten, because the fear at that moment is having lost the edit he
     * had just made.
     */
    case "file-changed":
      return [
        `${displayed(outcome.file)} — le fichier a changé sur le disque pendant le géocodage : rien n'a été écrit, ta version est intacte.`,
        `${plural(outcome.resolved, "ville avait été géocodée", "villes avaient été géocodées")} sur l'ancienne version du fichier → ${runCommand(`npm run geocode ${slug}`, "relance")}`,
      ];
    /**
     * Nothing was written either, and the wording has to be careful not to sound
     * like `file-changed`: the author did nothing wrong while the prompt waited,
     * his file simply is not UTF-8 — latin-1 typically, a `title: Café` whose
     * `é` is the single byte 0xE9. Telling him the file changed under the command
     * would send him looking for a culprit that does not exist.
     *
     * What the two lines owe him: his bytes are intact, the work to redo, and the
     * one action that unblocks him — converting the file, not retrying.
     */
    case "file-not-utf8":
      return [
        `${displayed(outcome.file)} — ce fichier n'est pas encodé en UTF-8 : rien n'a été écrit, ton texte est intact.`,
        `${plural(outcome.resolved, "ville avait été géocodée", "villes avaient été géocodées")}, mais l'écriture aurait détruit les caractères accentués du fichier → enregistre-le en UTF-8, puis ${runCommand(`npm run geocode ${slug}`, "relance")}`,
      ];
    case "done":
      return formatDone(outcome, `npm run geocode ${slug}`);
  }
}

/**
 * Where the bytes really went, and only when that is not where the author would
 * look: `trip.yaml` is a symlink whose target leaves the content directory.
 *
 * Following the link is deliberate — a trip kept in a notes folder is a
 * legitimate setup — but announcing the link's path while writing elsewhere is
 * how a summary becomes a lie the author has no way to catch. So the line above
 * keeps naming the file he asked for, and this one says where his bytes are.
 */
function describeTarget(
  outcome: Extract<GeocodeOutcome, { state: "done" }>,
  fileLabel: string
): readonly string[] {
  return outcome.writtenTo === undefined
    ? []
    : [
        `${fileLabel} est un lien symbolique : les octets sont allés dans ${displayed(outcome.writtenTo)}, hors du dossier de contenu.`,
      ];
}

/**
 * The closing lines of a finished run, for **either** file (TIW-36).
 *
 * `relaunch` and `fileLabel` are parameters rather than derived from a slug,
 * because `npm run geocode:places` takes no argument and its file is not called
 * `trip.yaml`. Everything else is shared word for word, and deliberately: "ce qui
 * a été trouvé est enregistré, rien n'a été perdu" is the sentence that answers
 * the fear a partial rewrite creates, and it must not exist in two versions that
 * can drift apart.
 */
function formatDone(
  outcome: Extract<GeocodeOutcome, { state: "done" }>,
  relaunch: string,
  fileLabel = "trip.yaml"
): readonly string[] {
  if (outcome.pending === 0) {
    return [
      `${displayed(outcome.file)} — toutes les villes ont déjà leurs coordonnées, rien à faire.`,
      // `runCommand()` builds « lance « … » » to be pasted after an arrow; here it
      // lands after a full stop, so the verb is capitalised at the call site.
      `Le fichier n'a pas été réécrit. ${runCommand("npm run validate:content", "Lance")} pour le vérifier`,
    ];
  }

  const counted = `${plural(outcome.resolved, "ville géocodée", "villes géocodées")} sur ${outcome.pending}`;

  if (outcome.failed === 0) {
    return [
      `${displayed(outcome.file)} — ${counted}, fichier réécrit.`,
      ...describeTarget(outcome, fileLabel),
      `→ ${runCommand("npm run validate:content", "vérifie avec")}`,
    ];
  }

  if (!outcome.written) {
    return [
      `${displayed(outcome.file)} — aucune ville géocodée, ${plural(outcome.failed, "échec", "échecs")} ; le fichier est inchangé.`,
      `Les lignes ci-dessus disent quoi corriger, puis ${runCommand(relaunch, "relance")}`,
    ];
  }

  /**
   * The partial run, and the one summary where "did my file move?" is a real
   * question: it did. The file was rewritten with what was found, and saying only
   * that some cities failed let the author believe his trip untouched — until a
   * dirty `git status` said otherwise. So the rewrite is stated, and the second
   * line answers the fear that comes with it: nothing found was lost.
   */
  return [
    `${displayed(outcome.file)} — ${counted}, fichier réécrit ; ${plural(outcome.failed, "ville reste sans coordonnées", "villes restent sans coordonnées")}.`,
    ...describeTarget(outcome, fileLabel),
    `Ce qui a été trouvé est enregistré, rien n'a été perdu → ${runCommand(relaunch, "relance")}`,
  ];
}

/* ------------------------------------------------------- the visited places -- */

/** The command that relaunches a places run — no slug, one file. */
const GEOCODE_PLACES = "npm run geocode:places";

/**
 * The closing lines of `npm run geocode:places` (TIW-36).
 *
 * A second formatter and not a branch inside {@link formatOutcome}, because the
 * two commands fail to *find their file* in genuinely different ways — a trip is
 * looked up by slug inside a directory, this is one named file — and pretending
 * otherwise would mean printing a list of trips to somebody who typed no slug.
 * Everything past that point is `formatDone`, shared to the word.
 *
 * The two rules hold here as they do there, and the suite asserts them on every
 * branch: a summary that names the file says whether that file was touched, and
 * the **last** line is the thing to do — an imperative, with no full stop.
 */
export function formatPlacesOutcome(outcome: PlacesGeocodeOutcome): readonly string[] {
  switch (outcome.state) {
    /**
     * A file that is not there, and the wording refuses to call it "nothing to
     * do". The loading façade answers an empty collection for the same absence —
     * a journal with no dateless place is an ordinary journal — but somebody who
     * has just typed this command is asking about a file, and "rien à faire" for
     * a mistyped `--places` is a typo that looks like success.
     */
    case "places-file-absent":
      return outcome.similarName === undefined
        ? [
            `${displayed(outcome.file)} — ce fichier n'existe pas, rien n'a été touché.`,
            `Écris-y les lieux visités (content/README.md en donne la structure), ou indique le bon fichier avec ${quoted("--places <fichier>")}`,
          ]
        : [
            `${displayed(outcome.file)} — ce fichier n'existe pas, mais ${quoted(outcome.similarName)} est là : seule la casse diffère.`,
            `Renomme-le en ${quoted("places.yaml")} plutôt que d'en écrire un second → rien n'a été touché`,
          ];
    case "places-file-unreadable":
      return [`${displayed(outcome.file)} — ${bounded(outcome.reason)} → rien n'a été touché`];
    case "places-file-malformed":
      return [
        `${displayed(outcome.file)} — YAML invalide : ${bounded(outcome.reason)}`,
        `Le géocodage ne réécrit pas un fichier qu'il ne sait pas relire → ${runCommand("npm run validate:content")} pour la ligne fautive`,
      ];
    case "no-places":
      return [
        `${displayed(outcome.file)} — ce fichier ne déclare aucun lieu, rien n'a été écrit → ajoute une entrée sous ${quoted("places:")} (content/README.md)`,
      ];
    case "write-failed":
      return [
        `${displayed(outcome.file)} — ${plural(outcome.resolved, "ville résolue", "villes résolues")}, mais le fichier n'a pas pu être écrit : ${bounded(outcome.reason)}`,
        "Le fichier d'origine est intact → vérifie les droits, puis relance",
      ];
    case "file-changed":
      return [
        `${displayed(outcome.file)} — le fichier a changé sur le disque pendant le géocodage : rien n'a été écrit, ta version est intacte.`,
        `${plural(outcome.resolved, "ville avait été géocodée", "villes avaient été géocodées")} sur l'ancienne version du fichier → ${runCommand(GEOCODE_PLACES, "relance")}`,
      ];
    case "file-not-utf8":
      return [
        `${displayed(outcome.file)} — ce fichier n'est pas encodé en UTF-8 : rien n'a été écrit, ton texte est intact.`,
        `${plural(outcome.resolved, "ville avait été géocodée", "villes avaient été géocodées")}, mais l'écriture aurait détruit les caractères accentués du fichier → enregistre-le en UTF-8, puis ${runCommand(GEOCODE_PLACES, "relance")}`,
      ];
    case "done":
      return formatDone(outcome, GEOCODE_PLACES, "places.yaml");
  }
}
