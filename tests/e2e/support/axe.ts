import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

/**
 * An automated WCAG audit of a real served page, run by axe-core inside the
 * browser Playwright is already driving.
 *
 * **Why axe-core is injected rather than wrapped.** `@axe-core/playwright` is the
 * usual door and it is one more dependency for one `addScriptTag`. `axe-core`
 * itself was already resolved in this tree as a transitive dependency of
 * `eslint-plugin-jsx-a11y`; this ticket promoted it to an explicit
 * `devDependency` — two lines of `package-lock.json`, no download — so that the
 * audit does not rest on another package's dependency graph. It ships nothing to
 * the client: the script is added to a page under test and never to a bundle.
 *
 * **What an automated audit does and does not prove.** axe-core finds a subset of
 * WCAG failures — contrast it can compute, names it can find, roles it can check
 * — and cannot judge whether a name is *useful*, whether a keyboard path is
 * *sensible*, or whether an equivalent says the same thing as the picture it
 * replaces. Zero violations is a floor, which is exactly why the acceptance
 * criteria ask for an explicit keyboard journey **as well as** this.
 *
 * Not a spec file: `testMatch` only picks up `*.spec.ts`, so this module is
 * imported and never run on its own.
 */

/**
 * Read once, at module load, from the resolved package rather than from a copy.
 * A stale vendored `axe.min.js` is an audit reporting on a version nobody has.
 */
const AXE_SOURCE = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

/**
 * WCAG 2.2 level AA, which is the target `AGENTS.md` and the acceptance criteria
 * name. Stated as tags rather than left to the default: axe's default set also
 * carries "best-practice" rules, and a suite that fails on those is a suite whose
 * failures nobody can act on against a stated standard.
 */
const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export type AxeViolation = {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  /** The elements the rule fired on, as CSS selectors, for a readable failure. */
  readonly targets: readonly string[];
};

export type AxeReport = {
  readonly violations: readonly AxeViolation[];
  /** Rules that passed. Reported so a green run cannot be an empty run. */
  readonly passes: number;
  /**
   * Rules axe could not decide — never a failure, always worth printing.
   *
   * With one carved-out exception, which is why this comment is longer than the
   * field: a `color-contrast` node whose ratio is *exactly* 1.0 is moved into
   * `violations` above. See the note in `auditPage`. It still appears in this
   * list, because the rule as a whole remains undecided for its other nodes.
   */
  readonly incomplete: readonly string[];
};

type RawResults = {
  violations: {
    id: string;
    impact: string | null;
    help: string;
    nodes: { target: string[] }[];
  }[];
  passes: { id: string }[];
  incomplete: {
    id: string;
    impact: string | null;
    help: string;
    nodes: {
      target: string[];
      any?: { data?: { messageKey?: string } | null }[];
      all?: { data?: { messageKey?: string } | null }[];
      none?: { data?: { messageKey?: string } | null }[];
    }[];
  }[];
};

declare global {
  interface Window {
    axe?: {
      run: (
        context: unknown,
        options: { runOnly: { type: "tag"; values: string[] } }
      ) => Promise<RawResults>;
    };
  }
}

/** Runs the audit over the whole document and flattens the result. */
export async function auditPage(page: Page): Promise<AxeReport> {
  await page.addScriptTag({ content: AXE_SOURCE });

  return page.evaluate(async (tags) => {
    if (window.axe === undefined) {
      throw new Error("axe-core did not install itself on the page; the injection failed.");
    }

    const results = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });

    /**
     * The one `incomplete` result this project refuses to treat as undecided.
     *
     * Measured while TIW-26 audited the four screens: axe reports a contrast
     * ratio of *exactly* 1.0 — foreground and background resolving to the same
     * colour, which is text nobody can read — as `incomplete` with
     * `messageKey: "equalRatio"`, and NOT as a violation. Its reasoning is
     * defensible in general: identical colours are how a decorative or
     * deliberately hidden node often looks, and axe will not guess. But every
     * assertion in this repository reads `report.violations`, so the worst
     * contrast expressible in CSS passed all eleven audits.
     *
     * Promoted here, at the choke point, rather than asserted in each spec: the
     * hole existed *because* it lived between the helper and its callers, and a
     * guard added to eleven files is a guard the twelfth forgets.
     *
     * Only `equalRatio`, deliberately. `incomplete` legitimately carries
     * `color-contrast` entries on a clean build — the zoom buttons' glyphs, the
     * `<figcaption>`, the timeline badge — where axe cannot resolve a composited
     * or gradient background. Failing on "any incomplete" would go red for the
     * wrong reason and be switched off within a month.
     */
    const equalRatio = results.incomplete.flatMap((entry) =>
      entry.id !== "color-contrast"
        ? []
        : entry.nodes
            .filter((node) =>
              [node.any, node.all, node.none]
                .flat()
                .some((check) => check?.data?.messageKey === "equalRatio")
            )
            .map((node) => ({
              id: "color-contrast",
              impact: entry.impact,
              help: `${entry.help} — foreground and background are the same colour (ratio 1.0), so the text is invisible`,
              targets: node.target,
            }))
    );

    return {
      violations: [
        ...results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          targets: violation.nodes.flatMap((node) => node.target),
        })),
        ...equalRatio,
      ],
      passes: results.passes.length,
      incomplete: results.incomplete.map((entry) => entry.id),
    };
  }, WCAG_22_AA);
}

/**
 * True when every element a rule fired on lies inside the map's own `<figure>` —
 * the one holding the `<svg>`.
 *
 * Used to confine one known, documented violation to the layer that owns it (see
 * the `target-size` note in `map-equivalent.populated.spec.ts`). Resolved in the
 * page against the live DOM rather than pattern-matched against CSS Module class
 * names, whose hashes change with every edit to the stylesheet — and the map's
 * textual equivalent is deliberately a *sibling* of that figure, so "inside the
 * figure" is exactly the distinction that matters.
 *
 * **`closest("figure")` alone is not enough**, and the first version stopped
 * there. `/fr` happens to hold exactly one `<figure>` today, so the allowance was
 * correctly confined by luck; the day a trip thumbnail is wrapped in one — the
 * trip page's mini-map already has a `<figure>` — a `target-size` failure on a
 * thumbnail link would have been swallowed in silence. So the figure must be the
 * one containing the drawing.
 *
 * An empty target list answers `false`: with nothing to place, the violation is
 * *reported* rather than tolerated, which is the safe direction. Same for the
 * selectors axe cannot resolve here (a frame path into an iframe or a shadow
 * root) — they fail the `closest` test and the violation is reported.
 */
export async function firedOnlyInsideTheMap(
  page: Page,
  targets: readonly string[]
): Promise<boolean> {
  if (targets.length === 0) {
    return false;
  }

  return page.evaluate(
    (selectors) => {
      const mapFigure = document.querySelector("figure:has(svg)");

      if (mapFigure === null) {
        return false;
      }

      return selectors.every((selector) => {
        const element = document.querySelector(selector);

        return element !== null && element.closest("figure") === mapFigure;
      });
    },
    [...targets]
  );
}

/** A failure message that names the rule and the element, not just a count. */
export const describeViolations = (report: AxeReport): string =>
  report.violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "no impact"}): ${violation.help} — ${violation.targets.join(", ")}`
    )
    .join("\n");
