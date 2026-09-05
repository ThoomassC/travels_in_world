import path from "node:path";
import { TripSchema, VisitedPlacesSchema } from "@/domain/schema";
import type { Place, Trip } from "@/domain/schema";
import { detailOf, hasStory, summaryOf } from "@/domain/trip";
import type { TripDetail, TripSummary } from "@/domain/trip";
import {
  displayPath,
  readTripCollection,
  readVisitedPlacesFile,
  VISITED_PLACES_FILE_NAME,
} from "./collection";
import type { TripFile, VisitedPlacesFile } from "./collection";
import { describeField } from "./finding";
import type { FieldPath } from "./finding";

/**
 * The loading façade: the one seam that makes "content in files" a reversible
 * decision. Five functions, and nothing else in the application knows where the
 * content comes from — the day it moves to PostgreSQL, only these five
 * implementations change and no caller is touched.
 *
 * **Five since TIW-36, and the fifth one is not a fourth of the same kind.** The
 * four original doors split in two pairs (TIW-18): two of them *render*, two of
 * them *refuse an address*. `listVisitedPlaces` is a rendering door with **no
 * refusing counterpart at all**, and that asymmetry is the guarantee rather than
 * an omission — see the note on the function itself. It also reads a second
 * collection, `content/places.yaml`, whose relation to the first is a refusal:
 * `assertDisjointFromVisitedPlaces`.
 *
 * **Why they are `async` when the read is synchronous.** That reversibility is
 * the whole reason. `readTripCollection` is `fs`-synchronous today, so nothing
 * here awaits anything; but synchronous *signatures* would make the swap
 * impossible without rewriting every page that consumes them. The `async` is the
 * seam, not an implementation detail.
 *
 * **Why the `server-only` guard is not here.** This module is loaded by Vitest
 * and by plain Node — `npm run validate:content` runs under
 * `scripts/runtime/register-typescript.mts`, outside React, where `server-only`
 * throws outright. That command is the one that is true *today*: on this branch
 * `package.json` maps `geocode` to `scripts/not-implemented.mjs`, so it loads
 * nothing. TIW-10 lands the real one — it merges before this branch and reads
 * `src/content/**` the same way, which makes it a second reason rather than a
 * different one. The guard lives on `src/content/trips.ts`, which is the only
 * module under `@/content/` the rest of `src/**` may import (an ESLint boundary
 * refuses every other route — from any folder, including the ones that do not
 * exist yet — and `tests/lint/content-facade.test.ts` proves it refuses).
 *
 * **What this module deliberately does not do: it is not `validateContent`.** The
 * frontier between the two is one criterion, not a list of rules: *this module
 * refuses everything it can decide from what it has already read.* The validator
 * owns the two families it cannot — what needs a further trip to the disk (does a
 * declared photo file exist, does the case of a path match what the filesystem
 * holds), and what needs a line, a column and a French sentence per finding
 * instead of one throw on the first problem.
 *
 * That criterion is why three rules are stated on both sides, and they are a
 * consequence of it rather than three exceptions to justify one by one:
 *
 *   rule                      | here                    | in `validate.ts`
 *   --------------------------|-------------------------|---------------------------
 *   a slug declared twice     | throws, naming both     | `duplicateSlugFindings`
 *   a `.yaml` loose at the root | throws                | `strayFileFindings`
 *   a `__proto__` key         | throws                  | `unsafeKeyFindings`
 *
 * All three are decidable from the collection already in hand, so this module
 * refuses them — it is the thing that would otherwise *act* on them. Where the
 * wording is user-visible it is copied from `validate.ts` verbatim rather than
 * rephrased: the same rule seen twice must not read as two different rules.
 *
 * **Who runs the validator, since TIW-22.** This paragraph used to say that
 * nothing did, and that a fault therefore shipped to production. Both halves are
 * now false, and the correction matters more than the original claim: a reader who
 * trusts a stale "nothing is guarded" note mis-prices every risk below it.
 *
 * `npm run validate:content` runs in three places today — `pretest`, so `npm test`
 * pays for it; `.github/workflows/ci.yml`, as its own step, so a broken trip shows
 * up as a red check naming the file, the line and the command; and `vercel.json`'s
 * `buildCommand`, ahead of `next build`, which is the one that covers content
 * reaching `main` without a pull request.
 *
 * What remains true is the *family* of faults this module cannot see, and the
 * validator can: a declared photo whose file is missing, or whose path differs
 * from the file's only by case. The likely spelling is a case-insensitive macOS
 * working tree deployed onto a case-sensitive Linux host, where the image is there
 * locally and 404s online. That one is now caught before the deployment rather
 * than after it — which is the whole difference TIW-22 bought.
 *
 * **What it never hands back.** Only domain values — `TripDetail`, `TripSummary`,
 * `{ slug }`. No type from `./collection` appears in an exported signature, and
 * that is a rule rather than a coincidence: a `TripFile` carries `locate`, a
 * *function*, so it is not serialisable and cannot cross the RSC boundary at all,
 * and it also carries the file's raw parsed value, which would travel into the
 * payload sent to the browser. The reading type stays internal to this module.
 */

export type { TripDetail, TripSummary } from "@/domain/trip";

/** The command that explains any refusal below, quoted in every message. */
const VALIDATE_COMMAND = "npm run validate:content";

/**
 * Loud, always, and with the two things the author needs: *which file*, and *the
 * command that explains it*. A trip that disappears from the map in silence is
 * the defect this whole content pipeline exists to prevent, and "the build
 * failed" without a path is an invitation to re-run the build.
 */
function contentError(where: string, problem: string): Error {
  return new Error(`${where} : ${problem}. Lance « ${VALIDATE_COMMAND} » pour le détail.`);
}

