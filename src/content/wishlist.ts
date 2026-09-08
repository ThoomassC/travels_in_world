import { readFileSync } from "node:fs";
import path from "node:path";
import { isSeq, LineCounter, parseDocument } from "yaml";
import {
  BASEMAP_VINTAGE,
  DRAWABLE_COUNTRY_CODES,
  FINER_BASEMAP_VINTAGES,
  FINER_VINTAGE_COUNTRY_CODES,
} from "@/basemap-coverage";
import { CountryCodeSchema } from "@/domain/geo";
import type { CountryCode } from "@/domain/geo";
import { isAssignedCountryCode } from "@/iso-3166";
import { displayPath } from "./collection";
import { escapeControls, quoted } from "./finding";
import type { ContentFinding, FieldPath, SourceLocation } from "./finding";

/**
 * **`content/wishlist.yaml` — the countries the journal wants to reach.**
 *
 * TIW-39 gave the map a third state. The two it already had are *derived*: a
 * country is tinted because a trip goes there, and the trip's `story` decides
 * which of the two tints it gets. « À venir » is derived from nothing — there is
 * no trip to read it off — so it is the first thing on this site that is content
 * without being a voyage, and it needed a file of its own.
 *
 * **Why a file and not a constant.** A list of four countries in a component is a
 * list nobody can change without a pull request against the drawing code, and the
 * whole premise of this repository is that the journal's content is data the
 * owner edits (`AGENTS.md`: "contenu en fichiers versionnés, aucune base de
 * données"). It also has to be *validated*: a code the basemap cannot draw makes
 * `buildWorldGeometry` throw mid-prerender, which is the exact circle TIW-29 spent
 * a ticket removing — so the same judgement has to be reachable from
 * `npm run validate:content`, before the build.
 *
 * **The split this file follows** is the one `src/content/loader.ts` states: it
 * *reads and judges*, returning findings, and it never decides what to do about
 * them. `src/content/validate.ts` prints them with a file and a line;
 * {@link loadWishedCountries} throws on them, which is what the build meets. One
 * verdict, two presentations, so the command and the build can never disagree.
 *
 * **No `import "server-only"`**, deliberately and for the same reason as every
 * other module here: `npm run validate:content` loads it under plain Node, where
 * that package throws at resolution. The guard is on `src/content/trips.ts`, the
 * one door `src/**` may use.
 */

export const WISHLIST_FILE_NAME = "wishlist.yaml";

/** The key the file hangs its list on. Named once: two spellings would be a bug. */
const LIST_KEY = "countries";

/**
 * Where the wishlist lives, given the **trips** directory.
 *
 * A sibling of `content/trips/` and not a file inside it, and the reason is the
 * published interface rather than taste: `TIW_CONTENT_DIR` and `--content
 * <dossier>` both name the trips directory (`content/README.md` documents them
 * that way, and `src/content/loader.ts` resolves them that way), and
 * `readTripCollection` refuses a loose `.yaml` at that root as a stray file. So
 * the wishlist has to be one level up — which is also what makes a fixture that
 * redirects the trips directory get *that fixture's* wishlist rather than the
 * repository's, with no second environment variable to keep in step.
 */
export function wishlistPathFor(tripsDir: string): string {
  return path.join(path.dirname(tripsDir), WISHLIST_FILE_NAME);
}

/**
 * One accepted line of the file: the code, and where it was written.
 *
 * The position travels with the code because the *last* judgement on a wish is
 * not made here — `src/content/validate.ts` refuses a country that a trip already
 * visits, and it can only do that once it has read the trips. Handing back the
 * codes alone made it file that finding against `countries[n]` where `n` was the
 * index among the *accepted* entries, which drifts from the file's own numbering
 * the moment one line above it is refused: a finding pointing at the wrong line.
 */
export type WishlistEntry = {
  readonly code: CountryCode;
  /** The path a message prints — `countries[2]`, the file's own numbering. */
  readonly field: FieldPath;
  readonly location?: SourceLocation;
};

export type WishlistReading = {
  /** The accepted lines, in file order, each still knowing where it came from. */
  readonly entries: readonly WishlistEntry[];
  /** The same codes, for the callers that only want the list. */
  readonly countryCodes: readonly CountryCode[];
  /** Empty when the file is fine — or when there is no file at all. */
  readonly problems: readonly ContentFinding[];
};

/**
 * Reads the wishlist beside `tripsDir` and judges every entry.
 *
 * **An absent file is an empty list and not a finding, and that is the only
 * fail-open decision here.** A journal with nothing on its wish list is the
 * ordinary case: it is the state of every fixture in this repository and was the
 * state of the repository itself until this ticket, so a missing file must not
 * make `npm run validate:content` red. The cost is real and is pinned by a test
 * of its own — rename the file and the map silently loses its third state — which
 * is why an *empty* file is refused: someone wrote it, so they meant something by
 * it.
 *
 * Everything the caller could act on is reported, never just the first: an author
 * with three bad codes should not need three runs to see three lines.
 *
 * `repoRoot` only shortens the path a message prints. It defaults to the working
 * directory, which is what both consumers already are — `scripts/validate-content.ts`
 * resolves it from the repository root and `next build` runs there too.
 */
