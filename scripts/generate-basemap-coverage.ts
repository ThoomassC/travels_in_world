import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { format, resolveConfig } from "prettier";
import { NUMERIC_BY_ALPHA2 } from "@/iso-3166";

/**
 * `npm run basemap:coverage` — writes `src/basemap-coverage.ts`.
 *
 * **Why a generated file rather than a lookup at validation time.** The question
 * `src/content/validate.ts` has to answer is "does the basemap carry a shape for
 * this country?", and the only authority on that is the TopoJSON itself. Reaching
 * it from the content layer means importing `world-atlas` — which
 * `travels-in-world/map-entry-point` forbids to every module of `src/**` outside
 * `src/map/**`, and forbids for a reason worth more than this check: those three
 * packages are what the `@/map` façade keeps out of a client bundle. Going
 * through the façade is not an option either, measured under bare Node:
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'server-only'` — it fails at
 * *resolution*, so no export of `@/map` can ever serve a script. That is the same
 * measurement TIW-29 recorded when it moved the ISO table to `src/iso-3166.ts`.
 *
 * So the dataset is read here, once, by a command, and the answer is committed as
 * plain data that any layer may import. What that buys is a boundary left exactly
 * as it was; what it costs is an artefact that can go stale, which is why it is
 * cross-checked in two places — see the header this file writes.
 *
 * **Why `createRequire().resolve` and not a static import.** `src/map/dataset.ts`
 * argues at length that the dataset must be a static `import`, and it is right —
 * *for a module a bundler compiles*. This is a script: no bundler ever sees it,
 * and bare Node refuses `import atlas from "…json"` without an import attribute
 * (measured: `ERR_IMPORT_ATTRIBUTE_MISSING`). It also has to open three vintages,
 * one of which the application never loads. The two constraints are opposite
 * because the two runtimes are opposite; the cross-checks are what keep the two
 * readings honest with each other.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_PATH = path.join(REPO_ROOT, "src", "basemap-coverage.ts");
const REGENERATE_COMMAND = "npm run basemap:coverage";

/**
 * The vintage `src/map/dataset.ts` imports, and the finer ones the same package
 * ships. Kept in step with that module by hand — as its own `DATASET_MODULE`
 * constant already is, and for the same reason: an import specifier must be a
 * literal. The drift is caught, not prevented: `tests/map/basemap-coverage.test.ts`
 * compares against `SHIPPED_DATASET_VINTAGE`, and `src/map/world.ts` compares the
 * generated list against the geometry it actually projected.
 */
const SHIPPED_VINTAGE = "110m";
const FINER_VINTAGES = ["50m", "10m"] as const;

const require_ = createRequire(import.meta.url);

const ALPHA2_BY_NUMERIC = new Map(
  [...NUMERIC_BY_ALPHA2].map(([alpha2, numeric]) => [numeric, alpha2])
);

type Geometry = { readonly id?: unknown; readonly properties?: unknown };

/**
 * The alpha-2 codes one vintage carries a shape for.
 *
 * Every structural assumption is checked rather than cast. A `world-atlas` bump
 * that renamed a key or switched `id` to a number would otherwise generate an
 * empty list in silence — and an empty list here means the validator refuses
 * every country on earth.
 */