/**
 * Paths are printed relative to the repository root, POSIX-separated, exactly as
 * the validator prints its findings — so the same file is named the same way by
 * the build and by the command the build tells you to run.
 */
function repositoryRoot(): string {
  return process.cwd();
}

/**
 * The visited-places file: `TIW_PLACES_FILE` when set and not blank,
 * `content/places.yaml` otherwise (TIW-36).
 *
 * **A file and not a directory**, and deliberately *beside* `content/trips`
 * rather than inside it: the trips root refuses a loose `.yaml` at its own level
 * — a trip is a directory — so a places file dropped in there would be reported
 * as content nobody reads.
 *
 * The blank-string trap and the `.trim()` are {@link contentRoot}'s, for its
 * reasons, and they are repeated here rather than shared because the fallback
 * differs and a helper taking both would read worse than two eight-line
 * functions. What must not differ is the *treatment* of a blank value, so the
 * suite asserts it on both names.
 */
function placesFile(): string {
  const configured = process.env.TIW_PLACES_FILE;

  return configured === undefined || configured.trim() === ""
    ? path.join(process.cwd(), "content", VISITED_PLACES_FILE_NAME)
    : path.resolve(configured);
}

/**
 * `TIW_CONTENT_DIR` when set **and not blank**, `content/trips` otherwise.
 *
 * The empty string is the trap the explicit test exists for: it is "set" as far
 * as `!== undefined` and `??` are concerned, so the natural
 * `process.env.TIW_CONTENT_DIR ?? fallback` resolves the root to `""` and reads
 * the working directory instead of the content one.
 *
 * **`.trim()`, and the CLI is what decides that.** `content/README.md` documents
 * this variable, so it is a published interface, and
 * `scripts/validate-content.ts` reads it through a `fromEnvironment` that treats
 * `value.trim() === ""` as unset. Testing `=== ""` here instead gave the same
 * name two contracts: `TIW_CONTENT_DIR=" "` had the command validate
 * `content/trips` while the build read `<cwd>/ `. One command and one build must
 * never read two different collections, so the looser of the two spellings wins
 * and it is the CLI's.
 *
 * The value itself is passed to `path.resolve` untrimmed, exactly as the CLI
 * passes it on: trimming the blanks off a path that is *not* blank would be this
 * module inventing a third contract.
 */
function contentRoot(): string {
  const configured = process.env.TIW_CONTENT_DIR;

  return configured === undefined || configured.trim() === ""
    ? path.join(process.cwd(), "content", "trips")
    : path.resolve(configured);
}

/* ---------------------------------------------------------------- the reading -- */

/**
 * Why a file could not become a trip, in the words the message will use.
 *
 * **A `switch` with a `never` default, and not the `if`/`if`/`if` this was.** The
 * chain ended in a fallthrough to the `malformed` wording, so the compiler only
 * objected to a new `TripFile` state if that state lacked a `problems` field —
 * and a new *reading* state naturally carries a list of problems. Measured on
 * the shape of the type: adding one with `problems` compiled clean and every
 * file in that state was reported as "YAML invalide", which is a wrong sentence
 * rather than a missing one.
 *
 * The `default` below is what makes the next state a **compile** error: `const
 * unexpected: never = file` stops accepting `file` the moment the union has a
 * member no `case` removed. The typing is the reminder, not a reviewer.
 */
function unreadableFileProblem(file: Exclude<TripFile, { state: "parsed" }>): string {
  switch (file.state) {
    case "absent":
      return file.similarName === undefined
        ? "le fichier « trip.yaml » est absent du dossier du voyage"
        : `le fichier s'appelle « ${file.similarName} », pas « trip.yaml »`;

    case "unreadable": {
      const what = file.scope === "directory" ? "le dossier du voyage" : "le fichier";

      return `${what} n'est pas lisible : ${file.reason}`;
    }

    case "broken-link":
      return "le dossier du voyage est un lien symbolique cassé";

    case "malformed": {
      // The first YAML problem only. The parser reports every line after the one
      // it lost its footing on, and a consequence carries no information.
      const [first] = file.problems;

      return `YAML invalide${first === undefined ? "" : ` : ${first.message}`}`;
    }

    default: {
      const unexpected: never = file;

      throw new Error(`état de fichier non traité : ${JSON.stringify(unexpected)}`);
    }
  }
}

/** Keys JavaScript reads as instructions rather than as data. */
const UNSAFE_KEYS: readonly string[] = ["__proto__"];

/**
 * Unsafe keys in the **materialised** value — the object the consumers would
 * actually receive — rather than in the YAML document.
 *
 * **Why this exists beside `file.unsafeKeys`, which does the same thing.** The
 * document walk in `collection.ts` identifies a key through `keyName`, which
 * reads `key.value`; an **Alias** node has no `.value`, so the walk answers
 * `undefined` and `continue`s without descending — while `toJS()` resolves the
 * alias and puts the key down as an ordinary own property. Measured, on an
 * anchor that is legitimate because `title` really is a string:
 *
 *     title: &k __proto__
 *     # … a valid trip …
 *     *k :
 *       polluted: yes
 *
 *     unsafeKeys: []                      hasOwn __proto__: true
 *     Object.keys: [… , "__proto__"]      schema ok: true      loader ACCEPTED
 *     npm run validate:content → « 1 voyage validé, aucun problème. »
 *
 * `Object.keys` cannot be fooled that way: it is asked of the same object the
 * pages would be handed, so a key it does not report is not there. That is what
 * makes the invariant claimed in `readTrips` — *refusing here means the value
 * does not circulate at all* — true rather than aspirational.
 *
 * The check is decided **here** and not in `collection.ts`: that module's AST
 * walk is still the useful one for the validator, which needs the *line* a key
 * was written on, and it belongs to another branch.
 *
 * `Reflect.get` and never `node[key]`: `key` comes out of the file, and indexing
 * a bare object with a key from a file is the exact reading this function exists
 * to refuse.
 *
 * `seen` is not a micro-optimisation, and this is the second thing measured here:
 * `parse("a: &x\n  b: *x")` **succeeds** and hands back an object where
 * `value.a.b === value.a`. A plain recursion over that never returns, and a build
 * that hangs is the least legible failure there is — no message, no exit code, no
 * line. The schema would have refused the trip a moment later; it never gets the
 * chance. A subtree reached twice is therefore walked once, so a repeated anchor is
 * reported at the first of its paths: "is there an unsafe key" is what the caller
 * asks, and one path answers it.
 */