export function readWishlist(tripsDir: string, repoRoot: string = process.cwd()): WishlistReading {
  const absolutePath = wishlistPathFor(tripsDir);
  const file = displayPath(repoRoot, absolutePath);

  let source: string;
  try {
    source = readFileSync(absolutePath, "utf8");
  } catch (cause) {
    /**
     * `ENOENT` is the ordinary case above. Anything else — a permission, a
     * directory where a file belongs — is a file that exists and cannot be read,
     * and treating that as "no wishlist" would advertise the fix as "create it"
     * for a file already there. Same distinction `readTripFile` draws.
     */
    return errorCode(cause) === "ENOENT"
      ? { entries: [], countryCodes: [], problems: [] }
      : {
          entries: [],
          countryCodes: [],
          problems: [
            {
              file,
              problem: `le fichier n'est pas lisible : ${escapeControls(errorMessage(cause))}`,
              action: "vérifie les droits du fichier",
            },
          ],
        };
  }

  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter });

  if (document.errors.length > 0) {
    const [first] = document.errors;

    return {
      entries: [],
      countryCodes: [],
      problems:
        first === undefined
          ? []
          : [
              {
                file,
                // The first error only: a parser that has lost its footing
                // reports every line after it, and nine of ten are consequences.
                problem: `le fichier n'est pas du YAML valide : ${escapeControls(
                  (first.message.split("\n")[0] ?? first.message).replace(
                    / at line \d+, column \d+:?$/,
                    ""
                  )
                )}`,
                action: `corrige la syntaxe de ${quoted(file)}`,
                ...(first.linePos === undefined
                  ? {}
                  : { location: { line: first.linePos[0].line, column: first.linePos[0].col } }),
              },
            ],
    };
  }

  const list = document.get(LIST_KEY, true);

  if (!isSeq(list)) {
    return {
      entries: [],
      countryCodes: [],
      problems: [
        {
          file,
          field: [LIST_KEY],
          problem:
            document.get(LIST_KEY) === undefined
              ? `le fichier ne déclare pas de liste ${quoted(LIST_KEY)}`
              : `${quoted(LIST_KEY)} n'est pas une liste`,
          action: `écris une liste de codes pays, un par ligne, sous ${quoted(`${LIST_KEY}:`)} — par exemple ${quoted("- HR")}`,
        },
      ],
    };
  }

  const entries: WishlistEntry[] = [];
  const problems: ContentFinding[] = [];
  const seen = new Set<string>();

  list.items.forEach((item, index) => {
    const field: FieldPath = [LIST_KEY, index];
    const at = { file, field, ...locate(lineCounter, item) };
    const written = scalarOf(item);

    if (written === undefined) {
      problems.push({
        ...at,
        problem: `l'entrée ${index + 1} n'est pas un code pays écrit en toutes lettres`,
        action: "écris le code ISO 3166-1 alpha-2 du pays, en deux capitales, sur sa propre ligne",
      });
      return;
    }

    const parsed = CountryCodeSchema.safeParse(written);

    if (!parsed.success) {
      problems.push({ ...at, ...malformedCode(written) });
      return;
    }

    const code = parsed.data;

    if (!DRAWABLE_COUNTRY_CODES.has(code)) {
      problems.push({
        ...at,
        ...(isAssignedCountryCode(code) ? undrawableCode(code) : unassignedCode(code)),
      });
      return;
    }

    if (seen.has(code)) {
      problems.push({
        ...at,
        problem: `${quoted(code)} est déclaré deux fois : la carte ne peut pas le teinter deux fois`,
        action: "retire cette ligne",
      });
      return;
    }

    seen.add(code);
    entries.push({ code, field, ...locate(lineCounter, item) });
  });

  return { entries, countryCodes: entries.map((entry) => entry.code), problems };
}

/**
 * The same reading, for a caller with nowhere to print a finding: the codes, or a
 * throw naming every problem.
 *
 * This is what the build meets. It is not a second judgement — every sentence
 * comes from {@link readWishlist} — only a second *presentation*, which is the
 * split `src/content/loader.ts` describes between itself and the validator.
 */
