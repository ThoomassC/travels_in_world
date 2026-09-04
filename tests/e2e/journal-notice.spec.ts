import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations } from "./support/axe";

/**
 * The journal-state notice (TIW-35) on served, prerendered pages — on the journal
 * that **has no récit**, which is the repository's own content and therefore
 * production today.
 *
 * **What only this file can see.** The rule is a pure function, asserted case by
 * case in `tests/domain/trip.test.ts`; the chain from the YAML to the rule is
 * asserted in `tests/app/journal-notice-pipeline.test.ts`; the markup is asserted
 * under jsdom in `tests/components/site/journal-notice.test.tsx`. What none of them
 * can reach is the three things that only exist in a browser: whether the bytes a
 * CDN would serve actually carry the sentence on *every* route, whether it survives
 * axe in both colour schemes, and **where the map's figure ends** once the notice is
 * on the page. A notice computed correctly and rendered into a client-only branch
 * would pass every test above and be absent from the document.
 *
 * The mirror half — the notice **gone** on a journal that holds récits — is
 * `journal-notice.populated.spec.ts`, and that is the case the acceptance criteria
 * call the one that counts.
 */

/** Every route a reader can reach under `[locale]` on the empty journal. */
const ROUTES = ["/fr", "/fr/voyages", "/fr/a-propos"] as const;

const notice = frMessages.trips;

