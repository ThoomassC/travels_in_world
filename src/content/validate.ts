import path from "node:path";
import { TripSchema } from "@/domain/schema";
import {
  createDirectoryCache,
  displayPath,
  lookupFile,
  readTripCollection,
  stringAt,
  TRIP_FILE_NAME,
  valueAt,
} from "./collection";
import type { DirectoryCache, TripFile, YamlProblem } from "./collection";
import {
  diagnose,
  RULE_COVER_EMPTY,
  RULE_COVER_NOT_DECLARED,
  RULE_STEP_OUT_OF_RANGE,
  RULE_TRIP_RANGE_INVERTED,
} from "./diagnose";
import { describeField, escapeControls, quoted } from "./finding";
import type { ContentFinding, ContentValidation, FieldPath } from "./finding";

export type { ContentFinding, ContentValidation } from "./finding";

/**
 * The whole collection, judged. Three things happen here that the schema cannot
 * do on its own, and each is a reason this layer exists rather than a richer
 * `TripSchema` (see `docs/adr/0001-domain-purity.md`):
 *
 * - **the collection**: `TripSchema` sees one trip at a time, so a slug used
 *   twice across two files is invisible to it;
 * - **the disk**: a declared photo that matches no file is a broken page, and
 *   checking it means reaching for `fs`, which the domain must not do;
 * - **the wording**: the domain reports in paths and English sentences, and the
 *   deliverable of TIW-9 is a French line that names a file, a field and a
 *   command.
 *
 * **On `import "server-only"`.** Invariant 3 of `AGENTS.md` has `src/content/**`
 * carry it, and these modules do not — deliberately, and it is not an oversight
 * to reproduce blindly in the next module here. `server-only` resolves to a
 * module that *throws* under any condition but `react-server`, so it would break
 * both consumers this code actually has today: a plain Node CLI, and Vitest.
 * Nothing in `src/app/**` imports this yet, so nothing can leak to a client
 * bundle. The guard belongs on the page-facing loading façade (TIW-11) — one
 * module, `import "server-only"` at the top, re-exporting the loader — which is
 * also the moment the invariant starts protecting something. `AGENTS.md`
 * invariant 3 states this split.
 */

export type ValidationRequest = {
  /** Absolute path of the directory holding one sub-directory per trip. */
  readonly contentDir: string;
  /** Absolute path the `src` of a photo resolves against — the site's `public/`. */
  readonly publicDir: string;
  /** Absolute path used to shorten every path that appears in a message. */
  readonly repoRoot: string;
};

export function validateContent(request: ValidationRequest): ContentValidation {
  const contentDir = displayPath(request.repoRoot, request.contentDir);
  const collection = readTripCollection(request.contentDir);
  const nothingRead = { contentDir, tripCount: 0, validCount: 0, failedCount: 0 };

  if (collection.state === "missing-directory") {
    return {
      ...nothingRead,
      structuralCount: 1,
      findings: [
        {
          file: contentDir,
          problem: "le répertoire de contenu est introuvable",
          action: `crée-le, ou indique le bon avec ${quoted("--content <dossier>")}`,
        },
      ],
    };
  }

  if (collection.state === "unreadable-directory") {
    return {
      ...nothingRead,
      structuralCount: 1,
      findings: [
        {
          file: contentDir,
          problem: `le répertoire de contenu n'est pas lisible : ${escapeControls(collection.reason)}`,
          action: "vérifie les droits du dossier",
        },
      ],
    };
  }

  /** Slug declared in a file → the first file that declared it. */
  const slugOwners = new Map<string, string>();
  const structural = strayFileFindings(collection.strayFiles, request);
  const findings: ContentFinding[] = [...structural];
  const directories = createDirectoryCache();
  let validCount = 0;

  for (const trip of collection.files) {
    const own = findingsForTrip(trip, request, slugOwners, directories);
    if (own.length === 0) {
      validCount += 1;
    }
    findings.push(...own);
  }

  return {
    contentDir,
    tripCount: collection.files.length,
    validCount,
    failedCount: collection.files.length - validCount,
    structuralCount: structural.length,
    findings,
  };
}

/**
 * A YAML file loose in the content root. It is not a trip — a trip is a
 * directory — so it is counted in no total; but it is content that would be read
 * by nothing at all, which is the one outcome this script exists to prevent.
 */
