import type { z } from "zod";
import { isPlainDate } from "@/domain/geo";
import { DERIVATIVE_LADDER, isDerivativeName } from "@/domain/photo";
import { TRANSPORT_MODES } from "@/domain/schema";
import { stringAt, valueAt } from "./collection";
import { describeField, fieldShape, quoted, quotedList, runCommand } from "./finding";
import type { FieldPath } from "./finding";

/**
 * The message catalogue: one schema issue in, one sentence a human can act on
 * out. This module is the deliverable of TIW-9 — a build that fails with
 * `invalid_type at places.1.coordinates` fails just as hard as one that says
 * which city has no coordinates and which command fills them in, and only one of
 * the two keeps publishing a trip pleasant six months from now.
 *
 * Three rules it follows.
 *
 * **The messages are in French**, because Thomas is the one who reads them,
 * while the code and these comments stay in English like the rest of the
 * repository.
 *
 * **The path decides the wording, not the text of the schema's message.**
 * `TripSchema` puts every issue on the path of the offending entry (see
 * `docs/adr/0001-domain-purity.md`), so the path is a stable contract; the
 * English sentences are not. Two families of rules share a path *shape*, and
 * those are resolved by reading the document back — never by pattern-matching
 * the English. The one exception is documented at {@link STEP_RULE_MARKERS}.
 *
 * **The values quoted come from the document, not from the issue.** A rejected
 * document has no parsed form, so `valueAt` reads what the author actually wrote:
 * naming Kyoto is what turns "a place lacks coordinates" into a line that points
 * at a line.
 */

type Issue = z.core.$ZodIssue;

export type Diagnosis = {
  /**
   * A stable identifier for the rule that fired. `validate.ts` uses it to drop
   * findings that another finding has already explained; nothing prints it.
   */
  readonly rule: string;
  readonly field: FieldPath;
  readonly problem: string;
  readonly action: string;
  readonly command?: string;
};

export type DiagnosisContext = {
  /** The raw YAML value, needed to quote what the author wrote. */
  readonly document: unknown;
  /** The trip slug the repair commands take as their argument. */
  readonly tripSlug: string;
  /**
   * The command that resolves a missing coordinate **for this document**
   * (TIW-36).
   *
   * `npm run geocode <slug>` for a `trip.yaml`, `npm run geocode:places` for
   * `content/places.yaml`. The two files share the `places[]` field shape, so
   * they share every sentence in this catalogue — which is the point, one rule
   * having one wording — and the command is the one thing that genuinely differs
   * between them.
   *
   * **Required and not defaulted**, deliberately. Derived from `tripSlug` when
   * absent, it would answer `npm run geocode places` for the places file: a
   * command naming a trip that does not exist, printed at the end of a line whose
   * whole job is to be the thing that ends the problem. The compiler asking each
   * of the two callers is cheaper than that.
   */
  readonly geocodeCommand: string;
};

/** Rules whose findings are consequences of another, more precise one. */
export const RULE_TRIP_RANGE_INVERTED = "trip-range-inverted";
export const RULE_STEP_OUT_OF_RANGE = "step-out-of-range";
export const RULE_COVER_EMPTY = "cover-empty";
export const RULE_COVER_NOT_DECLARED = "cover-not-declared";

/**
 * The three `TripSchema` rules that report on `steps[i]` with no further path,
 * told apart by a marker in the schema's own English message.
 *
 * This is the one place that reads that text, and it is deliberate: the
 * alternative is to recompute *which* of the three failed, which would duplicate
 * domain logic in a layer that must not own it. The coupling is loose but real,
 * so it is pinned — `tests/content/validate.test.ts` has a case per marker, and
 * rewording a message in `src/domain/schema.ts` turns one of them red instead of
 * silently degrading a line to the generic fallback.
 */
const STEP_RULE_MARKERS = {
  reference: "references the place",
  range: "outside the trip",
  order: "before the previous step ends",
} as const;

/* ---------------------------------------------------------------- vocabulary -- */

const CONTENT_GUIDE = "content/README.md";

