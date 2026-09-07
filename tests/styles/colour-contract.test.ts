import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { compositeLayers, contrastRatio, resolveToken, withAlpha } from "@thomascaron/ui/contract";
import { describe, expect, it } from "vitest";
import {
  GRAIN_INK,
  MEASURED_THEMES,
  assembledSheet,
  grainOpacity,
  siteToken,
  theme,
  type MeasuredTheme,
} from "./sheet";

const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * The colour contract of this site — the guard `src/styles/tokens.css` used to
 * lack.
 *
 * That file carried a comment promising its palette was "deliberately identical
 * to the portfolio's". Six tokens and both dark backgrounds had drifted anyway,
 * and nothing said a word, **because a comment is not a guard**. The palette now
 * comes from `@thomascaron/ui`, so that particular drift is structurally
 * impossible; this file guards the *other* half, which the shared library cannot
 * see: the fifty-odd contrast ratios written into the comments of this
 * repository's own CSS Modules.
 *
 * Those numbers are the review artefact. `world-map.module.css` chooses between
 * two country tints on the strength of a table; `trip-card.module.css` picks a
 * border by comparing three. A wrong number there is worse than no number,
 * because it is an argument that reads as if it had been checked.
 *
 * TWO ASSERTIONS, AND THE SECOND IS THE ONE THAT MAKES THIS A GUARD:
 *
 * 1. every measurement declared in {@link MEASUREMENTS} is recomputed from the
 *    real sheet, on the real composed substrate, in both themes;
 * 2. every `N.NN:1` string that appears anywhere in `src/**` OR in `README.md` is
 *    accounted for by a citation below. Write a new ratio into a comment or into
 *    the README without registering it and this suite fails — which is the only
 *    way a number cannot re-enter the repository unmeasured. `docs/adr/**` is out
 *    of scope on purpose: an ADR is a dated record, not a live claim.
 *
 * PROVEN BY DELIBERATE FAILURE, both halves, before this line was written:
 *
 *   1.33:1 → 1.34:1 in one comment of `latest-trips.module.css`
 *     FAIL … quotes only registered numbers
 *     expected { '1.34': 1 } to deeply equal { '1.33': 1 }
 *
 *   `:root { --accent: #0b7d90; }` appended to `src/styles/tokens.css`
 *     FAIL … declares no colour of its own outside the library
 *     FAIL … accent/surface: expected 4.32 to be 4.87
 *     FAIL … accent/page:    expected 4.02 to be 4.53
 *
 * The second is the interesting one: `#0b7d90` is the accent this project used
 * *before* the migration, so the failure is exactly the drift that went unnoticed
 * for the whole life of the old sheet.
 *
 * WHAT IT DOES NOT DO. It reads the stylesheet as text, so it proves the numbers
 * the comments claim, not that a browser paints those colours on those elements.
 * The pairing of a measurement with a rule is still a human claim; what is
 * mechanical is that the pair, once named, is arithmetically true. The browser's
 * half is covered elsewhere: `tests/e2e/map-equivalent.spec.ts` runs axe against
 * the rendered pages in both themes.
 */

/** A colour, per theme. Either a token to resolve or a stack to flatten. */
type Paint = (theme: MeasuredTheme) => string;

/** A token, resolved in `theme`. Throws on an absent token rather than skipping. */
const token =
  (name: string): Paint =>
  (activeTheme) =>
    siteToken(activeTheme, name);

/**
 * A stack of layers flattened to the opaque colour the eye receives, bottom
 * first. This is the whole reason the contract exists: `--accent-quiet` is
 * `rgba(8, 116, 135, 0.1)` and has no contrast of its own, only the contrast of
 * whatever it is painted on.
 */
const stack =
  (...layers: readonly (string | Paint)[]): Paint =>
  (name) =>
    compositeLayers(
      layers.map((layer) => (typeof layer === "string" ? siteToken(name, layer) : layer(name)))
    );

/* --- The substrates of this site, named once. -------------------------------
   Naming them here rather than inline is what stops a measurement from quietly
   being taken against `--site-background`, which is never the worst case. */