function strayFileFindings(
  strayFiles: readonly string[],
  request: ValidationRequest
): readonly ContentFinding[] {
  return strayFiles.map((name) => {
    const slug = name.replace(/\.ya?ml$/i, "");
    const target = path.join(request.contentDir, slug, TRIP_FILE_NAME);

    return {
      file: displayPath(request.repoRoot, path.join(request.contentDir, name)),
      problem: `un voyage est un dossier contenant ${quoted(TRIP_FILE_NAME)}, pas un fichier isolé : celui-ci n'est lu par personne`,
      action: `déplace-le en ${displayPath(request.repoRoot, target)}`,
    };
  });
}

function findingsForTrip(
  trip: TripFile,
  request: ValidationRequest,
  slugOwners: Map<string, string>,
  directories: DirectoryCache
): readonly ContentFinding[] {
  const file = displayPath(request.repoRoot, trip.absolutePath);

  if (trip.state === "absent") {
    // A near-miss on the name is a rename, not a rewrite — and saying "remove
    // the folder" to someone whose file is merely miscased destroys a trip.
    return [
      trip.similarName === undefined
        ? {
            file,
            problem: `le fichier ${quoted(TRIP_FILE_NAME)} est absent du dossier du voyage`,
            action: `écris ce fichier (content/README.md en donne la structure), ou retire le dossier ${quoted(trip.directory)}`,
          }
        : {
            file,
            problem: `le fichier s'appelle ${quoted(trip.similarName)}, pas ${quoted(TRIP_FILE_NAME)}`,
            action: `renomme-le : la casse compte sur le système de fichiers de la CI, pas sur celui d'un Mac`,
          },
    ];
  }

  if (trip.state === "broken-link") {
    return [
      {
        file,
        problem: "le dossier du voyage est un lien symbolique cassé",
        action: `répare le lien, ou retire-le : en l'état ce voyage n'existe pour personne`,
      },
    ];
  }

  if (trip.state === "unreadable") {
    const what = trip.scope === "directory" ? "le dossier du voyage" : "le fichier";

    return [
      {
        file,
        problem: `${what} n'est pas lisible : ${escapeControls(trip.reason)}`,
        action: `vérifie les droits — c'est là, ça ne s'ouvre pas`,
      },
    ];
  }

  if (trip.state === "malformed") {
    return trip.problems.map((problem) => ({
      file,
      ...(problem.location === undefined ? {} : { location: problem.location }),
      problem: `YAML invalide : ${escapeControls(problem.message)}`,
      action: yamlAction(problem),
    }));
  }

  const declaredSlug = stringAt(trip.value, ["slug"]);
  /**
   * The commands take a slug; the directory name is the honest fallback. Bounded
   * and neutralised because it is printed *inside a shell command*: a 400-character
   * slug, or one holding an escape sequence, would otherwise be echoed as
   * something that looks like a line to paste into a terminal.
   */
  const tripSlug = escapeControls(displaySlug(declaredSlug ?? trip.directory));

  const collected: ContentFinding[] = [
    ...duplicateSlugFindings(trip, file, declaredSlug, slugOwners),
    ...unsafeKeyFindings(trip, file),
    ...schemaFindings(trip, file, tripSlug),
    ...assetFindings(trip, file, request, directories),
  ];

  return sortByPosition(deduplicate(collected));
}

/**
 * Advice that fits the error. Every YAML fault used to be answered with a lecture
 * on indentation, including `Map keys must be unique`, which has nothing to do
 * with it.
 */
const YAML_ADVICE = new Map([
  ["DUPLICATE_KEY", `une clé n'apparaît qu'une fois par bloc : retire ou renomme le doublon`],
  ["TAB_AS_INDENT", "indente avec des espaces : une tabulation n'est pas de l'indentation en YAML"],
  ["UNRESOLVABLE", "simplifie les ancres et les alias : le document ne peut pas être résolu"],
]);

const YAML_ADVICE_DEFAULT =
  "corrige la syntaxe : indentation par deux espaces, un tiret par entrée de liste";

