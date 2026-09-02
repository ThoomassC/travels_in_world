import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SlugSchema } from "@/domain/geo";
import { TRANSPORT_MODES } from "@/domain/schema";
import { displayPath, TRIP_FILE_NAME } from "./collection";

/**
 * `npm run new-trip <slug>` — the first thirty seconds of a new trip.
 *
 * The skeleton is **deliberately incomplete**: the cities have no coordinates.
 * That is not laziness, it is the loop this ticket exists to create — the author
 * names his cities, `npm run validate:content` refuses the file and names
 * `npm run geocode <slug>`, the coordinates get written, and the second
 * validation is green. A skeleton with plausible coordinates already in it would
 * validate, ship, and put a marker in the wrong hemisphere.
 *
 * Everything else about the file **is** valid, so that the only thing the author
 * ever has to react to is the thing he actually has to do.
 *
 * The comments are in French: they exist to be read by Thomas, not by this
 * repository. The code and these doc blocks stay in English like the rest.
 */

/** The two placeholder cities. Named so that they cannot geocode by accident. */
const FIRST_PLACE_SLUG = "ville-de-depart";
const SECOND_PLACE_SLUG = "ville-d-arrivee";

/**
 * The skeleton, as text rather than as a serialised object.
 *
 * Serialising would drop every comment, and the comments are most of the value
 * here: they are the only documentation that is guaranteed to be in front of the
 * author at the moment he needs it.
 */
export function tripSkeleton(options: { readonly slug: string; readonly today: string }): string {
  const { slug, today } = options;

  const geocode = `npm run geocode ${slug}`;
  const validate = "npm run validate:content";
  // The two arrows line up whatever the slug's length, because a slug can be
  // longer than the command next to it and a ragged block is a block nobody reads.
  const column = Math.max(geocode.length, validate.length);

  return `# ${slug} — squelette créé par « npm run new-trip ${slug} ».
#
# Remplis les valeurs ci-dessous, puis, dans cet ordre :
#   1. ${geocode.padEnd(column)} → écrit les coordonnées des villes
#   2. ${validate.padEnd(column)} → vérifie tout le reste
#
# La structure complète et les règles sont dans content/README.md.

slug: ${slug} # minuscules, chiffres et traits d'union : c'est l'URL du voyage
title: Titre du voyage, à remplir # ce qui s'affichera en tête de page
startDate: ${today} # premier jour du voyage, toujours écrit AAAA-MM-JJ
endDate: ${today} # dernier jour du voyage, jamais avant startDate

# Le jour de la mise en ligne du récit — pas la fin du voyage. Un voyage de 2019
# raconté aujourd'hui est une nouveauté pour le lecteur, et c'est cette date-là
# qui décide du badge « nouveau récit » et de l'ordre du flux RSS. La date du jour
# est déjà écrite ci-dessous : corrige-la si tu publies plus tard.
publishedAt: ${today}

# Un lieu par ville. Ne remplis pas « coordinates » à la main :
# « npm run geocode ${slug} » les écrit à partir du nom et du code pays, refuse
# (0, 0), et vérifie que le pays renvoyé est bien celui déclaré ici.
places:
  - slug: ${FIRST_PLACE_SLUG} # identifiant du lieu, cité par les étapes ci-dessous
    name: Ville de départ # le nom tel qu'il s'affichera, et celui que le géocodage cherche
    countryCode: FR # ISO 3166-1 alpha-2, deux lettres majuscules
  - slug: ${SECOND_PLACE_SLUG}
    name: Ville d'arrivée
    countryCode: FR

# Les étapes, dans l'ordre chronologique. Deux formes d'étape, et deux seulement :
#   - un séjour      « kind: stay » → placeSlug, startDate, endDate
#   - un déplacement « kind: move » → fromSlug, toSlug, mode, date
# L'itinéraire doit être continu : un déplacement part du lieu du séjour qui le
# précède et arrive au lieu du séjour qui le suit. Deux séjours de suite dans deux
# villes différentes veulent dire qu'il manque le déplacement entre les deux.
steps:
  - kind: stay
    placeSlug: ${FIRST_PLACE_SLUG}
    startDate: ${today}
    endDate: ${today}
  - kind: move
    fromSlug: ${FIRST_PLACE_SLUG}
    toSlug: ${SECOND_PLACE_SLUG}
    mode: train # liste fermée, un seul de ces modes : ${TRANSPORT_MODES.join(", ")}
    date: ${today}
  - kind: stay
    placeSlug: ${SECOND_PLACE_SLUG}
    startDate: ${today}
    endDate: ${today}

# Tout ce qui suit est facultatif : décommente ce dont tu as besoin.
#
# photos: # les fichiers vivent dans public/, le chemin est celui de l'URL
#   - src: /photos/${slug}/une-image.jpg
#     alt: Ce qu'un lecteur d'écran annoncera — obligatoire, jamais vide
#     width: 1600 # largeur en pixels ; « npm run index-photos ${slug} » la remplira
#     height: 1067 # hauteur en pixels, même chose
# coverPhotoSrc: /photos/${slug}/une-image.jpg # doit figurer dans photos[]
#
# budget:
#   totalCents: 420000 # en centimes entiers : 4 200,00 € s'écrit 420000
#   currency: EUR # ISO 4217, trois lettres majuscules
#   travellers: 2 # entre combien de personnes la dépense a été partagée
#
# tags: # mêmes règles qu'un slug, une étiquette par ligne
#   - asie
#   - train
#
# story: unwritten # le voyage a eu lieu, le récit n'est pas écrit
#   # Le voyage entre dans la carte et dans les listes — son pays est teinté, sa
#   # fiche porte ses dates et ses pays — mais il n'a PAS de page, et rien ne
#   # renvoie vers une : la fiche affiche « Récit à venir » au lieu d'un lien.
#   # Retire cette ligne le jour où tu écris le récit ; sans elle, il est publié.
#   #
#   # À ne pas confondre avec « draft: true », qui masque le voyage partout en
#   # production. Ici c'est l'inverse : le voyage est montré, et le fait que le
#   # texte n'est pas encore là est dit au lecteur. Voir content/README.md.
`;
}