/**
 * **The page, grained — and this is the worst case, not the token.**
 *
 * TIW-38 laid a generated paper grain under the whole site. A texture has no
 * single colour, which is exactly the objection this suite had to answer rather
 * than be excused from. It answers it by measuring the ground a reader can
 * actually meet at its **darkest** (light theme, `multiply`, so the noise's black
 * end does the work) and at its **lightest** (dark theme, `screen`, the white
 * end) — both at the opacity `paper-grain.module.css` declares, read from that
 * file rather than repeated here.
 *
 * Every ink that sits on the page is therefore measured against a ground darker
 * (or lighter) than `--site-background`. Nothing on this site is measured against
 * the bare token any more, because nothing is painted on it.
 */
const page: Paint = (name) =>
  compositeLayers([
    siteToken(name, "--site-background"),
    withAlpha(GRAIN_INK[name], grainOpacity()),
  ]);

/** A card, a pill, the map's LAND — anything opaque sitting on the page. */
const surface = token("--surface");
/**
 * **The map's sea is the page itself since TIW-38**, grain included: the drawing
 * has no plate any more. Its land is `--surface`, opaque, so the grain does not
 * reach it — which is why land and sea are two different substrates here and were
 * two layers of one stack before.
 */
const sea = page;
const land = surface;
/** A visited country: the accent wash over land. */
const visitedFill = stack("--surface", "--accent-quiet");
/** An untold country: the copper wash over land (`color-mix(… 18%, transparent)`). */
const untoldFill = stack("--surface", (name) =>
  withAlpha(siteToken(name, "--accent-secondary"), 0.18)
);
/** The quiet accent plate of a chip or a nav pill, on the grained page. */
const quietOnPage: Paint = (name) =>
  compositeLayers([page(name), siteToken(name, "--accent-quiet")]);

/** The accent at an arbitrary alpha, to price a fill that was considered and refused. */
const accentAt = (alpha: number): Paint =>
  stack("--surface", (name) => withAlpha(siteToken(name, "--accent"), alpha));

/**
 * **The header's resting ink**: `--text-on-accent` at 80 %, on the accent fill it
 * is written over.
 *
 * `color-mix(in srgb, var(--text-on-accent) 80%, transparent)` is white with an
 * alpha of 0.8 and therefore has no contrast of its own — only the contrast of
 * the bar under it, which is the whole reason it is composited here rather than
 * measured as if it were a colour. `site-nav.module.css` explains why the recipe
 * is a mix and not an `opacity`, and this is what prices the two candidate bars
 * it chose between.
 */
const quietOnAccent = (bar: string): Paint =>
  stack(bar, (name) => withAlpha(siteToken(name, "--text-on-accent"), 0.8));

interface Measurement {
  /** What the comments call this pair. */
  readonly label: string;
  readonly foreground: Paint;
  readonly background: Paint;
  readonly light: number;
  readonly dark: number;
}

/**
 * Every ratio this repository claims, measured on the palette of
 * `@thomascaron/ui` v0.1.0.
 *
 * A translucent token never appears as a foreground: it is composited onto its
 * own substrate first and measured as the plate it really paints. The contract
 * refuses to do otherwise — `contrastRatio` throws on a translucent argument,
 * which is how the old numbers could not have been wrong in that particular way.
 */