function yamlAction(problem: YamlProblem): string {
  const advice = YAML_ADVICE.get(problem.code) ?? YAML_ADVICE_DEFAULT;

  if (problem.consequences === 0) {
    return advice;
  }

  // The consequences are not printed — they all accuse lines the parser could no
  // longer read — but hiding their number would be hiding what we know.
  const plural = problem.consequences > 1 ? "erreurs" : "erreur";

  return `${advice} — le reste du fichier n'a pas pu être lu (${problem.consequences} ${plural} en aval)`;
}

/** Bounds a slug that ends up inside a printed command. */
function displaySlug(slug: string): string {
  const points = [...slug];

  return points.length <= 40 ? slug : `${points.slice(0, 40).join("")}…`;
}

/**
 * Keys JavaScript reads as instructions. `z.strictObject` cannot reject
 * `__proto__` because assigning it never creates an own property — so the trip
 * validated green, and the value would have reached the loader of TIW-11 with a
 * rewritten prototype. This is the only hole in the promise `content/README.md`
 * makes ("une clé inconnue est une erreur"), and it is closed on the YAML
 * document, which still has the key.
 */
function unsafeKeyFindings(
  trip: Extract<TripFile, { state: "parsed" }>,
  file: string
): readonly ContentFinding[] {
  return trip.unsafeKeys.map((field) => ({
    file,
    field,
    ...locationOf(trip, field),
    problem: `la clé ${quoted(String(field.at(-1)))} est refusée : elle réécrirait le prototype de l'objet au chargement, et aucun schéma ne peut la voir`,
    action: "renomme-la, ou retire la ligne",
  }));
}

/** `location` omitted rather than set to `undefined`: the field is optional. */
function locationOf(
  trip: Extract<TripFile, { state: "parsed" }>,
  field: FieldPath
): { readonly location?: ContentFinding["location"] } {
  const location = trip.locate(field);

  return location === undefined ? {} : { location };
}

/**
 * A slug is the trip's URL, so two trips cannot share one. `TripSchema` is handed
 * a single trip and cannot see this; the check belongs here, and it reports on
 * the *second* declaration, naming the first so the author can compare them.
 */
function duplicateSlugFindings(
  trip: Extract<TripFile, { state: "parsed" }>,
  file: string,
  declaredSlug: string | undefined,
  slugOwners: Map<string, string>
): readonly ContentFinding[] {
  if (declaredSlug === undefined) {
    return [];
  }

  const owner = slugOwners.get(declaredSlug);
  if (owner === undefined) {
    slugOwners.set(declaredSlug, file);
    return [];
  }

  return [
    {
      file,
      field: ["slug"],
      ...locationOf(trip, ["slug"]),
      problem: `le slug ${quoted(declaredSlug)} est déjà porté par ${owner}`,
      action: "donne un slug unique à ce voyage : c'est lui qui fait son URL",
    },
  ];
}

function schemaFindings(
  trip: Extract<TripFile, { state: "parsed" }>,
  file: string,
  tripSlug: string
): readonly ContentFinding[] {
  const result = TripSchema.safeParse(trip.value);
  if (result.success) {
    return [];
  }

  const context = { document: trip.value, tripSlug };
  const diagnoses = result.error.issues.flatMap((issue) => diagnose(issue, context));

  /**
   * When the trip's own range is inverted, every step is out of it. Those
   * findings are true and carry nothing: they accuse healthy steps of a fault
   * that is one line above them, which is exactly the noise TIW-8 removed from
   * the schema and this reporter must not put back.
   */
  const derived = new Set<string>();
  if (diagnoses.some((entry) => entry.rule === RULE_TRIP_RANGE_INVERTED)) {
    derived.add(RULE_STEP_OUT_OF_RANGE);
  }
  /**
   * An empty cover cannot be one of the photos either, so the schema reports both
   * — two findings at the same position, the second of them reading "la photo de
   * couverture vide ne figure pas dans photos[]". Only the first says anything.
   */
  if (diagnoses.some((entry) => entry.rule === RULE_COVER_EMPTY)) {
    derived.add(RULE_COVER_NOT_DECLARED);
  }

  const kept = diagnoses.filter((entry) => !derived.has(entry.rule));

  return kept.map((entry) => ({
    file,
    field: entry.field,
    ...locationOf(trip, entry.field),
    problem: entry.problem,
    action: entry.action,
    ...(entry.command === undefined ? {} : { command: entry.command }),
  }));
}

