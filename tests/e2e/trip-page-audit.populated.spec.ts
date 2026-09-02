import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations, firedOnlyInsideTheMap } from "./support/axe";

/**
 * The automated accessibility audit on **the one screen the criterion names that
 * nothing audited**.
 *
 * TIW-26 asks for "aucune violation d'accessibilité automatique bloquante … sur
 * l'accueil, la carte, la liste et une page de voyage". Inventoried before writing
 * a line, the first three were already covered and the fourth was not:
 *
 * | écran                    | où                                                          |
 * | ------------------------ | ----------------------------------------------------------- |
 * | accueil `/fr`            | `map-equivalent.spec.ts`, `map-equivalent.populated.spec.ts` |
 * | la carte, panneau ouvert | `map-interaction.populated.spec.ts`                          |
 * | la liste `/fr/voyages`   | `map-equivalent.*`, `fresh-trip.populated.spec.ts`           |
 * | une page de voyage       | **rien** — this file                                        |
 * | (`/fr/a-propos`)         | `about.spec.ts`, beyond the criterion                       |
 *
 * And it is the richest page of the site: a header with a definition list, a
 * mini-map with numbered stops, a timeline of stays and moves with transport
 * icons, a photo grid, and a modal viewer. Five component families whose contrast
 * pairings and heading order nothing had ever checked against a real layout.
 *
 * The audit harness is `./support/axe.ts` — injected axe-core at WCAG 2.2 AA, no
 * wrapper package — and it is reused rather than rewritten, including its one
 * documented allowance, which this file narrows further below.
 *
 * **Why populated.** `content/trips` is empty until TIW-24, so on the repository's
 * own content this route prerenders zero pages and there is nothing to audit.
 *
 * **What the audit cannot see here, stated rather than left to be found.** The
 * photographs answer 404 on this server — `playwright.content.config.ts` explains
 * that `next start` serves the repository's `public/` and no configuration moves
 * it. Every box, alt text, role and contrast is real, and axe judges markup and
 * computed style rather than decoded pixels, so nothing below is weakened by it.
 * The one thing it would catch and cannot is text laid over a photograph, which
 * this page does not do.
 */

const TRIP = "/fr/voyages/japon-2024";

/**
 * The known allowance, inherited and **narrowed**.
 *
 * `map-equivalent.populated.spec.ts` records at length why `target-size` fires on
 * the world map's overlapping markers and why that is TIW-14's business rather
 * than a defect this suite can fix. This page has a map too — the trip's own
 * mini-map, one marker per city — so the same rule can fire here for a related
 * reason, and it is tolerated on exactly the same terms: the rule must be
 * `target-size`, and every element it fired on must be inside the figure holding
 * the drawing. The timeline, the header and the gallery are siblings of that
 * figure, so a failure on any of them is reported.
 */
const KNOWN_MARKER_OVERLAP = "target-size";

type Violation = {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly targets: readonly string[];
};

for (const colorScheme of ["light", "dark"] as const) {
  test(`the trip page has no WCAG 2.2 AA violation in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(TRIP);

    // The page really is the one this file assumes: a header, a mini-map, a
    // timeline and a gallery. An audit of a 404 would be a green run.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Japon, printemps 2024");
    await expect(page.locator("[data-photo-index]")).toHaveCount(3);

    const report = await auditPage(page);

    const unexpected: Violation[] = [];
    for (const violation of report.violations) {
      const confinedToTheDrawing =
        violation.id === KNOWN_MARKER_OVERLAP &&
        (await firedOnlyInsideTheMap(page, violation.targets));

      if (!confinedToTheDrawing) {
        unexpected.push(violation);
      }
    }

    expect(
      unexpected,
      `${TRIP} (${colorScheme}) : ${describeViolations({ ...report, violations: unexpected })}`
    ).toEqual([]);

    // A green audit on a page axe never really inspected is the failure mode the
    // harness's own header warns about: zero violations and zero passes is an
    // empty run.
    expect(
      report.passes,
      "axe n'a fait passer aucune règle : l'audit a tourné sur rien."
    ).toBeGreaterThan(10);
  });
}

/**
 * The photo viewer, open — the second of the milestone's two `'use client'`
 * components, and a state no audit had ever reached.
 *
 * It is a native `<dialog>` in the top layer, which is precisely what makes an
 * audit of the closed page say nothing about it: the modal's own contrast, the
 * accessible names of its three controls and its position announcement are all in
 * markup that does not exist until a photograph is clicked. No allowance here —
 * the drawing is not involved.
 */
test("the photo viewer has no WCAG 2.2 AA violation once it is open", async ({ page }) => {
  await page.goto(TRIP);
  await page.locator("[data-photo-index]").first().click();

  const viewer = page.getByRole("dialog", { name: frMessages.photos.viewerHeading });
  await expect(viewer).toBeVisible();

  /**
   * **Wait for the entry animation to finish, and this line is the whole lesson of
   * this file.**
   *
   * `photo-lightbox.module.css` fades the viewer in over 160 ms
   * (`@keyframes photo-viewer-in`, `opacity: 0 → 1`). Auditing as soon as the
   * dialog is *visible* therefore measures colours that are still blended with
   * whatever is behind them, and axe reported a contrast failure that does not
   * exist on the rendered page. Measured, on the position indicator
   * (`<p aria-live="polite">Photo 1 sur 3</p>`):
   *
   * | thème | premier plan vu par axe | fond      | rapport | attendu |
   * | ----- | ----------------------- | --------- | ------- | ------- |
   * | clair | `#8aa3ab`               | `#c4d8de` | 1,79:1  | 4,5:1   |
   * | sombre| `#2a3942`               | `#081721` | 1,52:1  | 4,5:1   |
   *
   * Neither foreground is a token: `--text-muted` is `#31505c` in the light theme
   * and `#d3e2e9` in the dark one. Both are the token composited at partial
   * opacity — the fade, caught mid-flight. Once it has finished the same audit is
   * clean.
   *
   * It is worth a paragraph rather than a `waitForTimeout` because the failure was
   * *credible*: a serious contrast violation, in both themes, on a screen no audit
   * had ever reached, with a plausible one-line fix in a stylesheet. Believing it
   * would have changed a colour nobody needed to change. An audit that runs during
   * an animation is a false red, and it is the exact mirror of the false green this
   * ticket exists to find.
   *
   * The animations are awaited rather than slept through, and infinite ones are
   * filtered out — one of those never resolves, and the wait would simply hang.
   */
  await viewer.evaluate(async (node) => {
    const running = node
      .getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);

    await Promise.all(running.map((animation) => animation.finished));
  });

  const report = await auditPage(page);

  expect(report.violations, `visionneuse ouverte : ${describeViolations(report)}`).toEqual([]);
  expect(
    report.passes,
    "axe n'a fait passer aucune règle : l'audit a tourné sur rien."
  ).toBeGreaterThan(10);
});