const MEASUREMENTS = {
  "border-subtle/page": {
    label: "--border-subtle over the page",
    foreground: stack("--site-background", "--border-subtle"),
    background: page,
    light: 1.17,
    dark: 1.17,
  },
  "border-subtle/surface": {
    label: "--border-subtle over a card",
    foreground: stack("--surface", "--border-subtle"),
    background: surface,
    light: 1.34,
    dark: 1.35,
  },
  "text-accent/surface": {
    label: "--text-accent on a card",
    foreground: token("--text-accent"),
    background: surface,
    light: 7.08,
    dark: 8.59,
  },
  "text-muted/surface": {
    label: "--text-muted on a card",
    foreground: token("--text-muted"),
    background: surface,
    light: 7.25,
    dark: 8.77,
  },
  "text-accent/page": {
    label: "--text-accent on the page",
    foreground: token("--text-accent"),
    background: page,
    light: 5.76,
    dark: 7.1,
  },
  "text-muted/page": {
    label: "--text-muted on the page",
    foreground: token("--text-muted"),
    background: page,
    light: 5.9,
    dark: 7.25,
  },
  "control-border/page": {
    label: "--control-border on the page",
    foreground: token("--control-border"),
    background: page,
    light: 4.16,
    dark: 5.49,
  },
  "control-border/surface": {
    label: "--control-border on a card",
    foreground: token("--control-border"),
    background: surface,
    light: 5.11,
    dark: 6.64,
  },
  "control-border/land": {
    label: "--control-border on the map's land",
    foreground: token("--control-border"),
    background: land,
    light: 5.11,
    dark: 6.64,
  },
  "accent-quiet-border/page": {
    label: "--accent-quiet-border over the page",
    foreground: stack("--site-background", "--accent-quiet-border"),
    background: page,
    light: 1.57,
    dark: 1.57,
  },
  "accent-quiet-border/surface": {
    label: "--accent-quiet-border over a card",
    foreground: stack("--surface", "--accent-quiet-border"),
    background: surface,
    light: 1.83,
    dark: 1.85,
  },
  "accent/surface": {
    label: "--accent on a card",
    foreground: token("--accent"),
    background: surface,
    light: 4.86,
    dark: 3.4,
  },
  "accent/page": {
    label: "--accent on the page",
    foreground: token("--accent"),
    background: page,
    light: 3.96,
    dark: 2.81,
  },
  "surface/page": {
    label: "a card's fill against the page",
    foreground: surface,
    background: page,
    light: 1.23,
    dark: 1.21,
  },
  "land/sea": {
    label: "the map's land against its sea",
    foreground: land,
    background: sea,
    light: 1.23,
    dark: 1.21,
  },
  "text-accent/land": {
    label: "--text-accent on the map's land",
    foreground: token("--text-accent"),
    background: land,
    light: 7.08,
    dark: 8.59,
  },
  "visited-fill/land": {
    label: "a visited country's fill against bare land",
    foreground: visitedFill,
    background: land,
    light: 1.14,
    dark: 1.15,
  },
  "untold-fill/land": {
    label: "an untold country's half-strength fill against bare land",
    foreground: untoldFill,
    background: land,
    light: 1.33,
    dark: 1.28,
  },
  "accent-a50/land": {
    label: "the accent at alpha 0.5 against bare land — refused",
    foreground: accentAt(0.5),
    background: land,
    light: 2.08,
    dark: 1.73,
  },
  "accent-a80/land": {
    label: "the accent at alpha 0.8 against bare land — refused",
    foreground: accentAt(0.8),
    background: land,
    light: 3.45,
    dark: 2.6,
  },
  "accent-secondary/land": {
    label: "--accent-secondary, the untold country's outline, on the map's land",
    foreground: token("--accent-secondary"),
    background: land,
    light: 7.65,
    dark: 6.01,
  },
  "text-accent/visited-fill": {
    label: "--text-accent on the accent end of the card tile's gradient",
    foreground: token("--text-accent"),
    background: visitedFill,
    light: 6.18,
    dark: 7.49,
  },
  "text-accent/quiet-on-page": {
    label: "--text-accent on a quiet accent pill, on the page",
    foreground: token("--text-accent"),
    background: quietOnPage,
    light: 5.09,
    dark: 6.18,
  },
  "text-accent/text-body": {
    label: "--text-accent against the body text beside it",
    foreground: token("--text-accent"),
    background: token("--text-body"),
    light: 1.27,
    dark: 1.22,
  },
  "on-accent/accent": {
    label: "--text-on-accent on the accent bar",
    foreground: token("--text-on-accent"),
    background: token("--accent"),
    light: 5.44,
    dark: 5.44,
  },
  "accent-quiet-border/accent": {
    label:
      "--accent-quiet-border composited on the accent bar — the reason the language pair is a shape",
    foreground: (name) =>
      compositeLayers([siteToken(name, "--accent"), siteToken(name, "--accent-quiet-border")]),
    background: token("--accent"),
    light: 1,
    dark: 1,
  },
  "on-accent/accent-active": {
    label: "--text-on-accent on a hovered bar entry",
    foreground: token("--text-on-accent"),
    background: token("--accent-active"),
    light: 7.51,
    dark: 6.52,
  },
  "on-accent-a80/accent": {
    label: "the header's 80 % white on the OLD `--accent` bar — the reason the bar moved",
    foreground: quietOnAccent("--accent"),
    background: token("--accent"),
    light: 4.09,
    dark: 4.09,
  },
  "on-accent-a80/accent-active": {
    label: "the header's 80 % white on the `--accent-active` bar — a nav entry at rest",
    foreground: quietOnAccent("--accent-active"),
    background: token("--accent-active"),
    light: 5.43,
    dark: 4.79,
  },
  "on-accent/on-accent-a80": {
    label: "a bar entry's full white against its 80 % neighbours — a difference, not a contrast",
    foreground: token("--text-on-accent"),
    background: quietOnAccent("--accent-active"),
    light: 1.38,
    dark: 1.36,
  },
  "accent-secondary/accent": {
    label: "--accent-secondary on the old teal bar — the underline colour that was asked for",
    foreground: token("--accent-secondary"),
    background: token("--accent"),
    light: 1.57,
    dark: 1.77,
  },
  "accent-secondary/accent-active": {
    label: "--accent-secondary on the darkened bar — the same underline, refused",
    foreground: token("--accent-secondary"),
    background: token("--accent-active"),
    light: 1.14,
    dark: 2.12,
  },
  "logo-ink/page": {
    label: "--logo-ink on the page",
    foreground: token("--logo-ink"),
    background: page,
    light: 8.97,
    dark: 10.28,
  },
  "logo-accent/page": {
    label: "--logo-accent on the page",
    foreground: token("--logo-accent"),
    background: page,
    light: 5.76,
    dark: 7.1,
  },
  "logo-ink/logo-accent": {
    label: "--logo-ink against --logo-accent — the edge the mark must never have",
    foreground: token("--logo-ink"),
    background: token("--logo-accent"),
    light: 1.56,
    dark: 1.45,
  },
  /**
   * The two country outlines against **each other** — the pair an accessibility
   * audit measured on 7 September 2026 and the reason `.visited` is now stroked
   * 3.5 device pixels against `.untold`'s 2.
   *
   * It is registered rather than written as prose because it is a real contrast of
   * this sheet, and because the number is an *argument*: it says the hue carries
   * nothing, which is why the stroke width has to. If a future palette pulled these
   * two apart, this line is what would say so — and the thickness could then be
   * revisited on evidence instead of on memory.
   *
   * There is no threshold column for it, deliberately. WCAG sets none for two
   * non-textual objects distinguished from each other; 1.4.1 asks for a channel
   * that is not colour, and `tests/e2e/map-equivalent.populated.spec.ts` is what
   * checks that one exists.
   */
  "text-accent/accent-secondary": {
    label: "the told country's outline against the untold one's — hue alone, measured",
    foreground: token("--text-accent"),
    background: token("--accent-secondary"),
    light: 1.08,
    dark: 1.43,
  },
  /* `satisfies` and not a type annotation: an annotation widens the keys to
     `string`, and `Citation.measurement` — declared as `keyof typeof
     MEASUREMENTS` — would then accept any string and index into `undefined`
     under `noUncheckedIndexedAccess`. Measured: `tsc --noEmit` reported exactly
     that, on the two lines that read `entry.light`. */
} satisfies Readonly<Record<string, Measurement>>;

