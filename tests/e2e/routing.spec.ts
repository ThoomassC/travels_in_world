import { expect, test } from "@playwright/test";
// The import attribute is required here and not in the Vitest specs: Playwright
// loads specs as real ESM (package.json is `type: "module"`), where Node
// mandates it for JSON, while Vite resolves JSON imports itself.
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };

test("the bare root redirects to the default locale", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/fr\/?$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

/**
 * The home page's first screen, asserted against the state production is really
 * in: `content/trips` is empty, so this is what a reader sees today.
 */
test("the French home page carries the sentence, the map and an honest empty block", async ({
  page,
}) => {
  await page.goto("/fr");

  await expect(page.getByRole("heading", { level: 1, name: frMessages.home.title })).toBeVisible();
  await expect(page.getByText(frMessages.home.intro)).toBeVisible();
  // The map is a `<figure>` carrying a counted caption — see TIW-13.
  await expect(page.getByRole("figure")).toBeVisible();

  // No trip published: the waiting message, and NOT a "Derniers voyages" heading
  // above nothing. That distinction is an acceptance criterion, not a nicety.
  await expect(
    page.getByRole("heading", { level: 2, name: frMessages.home.emptyHeading })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: frMessages.home.latestHeading })
  ).toHaveCount(0);
});

test("the main navigation reaches the full listing, at the same level as the map", async ({
  page,
}) => {
  await page.goto("/fr");

  const nav = page.getByRole("navigation", { name: frMessages.trips.navLabel });
  await expect(nav.getByRole("link", { name: frMessages.trips.navMap })).toBeVisible();

  await nav.getByRole("link", { name: frMessages.trips.navAll }).click();

  // The listing is the index of the collection the trip pages are items of, so
  // its URL is `tripsPath()` — built on the same segment as `tripPath()`.
  await expect(page).toHaveURL(/\/fr\/voyages$/);
  await expect(
    page.getByRole("heading", { level: 1, name: frMessages.trips.allHeading })
  ).toBeVisible();
});

/**
 * "Rendered by the server and readable without JavaScript" is an acceptance
 * criterion, and switching JavaScript off is the only way to assert it: a green
 * suite in a JavaScript-enabled browser cannot tell a server-rendered page from
 * one that hydration filled in.
 *
 * `browser.newContext` does not inherit the project's `use`, hence the explicit
 * `baseURL` — without it `page.goto("/fr/voyages")` throws on a relative URL.
 */
test("the full listing is readable with JavaScript disabled", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();

  try {
    const response = await page.goto("/fr/voyages");

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: frMessages.trips.allHeading })
    ).toBeVisible();
    // Empty today, so what has to be readable is the waiting message and the way
    // back to the map — a page with neither is a dead end.
    await expect(
      page.getByRole("heading", { level: 2, name: frMessages.trips.emptyHeading })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: frMessages.trips.emptyBackHome })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("an unknown path under the active locale renders the localised 404", async ({ page }) => {
  const response = await page.goto("/fr/no-such-page");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: frMessages.notFound.title })
  ).toBeVisible();
  // The 404 must announce its own language, like any other page. There is a
  // single global `not-found.tsx` and it hardcodes the default locale, so this
  // will keep saying "fr" for every locale — a known limitation, spelled out in
  // the README and guarded by the "exactly one active locale" unit test, which
  // goes red the day a second locale is declared.
  await expect(page.locator("html[lang]")).toHaveAttribute("lang", "fr");
});

/**
 * There is no locale negotiation at all: the `/` → `/fr` redirect is a single
 * entry in `next.config.ts` (`redirects()`), not a proxy/middleware, so an
 * unknown first segment is just an unknown route. `/de` therefore 404s where it
 * stands — it is NOT rewritten to `/fr/de`, which is what the previous
 * middleware did.
 *
 * The trade-off, deliberate: an un-prefixed deep path (`/voyages/japon-2024`)
 * also 404s instead of being redirected. Every internal link carries its prefix,
 * so only hand-typed URLs are affected. See README, "Rendu statique".
 */
test("an unknown locale prefix 404s where it stands, without a rewrite", async ({ page }) => {
  const response = await page.goto("/de");

  await expect(page).toHaveURL(/\/de$/);
  expect(response?.status()).toBe(404);
});

test("the /fr document carries no locale cookie", async ({ page, context }) => {
  const response = await page.goto("/fr");

  // A response carrying `Set-Cookie` is not stored by a CDN, which would void
  // the year-long `s-maxage` on this prerendered page. See `localeCookie: false`
  // in `src/i18n/routing.ts`.
  expect(response?.headers()["set-cookie"]).toBeUndefined();
  expect(await context.cookies()).toEqual([]);
});
