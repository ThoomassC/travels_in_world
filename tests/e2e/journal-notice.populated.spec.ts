import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };

/**
 * **The case that counts: the notice is GONE.**
 *
 * `tests/e2e/journal-notice.spec.ts` proves the notice appears on the empty journal.
 * That half is easy and it is not the risk. The risk of a banner announcing a
 * temporary state on a site whose every byte is written at build time is that it
 * **stays** — that the site goes on saying "les récits arrivent" with récits online,
 * and that nobody notices because nothing is red.
 *
 * `playwright.content.config.ts` serves a build of `tests/fixtures/content/home-map`:
 * five trips, four with a written récit and one (`maroc-2023`) untold. So this is a
 * journal that holds récits, and every assertion below is an absence.
 *
 * **Why this cannot be a unit test.** The condition is a pure function and is
 * asserted as one. What only a served build can say is that the *layout's branch*
 * really took the other road — a notice rendered unconditionally, or a stylesheet
 * that kept the reclaimed whitespace, passes every test in the domain suite.
 */

const notice = frMessages.trips;

/** The fixture's newest publication, which carries TIW-19's banner here. */
const FRESH_TITLE = "Pérou et Bolivie, hiver 2023";

const ROUTES = ["/fr", "/fr/voyages", "/fr/a-propos", "/fr/voyages/japon-2024"] as const;

test.describe("a journal that holds récits", () => {
  for (const route of ROUTES) {
    test(`carries no journal-state notice on ${route}`, async ({ page }) => {
      await page.goto(route);

      await expect(page.getByText(notice.noticeBody)).toHaveCount(0);
      await expect(page.getByRole("complementary", { name: notice.noticeLabel })).toHaveCount(0);
    });
  }

  /**
   * **The cohabitation criterion, seen from the side where it is observable.**
   *
   * The two banners are mutually exclusive by construction — both go through
   * `hasStory`, and `freshestTrip` drops untold trips before comparing — so there is
   * no arbitration to assert, only an impossibility. `tests/app/journal-notice-pipeline.test.ts`
   * pins the pair over real collections; what this case adds is the rendered proof
   * that the home page carries exactly one of the two, and that it is the right one.
   *
   * Note the fixture is a *mixed* journal: one of its five trips is untold. So this
   * also pins that one untold trip is not enough to bring the site-wide notice back
   * — "Récit à venir" on that trip's own entry (TIW-18) is where that fact belongs.
   */
  test("shows the newest-récit banner and not the journal-state notice", async ({ page }) => {
    await page.goto("/fr");

    await expect(page.getByRole("complementary", { name: FRESH_TITLE })).toBeVisible();
    await expect(page.getByText(notice.noticeBody)).toHaveCount(0);

    // The mixed half of the fixture, so the row above is read for what it is: an
    // untold trip is present and the notice is still gone.
    await expect(page.getByText(frMessages.trips.cardStoryToCome, { exact: true })).not.toHaveCount(
      0
    );
  });

  /**
   * **The stylesheet undoes itself, and this is the assertion that proves it.**
   *
   * The notice costs nothing at the fold because `.notice + main` reclaims part of
   * `main`'s `--section-space` top padding. That is an *adjacency*, so it is meant to
   * lapse on its own the day the notice stops being rendered — nothing to remember to
   * revert. A rule written any other way (a class on `<body>`, a global override)
   * would leave the page permanently tighter, which nothing else here would notice.
   *
   * `--space-7` is 48 px and `--section-space` is 92 px at this width, so the two are
   * far enough apart for the comparison to mean something. The bound is deliberately
   * loose: what is asserted is "the full band is back", not a pixel.
   */
  test("gives the page its full opening whitespace back", async ({ page }) => {
    await page.setViewportSize({ width: 1152, height: 800 });
    await page.goto("/fr");

    const paddingTop = await page
      .locator("main")
      .evaluate((element) => parseFloat(getComputedStyle(element).paddingBlockStart));

    expect(
      paddingTop,
      "main is still wearing the notice's compacted top padding, on a journal with no notice"
    ).toBeGreaterThan(60);
  });
});