/**
 * Where each number is written, and which measurement it is.
 *
 * The point of this list is not documentation: it is what lets the scan below
 * assert that the set of numbers *found* in the source equals the set of numbers
 * *declared* here. A ratio nobody registered fails; a registration nobody uses
 * fails too.
 */
interface Citation {
  readonly file: string;
  readonly measurement: keyof typeof MEASUREMENTS;
  readonly theme: MeasuredTheme;
}

const CITATIONS: readonly Citation[] = [
  // --- src/app/[locale]/voyages/page.module.css
  {
    file: "src/app/[locale]/voyages/page.module.css",
    measurement: "border-subtle/page",
    theme: "light",
  },

  // --- src/app/[locale]/voyages/[slug]/withdrawn-notice.module.css
  {
    file: "src/app/[locale]/voyages/[slug]/withdrawn-notice.module.css",
    measurement: "border-subtle/page",
    theme: "light",
  },

  // --- src/components/map/world-map.module.css
  {
    file: "src/components/map/world-map.module.css",
    measurement: "text-accent/accent-secondary",
    theme: "light",
  },
  //     The coastline argument, then the three country states.
  {
    file: "src/components/map/world-map.module.css",
    measurement: "border-subtle/page",
    theme: "light",
  },
  { file: "src/components/map/world-map.module.css", measurement: "land/sea", theme: "light" },
  { file: "src/components/map/world-map.module.css", measurement: "land/sea", theme: "dark-os" },
  { file: "src/components/map/world-map.module.css", measurement: "land/sea", theme: "light" },
  {
    file: "src/components/map/world-map.module.css",
    measurement: "control-border/land",
    theme: "light",
  },
  {
    file: "src/components/map/world-map.module.css",
    measurement: "control-border/land",
    theme: "dark-os",
  },
  {
    file: "src/components/map/world-map.module.css",
    measurement: "control-border/page",
    theme: "light",
  },
  {
    file: "src/components/map/world-map.module.css",
    measurement: "control-border/page",
    theme: "dark-os",
  },
  {
    file: "src/components/map/world-map.module.css",
    measurement: "visited-fill/land",
    theme: "light",
  },
  {
    file: "src/components/map/world-map.module.css",
    measurement: "visited-fill/land",
    theme: "light",
  },
  {
    file: "src/components/map/world-map.module.css",
    measurement: "accent-a50/land",
    theme: "light",
  },
  {
    file: "src/components/map/world-map.module.css",
    measurement: "accent-a80/land",
    theme: "light",
  },
  {
    file: "src/components/map/world-map.module.css",
    measurement: "text-accent/land",
    theme: "light",
  },
  {
    file: "src/components/map/world-map.module.css",
    measurement: "text-accent/land",
    theme: "dark-os",
  },

  {
    file: "src/components/map/world-map.module.css",
    measurement: "text-accent/land",
    theme: "light",
  },
  {
    file: "src/components/map/world-map.module.css",
    measurement: "accent-secondary/land",
    theme: "light",
  },

  // --- src/components/map/world-map.tsx
  { file: "src/components/map/world-map.tsx", measurement: "visited-fill/land", theme: "light" },

  // --- src/components/timeline/trip-mini-map.module.css
  {
    file: "src/components/timeline/trip-mini-map.module.css",
    measurement: "land/sea",
    theme: "light",
  },
  {
    file: "src/components/timeline/trip-mini-map.module.css",
    measurement: "border-subtle/page",
    theme: "light",
  },
  {
    file: "src/components/timeline/trip-mini-map.module.css",
    measurement: "visited-fill/land",
    theme: "light",
  },
  {
    file: "src/components/timeline/trip-mini-map.module.css",
    measurement: "text-accent/land",
    theme: "light",
  },

  // --- src/components/timeline/trip-timeline.module.css
  {
    file: "src/components/timeline/trip-timeline.module.css",
    measurement: "control-border/page",
    theme: "light",
  },
  {
    file: "src/components/timeline/trip-timeline.module.css",
    measurement: "control-border/page",
    theme: "dark-os",
  },
  {
    file: "src/components/timeline/trip-timeline.module.css",
    measurement: "border-subtle/page",
    theme: "light",
  },

  // --- src/components/timeline/trip-header.module.css — the exit pills, and the
  //     token the grain forced them onto.
  {
    file: "src/components/timeline/trip-header.module.css",
    measurement: "text-accent/page",
    theme: "light",
  },
  {
    file: "src/components/timeline/trip-header.module.css",
    measurement: "accent-quiet-border/page",
    theme: "light",
  },
  {
    file: "src/components/timeline/trip-header.module.css",
    measurement: "text-accent/text-body",
    theme: "light",
  },
  {
    file: "src/components/timeline/trip-header.module.css",
    measurement: "text-accent/quiet-on-page",
    theme: "light",
  },
  {
    file: "src/components/timeline/trip-header.module.css",
    measurement: "accent/page",
    theme: "light",
  },
  {
    file: "src/components/timeline/trip-header.module.css",
    measurement: "accent/page",
    theme: "dark-os",
  },

  // --- src/components/trips/trip-card.module.css
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "border-subtle/page",
    theme: "light",
  },
  // `.card:hover` — the rule the shared palette forced to change.
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "accent-quiet-border/surface",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "accent-quiet-border/surface",
    theme: "dark-os",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "control-border/surface",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "accent-quiet-border/surface",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "text-accent/surface",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "text-accent/surface",
    theme: "dark-os",
  },
  // `.tile` — the gradient, measured at both ends.
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "text-accent/land",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "text-accent/visited-fill",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "text-accent/visited-fill",
    theme: "dark-os",
  },
  // `.badge` — the hairline edge.
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "text-accent/land",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "accent-quiet-border/surface",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "accent-quiet-border/surface",
    theme: "dark-os",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "text-accent/surface",
    theme: "light",
  },
  // `.cta` — the pill's own text, the three-token table, then the same ranking
  //          on the page behind the card.
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "text-accent/surface",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "accent-quiet-border/surface",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "accent-quiet-border/surface",
    theme: "dark-os",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "accent/surface",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "accent/surface",
    theme: "dark-os",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "control-border/surface",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "control-border/surface",
    theme: "dark-os",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "accent-quiet-border/page",
    theme: "light",
  },
  { file: "src/components/trips/trip-card.module.css", measurement: "accent/page", theme: "light" },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "control-border/page",
    theme: "light",
  },
  {
    file: "src/components/trips/trip-card.module.css",
    measurement: "accent-quiet-border/surface",
    theme: "light",
  },

  // --- src/components/site/site-brand.module.css — why the ink token is
  //     re-pointed on the bar rather than kept.
  //
  //     The three `on-accent` readings that used to be registered here were the
  //     medallion's: what the mark measured against the disc it sat in. The owner
  //     chose the "Deux temps" lock-up on 7 September 2026 and the disc went with
  //     the choice, so the pairs it justified left the file. What the wordmark
  //     itself reads against the bar is `on-accent/accent-active`, and it is
  //     registered where the bar is declared — `site-nav.module.css`, below.
  {
    file: "src/components/site/site-brand.module.css",
    measurement: "logo-ink/logo-accent",
    theme: "light",
  },

  /* --- src/components/site/site-nav.module.css — the bar, the two states of an
     entry, and the two refusals TIW-38 wrote down.

     The file no longer quotes `on-accent/accent` (5.44) nor
     `accent-quiet-border/accent` (1.00): both belonged to the `--accent` bar and
     to the filled language pill that replaced. What it quotes instead is the pair
     that decided the new bar — 80 % white at 4.09:1 on `--accent` against 5.43:1
     on `--accent-active` — and the pair that decided the underline's colour. */

  // `.bar`, on why the fill moved: 4.09 / 5.43 / 4.79 / 7.51 / 6.52.
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent-a80/accent",
    theme: "light",
  },
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent-a80/accent-active",
    theme: "light",
  },
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent-a80/accent-active",
    theme: "dark-os",
  },
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent/accent-active",
    theme: "light",
  },
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent/accent-active",
    theme: "dark-os",
  },

  // `.link`, the resting entry: 5.43 / 4.79.
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent-a80/accent-active",
    theme: "light",
  },
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent-a80/accent-active",
    theme: "dark-os",
  },

  // `.link:hover`, the entry under the pointer: 5.43 → 7.51.
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent-a80/accent-active",
    theme: "light",
  },
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent/accent-active",
    theme: "light",
  },

  // The current-page underline: the secondary colour refused at 1.57 and 1.14,
  // the white it is drawn in at 7.51, and the label's second channel at 1.38 /
  // 1.36.
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "accent-secondary/accent",
    theme: "light",
  },
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "accent-secondary/accent-active",
    theme: "light",
  },
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent/accent-active",
    theme: "light",
  },
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent/on-accent-a80",
    theme: "light",
  },
  {
    file: "src/components/site/site-nav.module.css",
    measurement: "on-accent/on-accent-a80",
    theme: "dark-os",
  },

  // --- src/components/trips/latest-trips.module.css
  {
    file: "src/components/trips/latest-trips.module.css",
    measurement: "border-subtle/page",
    theme: "light",
  },

  // --- src/components/trips/fresh-trip-banner.module.css
  {
    file: "src/components/trips/fresh-trip-banner.module.css",
    measurement: "border-subtle/page",
    theme: "light",
  },

  // --- src/components/site/brand-art.ts
  //     The mark the owner supplied on 7 September 2026 has no accented part, so
  //     the two `logo-accent/page` readings left the file with the trajectory
  //     they justified. The ink/accent pair stays: the header still recounts why
  //     the *old* mark needed a clearance, and a historical claim quoted with a
  //     live number has to keep being a live number.
  { file: "src/components/site/brand-art.ts", measurement: "logo-ink/logo-accent", theme: "light" },
  {
    file: "src/components/site/brand-art.ts",
    measurement: "logo-ink/logo-accent",
    theme: "dark-os",
  },
  { file: "src/components/site/brand-art.ts", measurement: "logo-ink/page", theme: "light" },
  { file: "src/components/site/brand-art.ts", measurement: "logo-ink/page", theme: "dark-os" },

  // --- README.md — the "Marque" and "Carte" sections quote the same pairs, in
  //     French decimal notation.
  { file: "README.md", measurement: "logo-ink/logo-accent", theme: "light" },
  { file: "README.md", measurement: "logo-ink/logo-accent", theme: "dark-os" },
  { file: "README.md", measurement: "logo-ink/page", theme: "light" },
  { file: "README.md", measurement: "logo-ink/page", theme: "dark-os" },
  { file: "README.md", measurement: "border-subtle/page", theme: "light" },
];