test.describe("a journal with no récit", () => {
  for (const route of ROUTES) {
    test(`carries the notice on ${route}`, async ({ page }) => {
      await page.goto(route);

      const banner = page.getByRole("complementary", { name: notice.noticeLabel });

      await expect(banner).toBeVisible();
      // The wording read from the catalogue, never retyped: a literal here would
      // pass while `fr.json` said something else, and the sentence is the whole
      // deliverable.
      await expect(banner).toHaveText(notice.noticeBody);
    });
  }

  /**
   * **The one route that must NOT carry it**, and it is a criterion rather than an
   * accident: `src/app/not-found.tsx` sits *above* the `[locale]` segment, so the
   * notice — rendered by the locale layout — cannot reach it. Asserted because the
   * day somebody moves the notice into the root layout to "cover everything", that
   * root layout starts reading the content, and invariant 1 is what pays for it.
   */
  test("does not reach the 404 page, which is above the locale segment", async ({ page }) => {
    const response = await page.goto("/fr/cette-adresse-nexiste-pas");

    expect(response?.status()).toBe(404);
    await expect(page.getByText(notice.noticeBody)).toHaveCount(0);
  });

  /**
   * **Not an alert**, which the acceptance criterion names explicitly: the role
   * interrupts a screen reader mid-sentence, and this is permanent information about
   * the state of a journal rather than an urgency. No `role="status"` either, for a
   * different reason — a live region over bytes frozen at build time never announces
   * anything to anybody.
   *
   * **Scoped to the notice, and the first version of this case was not — it asserted
   * `getByRole("alert")` over the whole document and went red on the framework.**
   * Next injects its own route announcer into every hydrated page:
   *
   *     <div id="__next-route-announcer__" role="alert" aria-live="assertive" …>
   *
   * It is client-side, so it is absent from the prerendered HTML and appears only in
   * a browser — which is exactly why a document-wide assertion looked right and
   * measured somebody else's chrome. Kept as a note rather than deleted: the next
   * person to assert "no live region on this page" will meet the same element.
   */
  test("announces itself as complementary and never as an alert", async ({ page }) => {
    await page.goto("/fr");

    const banner = page.getByRole("complementary", { name: notice.noticeLabel });

    // The notice's own element carries no role of its own — `complementary` comes
    // from `<aside>` — and nothing inside it is a live region.
    await expect(banner).toHaveAttribute("aria-label", notice.noticeLabel);
    expect(await banner.evaluate((element) => element.getAttribute("role"))).toBeNull();
    expect(await banner.evaluate((element) => element.getAttribute("aria-live"))).toBeNull();
    await expect(banner.locator("[role], [aria-live]")).toHaveCount(0);

    // And no element of the page *outside* Next's own announcer is an alert.
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  /**
   * **The other half of "not dismissible", and the reason it is acceptable.** The
   * notice cannot be closed — `docs/le-bandeau-des-recits-a-venir.md` prices the two
   * script-free ways of closing one — so what it owes the reader instead is to cost
   * nothing: a named landmark to skip past, and not one tab stop on any of the site's
   * pages. This case is what refuses a `:target` anchor or a hidden checkbox if
   * somebody adds one later.
   */
  test("adds no tab stop to any page", async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);

      const banner = page.getByRole("complementary", { name: notice.noticeLabel });

      await expect(banner.locator("a, button, input, select, textarea, [tabindex]")).toHaveCount(0);
    }
  });

  /**
   * The automated audit the acceptance criterion asks for, in **both** themes.
   *
   * Not a formality and not a duplicate of `map-equivalent.spec.ts`, which audits
   * the same two routes: every colour of this notice comes from a token redeclared
   * under `prefers-color-scheme: dark`, so a contrast failure can exist in one theme
   * and not the other — and the notice is asserted **visible in the same test**, so a
   * green audit cannot be a green audit of a page that stopped rendering it. The
   * harness also promotes a contrast ratio of exactly 1.0 from `incomplete` to a
   * violation (`support/axe.ts`), which is the failure a muted token on a muted
   * background would produce.
   */
  for (const colorScheme of ["light", "dark"] as const) {
    test(`passes a WCAG 2.2 AA audit in the ${colorScheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/fr");

      await expect(page.getByRole("complementary", { name: notice.noticeLabel })).toBeVisible();

      const report = await auditPage(page);

      expect(report.violations, describeViolations(report)).toEqual([]);
      // Zero violations and zero passes is an empty run, not a clean one.
      expect(report.passes).toBeGreaterThan(10);
    });
  }
});

/**
 * **The first-screen guard, and the reason this file measures pixels at all.**
 *
 * TIW-13's criterion asks the first screen to carry a sentence, the map and the
 * start of the listing. TIW-19 measured exactly this trap: its own banner pushed the
 * map's figure from a bottom edge of 716 to 854 at 1152 x 800, and had to be
 * recompacted to one 45 px line to come back under the fold.
 *
 * This notice takes the opposite route — it spends the decorative whitespace
 * `--section-space` already puts above the `<h1>` rather than adding a band of its
 * own (`journal-notice.module.css` carries the rule and the measurement). Measured
 * on the served build, the figure's bottom edge:
 *
 *   viewport     without the notice   with it
 *   1152 x 800   715                  699
 *   1280 x 720   696                  669
 *
 * So the notice does not push the map down by 28 px, it pulls it **up** by 16 and
 * 27. That result rests on two things a future edit can silently break: the
 * `.notice + main` adjacency, and the notice staying one line at these widths. Hence
 * an assertion on the served page rather than a number in a comment — the reason
 * every measured figure in this repository has a test behind it.
 *
 * The bound is the fold and not the measured value: a test pinned to 699 would go
 * red on a font-metric change that costs nothing, and this criterion is about
 * fitting, not about a pixel.
 */
test.describe("the notice and the first screen", () => {
  for (const viewport of [
    { width: 1152, height: 800 },
    { width: 1280, height: 720 },
  ] as const) {
    test(`leaves the whole map above the fold at ${viewport.width} x ${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/fr");

      const banner = page.getByRole("complementary", { name: notice.noticeLabel });
      await expect(banner).toBeVisible();

      const noticeBox = await banner.boundingBox();
      const figureBox = await page.locator("figure:has(svg)").boundingBox();

      expect(noticeBox).not.toBeNull();
      expect(figureBox).not.toBeNull();

      /**
       * One line at both reference widths. Two lines is what a `max-width` on the
       * sentence produced in the first version — 47 px instead of 28 — and it is the
       * cheapest way to lose the result above without anyone noticing.
       */
      expect(noticeBox?.height ?? 0).toBeLessThan(40);

      // `y + height`, in page coordinates: nothing has scrolled, so this is the
      // distance from the top of the document to the bottom of the figure.
      const figureBottom = (figureBox?.y ?? 0) + (figureBox?.height ?? 0);

      expect(
        figureBottom,
        `the map's figure ends at ${Math.round(figureBottom)} px, below the ${viewport.height} px fold`
      ).toBeLessThanOrEqual(viewport.height);
    });
  }
});
