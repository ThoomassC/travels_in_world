import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseThemes, resolveToken, type Theme, type ThemeName } from "@thomascaron/ui/contract";

/**
 * The site's stylesheet, as the browser assembles it — the one source both the
 * colour contract and the favicon drift guard measure.
 *
 * A helper and not a copy in each test, for the reason the whole migration
 * exists: two files that each rebuild the same sheet are two sheets, and the day
 * one of them is pointed at a different entry point the other goes on reporting
 * green about a file the site no longer ships.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `include` leaves it alone.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "src");
const require = createRequire(path.join(ROOT, "package.json"));

/**
 * `src/styles/tokens.css` with its `@import`s inlined, bare package specifiers
 * resolved through the same exports map Next resolves them with.
 *
 * Inlining rather than reading the three files by name: the day the local sheet
 * stops importing the library, or imports a different entry point, these suites
 * must measure what the site actually ships.
 */
export function assembledSheet(): string {
  const seen = new Set<string>();

  const inline = (file: string): string => {
    if (seen.has(file)) return "";
    seen.add(file);

    return readFileSync(file, "utf8").replace(
      /@import\s+["']([^"']+)["']\s*;/g,
      (_match, specifier: string) =>
        inline(
          specifier.startsWith(".")
            ? path.resolve(path.dirname(file), specifier)
            : require.resolve(specifier)
        )
    );
  };

  return inline(path.join(SRC, "styles/tokens.css"));
}

const THEMES: ReadonlyMap<ThemeName, Theme> = new Map(
  parseThemes(assembledSheet()).map((parsed) => [parsed.name, parsed])
);

/**
 * The two themes a visitor can be in. `dark-explicit` duplicates `dark-os`, and
 * the library's own contract already proves the two blocks never diverge.
 */
export const MEASURED_THEMES = ["light", "dark-os"] as const satisfies readonly ThemeName[];

export type MeasuredTheme = (typeof MEASURED_THEMES)[number];

export function theme(name: MeasuredTheme): Theme {
  const found = THEMES.get(name);
  if (found === undefined) throw new Error(`thème absent de la feuille : ${name}`);

  return found;
}

/**
 * A token's value in `theme`, `var()` chains substituted.
 *
 * Throws on an absent token rather than returning undefined — a guard that skips
 * what it cannot find reports green on a sheet it never read.
 */
export function siteToken(name: MeasuredTheme, token: string): string {
  return resolveToken(theme(name), token);
}

/**
 * The paper grain's opacity, **read from the stylesheet that declares it** rather
 * than repeated here.
 *
 * This is what lets a texture exist in a repository whose colour argument rests
 * on flat substrates: the grain is bounded, so the worst ground an ink can meet
 * is computable — and it is computable *from the source*, so raising the opacity
 * in `paper-grain.module.css` moves every measurement instead of quietly
 * invalidating them. A number copied into this file would have been the third
 * copy of a value, which is the failure mode this whole suite exists to refuse.
 */
export function grainOpacity(): number {
  const css = readFileSync(path.join(SRC, "components/site/paper-grain.module.css"), "utf8");
  const declared = /--grain-opacity:\s*([0-9.]+)\s*;/.exec(css)?.[1];

  if (declared === undefined) {
    throw new Error(
      "`--grain-opacity` is not declared in paper-grain.module.css — the grain's bound is what makes it measurable, so a missing one is not a default, it is a broken contract"
    );
  }

  return Number(declared);
}

/**
 * The grain's own ink, per theme, and it is not a token: `feTurbulence`
 * synthesises greyscale noise from pure black to pure white, and the blend mode
 * decides which end does the work. `multiply` in the light theme keeps only the
 * dark end, `screen` in the dark theme keeps only the light one — so the worst
 * ground is black in light and white in dark, at `grainOpacity()`.
 */
export const GRAIN_INK: Readonly<Record<MeasuredTheme, string>> = {
  light: "#000000",
  "dark-os": "#ffffff",
};