/**
 * The `N.NN:1` strings in `src/**` that are NOT a contrast measurement.
 *
 * Kept as an explicit list rather than a smarter regex, because the two kinds are
 * genuinely indistinguishable in text and the cost of guessing wrong runs in one
 * direction only: a threshold silently classified as a measurement would be
 * "verified" against nothing.
 *
 * A HISTORICAL ratio never belongs here — it belongs written without its `:1`. A
 * number that used to be true is not a measurement of this sheet, and dressing it
 * as one is exactly the drift this suite exists to refuse.
 */
const NOT_A_CONTRAST: Readonly<Record<string, readonly string[]>> = {
  // The Open Graph image is 1200 x 630 — an aspect ratio, not a contrast.
  "src/app/share.ts": ["1.91"],
};

/** Two decimals, the precision the comments are written in. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

function measure(entry: Measurement, name: MeasuredTheme): number {
  return round2(contrastRatio(entry.foreground(name), entry.background(name)));
}

describe("the sheet the site actually ships", () => {
  it("assembles the shared palette, not a local copy of it", () => {
    const light = theme("light");

    // A primitive from `@thomascaron/ui`, reachable only if the import resolved.
    expect(light.tokens.get("--tc-teal-515")).toBe("#087487");
    /**
     * Paper in light since @thomascaron/ui v0.2.0, `mist` in dark. The pair is
     * asserted rather than the light one alone: the whole point of the paper
     * family is that it warms the GROUNDS and only the grounds, so a dark theme
     * that had gone warm too would be the change having escaped its scope.
     */
    expect(resolveToken(light, "--site-background")).toBe("#f2e9d6");
    expect(resolveToken(theme("dark-os"), "--site-background")).toBe("#0f191c");
  });

  it("declares no colour of its own outside the library", () => {
    const local = readFileSync(path.join(ROOT, "src/styles/tokens.css"), "utf8");

    expect(local).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(local).not.toMatch(/\brgba?\(/);
  });

  it("leaves no @import un-inlined", () => {
    /**
     * `assembledSheet` inlines by regular expression, so a form it does not match
     * — `@import url(…)`, an import carrying a `layer()` or a media query — would
     * pass through untouched and the tokens behind it would simply be absent.
     * `resolveToken` throws on an absent token, so the failure would be loud
     * rather than silent; this makes it loud AND legible, at the right place.
     */
    expect(assembledSheet()).not.toMatch(/@import/);
  });

  it("declares no theme block of its own, which is what makes two themes enough", () => {
    /**
     * This suite measures `light` and `dark-os` and skips `dark-explicit`, on the
     * grounds that the library's own contract proves its two dark blocks never
     * diverge. That proof covers the LIBRARY's sheet, not this project's layer —
     * so the day the local sheet grows a `[data-theme="dark"]` block of its own,
     * the reasoning lapses and nothing else would notice.
     *
     * The local layer declares its tokens once, in a bare `:root`, and the three
     * `--logo-*` are aliases that follow whatever theme is active. Red here means
     * that stopped being true: either measure `dark-explicit` too, or put the
     * declaration back where it belongs, in the shared sheet.
     */
    const local = readFileSync(path.join(ROOT, "src/styles/tokens.css"), "utf8");

    expect(local).not.toMatch(/prefers-color-scheme/);
    expect(local).not.toMatch(/\[data-theme/);
  });

  it("keeps the logo tokens as aliases, so no dark block can forget them", () => {
    for (const name of ["--logo-ink", "--logo-accent", "--logo-bg"]) {
      const light = resolveToken(theme("light"), name);
      const dark = resolveToken(theme("dark-os"), name);

      expect(
        light,
        `${name} is the same colour in both themes — the alias is not following`
      ).not.toBe(dark);
    }
  });
});