function normalize(path: readonly PropertyKey[]): FieldPath {
  return path.map((segment) =>
    typeof segment === "number" || typeof segment === "string" ? segment : String(segment)
  );
}

/** What the author wrote at a path, rendered for a message; "" when absent. */
function written(context: DiagnosisContext, field: FieldPath): string {
  const value = valueAt(context.document, field);

  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/** `« 2024-4-1 »`, or a fallback when the value is absent or not a scalar. */
function writtenOr(context: DiagnosisContext, field: FieldPath, fallback: string): string {
  const value = written(context, field);

  return value === "" ? fallback : quoted(value);
}

/**
 * Absent *or* left empty. `startDate:` with nothing after it parses as `null`,
 * not `undefined`, and treating the two apart put a fallback meant for the
 * "what to do" slot into the "what you wrote" slot: "la date est absente n'est
 * pas écrite AAAA-MM-JJ". For the author the two cases are one — the value is
 * not there.
 */
function isAbsent(context: DiagnosisContext, field: FieldPath): boolean {
  const value = valueAt(context.document, field);

  return value === undefined || value === null;
}

/** `la ville « Kyoto »` when it has a name, `le lieu places[1]` when it does not. */
function placeLabel(context: DiagnosisContext, index: number): string {
  const name = stringAt(context.document, ["places", index, "name"]);

  return name === undefined
    ? `le lieu ${describeField(["places", index])}`
    : `la ville ${quoted(name)}`;
}

function photoLabel(context: DiagnosisContext, index: number): string {
  const source = stringAt(context.document, ["photos", index, "src"]);

  return source === undefined
    ? `la photo ${describeField(["photos", index])}`
    : `la photo ${quoted(source)}`;
}

/**
 * The step named the way the field path names it. "l'étape 1" read as the first
 * step while it meant the second, and any 1-based rewording would then disagree
 * with the `steps[1]` printed at the head of the same line. Quoting the path
 * leaves nothing to interpret.
 */
function stepLabel(index: number): string {
  return `l'étape ${describeField(["steps", index])}`;
}

/** The trailing index of a path shape such as `places[].coordinates`. */
function indexAt(field: FieldPath, position: number): number {
  const segment = field[position];

  return typeof segment === "number" ? segment : 0;
}

function tripBounds(context: DiagnosisContext): string {
  const start = written(context, ["startDate"]);
  const end = written(context, ["endDate"]);

  return `${start} … ${end}`;
}

function declaredPlaceSlugs(context: DiagnosisContext): readonly string[] {
  const places = valueAt(context.document, ["places"]);
  if (!Array.isArray(places)) {
    return [];
  }

  return places
    .map((_place, index) => stringAt(context.document, ["places", index, "slug"]))
    .filter((slug): slug is string => slug !== undefined);
}

/** The place slugs a raw step points at, whatever kind it claims to be. */
function stepPlaceSlugs(context: DiagnosisContext, index: number): readonly string[] {
  return (["placeSlug", "fromSlug", "toSlug"] as const)
    .map((key) => stringAt(context.document, ["steps", index, key]))
    .filter((slug): slug is string => slug !== undefined);
}

const SLUG_RULE = "minuscules, chiffres et traits d'union";
const DATE_SHAPES = new Set([
  "startDate",
  "endDate",
  "steps[].startDate",
  "steps[].endDate",
  "steps[].date",
]);
/** The list-valued keys, with the noun a message uses for one of their entries. */
const COLLECTION_LABELS = new Map([
  ["places", "lieu"],
  ["steps", "étape"],
  ["photos", "photo"],
  ["tags", "étiquette"],
]);

/** One entry of those lists, when the entry itself is not even an object. */
const ENTRY_SHAPES = new Set(["places[]", "steps[]", "photos[]"]);

const SLUG_SHAPES = new Set([
  "slug",
  "places[].slug",
  "steps[].placeSlug",
  "steps[].fromSlug",
  "steps[].toSlug",
  // The *leaf* failure only — a `placeSlug` that is not a slug at all. The
  // cross-field rule, a well-formed slug no place bears, is caught earlier by
  // `diagnosePhotoPlace`, which can list the places that are declared.
  "photos[].placeSlug",
  "tags[]",
]);

/* -------------------------------------------------------------- the catalogue -- */

/**
 * A place's coordinates, in any of the ways they can be wrong. All of them are
 * repaired by the same command, which is the whole point of naming it.
 */
function diagnoseCoordinates(
  shape: string,
  issue: Issue,
  context: DiagnosisContext,
  field: FieldPath
): Diagnosis | undefined {
  const index = indexAt(field, 1);
  const geocode = context.geocodeCommand;

  if (shape === "places[].coordinates") {
    if (issue.code === "custom") {
      return {
        rule: "null-island",
        field,
        problem: `${placeLabel(context, index)} est géocodée en (0, 0), la signature d'un géocodage raté`,
        action: runCommand(geocode, "relance"),
        command: geocode,
      };
    }
    return {
      rule: "coordinates-missing",
      field,
      problem: isAbsent(context, field)
        ? `${placeLabel(context, index)} est déclarée sans coordonnées`
        : `${placeLabel(context, index)} a des coordonnées illisibles`,
      action: runCommand(geocode),
      command: geocode,
    };
  }

  const axis = shape.endsWith("lat") ? "latitude" : "longitude";
  const bounds = axis === "latitude" ? "-90 … 90" : "-180 … 180";

  if (isAbsent(context, field)) {
    return {
      rule: "coordinate-missing",
      field,
      problem: `${placeLabel(context, index)} n'a pas de ${axis}`,
      action: runCommand(geocode),
      command: geocode,
    };
  }

  /**
   * A value that is not a number at all is a different fault from a value out of
   * range, and the likeliest one from a French keyboard: `lat: 35,6762` was
   * reported as "hors des bornes -90 … 90", which sends the author looking for a
   * wrong coordinate instead of a comma.
   */
  if (issue.code !== "too_big" && issue.code !== "too_small") {
    return {
      rule: "coordinate-format",
      field,
      problem: `la ${axis} ${quoted(written(context, field))} de ${placeLabel(context, index)} n'est pas un nombre`,
      action: `écris-la comme un nombre, avec un point décimal, ou ${runCommand(geocode, "relance")}`,
      command: geocode,
    };
  }

  return {
    rule: "coordinate-out-of-bounds",
    field,
    problem: `${placeLabel(context, index)} a une ${axis} de ${quoted(written(context, field))}, hors des bornes ${bounds}`,
    action: `corrige la valeur, ou ${runCommand(geocode, "relance")}`,
    command: geocode,
  };
}

function diagnosePhotoDimension(
  shape: string,
  context: DiagnosisContext,
  field: FieldPath
): Diagnosis {
  const index = indexAt(field, 1);
  const dimension = shape.endsWith("width") ? "largeur" : "hauteur";
  const indexPhotos = `npm run index-photos ${context.tripSlug}`;
  const absent = isAbsent(context, field);

  return {
    rule: "photo-dimension",
    field,
    problem: absent
      ? `${photoLabel(context, index)} est déclarée sans ${dimension}`
      : `${photoLabel(context, index)} a une ${dimension} invalide (${written(context, field)})`,
    // No explanation appended: this action is printed once per missing
    // dimension, and a sentence read twice in a row stops being read.
    action: runCommand(indexPhotos),
    command: indexPhotos,
  };
}

/**
 * The preloading placeholder, absent or malformed.
 *
 * Same command as the dimensions, and deliberately the same terse action: one run
 * of `index-photos` writes all three, so three self-explaining sentences would be
 * the same repair said three times.
 *
 * The malformed branch does **not** quote the value, unlike almost every other
 * message here. It is a base64 blob of up to 512 characters, and printing it
 * fills the terminal with noise nobody can act on — this is not a field anyone
 * types, so showing what was written tells the author nothing.
 */
function diagnosePhotoPlaceholder(context: DiagnosisContext, field: FieldPath): Diagnosis {
  const index = indexAt(field, 1);
  const indexPhotos = `npm run index-photos ${context.tripSlug}`;

  return {
    rule: "photo-placeholder",
    field,
    problem: isAbsent(context, field)
      ? `${photoLabel(context, index)} est déclarée sans vignette de préchargement`
      : `${photoLabel(context, index)} porte une vignette de préchargement que le contenu refuse : ce doit être une image WebP en base64, écrite par la commande`,
    action: runCommand(indexPhotos),
    command: indexPhotos,
  };
}

/**
 * A photo attached to a place the trip does not declare.
 *
 * The declared slugs are listed in the action, which is the difference between a
 * refusal and a repair: this is almost always a typo or a place that was renamed,
 * and the right answer is one of two or three words already in the file.
 *
 * **No command is offered, and that is the point.** `index-photos` writes
 * dimensions and placeholders and has no opinion whatsoever about which place a
 * photo belongs to. Naming it here would send the author to a command that
 * changes nothing and then reports success.
 */
function diagnosePhotoPlace(context: DiagnosisContext, field: FieldPath): Diagnosis {
  const index = indexAt(field, 1);
  const declared = declaredPlaceSlugs(context);

  return {
    rule: "photo-place-unknown",
    field,
    problem: `${photoLabel(context, index)} est rattachée au lieu ${writtenOr(context, field, "vide")}, absent de places[]`,
    action:
      declared.length === 0
        ? `déclare ce lieu dans places[], ou retire la clé ${quoted("placeSlug")}`
        : `écris l'un des lieux déclarés (${quotedList(declared)}), ou retire la clé ${quoted("placeSlug")}`,
  };
}

/**
 * A source that has the shape of the pipeline's own output.
 *
 * The action is **rename**, and it must never be "run the command": running
 * `index-photos` on a trip declaring `tokyo-480.jpg` is precisely what would
 * overwrite that file with the 480 px derivative of `tokyo.jpg`. This is the one
 * photo finding whose repair the author has to make by hand, so it carries no
 * `command` at all.
 */
function diagnosePhotoDerivativeName(context: DiagnosisContext, field: FieldPath): Diagnosis {
  const index = indexAt(field, 1);

  return {
    rule: "photo-src-reserved",
    field,
    problem: `${photoLabel(context, index)} porte un nom que la commande d'indexation écrit elle-même : un tiret suivi d'une des largeurs ${DERIVATIVE_LADDER.join(", ")}`,
    action: `renomme le fichier sur le disque et dans photos[] — sinon ${quoted("npm run index-photos")} l'écraserait avec la vignette qu'il produit`,
  };
}

function diagnoseDate(context: DiagnosisContext, field: FieldPath): Diagnosis {
  const value = written(context, field);

  if (isAbsent(context, field)) {
    return {
      rule: "date-missing",
      field,
      problem: "la date n'est pas renseignée",
      action: "écris-la AAAA-MM-JJ, par exemple 2024-04-12",
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return {
      rule: "date-format",
      field,
      problem: `la date ${writtenOr(context, field, "est absente")} n'est pas écrite AAAA-MM-JJ`,
      action: "écris-la sur quatre, deux et deux chiffres, par exemple 2024-04-12",
    };
  }

  return {
    rule: "date-calendar",
    field,
    problem: `la date ${quoted(value)} n'existe pas au calendrier`,
    action: "corrige le jour ou le mois",
  };
}

/** A `steps[i]` rule, told apart by the marker in the schema's message. */
function diagnoseStep(issue: Issue, context: DiagnosisContext, field: FieldPath): Diagnosis {
  const index = indexAt(field, 1);

  if (issue.message.includes(STEP_RULE_MARKERS.reference)) {
    const declared = new Set(declaredPlaceSlugs(context));
    const unknown = stepPlaceSlugs(context, index).filter((slug) => !declared.has(slug));
    const several = unknown.length > 1;

    return {
      rule: "step-unknown-place",
      field,
      problem:
        unknown.length === 0
          ? `${stepLabel(index)} renvoie à un lieu absent de places[]`
          : `${stepLabel(index)} renvoie ${several ? "aux lieux" : "au lieu"} ${quotedList(unknown)}, ${several ? "absents" : "absent"} de places[]`,
      action: `déclare ${several ? "ces lieux" : "ce lieu"} dans places[], ou corrige ${several ? "les slugs" : "le slug"} de l'étape`,
    };
  }

  if (issue.message.includes(STEP_RULE_MARKERS.range)) {
    return {
      rule: RULE_STEP_OUT_OF_RANGE,
      field,
      problem: `${stepLabel(index)} est datée hors des bornes ${tripBounds(context)} du voyage`,
      action: "corrige la date de l'étape, ou les bornes du voyage",
    };
  }

  if (issue.message.includes(STEP_RULE_MARKERS.order)) {
    return {
      rule: "step-out-of-order",
      field,
      problem: `${stepLabel(index)} commence avant la fin de l'étape précédente`,
      action: "remets les étapes dans l'ordre chronologique",
    };
  }

  return {
    rule: "step-inconsistent",
    field,
    problem: `${stepLabel(index)} est incohérente avec le reste de l'itinéraire`,
    action: `relis l'étape et ses voisines (${CONTENT_GUIDE})`,
  };
}

function diagnoseKnownShape(
  issue: Issue,
  context: DiagnosisContext,
  field: FieldPath
): Diagnosis | undefined {
  const shape = fieldShape(field);
  const custom = issue.code === "custom";

  if (shape === "") {
    return {
      rule: "not-a-trip",
      field,
      problem:
        "le fichier ne décrit pas un voyage : une correspondance clé/valeur YAML est attendue",
      action: `reprends la structure décrite dans ${CONTENT_GUIDE}`,
    };
  }

  if (
    shape === "places[].coordinates" ||
    shape === "places[].coordinates.lat" ||
    shape === "places[].coordinates.lon"
  ) {
    return diagnoseCoordinates(shape, issue, context, field);
  }

  if (shape === "photos[].width" || shape === "photos[].height") {
    return diagnosePhotoDimension(shape, context, field);
  }

  if (shape === "photos[].blurDataUrl") {
    return diagnosePhotoPlaceholder(context, field);
  }

  /**
   * `custom` only: the cross-field rule reports here. A `placeSlug` that is not a
   * slug at all is a leaf failure, and {@link SLUG_SHAPES} has the better
   * sentence for it — the spelling rule, not the list of declared places.
   */
  if (shape === "photos[].placeSlug" && custom) {
    return diagnosePhotoPlace(context, field);
  }

  if (DATE_SHAPES.has(shape)) {
    // A `custom` issue on a date is either "this is not a real day" — the leaf
    // rule — or a cross-field rule that happens to report here. The document
    // tells them apart: a well-formed day means the leaf rule passed.
    if (!custom || !isPlainDate(written(context, field))) {
      return diagnoseDate(context, field);
    }
  }

  if (shape === "endDate" && custom) {
    return {
      rule: RULE_TRIP_RANGE_INVERTED,
      field,
      problem: `le voyage se termine le ${written(context, ["endDate"])}, avant son début le ${written(context, ["startDate"])}`,
      action: `corrige ${quoted("endDate")} ou ${quoted("startDate")}`,
    };
  }

  if (shape === "steps[].endDate" && custom) {
    const index = indexAt(field, 1);

    return {
      rule: "stay-inverted",
      field,
      problem: `le séjour de ${stepLabel(index)} se termine le ${written(context, field)}, avant son début le ${written(context, ["steps", index, "startDate"])}`,
      action: `corrige ${quoted("endDate")} ou ${quoted("startDate")} de l'étape`,
    };
  }

  // `custom` only: the three cross-field rules report here. A step that is not
  // even an object is a different fault, handled by {@link ENTRY_SHAPES}.
  if (shape === "steps[]" && custom) {
    return diagnoseStep(issue, context, field);
  }

  if (shape === "steps[].fromSlug" && custom) {
    const index = indexAt(field, 1);

    return {
      rule: "step-disconnected",
      field,
      problem: `${stepLabel(index)} part de ${writtenOr(context, field, "nulle part")} alors que le séjour précédent est à ${writtenOr(context, ["steps", index - 1, "placeSlug"], "un autre lieu")}`,
      action: `corrige ${quoted("fromSlug")}, ou l'ordre des étapes`,
    };
  }

  if (shape === "steps[].toSlug" && custom) {
    const index = indexAt(field, 1);
    const from = written(context, ["steps", index, "fromSlug"]);
    const to = written(context, field);

    if (from === to) {
      return {
        rule: "move-in-place",
        field,
        problem: `${stepLabel(index)} part de ${quoted(from)} et y arrive`,
        action: `un déplacement relie deux lieux différents : corrige ${quoted("toSlug")}, ou fais-en un séjour`,
      };
    }

    return {
      rule: "step-disconnected",
      field,
      problem: `${stepLabel(index)} arrive à ${quoted(to)} alors que le séjour suivant est à ${writtenOr(context, ["steps", index + 1, "placeSlug"], "un autre lieu")}`,
      action: `corrige ${quoted("toSlug")}, ou l'ordre des étapes`,
    };
  }

  if (shape === "steps[].placeSlug" && custom) {
    const index = indexAt(field, 1);

    return {
      rule: "missing-move",
      field,
      problem: `${stepLabel(index)} séjourne à ${writtenOr(context, field, "un lieu")} alors que l'étape précédente séjourne à ${writtenOr(context, ["steps", index - 1, "placeSlug"], "un autre lieu")} : le déplacement entre les deux manque`,
      action: "ajoute l'étape de déplacement entre les deux séjours",
    };
  }

  if (shape === "steps[].kind") {
    const index = indexAt(field, 1);

    return {
      rule: "step-kind",
      field,
      problem: isAbsent(context, field)
        ? `${stepLabel(index)} ne dit pas de quel type elle est`
        : `${quoted(written(context, field))} n'est pas un type d'étape`,
      action: `choisis ${quoted("kind: stay")} pour un séjour ou ${quoted("kind: move")} pour un déplacement`,
    };
  }

  if (shape === "steps[].mode") {
    const index = indexAt(field, 1);

    return {
      rule: "transport-mode",
      field,
      problem: isAbsent(context, field)
        ? `${stepLabel(index)} ne dit pas comment on se déplace`
        : `${quoted(written(context, field))} n'est pas un mode de transport connu`,
      action: `choisis parmi ${TRANSPORT_MODES.join(", ")}`,
    };
  }

  if (SLUG_SHAPES.has(shape)) {
    if (custom) {
      if (shape === "places[].slug") {
        return {
          rule: "duplicate-place-slug",
          field,
          problem: `deux lieux portent le slug ${writtenOr(context, field, "identique")} : toute étape qui s'y réfère est ambiguë`,
          action: "renomme l'un des deux",
        };
      }
      if (shape === "tags[]") {
        return {
          rule: "duplicate-tag",
          field,
          problem: `l'étiquette ${writtenOr(context, field, "identique")} est listée deux fois`,
          action: "retire le doublon",
        };
      }
    }
    return {
      rule: "slug-format",
      field,
      problem: isAbsent(context, field)
        ? `le slug ${describeField(field)} est absent`
        : `${quoted(written(context, field))} n'est pas un slug : ${SLUG_RULE} seulement`,
      action:
        shape === "slug"
          ? "corrige-le : c'est lui qui fait l'URL du voyage"
          : "corrige-le, et reporte la correction sur les étapes qui le citent",
    };
  }

  if (shape === "title") {
    const value = written(context, field);

    return {
      rule: "title",
      field,
      problem: isAbsent(context, field)
        ? "le voyage n'a pas de titre"
        : value.trim() === ""
          ? "le titre du voyage est vide"
          : "le titre du voyage n'est pas du texte",
      action: "donne-lui le titre qui s'affichera en tête de page",
    };
  }

  if (shape === "places[].name") {
    return {
      rule: "place-name",
      field,
      problem: `le lieu ${describeField(["places", indexAt(field, 1)])} n'a pas de nom`,
      action: "donne-lui son nom, tel qu'il s'affichera sur la carte",
    };
  }

  if (shape === "places[].countryCode") {
    return {
      rule: "country-code",
      field,
      problem: `${placeLabel(context, indexAt(field, 1))} porte le code pays ${writtenOr(context, field, "vide")}, qui n'est pas un code ISO 3166-1 alpha-2`,
      action: `écris-le sur deux lettres majuscules, ${quoted("JP")} pour le Japon`,
    };
  }

  if (shape === "places[]" && custom) {
    return {
      rule: "unreferenced-place",
      field,
      problem: `le lieu ${writtenOr(context, [...field, "slug"], describeField(field))} est déclaré mais aucune étape ne s'y rend`,
      action: "ajoute l'étape qui y passe, ou retire le lieu",
    };
  }

  if (COLLECTION_LABELS.has(shape)) {
    const what = COLLECTION_LABELS.get(shape) ?? shape;
    const value = valueAt(context.document, field);

    if (value !== undefined && !Array.isArray(value)) {
      return {
        rule: "collection-not-a-list",
        field,
        problem: `la clé ${quoted(shape)} n'est pas une liste`,
        action: `écris une entrée par ${what}, chacune précédée d'un tiret (${CONTENT_GUIDE})`,
      };
    }

    return {
      rule: "collection-empty",
      field,
      problem: `le voyage ne déclare aucun ${what}`,
      action: `déclare au moins un ${what} (${CONTENT_GUIDE})`,
    };
  }

  if (ENTRY_SHAPES.has(shape)) {
    return {
      rule: "entry-malformed",
      field,
      problem: `l'entrée ${describeField(field)} n'est pas décrite comme attendu`,
      action: `reprends la liste des clés attendues dans ${CONTENT_GUIDE}`,
    };
  }

  if (shape === "photos[].alt") {
    return {
      rule: "photo-alt",
      field,
      problem: `${photoLabel(context, indexAt(field, 1))} n'a pas de texte alternatif`,
      action: "décris l'image en une phrase : c'est tout ce qu'un lecteur d'écran annonce",
    };
  }

  if (shape === "photos[].src") {
    if (custom) {
      /**
       * Two `custom` rules land on this one field: the duplicate-source rule in
       * `checkTrip`, and the reserved-name refinement on `src` itself. Zod
       * reports both as `custom` with no distinguishing code, so the document
       * decides — a value that *is* a derivative name can only be the second.
       *
       * Order matters and it is this way round: a trip declaring
       * `tokyo-480.jpg` twice fails both rules, and "rename it" is the finding
       * that has to be read first, since removing the duplicate would leave the
       * name the command is about to overwrite.
       */
      const source = stringAt(context.document, field);
      if (source !== undefined && isDerivativeName(source)) {
        return diagnosePhotoDerivativeName(context, field);
      }

      return {
        rule: "duplicate-photo",
        field,
        problem: `deux photos ont la même source ${writtenOr(context, field, "identique")}`,
        action: "retire le doublon de photos[]",
      };
    }
    return {
      rule: "photo-src",
      field,
      problem: `${photoLabel(context, indexAt(field, 1))} n'a pas de source`,
      action: `écris le chemin depuis la racine du site, ${quoted("/photos/<voyage>/<image>.jpg")}`,
    };
  }

  if (shape === "coverPhotoSrc") {
    if (!custom) {
      return {
        rule: RULE_COVER_EMPTY,
        field,
        problem: "la photo de couverture est vide",
        action: "retire la clé, ou nomme une des photos de photos[]",
      };
    }
    return {
      rule: RULE_COVER_NOT_DECLARED,
      field,
      problem: `la photo de couverture ${writtenOr(context, field, "vide")} ne figure pas dans photos[]`,
      action: "ajoute-la à photos[], ou choisis une photo déjà déclarée",
    };
  }

  if (shape === "budget") {
    const value = valueAt(context.document, field);
    const expected = `${quoted("totalCents")}, ${quoted("currency")} et ${quoted("travellers")}`;

    return {
      rule: "budget-empty",
      field,
      problem:
        value === null || value === undefined
          ? `la clé ${quoted("budget")} est présente mais vide`
          : `le budget n'est pas décrit comme attendu`,
      action: `retire la clé ${quoted("budget")}, ou renseigne ${expected}`,
    };
  }

  if (shape === "budget.totalCents") {
    return {
      rule: "budget-total",
      field,
      problem: isAbsent(context, field)
        ? `le budget ne dit pas combien le voyage a coûté`
        : `le budget total ${quoted(written(context, field))} n'est pas un nombre entier de centimes`,
      action: "écris-le en centimes entiers : 4 200,50 € s'écrit 420050",
    };
  }

  if (shape === "budget.currency") {
    return {
      rule: "budget-currency",
      field,
      problem: `la devise ${writtenOr(context, field, "vide")} n'est pas un code ISO 4217`,
      action: `écris-la sur trois lettres majuscules, ${quoted("EUR")}`,
    };
  }

  if (shape === "budget.travellers") {
    return {
      rule: "budget-travellers",
      field,
      problem: isAbsent(context, field)
        ? "le budget ne dit pas entre combien de personnes il a été partagé"
        : `le nombre de voyageurs ${quoted(written(context, field))} n'est pas un entier d'au moins 1`,
      action: "indique le nombre de personnes qui ont partagé la dépense",
    };
  }

  /**
   * `draft` takes a bare boolean, and the mistake worth its own sentence is
   * `draft: "true"` between quotes: it is a *string*, and every non-empty string
   * is truthy in JavaScript, so accepting it would make `draft: "false"` hide a
   * published trip as effectively as `draft: "true"`. The fallback would answer
   * that with half a French sentence and the schema's English rule appended,
   * which is the one message shape this catalogue exists to avoid. No repair
   * command: there is none for this field, the line is two words long.
   */
  if (shape === "draft") {
    const value = valueAt(context.document, field);

    return {
      rule: "draft-not-boolean",
      field,
      problem:
        typeof value === "string"
          ? `${quoted("draft")} vaut la chaîne ${quoted(value)}, pas un booléen : toute chaîne non vide serait lue comme vraie`
          : `${quoted("draft")} vaut ${writtenOr(context, field, "vide")}, qui n'est pas un booléen`,
      action: `écris ${quoted("draft: true")} pour un brouillon ou ${quoted("draft: false")}, sans guillemets`,
    };
  }

  return undefined;
}

/**
 * Everything the catalogue above did not name. Two shapes only: a key that is
 * simply missing, and the honest admission that the rule is not translated —
 * with the schema's own sentence quoted as a detail rather than swallowed. A
 * message that hides what it knows is worse than a message in the wrong
 * language.
 */
function diagnoseFallback(issue: Issue, context: DiagnosisContext, field: FieldPath): Diagnosis {
  const name = describeField(field);

  if (isAbsent(context, field)) {
    return {
      rule: "field-missing",
      field,
      problem: `le champ ${quoted(name)} est absent`,
      action: `ajoute-le (${CONTENT_GUIDE})`,
    };
  }

  return {
    rule: "unmapped",
    field,
    problem: `la valeur de ${quoted(name)} est refusée par le schéma (règle : ${issue.message})`,
    action: `relis la structure attendue dans ${CONTENT_GUIDE}`,
  };
}

/**
 * One issue can produce several diagnoses: a strict object rejecting three
 * misspelled keys has three lines to write, one per key, each pointing at the
 * line that carries it.
 */
export function diagnose(issue: Issue, context: DiagnosisContext): readonly Diagnosis[] {
  const field = normalize(issue.path);

  if (issue.code === "unrecognized_keys") {
    const container = describeField(field);

    return issue.keys.map((key) => ({
      rule: "unknown-key",
      field: [...field, key],
      problem:
        container === ""
          ? `la clé ${quoted(key)} est inconnue`
          : `la clé ${quoted(key)} est inconnue dans ${container}`,
      action:
        "corrige son orthographe, ou retire la ligne : sans ce contrôle, elle serait ignorée en silence",
    }));
  }

  return [diagnoseKnownShape(issue, context, field) ?? diagnoseFallback(issue, context, field)];
}