function unsafeKeysIn(value: unknown, at: FieldPath = []): readonly FieldPath[] {
  const found: FieldPath[] = [];
  const seen = new Set<object>();

  const walk = (node: unknown, field: FieldPath): void => {
    if (typeof node !== "object" || node === null || seen.has(node)) {
      return;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((entry: unknown, index) => walk(entry, [...field, index]));

      return;
    }

    for (const key of Object.keys(node)) {
      if (UNSAFE_KEYS.includes(key)) {
        found.push([...field, key]);
      }
      walk(Reflect.get(node, key), [...field, key]);
    }
  };

  walk(value, at);

  return found;
}

/**
 * One wording for one rule, whichever of the two checks saw the key.
 *
 * The sentence is `unsafeKeyFindings`' sentence word for word — the same rule
 * seen twice must not read as two different rules, which is the criterion stated
 * at the top of this file. The path is appended only when there is one to append:
 * the validator answers with a line and a column, which this layer does not have,
 * so a nested key needs *something* to say where it landed.
 */
function unsafeKeyProblem(field: FieldPath): string {
  const key = String(field.at(-1));
  const sentence = `la clé « ${key} » est refusée : elle réécrirait le prototype de l'objet au chargement, et aucun schéma ne peut la voir`;

  return field.length > 1 ? `${sentence} (${describeField(field)})` : sentence;
}

/**
 * Reads the collection and turns it into parsed trips, in the order the listings
 * publish them. Throws on anything it cannot turn into a trip.
 *
 * Synchronous on purpose, and that is what implements "do not memoise a
 * rejection": it throws *before* the caller inserts anything into the memo, so a
 * broken file leaves no trace. That matters on the one path where a memo exists at
 * all — a production build, where a refused collection must not be remembered as
 * an answer. Under `next dev` nothing is memoised in the first place; see
 * {@link memoisedTrips}.
 */
function readTrips(contentDir: string): readonly Trip[] {
  const repoRoot = repositoryRoot();
  const collection = readTripCollection(contentDir);
  const where = displayPath(repoRoot, contentDir);

  /**
   * A directory that does not exist is not an empty collection. Answering "no
   * trips" for a mistyped path is how a deployment ships an empty site with a
   * green build.
   */
  if (collection.state === "missing-directory") {
    throw contentError(where, "le répertoire de contenu est introuvable");
  }
  if (collection.state === "unreadable-directory") {
    throw contentError(where, `le répertoire de contenu n'est pas lisible : ${collection.reason}`);
  }

  // A `.yaml` alone in the content root is not a trip — a trip is a directory —
  // so it is content nobody will ever read.
  const [stray] = collection.strayFiles;
  if (stray !== undefined) {
    throw contentError(
      displayPath(repoRoot, path.join(contentDir, stray)),
      "un voyage est un dossier contenant « trip.yaml », pas un fichier isolé : celui-ci n'est lu par personne"
    );
  }

  /** Declared slug → the file that declared it first, to name both in a clash. */
  const owners = new Map<string, string>();
  const trips: Trip[] = [];

  for (const file of collection.files) {
    const fileWhere = displayPath(repoRoot, file.absolutePath);

    if (file.state !== "parsed") {
      throw contentError(fileWhere, unreadableFileProblem(file));
    }

    /**
     * The one hole in "an unknown key is an error", closed here because it can
     * be closed nowhere else: assigning `__proto__` never creates an own
     * property, so `z.strictObject` never sees the key and `safeParse` *succeeds*
     * on `{ …, __proto__ }`. `collection.ts` therefore reports it from the YAML
     * document, which still has the key.
     *
     * The reading itself is sound — `yaml.toJS()` puts `__proto__` down as an
     * ordinary own enumerable property and the object's prototype is untouched
     * (measured in block, flow, quoted and merge-key spellings). The danger is
     * deferred: it appears in a *consumer* that does `Object.assign(target,
     * value)`, which does honour an own `__proto__` and rewrites the target's
     * prototype. Refusing here means the value never circulates at all — and
     * downstream of it, this module builds domain objects field by field
     * (`summaryOf`, `detailOf`), never with `Object.assign`, which is the rule
     * that keeps the second half of that pair true.
     *
     * `__proto__` is the only key in that set, and correctly so: `constructor:`
     * and `prototype:` are ordinary own properties that `z.strictObject` already
     * reports as unknown keys.
     *
     * The wording of both refusals lives in {@link unsafeKeyProblem}: it is
     * `unsafeKeyFindings`' sentence word for word, because an author who meets
     * this rule from the build and from the validator must not read two different
     * explanations of one refusal.
     *
     * **Two checks, and they catch different files.** The document walk first,
     * because it names the key *as it was written*, from the YAML node itself.
     * Then the same question asked of the materialised value, which is the only
     * one an alias cannot slip past — see {@link unsafeKeysIn} for the measured
     * spelling that walks straight through the first check. Neither is redundant:
     * the first is the better message, the second is the one that cannot be
     * fooled.
     */
    const [declaredUnsafeKey] = file.unsafeKeys;
    if (declaredUnsafeKey !== undefined) {
      throw contentError(fileWhere, unsafeKeyProblem(declaredUnsafeKey));
    }

    const [materialisedUnsafeKey] = unsafeKeysIn(file.value);
    if (materialisedUnsafeKey !== undefined) {
      throw contentError(fileWhere, unsafeKeyProblem(materialisedUnsafeKey));
    }

    /**
     * `TripSchema.parse` and nothing looser. The ADR makes it an obligation: a
     * `Trip` circulates as a value that came out of `TripSchema.parse()`, never
     * as a raw YAML object — `yaml` hands back `any`, so this is the line that
     * stops it spreading.
     */
    const parsed = TripSchema.safeParse(file.value);
    if (!parsed.success) {
      throw contentError(fileWhere, "le voyage est refusé par le schéma");
    }
    const trip = parsed.data;

    /**
     * A slug is a URL, and two trips claiming one would make `findTrip` pick one
     * of them in silence. `TripSchema` sees a single trip and cannot know this;
     * `validateContent` reports it too, but this façade is the thing that would
     * *act* on the ambiguity, so it refuses on its own account.
     */
    const owner = owners.get(trip.slug);
    if (owner !== undefined) {
      throw contentError(
        fileWhere,
        `le slug « ${trip.slug} » est déjà déclaré par ${owner} : c'est la même URL pour deux voyages`
      );
    }
    owners.set(trip.slug, fileWhere);

    trips.push(trip);
  }

  return trips.sort(byMostRecentThenSlug);
}

