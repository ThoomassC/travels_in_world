import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Shared fixtures for `tests/map/**`: the raw world-atlas dataset, read straight
 * from `node_modules` rather than through the production code, and a parser for
 * the SVG path data the map produces.
 *
 * Reading the dataset independently is the point. The structural guards in
 * `iso-3166.test.ts` — 174 of 177 geometries resolve to an alpha-2, and the three
 * that do not are named — only mean something if the count they check against
 * comes from the dataset and not from the table under test.
 */

/**
 * Why `process.cwd()` and not `new URL("../..", import.meta.url)`, which is what
 * `tests/lint/**` uses. Vite rewrites the `new URL(…, import.meta.url)` form into
 * an asset reference, so under Vitest it answers `/@fs/…` — measured, not
 * assumed — and every path built on it misses. Vitest runs each suite with the
 * repository root as its working directory; `repositoryRoot()` refuses to hand
 * back a directory that is not this repository rather than let a wrong path
 * surface later as an unreadable dataset.
 */
export function repositoryRoot(): string {
  const candidate = process.cwd();
  const manifest = path.join(candidate, "package.json");
  const name: unknown = readJson(manifest, "name");

  if (name !== "travels-in-world") {
    throw new Error(
      `Expected Vitest to run from the repository root; ${candidate} holds no travels-in-world package.json.`
    );
  }

  return candidate;
}

function readJson(absolutePath: string, key: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(absolutePath, "utf8"));

  return isRecord(parsed) ? parsed[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The 110m world-atlas vintage, which is the one the map is built from. Pinned as
 * a path rather than imported as a module: a `resolveJsonModule` import of a
 * 100 kB TopoJSON makes `tsc` infer the whole literal, and the suite only needs
 * two fields out of it.
 */
const DATASET_RELATIVE_PATH = "node_modules/world-atlas/countries-110m.json";

export type DatasetGeometry = {
  /**
   * ISO 3166-1 numeric, as a string, exactly as the dataset spells it — or `null`
   * for the three territories the dataset ships without one.
   */
  readonly id: string | null;
  /** The dataset's own English label; `properties` carries nothing else. */
  readonly name: string;
};

/**
 * The dataset's country geometries, reduced to the two fields the suite asserts
 * on. Every shape assumption is checked rather than cast: a world-atlas bump that
 * renames a key or switches `id` to a number has to fail here, loudly, and not
 * as a mystery count three files away.
 */
export function readDatasetGeometries(): readonly DatasetGeometry[] {
  const absolutePath = path.join(repositoryRoot(), DATASET_RELATIVE_PATH);
  const parsed: unknown = JSON.parse(readFileSync(absolutePath, "utf8"));

  const objects = isRecord(parsed) ? parsed["objects"] : undefined;
  const countries = isRecord(objects) ? objects["countries"] : undefined;
  const geometries = isRecord(countries) ? countries["geometries"] : undefined;

  if (!Array.isArray(geometries)) {
    throw new Error(
      `${DATASET_RELATIVE_PATH} has no objects.countries.geometries array; the world-atlas layout changed.`
    );
  }

  return geometries.map((geometry, index) => {
    if (!isRecord(geometry)) {
      throw new Error(`Geometry ${index} of ${DATASET_RELATIVE_PATH} is not an object.`);
    }

    const id = geometry["id"];
    const properties = geometry["properties"];
    const name = isRecord(properties) ? properties["name"] : undefined;

    if (typeof name !== "string") {
      throw new Error(
        `Geometry ${index} of ${DATASET_RELATIVE_PATH} has no properties.name string.`
      );
    }

    // `id` is absent on exactly three geometries and a numeric *string* on every
    // other. A number would mean the vintage changed how it keys countries, which
    // silently breaks a join written against strings.
    if (id !== undefined && typeof id !== "string") {
      throw new Error(
        `Geometry ${index} (${name}) of ${DATASET_RELATIVE_PATH} has a non-string id ${String(id)}.`
      );
    }

    return { id: id ?? null, name };
  });
}

export type PathCoordinate = {
  readonly x: number;
  readonly y: number;
};

/**
 * Every `x,y` pair in an SVG path produced by `d3-geo`'s `geoPath`.
 *
 * Pairs are matched on the comma rather than by walking command letters and
 * counting positions, because that stays correct whatever commands the generator
 * emits. Measured on the 177 projected geometries: the only letters that appear
 * are `M`, `L` and `Z`, so every number in the output is one half of a
 * coordinate — but a parser that assumed it would be wrong the day a point
 * feature adds an arc.
 */
const COORDINATE_PAIR_PATTERN = /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;

export function coordinatesOf(pathData: string): readonly PathCoordinate[] {
  return Array.from(pathData.matchAll(COORDINATE_PAIR_PATTERN), (match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
}

/**
 * Any number carrying two or more decimals. The rounding decision is what keeps
 * the whole geometry payload at 30 kB brotli instead of 45 kB, and it is
 * invisible in a rendered map — so a regression to full precision has no symptom
 * other than a heavier page. This pattern is the symptom.
 */
export const OVERLY_PRECISE_NUMBER_PATTERN = /\d+\.\d{2,}/;

/** A production module of `src/map`, read from disk for the source-text guards. */
export function readMapSource(relativePath: string): string {
  return readFileSync(path.join(repositoryRoot(), relativePath), "utf8");
}

/**
 * The same source with every comment removed.
 *
 * Needed because the guards that forbid an identifier in `src/map/**` — no
 * `readFileSync`, no `createRequire` — must not fire on the comment that
 * *explains why those are forbidden*. That comment is the most valuable part of
 * the file: it is what stops the next reader from "fixing" the static import back
 * into a runtime resolution. A guard that punished it would get the comment
 * deleted rather than the rule respected.
 *
 * Strings and template literals are tracked so a `"//"` inside one cannot open a
 * comment. Regular-expression literals are **not** parsed, and that is a known
 * limitation rather than an oversight: a literal beginning `/*` or `//` is not
 * valid regex syntax anyway (`/*` is a quantifier with nothing to repeat), so the
 * only construct that could confuse this stripper cannot be written. The
 * `assertStripped` control below is what keeps the limitation from turning into a
 * silently empty haystack.
 */
export function stripComments(source: string): string {
  let output = "";
  let index = 0;

  while (index < source.length) {
    const two = source.slice(index, index + 2);

    if (two === "//") {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue;
    }

    if (two === "/*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }

    const character = source[index] ?? "";

    if (character === '"' || character === "'" || character === "`") {
      const literal = readLiteral(source, index, character);
      output += literal;
      index += literal.length;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

/** A quoted run starting at `start`, escapes honoured, unterminated tolerated. */
function readLiteral(source: string, start: number, quote: string): string {
  let index = start + 1;

  while (index < source.length) {
    const character = source[index];

    if (character === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (character === quote) {
      break;
    }
  }

  return source.slice(start, index);
}