export type ScaffoldRequest = {
  readonly contentDir: string;
  readonly repoRoot: string;
  readonly slug: string;
  /** The day the trip is dated, as `YYYY-MM-DD`. Injected so tests are stable. */
  readonly today: string;
};

export type ScaffoldOutcome =
  | { readonly state: "created"; readonly file: string; readonly slug: string }
  /** The domain refused the slug. Nothing was created, not even the folder. */
  | { readonly state: "invalid-slug"; readonly slug: string }
  | { readonly state: "exists"; readonly file: string; readonly existingName: string }
  | { readonly state: "failed"; readonly file: string; readonly reason: string };

/**
 * Creates `<contentDir>/<slug>/trip.yaml`.
 *
 * The slug is checked by `SlugSchema` — the domain's, not a second copy of the
 * pattern — **before** any path is joined. That ordering is the whole security
 * property: a slug is a path segment here, and `../../etc/passwd` is refused by
 * the same rule that refuses `Japon_2024`, because the pattern allows neither a
 * dot nor a slash.
 */
export function createTrip(request: ScaffoldRequest): ScaffoldOutcome {
  if (!SlugSchema.safeParse(request.slug).success) {
    return { state: "invalid-slug", slug: request.slug };
  }

  const directory = path.join(request.contentDir, request.slug);
  const absolutePath = path.join(directory, TRIP_FILE_NAME);
  const file = displayPath(request.repoRoot, absolutePath);

  /**
   * Compared against the real names on disk rather than through `existsSync`.
   * A macOS filesystem answers "yes" for `Trip.yaml`, so `existsSync` would
   * refuse a trip that does not exist on Linux — and, worse, the reverse: writing
   * `trip.yaml` next to an existing `Trip.yaml` gives a repository with two trip
   * files, one of which CI reads and the author's machine does not.
   */
  let entries: readonly string[] = [];
  try {
    entries = readdirSync(directory);
  } catch {
    // No directory yet, which is the normal case: nothing to collide with.
  }

  const existingName = entries.find((name) => name.toLowerCase() === TRIP_FILE_NAME.toLowerCase());
  if (existingName !== undefined) {
    return { state: "exists", file, existingName };
  }

  try {
    mkdirSync(directory, { recursive: true });
    // `wx`: fails rather than truncates if the file appeared between the check
    // above and this line. A trip is not something to overwrite on a race.
    writeFileSync(absolutePath, tripSkeleton({ slug: request.slug, today: request.today }), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (cause) {
    return {
      state: "failed",
      file,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }

  return { state: "created", file, slug: request.slug };
}