/**
 * The check the domain cannot make: a photo is a *file*, and a `src` that points
 * at nothing renders as a broken image on a page that is otherwise perfect.
 *
 * Read from the raw document rather than from a parsed trip, so that a file with
 * a schema error still gets its photos checked — one run, every problem.
 */
function assetFindings(
  trip: Extract<TripFile, { state: "parsed" }>,
  file: string,
  request: ValidationRequest,
  directories: DirectoryCache
): readonly ContentFinding[] {
  const findings: ContentFinding[] = [];
  const checked = new Set<string>();

  const report = (field: FieldPath, problem: string, action: string): void => {
    findings.push({ file, field, ...locationOf(trip, field), problem, action });
  };

  const check = (source: string, field: FieldPath, label: string): void => {
    if (!source.startsWith("/")) {
      report(
        field,
        `${label} ${quoted(source)} n'est pas un chemin absolu`,
        `écris-le depuis la racine du site, ${quoted("/photos/<voyage>/<image>.jpg")}`
      );
      return;
    }

    /**
     * Decoded before anything else. A `src` written for a browser carries `%20`
     * for a space, and comparing it raw to the disk both failed to find the file
     * *and* advised creating one whose name contains a literal `%20` — advice
     * that would have made the validation pass and the page 404.
     *
     * Order matters: decoding after the containment check below would let
     * `%2e%2e%2f` walk out of `public/` unnoticed.
     */
    let decoded: string;
    try {
      decoded = decodeURIComponent(source);
    } catch {
      report(
        field,
        `${label} ${quoted(source)} contient un échappement d'URL invalide`,
        "écris le chemin tel qu'il est sur le disque, ou encode-le correctement"
      );
      return;
    }

    const segments = decoded.split("/").filter((segment) => segment !== "");

    if (segments.some((segment) => segment === ".." || segment === ".")) {
      report(
        field,
        `${label} ${quoted(source)} sort du dossier public`,
        `retire les ${quoted("..")} du chemin`
      );
      return;
    }

    const lookup = lookupFile(request.publicDir, segments, directories);

    if (lookup.state === "case-mismatch") {
      report(
        field,
        `${label} ${quoted(source)} ne correspond à aucun fichier : sur le disque, c'est ${quoted(lookup.onDisk)}`,
        `aligne la casse — un système de fichiers insensible à la casse laisse passer l'écart, le CDN de production non`
      );
      return;
    }

    if (lookup.state === "missing") {
      const expected = displayPath(request.repoRoot, path.join(request.publicDir, ...segments));

      report(
        field,
        `${label} ${quoted(source)} ne correspond à aucun fichier`,
        `dépose l'image en ${expected}, ou retire la déclaration`
      );
    }
  };

  const photos = valueAt(trip.value, ["photos"]);
  if (Array.isArray(photos)) {
    photos.forEach((_photo, index) => {
      const source = stringAt(trip.value, ["photos", index, "src"]);
      if (source === undefined || checked.has(source)) {
        return;
      }
      checked.add(source);
      check(source, ["photos", index, "src"], "la photo");
    });
  }

  const cover = stringAt(trip.value, ["coverPhotoSrc"]);
  // Only when the cover is not one of the photos: the same missing file reported
  // twice, once per declaration, is noise the author cannot act on twice.
  if (cover !== undefined && !checked.has(cover)) {
    check(cover, ["coverPhotoSrc"], "la photo de couverture");
  }

  return findings;
}

/**
 * One fault, one line. A malformed date fails both its format check and its
 * calendar check, and both translate to the same sentence about the same field —
 * the author has one thing to fix, so they read one line.
 */
function deduplicate(findings: readonly ContentFinding[]): readonly ContentFinding[] {
  const seen = new Set<string>();

  return findings.filter((finding) => {
    const identity = `${describeField(finding.field)} ${finding.problem}`;
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

/** File order, so the report reads like the file the author is looking at. */
function sortByPosition(findings: readonly ContentFinding[]): readonly ContentFinding[] {
  return [...findings].sort(
    (left, right) =>
      (left.location?.line ?? 0) - (right.location?.line ?? 0) ||
      (left.location?.column ?? 0) - (right.location?.column ?? 0)
  );
}
