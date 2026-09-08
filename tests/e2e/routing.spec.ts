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
test("the French home page carries its heading, the map and an honest empty block", async ({
  page,
}) => {
  await page.goto("/fr");

  /**
   * `toBeAttached` and not `toBeVisible`, since TIW-38 took the heading and the
   * introduction out of the picture at the owner's request. The `<h1>` is still
   * in the document and still in the accessibility tree — it is the page's only
   * name, for a screen reader and for a search result — and it is what this line
   * guards. The introduction is gone outright, so there is nothing left to assert
   * about it.
   */
  await expect(page.getByRole("heading", { level: 1, name: frMessages.home.title })).toBeAttached();
  // The map is a `<figure>` carrying a counted caption — see TIW-13. The caption
  // is hidden since TIW-38; the figure and its accessible name are not.
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

/**
 * The skip link, end to end, because none of its three parts can be asserted
 * under jsdom: the hiding is `clip-path` (a computed style jsdom does not lay
 * out), the reveal is `:focus-visible`, and the landing needs a browser that
 * really moves the focus.
 *
 * What is pinned is not the ring or the pixels — those are for a human eye — but
 * the two facts that break silently: the link is the first tab stop, and
 * `<main>` still carries the `id` it points at. The link lives in the layout and
 * each page renders its own `<main>`, so a page can ship without the target and
 * nothing else on the site would say so.
 */
test("the first tab stop is a skip link, and it lands the focus on main", async ({ page }) => {
  await page.goto("/fr");

  const skip = page.getByRole("link", { name: frMessages.trips.skipToContent });

  // Out of the visual layout until focused: a 1 px box, the `clip-path` pattern
  // this repository uses to keep text in the accessibility tree. `toBeVisible()`
  // cannot tell the difference — a 1 px box counts as visible.
  const atRest = await skip.boundingBox();
  expect(atRest?.width).toBeLessThanOrEqual(1);

  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();

  // Focused, it is a real 44 px target — WCAG 2.2 target size (minimum).
  const focused = await skip.boundingBox();
  expect(focused?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(focused?.width ?? 0).toBeGreaterThan(44);

  await page.keyboard.press("Enter");

  // `tabIndex={-1}` on `<main>` is what makes this true here and in Safari:
  // without it the scroll position moves and the focus does not, so the next Tab
  // resumes from the top of the document and the reader has skipped nothing.
  await expect(page.locator("main")).toBeFocused();
});

test("the full listing carries the skip link's target too", async ({ page }) => {
  // The same assertion on the second route: the `id` belongs to the page, so it
  // is exactly the kind of thing that ships on one page and not on the next.
  await page.goto("/fr/voyages");

  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await expect(page.locator("main")).toBeFocused();
});

test("the main navigation reaches the full listing, at the same level as the map", async ({
  page,
}) => {
  await page.goto("/fr");

  const nav = page.getByRole("navigation", { name: frMessages.trips.navLabel });
  await expect(nav.getByRole("link", { name: frMessages.trips.navMap })).toBeVisible();

  await nav.getByRole("link", { name: frMessages.trips.navCountries }).click();

  // **« Pays » leads to countries.** It led to `/fr/voyages` — the catalogue
  // grouped by country — for as long as there was no country page to lead to,
  // and this pair of assertions used to pin that on the argument that the label
  // had changed and the address had not. `/fr/pays` ended it: the index is a page
  // now, and each of its rows opens that country's own page.
  //
  // `/fr/voyages` keeps its address and every link into it; it simply has no tab.
  await expect(page).toHaveURL(/\/fr\/pays$/);
  await expect(
    page.getByRole("heading", { level: 1, name: frMessages.country.heading })
  ).toBeVisible();
});

test("the main navigation reaches the places listing, its own page at its own URL", async ({
  page,
}) => {
  /**
   * The other half of TIW-38's navigation: « Villes » is a *new* page, so unlike
   * « Pays » above it the URL is new too. Asserted from `/fr` and by clicking
   * rather than by `goto`, because what is under test is the entry in the bar —
   * a page that exists and is unreachable from the header is the failure this
   * catches.
   */
  await page.goto("/fr");

  const nav = page.getByRole("navigation", { name: frMessages.trips.navLabel });

  await nav.getByRole("link", { name: frMessages.trips.navPlaces }).click();

  await expect(page).toHaveURL(/\/fr\/villes$/);
  await expect(
    page.getByRole("heading", { level: 1, name: frMessages.places.heading })
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

test("the places listing is readable with JavaScript disabled", async ({ browser, baseURL }) => {
  /**
   * The same criterion as the catalogue above, on the page TIW-38 adds: it is a
   * heading, a `<ul>` and plain anchors, and there is no `'use client'` in its
   * tree — so a script-less browser must get the whole of it.
   *
   * This config serves the EMPTY content fixture, so what has to be readable here
   * is the waiting message and the way back to the map. A page with neither is a
   * dead end, and this page is reachable from the header of every other one.
   */
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();

  try {
    const response = await page.goto("/fr/villes");

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: frMessages.places.heading })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: frMessages.places.emptyHeading })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: frMessages.places.emptyBackHome })).toBeVisible();
    // The count is announced only when there is something to count: an intro
    // reading "0 ville" over an empty page is the empty block the criteria refuse.
    await expect(page.getByText(/\b0\b/)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("the places listing carries the skip link's target too", async ({ page }) => {
  // The `id` and the `tabIndex={-1}` belong to the page, so they are exactly the
  // kind of thing that ships on three routes and not on the fourth.
  await page.goto("/fr/villes");

  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await expect(page.locator("main")).toBeFocused();
});

test("an unknown path under the active locale renders the localised 404", async ({ page }) => {
  const response = await page.goto("/fr/no-such-page");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: frMessages.notFound.title })
  ).toBeVisible();
  // The 404 must announce its own language, like any other page. There is a
  // single global `not-found.tsx` and it resolves the default locale, so it says
  // "fr" under every prefix — `/en/no-such-page` included, now that `en` and `es`
  // are active. That is an accepted limitation and not a bug to file: the fix is
  // a `[locale]/[...rest]` catch-all, which costs a dynamic `ƒ` route and
  // therefore invariant 1. Written down in `src/i18n/routing.ts`, in the README
  // ("Rendu statique") and in the "declares the three active locales" unit test.
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