function codesDrawnBy(vintage: string): ReadonlySet<string> {
  const specifier = `world-atlas/countries-${vintage}.json`;
  const parsed: unknown = JSON.parse(readFileSync(require_.resolve(specifier), "utf8"));

  const objects = isRecord(parsed) ? parsed["objects"] : undefined;
  const countries = isRecord(objects) ? objects["countries"] : undefined;
  const geometries = isRecord(countries) ? countries["geometries"] : undefined;

  if (!Array.isArray(geometries) || geometries.length === 0) {
    throw new Error(`${specifier} has no objects.countries.geometries array to read.`);
  }

  const codes = new Set<string>();

  for (const [index, geometry] of (geometries as readonly Geometry[]).entries()) {
    const id: unknown = isRecord(geometry) ? geometry["id"] : undefined;

    if (id === undefined) {
      // Three geometries of the 110m vintage carry no id at all — N. Cyprus,
      // Somaliland, Kosovo. No ISO code designates them, so nothing joins.
      continue;
    }

    if (typeof id !== "string") {
      throw new Error(
        `${specifier} geometry ${index} has a non-string id ${String(id)}: the join is a string comparison.`
      );
    }

    const code = ALPHA2_BY_NUMERIC.get(id);

    if (code !== undefined) {
      codes.add(code);
    }
  }

  return codes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sorted and one per line, so a diff of the generated file shows exactly which
 * countries a `world-atlas` bump added or dropped. Prettier would break the list
 * onto one entry per line anyway; writing it that way keeps this template and its
 * output the same shape.
 */
function codeList(codes: ReadonlySet<string>): string {
  return [...codes]
    .sort()
    .map((code) => `  "${code}",`)
    .join("\n");
}

function render(shipped: ReadonlySet<string>, finer: ReadonlySet<string>): string {
  const undrawable = [...NUMERIC_BY_ALPHA2.keys()].filter((code) => !shipped.has(code));
  const nowhere = undrawable.filter((code) => !finer.has(code));

  return `/**
 * Which countries the shipped basemap can actually draw — **generated, do not
 * edit by hand**. Run \`${REGENERATE_COMMAND}\` after any \`world-atlas\` bump or
 * vintage change.
 *
 * **The question this answers, and why it needs a file.** \`src/iso-3166.ts\` says
 * whether ISO 3166-1 assigns a code; it says nothing about whether a *map* can
 * draw it. At the ${SHIPPED_VINTAGE} vintage, ${undrawable.length} of the ${NUMERIC_BY_ALPHA2.size} assigned codes have no shape
 * at all — every micro-state, Singapore and Hong Kong included. Before TIW-30
 * \`npm run validate:content\` cleared them and \`buildWorldGeometry\` threw halfway
 * through the prerender of \`/fr\`.
 *
 * The content layer cannot ask the dataset directly:
 * \`travels-in-world/map-entry-point\` bans \`world-atlas\`, \`d3-*\` and \`topojson-*\`
 * everywhere in \`src/**\` outside \`src/map/**\`, and the \`@/map\` façade carries
 * \`import "server-only"\`, which fails at *resolution* under the plain Node the
 * validator runs on. So the answer is precomputed by a command and committed as
 * data — the same shape of decision TIW-29 made for the ISO table, one layer
 * further out.
 *
 * **A generated artefact that lies is worse than no artefact, so two guards
 * compare it to the real dataset, at two different moments:**
 *
 * - \`tests/map/basemap-coverage.test.ts\` recomputes both lists from the packaged
 *   TopoJSON — read independently of this file *and* of \`src/map/dataset.ts\` —
 *   and fails naming the codes that moved. It runs on every \`npm test\`, hence on
 *   every pull request;
 * - \`src/map/world.ts\` compares {@link DRAWABLE_COUNTRY_CODES} against the
 *   geometries it has just projected, and refuses to draw on a mismatch. That one
 *   runs inside \`next build\`, which is the only run that ships.
 *
 * Neither replaces the other: the suite is the fast, precise signal, and the
 * build-time check is what makes a stale list unable to reach production even if
 * nobody ran the suite.
 */

/** The vintage \`src/map/dataset.ts\` imports. */
export const BASEMAP_VINTAGE = "${SHIPPED_VINTAGE}";

/**
 * The finer vintages the same package already ships. Switching to one costs
 * bundle weight, not a dependency — and the price is steep: the whole 50m vintage
 * projects to 182.5 KB brotli of paths against the 34 KB ceiling of
 * \`tests/map/world.test.ts\`. Named here so a refusal can quote the way out with
 * its cost instead of implying it is free.
 */
export const FINER_BASEMAP_VINTAGES = [${FINER_VINTAGES.map((v) => `"${v}"`).join(", ")}] as const;

/** The command that rewrites this file, quoted by both guards when they fail. */
export const REGENERATE_COMMAND = "${REGENERATE_COMMAND}";

/**
 * The ${shipped.size} countries the ${SHIPPED_VINTAGE} vintage draws — the set the validator gates on.
 */
export const DRAWABLE_COUNTRY_CODES: ReadonlySet<string> = new Set([
${codeList(shipped)}
]);

/**
 * The ${finer.size} countries some finer vintage of the package draws.
 *
 * Its only job is to keep a refusal from becoming a dead end: ${nowhere.length} assigned codes —
 * ${nowhere.join(", ")} — are drawn by
 * *no* vintage of \`world-atlas\`, so telling their author to switch would be
 * telling them to buy 152 KB of paths that still would not draw their country.
 */
export const FINER_VINTAGE_COUNTRY_CODES: ReadonlySet<string> = new Set([
${codeList(finer)}
]);
`;
}

/**
 * Formatted through Prettier before it is written, rather than by a second
 * command afterwards. A generated file that a human has to remember to reformat
 * is a red `npm run lint` waiting for the next `world-atlas` bump, and the person
 * who meets it will be debugging a formatting failure in a file they did not
 * write.
 */
async function main(): Promise<number> {
  const shipped = codesDrawnBy(SHIPPED_VINTAGE);
  const finer = new Set<string>();

  for (const vintage of FINER_VINTAGES) {
    for (const code of codesDrawnBy(vintage)) {
      finer.add(code);
    }
  }

  const options = await resolveConfig(OUTPUT_PATH);
  writeFileSync(
    OUTPUT_PATH,
    await format(render(shipped, finer), { ...options, filepath: OUTPUT_PATH }),
    "utf8"
  );

  const undrawable = [...NUMERIC_BY_ALPHA2.keys()].filter((code) => !shipped.has(code));
  const nowhere = undrawable.filter((code) => !finer.has(code));

  process.stdout.write(
    `src/basemap-coverage.ts écrit : ${shipped.size} pays dessinés par le millésime ${SHIPPED_VINTAGE}, ` +
      `${undrawable.length} codes ISO sans forme, dont ${undrawable.length - nowhere.length} qu'un millésime plus fin dessinerait.\n`
  );

  return 0;
}

process.exitCode = await main();