/**
 * Descending start date, ascending slug for a tie — the order of the home page,
 * of the trip listing and of the sitemap alike. Applied **once**, here, when the
 * memo is built: sorting in each of the three functions instead would state the
 * same guarantee in three places, and three places is where two of them drift.
 *
 * Raw string comparison on the dates, because `YYYY-MM-DD` is fixed-width,
 * zero-padded and most-significant first, so lexicographic order *is*
 * chronological order. `<` and `>` rather than `localeCompare`, whose order
 * depends on the runtime's locale data — the same reasoning as
 * `visitedCountryCodes`.
 *
 * The tie-break is the half nobody writes: `sort` is stable in every engine this
 * project runs on, so a comparator answering 0 for two same-day trips *looks*
 * deterministic while it silently falls back on directory order.
 */
function byMostRecentThenSlug(left: Trip, right: Trip): number {
  if (left.startDate !== right.startDate) {
    return left.startDate < right.startDate ? 1 : -1;
  }

  return left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0;
}

/* ------------------------------------------------------------- environment -- */

/**
 * The one environment name that changes what this module does, shared by the two
 * predicates below rather than written twice.
 *
 * **Two predicates and not one, deliberately.** They answer different questions:
 * one is about *what a visitor may see*, the other about *whether the answer may
 * be frozen for the life of the process*. The first is a correctness decision
 * about private content, the second a performance one — a wrong answer costs a
 * re-read. A single predicate doing both would be one function whose name talks
 * about drafts deciding when the disk is read again, and the day one threshold
 * moves the other would move with it by accident.
 */
const PRODUCTION_ENVIRONMENT = "production";

/** `next build` stamps this, whatever `NODE_ENV` holds. Measured: not inlined. */
const PRODUCTION_BUILD_PHASE = "phase-production-build";

/**
 * Whether a draft may be served, decided by an **allowlist** and never by "any
 * environment that is not production", read on every call so a change between two
 * calls changes the answer rather than serving a stale verdict.
 *
 * **Why fail-closed, when a build demonstrably cannot leak.** Three facts,
 * measured on this branch through a probe page that really called
 * `listTripSummaries()`, with `NODE_ENV=test npm run build` and a key the bundler
 * cannot fold:
 *
 *   fact                                       | where it comes from
 *   -------------------------------------------|--------------------------------------------
 *   a pre-set `NODE_ENV` survives              | `node_modules/next/dist/bin/next:84`
 *     (`real="test"`)                          | `process.env.NODE_ENV ||= defaultEnv`
 *   `process.env.NODE_ENV` is **inlined** as   | `node_modules/next/dist/build/define-env.js`
 *     `"production"` in the server bundle      |
 *   `NEXT_PHASE=phase-production-build` is set | `node_modules/next/dist/build/index.js:1212`
 *     and is **not** inlined                  |
 *
 * So the leak does not reproduce *through `next build`* — the bundler happens to
 * replace the read with a literal. That is a guarantee borrowed from a bundler
 * implementation detail rather than written here, and it does not cover the
 * consumers that are not bundled: Vitest today, and tomorrow the first plain Node
 * script that calls `loadTrips()` (sitemap, feed, photo indexing). It also does
 * not cover `next build --debug-prerender`, which sets `NODE_ENV=development`.
 *
 * Hence the order below: an explicit answer **capped by `VERCEL_ENV`**, then the
 * build signal, then the two environments that are demonstrably not a deployment.
 * Do **not** simplify this to `NODE_ENV !== "production"` or
 * `NODE_ENV !== "development"` — the table above is why the shape is an allowlist
 * and not a negation, and the cap on the explicit answer has its own note below:
 * it is the one clause that answers a misconfiguration rather than a code path.
 *
 * Under Vitest `NODE_ENV` is `"test"`, so drafts stay visible in the suite by
 * design: a test that wants the production behaviour says so. A façade that hid
 * drafts under "not development" would make the whole suite blind to every draft
 * it means to assert on.
 */