describe.each(MEASURED_THEMES)("every claimed ratio, recomputed in the %s theme", (name) => {
  it.each(Object.entries(MEASUREMENTS))("%s", (key, entry) => {
    const claimed = name === "light" ? entry.light : entry.dark;

    expect(
      measure(entry, name),
      `${entry.label} (${key}) is written as ${claimed.toFixed(2)}:1 in the ${name} theme`
    ).toBe(claimed);
  });
});

/* --- The scan. ---------------------------------------------------------------
   Reads every source file for `N.NN:1` and compares what it finds, file by file,
   with what CITATIONS declares. This is the half that makes the suite a guard
   rather than a table: an unregistered number cannot enter the repository. */

/**
 * `7.10:1` and `7,10:1` alike: the CSS Modules are written in English and the
 * README in French, and a guard that only saw one of the two decimal separators
 * would report green on every number in the document a reader is most likely to
 * trust.
 */
const RATIO = /\d+[.,]\d+(?=:1)/g;

/** `"7,10"` → `"7.10"`, so both spellings tally as the same measurement. */
const normalise = (value: string): string => value.replace(",", ".");

/**
 * Everything whose prose may quote a measurement: the sources, and the README.
 *
 * `docs/adr/**` is deliberately NOT scanned. This repository's convention is that
 * an ADR carries the figures of the day it was decided and is never rewritten
 * when they move — a dated record is the point of the document. The README is the
 * opposite: it describes the site as it is now, so its numbers are claims and
 * belong under the guard.
 */
function scannedFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return scannedFiles(full);

    return /\.(css|ts|tsx)$/.test(entry) ? [path.relative(ROOT, full)] : [];
  });
}

const SCANNED = [...scannedFiles(path.join(ROOT, "src")), "README.md"];

/** `["1.33", "1.33"]` → `{"1.33": 2}`: a ratio quoted twice must be declared twice. */
function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;

  return counts;
}

/** Every `N.NN:1` in a file, less the ones registered as not being contrasts. */
function contrastsIn(file: string): readonly string[] {
  const excused = [...(NOT_A_CONTRAST[file] ?? [])];

  return (readFileSync(path.join(ROOT, file), "utf8").match(RATIO) ?? [])
    .map(normalise)
    .filter((value) => {
      const at = excused.indexOf(value);
      if (at === -1) return true;
      excused.splice(at, 1);

      return false;
    });
}

const FOUND = new Map<string, readonly string[]>(
  SCANNED.map((file) => [file, contrastsIn(file)] as const).filter(
    ([, matches]) => matches.length > 0
  )
);

const DECLARED = new Map<string, string[]>();
for (const citation of CITATIONS) {
  const entry = MEASUREMENTS[citation.measurement];
  const value = (citation.theme === "light" ? entry.light : entry.dark).toFixed(2);
  DECLARED.set(citation.file, [...(DECLARED.get(citation.file) ?? []), value]);
}

describe("no ratio enters the source unregistered", () => {
  it("cites exactly the files that quote a ratio", () => {
    expect([...DECLARED.keys()].sort()).toEqual([...FOUND.keys()].sort());
  });

  it.each([...DECLARED.keys()].sort())("%s quotes only registered numbers", (file) => {
    expect(
      tally(FOUND.get(file) ?? []),
      `the ratios written in ${file} do not match what CITATIONS declares for it`
    ).toEqual(tally(DECLARED.get(file) ?? []));
  });

  it("scans a corpus that is actually there", () => {
    // The failure this refuses: a bad glob finds nothing, every check above
    // passes on an empty set, and the suite reports green having read no file.
    expect(FOUND.size).toBeGreaterThanOrEqual(10);
    expect([...FOUND.values()].flat().length).toBeGreaterThanOrEqual(50);
  });
});