export function loadWishedCountries(tripsDir: string, repoRoot?: string): readonly CountryCode[] {
  const { countryCodes, problems } = readWishlist(tripsDir, repoRoot);

  if (problems.length === 0) {
    return countryCodes;
  }

  throw new Error(
    [
      `${problems.length === 1 ? "Un problème" : `${problems.length} problèmes`} dans ${WISHLIST_FILE_NAME} :`,
      ...problems.map((finding) => `  ${finding.file} — ${finding.problem}. ${finding.action}.`),
      `« npm run validate:content » nomme ces défauts avec leur ligne, et il tourne avant tout ` +
        `« npm run build » (script « prebuild ») : si tu lis ce message, c'est que le build a été lancé sans lui.`,
    ].join("\n")
  );
}

/* ------------------------------------------------------------- the wordings -- */

/**
 * Not two capitals at all. The casing slip gets its own sentence for the reason
 * `src/map/world.ts` gives about `jp`: telling an author "no country bears this
 * code" when the code is right and the shift key was not is both false and a dead
 * end.
 */
function malformedCode(written: string): Pick<ContentFinding, "problem" | "action"> {
  const upperCased = written.toUpperCase();

  if (upperCased !== written && DRAWABLE_COUNTRY_CODES.has(upperCased)) {
    return {
      problem: `${quoted(written)} n'est pas reconnu parce qu'il n'est pas en majuscules`,
      action: `écris ${quoted(upperCased)} : la norme ISO 3166-1 alpha-2 est en capitales, et les codes sont comparés caractère pour caractère`,
    };
  }

  return {
    problem: `${quoted(written)} n'est pas un code ISO 3166-1 alpha-2 : ce n'est pas deux lettres majuscules`,
    action: `écris le code du pays en deux capitales — ${quoted("HR")} pour la Croatie, ${quoted("PT")} pour le Portugal`,
  };
}

/** Well formed, and assigned to nobody. */
function unassignedCode(code: string): Pick<ContentFinding, "problem" | "action"> {
  return {
    problem: `le code ${quoted(code)} n'est attribué à aucun pays par l'ISO 3166-1 alpha-2 : la carte n'a aucune forme à teinter`,
    action: "écris les deux capitales que la norme attribue au pays, ou retire la ligne",
  };
}

/**
 * A real country the shipped basemap has no shape for. The wording deliberately
 * does not read like the one above it: told "this code is assigned to nobody" the
 * author hunts a typo that is not there.
 *
 * The way out is priced rather than suggested, exactly as `src/content/validate.ts`
 * prices it for a trip — and it is a *shorter* list here, because a wishlist entry
 * has nothing to reattach: there is no place, no trip and no itinerary, only the
 * line itself.
 */
function undrawableCode(code: string): Pick<ContentFinding, "problem" | "action"> {
  return {
    problem:
      `le code ${quoted(code)} est bien attribué par l'ISO 3166-1 alpha-2, mais le fond de carte du site, ` +
      `${quoted(`world-atlas ${BASEMAP_VINTAGE}`)}, n'a aucune forme pour lui : il n'y a rien à teinter`,
    action: FINER_VINTAGE_COUNTRY_CODES.has(code)
      ? `retire la ligne. Le millésime ${quoted(FINER_BASEMAP_VINTAGES[0])} du même paquet le dessinerait, mais il porte ` +
        `les tracés de 182,6 à 512,6 Kio brotli pour un plafond de 200 Kio : c'est une décision de budget, pas une option de contenu`
      : `retire la ligne. Changer de millésime n'y ferait rien : aucun de ceux que world-atlas livre ` +
        `(${[BASEMAP_VINTAGE, ...FINER_BASEMAP_VINTAGES].join(", ")}) ne porte de forme pour ce code`,
  };
}

/* ---------------------------------------------------------------- the plumbing -- */

/** The scalar text of a sequence item, or `undefined` for a map, a list or a null. */
function scalarOf(item: unknown): string | undefined {
  if (typeof item === "object" && item !== null && "value" in item) {
    const { value } = item as { readonly value: unknown };

    return typeof value === "string" ? value : undefined;
  }

  return typeof item === "string" ? item : undefined;
}

/**
 * The line a list item was written on.
 *
 * The *item's* own position and not its key's, which is the distinction
 * `src/content/collection.ts` records for maps: a sequence item has no key, and
 * its first byte is the value itself, so there is no next-line drift to correct
 * here.
 */
function locate(lineCounter: LineCounter, item: unknown): { location?: SourceLocation } {
  if (typeof item !== "object" || item === null || !("range" in item)) {
    return {};
  }
  const { range } = item as { readonly range: unknown };
  const start = Array.isArray(range) ? range[0] : undefined;

  if (typeof start !== "number") {
    return {};
  }
  const position = lineCounter.linePos(start);

  return { location: { line: position.line, column: position.col } };
}

function errorCode(cause: unknown): string | undefined {
  return typeof cause === "object" && cause !== null && "code" in cause
    ? String((cause as { readonly code: unknown }).code)
    : undefined;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