function showsDrafts(): boolean {
  const asked = process.env.TIW_DRAFTS;

  /**
   * An explicit answer wins — **except against the production deployment**, and
   * that exception is the whole point of the clause.
   *
   * `TIW_DRAFTS=hidden npm run dev` is how an author sees what will actually be
   * online without paying for a build, and it stays absolute: asking for *less*
   * can never leak.
   *
   * Asking for *more* is capped, because the failure is a hand slip nobody would
   * ever see. Measured on this branch: `TIW_DRAFTS=visible VERCEL_ENV=production
   * npx next build` prerenders the draft and writes its title into the HTML —
   * the explicit answer used to outrank both `NEXT_PHASE` and `VERCEL_ENV`. What
   * makes that likely rather than theoretical is the Vercel dashboard itself: its
   * add-a-variable form ticks **Production, Preview and Development by default**,
   * so a variable set once to review a draft on a preview URL publishes it to the
   * production site too, with a green CI and nothing to notice.
   *
   * An override that can publish production is not an override, it is a switch.
   * `VERCEL_ENV` is the only name that distinguishes the three deployments, it is
   * set by the platform and not by us, and it is absent everywhere else — so this
   * costs nothing locally and in the suite, where `asked === "visible"` still
   * answers `true`.
   */
  if (asked === "visible") return process.env.VERCEL_ENV !== PRODUCTION_ENVIRONMENT;
  if (asked === "hidden") return false;

  // A build never publishes a draft, whatever NODE_ENV happens to hold.
  if (process.env.NEXT_PHASE === PRODUCTION_BUILD_PHASE) return false;

  // Otherwise only the two environments that are demonstrably not a deployment.
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

/**
 * Whether the collection may be read once and remembered — see
 * {@link memoisedTrips} for why that is a build-only licence.
 *
 * **Deliberately still on `NODE_ENV` alone, and not on the build phase.** This is
 * a performance decision, so its failure modes are not the filter's: answering
 * `false` during a build costs one read per page, and answering `true` outside one
 * serves a stale collection. The measurement above settles it — the server bundle
 * of a `next build` has `process.env.NODE_ENV` inlined as `"production"`, so the
 * memo already engages there whatever `NODE_ENV` was on the command line. Adding
 * `NEXT_PHASE` would only extend the memo to non-bundled callers, where a
 * long-lived process wants the disk re-read, not frozen.
 */
function isProductionBuild(): boolean {
  return process.env.NODE_ENV === PRODUCTION_ENVIRONMENT;
}

/* --------------------------------------------------------- visible drafts -- */

/**
 * One line on `stderr` when a read just succeeded and the drafts it contains are
 * about to be served. Never in production, where the filter has removed them.
 *
 * Why this is not a field on `TripSummary`: in production the flag would be
 * `false` for every trip a page can see, so `if (trip.draft)` would work on
 * localhost and never run once online — the reasoning written on `TripSummary`
 * itself. But the need behind the request is real: under `next dev` a draft is
 * indistinguishable from a published trip, and the contributor cannot tell what
 * will actually go online. `content/README.md` already sends them to
 * `npm run build && npm run start` for the truth, which is the right answer and
 * the one nobody runs between two edits; this line closes that daily gap without
 * adding a field to the data contract or a condition to write in a consumer.
 *
 * Called from the read site, so it is one line **per read** rather than per call:
 * the four doors all go through {@link memoisedTrips}, and three of them can be
 * called for a single page.
 */
function announceVisibleDrafts(trips: readonly Trip[]): void {
  if (!showsDrafts()) {
    return;
  }

  const slugs = trips.filter((trip) => trip.draft).map((trip) => trip.slug);
  if (slugs.length === 0) {
    return;
  }

  // French, like every other message this layer prints — the author reading it is
  // the author writing the trip.
  const plural = slugs.length > 1 ? "s" : "";

  /**
   * The message names *why* drafts are visible, and never says "seulement ici".
   *
   * It used to, and it reassured in exactly the one case where it should not:
   * measured in the log of a production `next start`, `TIW_DRAFTS=visible` printed
   * « 1 brouillon, visible seulement ici » while that draft was being served with
   * a 200 on the public port. "Ici" is the one thing this function cannot know —
   * it knows the process, not who can reach it. The environment name is something
   * it does know, so that is what it prints.
   */
  const because =
    process.env.TIW_DRAFTS === "visible"
      ? `visible${plural} dans cet environnement (TIW_DRAFTS=visible)`
      : `visible${plural} seulement en développement`;

  process.stderr.write(`${slugs.length} brouillon${plural}, ${because} : ${slugs.join(", ")}\n`);
}

/* ------------------------------------------------------------- memoisation -- */

/**
 * Keyed by the *resolved* content directory, not by "have I run before". A single
 * global slot is the natural implementation and it makes every caller after the
 * first read a collection it never asked for.
 *
 * It holds **every** trip, drafts included, so the publication filter can run per
 * call: memoising a filtered list would let whichever environment asked first
 * decide the answer for the rest of the process.
 *
 * The values are parsed `Trip`s — a domain value carrying `draft` beside the
 * fields the projections use — never the `TripFile` they came from, which is not
 * serialisable and has no business leaving this module.
 */
const collections = new Map<string, readonly Trip[]>();

function memoisedTrips(contentDir: string): readonly Trip[] {
  /**
   * **Only a build wants a snapshot.** Under `next dev` this memo would make an
   * edited `trip.yaml` invisible until the server restarts: the YAML is not in
   * the module graph, so HMR re-evaluates nothing and no reload empties the
   * `Map`. Worse, it does it *intermittently* — touching any `.ts` re-instantiates
   * this module and empties the memo, touching only the YAML does not, so the
   * author sees their edit appear sometimes. And that is this ticket's own
   * workflow: `draft` exists so a trip can be written over several sittings, and
   * those sittings happen in `next dev`.
   */
  if (!isProductionBuild()) {
    return readAndAnnounce(contentDir);
  }

  const cached = collections.get(contentDir);
  if (cached !== undefined) {
    return cached;
  }

  /**
   * A *rejection* is not memoised, and that is all this ordering buys: `readTrips`
   * throws before the insertion, so a refused file leaves no trace and correcting
   * it works without restarting. Correcting a file that was **accepted** is the
   * case the memo does not cover, which is precisely why the branch above exists.
   *
   * The guarantee, stated honestly: **one read per content directory per worker.**
   * `next build` parallelises page rendering across processes and this `Map` is
   * per module instance, so "one read per build" would be a promise this cannot
   * keep — what it removes is the re-read per page, which is the cost that
   * mattered.
   */
  const trips = readAndAnnounce(contentDir);
  collections.set(contentDir, trips);

  return trips;
}

/**
 * Both branches read through here, so "one notice per read" is a property of the
 * reading and not of one branch. It costs nothing on the production path — the
 * notice guards itself on `showsDrafts()` — and it means the day the two
 * environment predicates diverge, a served draft is still announced.
 */
function readAndAnnounce(contentDir: string): readonly Trip[] {
  const trips = readTrips(contentDir);
  announceVisibleDrafts(trips);

  return trips;
}

/* -------------------------------------------------------------- publication -- */

function publishedTrips(): readonly Trip[] {
  const all = memoisedTrips(contentRoot());

  /**
   * The disjunction is checked from **this** side too, and not only from
   * `listVisitedPlaces`. A collection whose two halves contradict each other must
   * not be half-servable: a build that rendered the trip listing and failed only
   * on the map would ship a page saying a city was never visited while another
   * page said it was.
   */
  assertDisjointFromVisitedPlaces(all);

  return showsDrafts() ? all : all.filter((trip) => !trip.draft);
}

/* ------------------------------------------------------- the visited places -- */

/**
 * The places the journal has been to with no journey attached (TIW-36) — the
 * whole of `content/places.yaml`, parsed.
 *
 * Memoised on the same terms as the trips and keyed by the resolved *file*: a
 * build reads it once per worker, `next dev` reads it every time so an edit
 * shows up. `readVisitedPlaces` throws before the insertion, so a refused file
 * leaves no trace and correcting it needs no restart — the same ordering, for the
 * same reason, as {@link memoisedTrips}.
 */
const placeCollections = new Map<string, readonly Place[]>();

function memoisedVisitedPlaces(file: string): readonly Place[] {
  if (!isProductionBuild()) {
    return readVisitedPlaces(file);
  }

  const cached = placeCollections.get(file);
  if (cached !== undefined) {
    return cached;
  }

  const places = readVisitedPlaces(file);
  placeCollections.set(file, places);

  return places;
}

/**
 * Why a places file could not be read, in the words the message will use.
 *
 * A `switch` with a `never` default, for the reason {@link unreadableFileProblem}
 * gives: the `default` is what turns a new state of `VisitedPlacesFile` into a
 * **compile** error rather than into a wrong sentence.
 */
function unreadablePlacesProblem(file: Exclude<VisitedPlacesFile, { state: "parsed" }>): string {
  switch (file.state) {
    case "absent":
      // Reached only for a near-miss on the name: a genuinely absent file is an
      // empty collection and never an error — see `readVisitedPlaces`.
      return `le fichier s'appelle « ${file.similarName ?? ""} », pas « ${VISITED_PLACES_FILE_NAME} »`;

    case "unreadable":
      return `le fichier n'est pas lisible : ${file.reason}`;

    case "malformed": {
      // The first YAML problem only; the parser reports every line after the one
      // it lost its footing on, and a consequence carries no information.
      const [first] = file.problems;

      return `YAML invalide${first === undefined ? "" : ` : ${first.message}`}`;
    }

    default: {
      const unexpected: never = file;

      throw new Error(`état de fichier non traité : ${JSON.stringify(unexpected)}`);
    }
  }
}

/**
 * Reads and parses the visited places, or throws naming the file and the command.
 *
 * **No file at all is an empty list, and it is the one lenient answer in this
 * module.** Everywhere else an absence is loud, because a trip vanishing in
 * silence is the defect this pipeline exists to prevent. But a journal holding no
 * dateless place is not a broken journal: it is what this repository was before
 * TIW-36, and what it becomes again once every place has been promoted into a
 * trip. Making that an error would turn the ordinary end state into a build
 * failure. The distinction is only safe because `readYamlFile` reserves `absent`
 * for `ENOENT` alone — an `EACCES` comes back as `unreadable` and throws, so
 * "no places" is never the answer to a file that is there.
 */
function readVisitedPlaces(file: string): readonly Place[] {
  const repoRoot = repositoryRoot();
  const read = readVisitedPlacesFile(file);
  const where = displayPath(repoRoot, read.absolutePath);

  if (read.state === "absent" && read.similarName === undefined) {
    return [];
  }

  if (read.state !== "parsed") {
    throw contentError(where, unreadablePlacesProblem(read));
  }

  /**
   * The same two `__proto__` checks the trips get, in the same order and for the
   * same measured reasons: the document walk names the key as it was written, and
   * the walk over the materialised value is the only one an alias cannot slip
   * past. Closing the hole in one collection and not the other would be worse
   * than closing it in neither — a reader would reasonably believe it closed
   * everywhere.
   */
  const [declaredUnsafeKey] = read.unsafeKeys;
  if (declaredUnsafeKey !== undefined) {
    throw contentError(where, unsafeKeyProblem(declaredUnsafeKey));
  }

  const [materialisedUnsafeKey] = unsafeKeysIn(read.value);
  if (materialisedUnsafeKey !== undefined) {
    throw contentError(where, unsafeKeyProblem(materialisedUnsafeKey));
  }

  const parsed = VisitedPlacesSchema.safeParse(read.value);
  if (!parsed.success) {
    throw contentError(where, "le fichier des lieux visités est refusé par le schéma");
  }

  /**
   * **Sorted by name here, once**, exactly as the trips are sorted once by
   * `byMostRecentThenSlug`: three consumers read this list — the map's markers,
   * the map's textual equivalent and the anchors they point at — and an order
   * stated in three places is an order two of them eventually get wrong.
   *
   * By name and not by file order, because a visited place carries no date and
   * therefore has no chronology to take; by name and not by localised collation,
   * because that belongs to the presentation layer and `localeCompare`'s answer
   * depends on the runtime's locale data — the same reasoning as
   * `visitedCountryCodes`. A prerendered page has to be byte-identical between
   * two builds of the same content.
   */
  return [...parsed.data.places].sort(byName);
}

/** Ascending by name, then by slug for a tie — see {@link readVisitedPlaces}. */
function byName(left: Place, right: Place): number {
  if (left.name !== right.name) {
    return left.name < right.name ? -1 : 1;
  }

  return left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0;
}

/**
 * **The two collections hold disjoint place slugs, and the refusal is what makes
 * them one source of truth.**
 *
 * This is the whole answer to the one real objection against a separate
 * collection (`docs/lieux-visites.md`): two files holding places is two places
 * for the same city to live, free to diverge in silence. It is not free here — a
 * slug declared on both sides is refused, naming both files, so promoting a place
 * into a trip cannot half-happen. Until the four lines are removed from
 * `places.yaml`, nothing builds.
 *
 * **Drafts are included on purpose.** A draft's places are not published, so no
 * reader could see the duplicate — but the promotion this rule exists to make
 * loud happens *inside* a draft, which `content/README.md` calls the ordinary
 * shape of a return from a journey. A rule that only bit once the trip was
 * published would be silent exactly while the author is doing the work it guards.
 *
 * **A place slug matching a *trip* slug is not this fault** and is not refused:
 * `/voyages/<slug>` and `#lieu-<slug>` are different namespaces, and a récit
 * named « annecy » beside a dateless stop in Annecy is a coherent statement.
 *
 * **Not memoised, deliberately.** It is a set build over a few dozen strings on a
 * list that is already in memory, so there is nothing to buy — and ADR 0015
 * records what a memoised guard costs when it remembers its *execution* instead
 * of its verdict: the first page of a build fails and every later one passes.
 * Having no memo is the cheapest way to be sure this one cannot.
 */
function assertDisjointFromVisitedPlaces(trips: readonly Trip[]): void {
  const file = placesFile();
  const places = memoisedVisitedPlaces(file);
  if (places.length === 0) {
    return;
  }

  const declared = new Set(places.map((place) => place.slug));
  const repoRoot = repositoryRoot();

  for (const trip of trips) {
    for (const place of trip.places) {
      if (declared.has(place.slug)) {
        throw contentError(
          displayPath(repoRoot, file),
          `le lieu « ${place.slug} » est aussi déclaré par le voyage « ${trip.slug} » : c'est le même lieu dans deux collections — retire-le d'ici si le voyage le raconte désormais`
        );
      }
    }
  }
}

/**
 * The published trips that have a récit to read, and therefore an address
 * (TIW-18).
 *
 * **A second filter over `publishedTrips`, not beside it**, because the two
 * questions nest: a draft is not published at all, so whether its story is
 * written cannot arise. That order is what keeps `TIW_DRAFTS` out of a state it
 * has nothing to say about — the flag decides visibility, this decides whether
 * there is a page.
 *
 * **Why the environment does not enter into it, unlike `showsDrafts()`.** A draft
 * is a staging state, shown on `localhost` so an author can see work in progress.
 * An untold trip is not staged: it is deliberately published *without* a récit. A
 * page shown only in development would be a page that ships to nobody, and the
 * author would be reviewing something no reader ever sees — the exact inversion of
 * what the draft flag buys. So this filter is unconditional, and
 * `tests/content/loader.test.ts` pins that across all three values of `NODE_ENV`
 * and against `TIW_DRAFTS=visible`.
 *
 * `hasStory` rather than the comparison written out here: the direction that
 * predicate fails in is the whole reason it exists, and it is argued on the
 * predicate.
 */
function tripsWithAStory(): readonly Trip[] {
  return publishedTrips().filter(hasStory);
}

/* ------------------------------------------------------------- the five doors -- */

/**
 * **Every visited place, ordered by name** — a place the journal has been to with
 * no journey attached, and therefore with no date, no step, no récit and no page
 * (TIW-36).
 *
 * **The fifth door, and it joins the *rendering* pair on purpose.** TIW-18 split
 * the four others in two: `listTripSummaries` and `loadTrips` answer "what does
 * the journal hold", `tripStaticParams` and `findTrip` answer "what has an
 * address". This one is in the first pair and has **no counterpart in the
 * second** — no `findVisitedPlace`, no `visitedPlaceStaticParams`, not now and
 * not as a gap to fill later. That absence *is* the guarantee: there is no
 * function in this codebase capable of producing an address for a place, so no
 * code path — not a route added next year, not a script — can link to one. It is
 * the same property the second pair buys for an untold trip, obtained by not
 * having the doors rather than by filtering them.
 *
 * Consequence on the marker, worth stating because it is where the guarantee is
 * cashed in: a place's marker is still a real `<a href>` — an `<a>` with no href
 * has no link role and its panel would be unreachable by keyboard — and it points
 * at the place's own entry in the map's textual equivalent, `#lieu-<slug>`, which
 * is on the very page the marker is drawn on. The same move
 * `visited-countries.tsx` recorded making after measuring that its `#pays-xx`
 * fragment dangled.
 *
 * `Place` and not a projection of its own: a visited place has exactly the four
 * fields `PlaceSchema` holds, and a `VisitedPlaceSummary` narrowing them to
 * themselves would be a second declaration of the shape this whole design rests
 * on being single. Copied, like every array the projections return, because the
 * parse is memoised for the life of a build and `readonly` is compile-time only.
 *
 * **No publication filter, and nothing for `TIW_DRAFTS` to say.** A place is not
 * a staging state: it is published, deliberately, without a récit. There is no
 * `draft` field on it, so there is no environment-dependent answer to give — the
 * same reasoning `tripsWithAStory` records for the untold state, one collection
 * over.
 */
export async function listVisitedPlaces(): Promise<readonly Place[]> {
  const places = memoisedVisitedPlaces(placesFile());

  /**
   * The disjunction, from this side. `assertDisjointFromVisitedPlaces` needs the
   * trips, so reading them here is not a detour: the two collections are one
   * source of truth or they are two that disagree, and this door must not be the
   * one that serves the disagreement.
   */
  assertDisjointFromVisitedPlaces(memoisedTrips(contentRoot()));

  return places.map((place) => ({ ...place, coordinates: { ...place.coordinates } }));
}

/**
 * Every published trip, in full, in publication order — **an untold trip
 * included**.
 *
 * The pair with `tripStaticParams` below is deliberate and is the whole shape of
 * the untold state (TIW-18): this door and `listTripSummaries` answer "what does
 * the journal hold", the other two answer "what has an address". A trip whose
 * récit is not written is in the first pair and not in the second.
 */
export async function loadTrips(): Promise<readonly TripDetail[]> {
  return publishedTrips().map(detailOf);
}

/**
 * The same trips, projected down to what a listing renders — untold ones
 * included, since a listing is exactly where they belong.
 *
 * The two consumers that must *not* take this list whole are `sitemap.xml` and
 * `feed.xml`: both advertise addresses, so both filter on `hasStory` themselves.
 * That filtering is not done here, because a listing needs the untold trips and a
 * fifth door taking the decision for everyone would be the wrong seam — see the
 * note on `hasStory` in `src/domain/trip.ts`.
 */
export async function listTripSummaries(): Promise<readonly TripSummary[]> {
  return publishedTrips().map(summaryOf);
}

/**
 * One trip by its slug, or an explicit absence — never an exception. The consumer
 * is a page that answers 404 on absence, and the difference between "resolved to
 * `undefined`" and "threw" is the difference between a 404 and a 500.
 *
 * The slug is the one **declared in the file**, not the directory name: the
 * directory name is a convention, and keying on it would move a published trip's
 * URL the day someone renames a folder.
 *
 * A linear, exact comparison over the published list. Never an object indexed by
 * the argument: the slug arrives from a URL segment, so `"__proto__"`,
 * `"constructor"` and `"toString"` are attacker-controlled text, and
 * `index["constructor"]` on a plain object answers with a function — a page would
 * be handed `Object` to render. Comparing strings has no such reading, and it
 * needs no sanitising of `"../../etc/passwd"` either, because a slug is compared
 * and never joined onto a path.
 *
 * **Over the trips that have a récit, not over every published one** (TIW-18),
 * and this is the second of the two locks on the untold state. `tripStaticParams`
 * decides the closed set of addresses the build produces, which
 * `dynamicParams = false` turns into an immediate 404; this makes the absence true
 * for any *other* caller as well — a route added next year, a script — so no code
 * path can render a page for a story nobody wrote. Neither lock is redundant: the
 * first one is what stops a file being read at all, the second is what stops a
 * page being rendered from one.
 */
export async function findTrip(slug: string): Promise<TripDetail | undefined> {
  const found = tripsWithAStory().find((trip) => trip.slug === slug);

  return found === undefined ? undefined : detailOf(found);
}

/**
 * The `generateStaticParams` of the trip page: exactly the trips that must be
 * prerendered, in the same order as the listings. A draft is absent from it in
 * production, and **a trip whose récit is not written is absent from it in every
 * environment** (TIW-18) — it has no page, which is what makes "no link to a page
 * that does not exist" a property of the build rather than a discipline every
 * component has to keep. See `tripsWithAStory`.
 *
 * **Being absent from this list is not, by itself, a 404 — and this comment said
 * it was.** Under the App Router's defaults, a slug that `generateStaticParams`
 * did not return is *rendered on demand*. Measured on a build that had correctly
 * excluded a draft:
 *
 * - `prerender-manifest.json` carries `dynamicRoutes["/[locale]/voyages/[slug]"]`
 *   with `"fallback": null, "compute": "blocking"` — an unknown slug reaches a
 *   server function rather than a static 404;
 * - `page.js.nft.json` traces the draft's own `trip.yaml` into that function's
 *   bundle, so the file ships to the production runtime;
 * - `process.env.TIW_DRAFTS` survives in the compiled server chunk as a **runtime**
 *   read (only `NODE_ENV` is folded), so the decision is taken per request, by a
 *   function that has the draft on hand.
 *
 * With the variable set at runtime only — on that same build — the URL answered
 * `200` with the draft's content. And removing it does not immediately unpublish:
 * the first request afterwards still served the draft from the ISR cache
 * (`x-nextjs-cache: STALE`) before the background revalidation wrote the 404. On
 * Vercel that cache is durable and CDN-served.
 *
 * **What the page must therefore carry**, and what makes the 404 real:
 * `export const dynamicParams = false;` on the trip detail route. Verified: with
 * it, the same request answers `404` with `x-nextjs-cache: HIT` and creates no
 * cache entry at all — no function, no disk read, no per-request decision. The
 * route is TIW-16's to write and TIW-24's to fill; this note is here because the
 * requirement belongs to whoever reads this function, not to a ticket description.
 */
export async function tripStaticParams(): Promise<readonly { readonly slug: string }[]> {
  return tripsWithAStory().map((trip) => ({ slug: trip.slug }));
}
