import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };

/**
 * The third acceptance criterion of TIW-19, on the state that is **production
 * today**: `content/trips` holds nothing but a `.gitkeep` until TIW-24, so this
 * suite's build serves a journal with no published récit.
 *
 * "Un site sans aucun voyage publié n'affiche ni bandeau ni badge" is worth an
 * end-to-end assertion rather than a unit test, because the failure it guards
 * against is a *rendering* one: a banner rendered as an empty plate, a chip with
 * no trip behind it, a feed answering 404 or a broken document. Every one of
 * those is invisible to a derivation that correctly answered `undefined`.
 *
 * `playwright.config.ts` builds the repository's own content and its specs assert
 * that state deliberately; the populated half lives in
 * `fresh-trip.populated.spec.ts`, against `tests/fixtures/content/home-map`.
 */

test.describe("a journal with no published récit", () => {
  test("shows no banner and no badge on the home page", async ({ page }) => {
    await page.goto("/fr");

    // The honest empty block is TIW-13's, and it is still there.
    await expect(
      page.getByRole("heading", { level: 2, name: frMessages.home.emptyHeading })
    ).toBeVisible();

    // Nothing announcing news, in any of the three placements.
    await expect(page.getByText(frMessages.home.freshLabel, { exact: true })).toHaveCount(0);
    await expect(page.getByText(frMessages.trips.cardNew, { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-new]")).toHaveCount(0);
  });

  test("shows no badge on the full listing either", async ({ page }) => {
    await page.goto("/fr/voyages");

    await expect(page.getByText(frMessages.trips.cardNew, { exact: true })).toHaveCount(0);
  });

  /**
   * **An empty feed is a valid feed**, and that is the point of this case. An
   * aggregator that subscribed before the first récit must keep a working
   * subscription — a 404 or a truncated document would make it unsubscribe, and
   * the reader would never learn that the journal had started.
   */
  test("serves a valid, empty feed rather than a 404", async ({ page }) => {
    const response = await page.request.get("/feed.xml");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/rss+xml; charset=utf-8");

    const body = await response.text();

    expect(body.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(body).toContain("<channel>");
    expect(body.trimEnd().endsWith("</rss>")).toBe(true);
    expect(body).not.toContain("<item>");
    // No item, so nothing to date the channel from: an invented `lastBuildDate`
    // would be the build clock, which is the one value this project keeps out of
    // its published bytes.
    expect(body).not.toContain("<lastBuildDate>");
  });

  test("still advertises the feed, so a reader can subscribe before the first récit", async ({
    page,
  }) => {
    await page.goto("/fr");

    const link = page.locator('link[rel="alternate"][type="application/rss+xml"]');

    await expect(link).toHaveCount(1);
    expect(await link.getAttribute("href")).toContain("/feed.xml");
  });
});
