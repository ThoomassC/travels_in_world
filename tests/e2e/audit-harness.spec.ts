import { expect, test } from "@playwright/test";
import { auditPage, describeViolations } from "./support/axe";

/**
 * The audit harness, audited.
 *
 * Every accessibility assertion in this suite reads `report.violations` from
 * `auditPage`. That makes the helper a single point of failure of a particular
 * kind: it does not go red when it stops catching something, it goes green. So
 * the harness gets the same treatment as the ESLint boundaries in
 * `tests/lint/**` — a test that proves it still refuses what it claims to
 * refuse.
 *
 * **The hole this file was written for.** Measured on 2026-09-02, before the
 * fix: axe reports a contrast ratio of *exactly* 1.0 — foreground and
 * background resolving to the same colour, which is text nobody can read — as
 * `incomplete` with `messageKey: "equalRatio"`, never as a violation. With the
 * probe below on the previous helper the audit answered **0 violations**; with
 * the promotion in `auditPage` it answers **1**. The worst contrast expressible
 * in CSS passed all eleven audits of this suite, on every screen, in both
 * colour schemes.
 *
 * Found by TIW-26 while inventorying what the accessibility criterion actually
 * guarded, and left unfixed there on purpose: `support/axe.ts` was owned by
 * TIW-18 at the time.
 */
test.describe("the accessibility harness", () => {
  test("counts a contrast ratio of exactly 1.0 as a violation, not as undecided", async ({
    page,
  }) => {
    await page.goto("/fr");

    /*
      A hex colour rather than a named one, and `color`/`background-color` on the
      same element: axe resolves the background by walking ancestors, so a probe
      that set only the foreground would inherit the page's background and
      measure a real ratio instead of the degenerate one.
    */
    await page.addStyleTag({
      content: ".probe-equal-contrast { color: #123456; background-color: #123456; }",
    });
    await page.evaluate(() => {
      const paragraph = document.createElement("p");
      paragraph.className = "probe-equal-contrast";
      paragraph.textContent = "Texte dont le contraste vaut exactement 1,0.";
      document.body.append(paragraph);
    });

    const report = await auditPage(page);
    const contrast = report.violations.filter((violation) => violation.id === "color-contrast");

    expect(contrast, describeViolations(report)).not.toEqual([]);
    expect(contrast.some((violation) => violation.targets.some((t) => t.includes("probe")))).toBe(
      true
    );
  });

  /**
   * The other half of the promotion, and the reason it is narrow.
   *
   * `incomplete` legitimately carries `color-contrast` entries on a clean build
   * — the zoom buttons' glyphs, the `<figcaption>`, the timeline badge — where
   * axe cannot resolve a composited or gradient background. A guard written as
   * "no incomplete at all" would go red for the wrong reason and be switched
   * off within a month, so this case pins that `/fr` audits clean *while* the
   * rule may still be undecided elsewhere on the page.
   */
  test("leaves a genuinely undecided contrast undecided", async ({ page }) => {
    await page.goto("/fr");

    const report = await auditPage(page);

    expect(report.violations, describeViolations(report)).toEqual([]);
    expect(report.passes).toBeGreaterThan(10);
  });
});
