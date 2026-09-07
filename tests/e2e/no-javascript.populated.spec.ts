import { expect, test, type Page } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { MAP_DRAWING_IN_FIGURE } from "./support/map";

/**
 * TIW-26's sixth acceptance criterion, as a journey rather than as four
 * assertions: **the site stays usable with JavaScript disabled — frozen map, list
 * of destinations, navigation, reading a trip.**
 *
 * **What was already covered, and why it was not enough.** Three files switch
 * JavaScript off today and each one asserts a single page in isolation:
 * `about.spec.ts` (the colophon reads), `map-equivalent.spec.ts` (the country
 * block under the map reads), and `map-interaction.populated.spec.ts` — which
 * fetches `/fr` as *bytes*, with no browser at all, and checks the drawing and the
 * markers are in the response. All three are right, and none of them ever
 * *navigates*: not one link is followed with the script off. So "la navigation"
 * and "la lecture d'un voyage", two of the four things the criterion names, rested
 * on the fact that plain anchors work — which is true, and which is exactly the
 * kind of true thing that stops being true the day a page grows an `onClick`
 * handler that a `preventDefault` sits behind.
 *
 * This file follows the whole path in one script-less context: the map, the
 * listing, a trip, and back to the map.
 *
 * **The two things it is honest about.**
 *
 * 1. The photographs answer 404 on this server — `playwright.content.config.ts`
 *    explains that `next start` serves the repository's own `public/`. So the
 *    gallery's links are asserted to *point at* the file rather than followed; what
 *    matters for this criterion is that the anchor is real and needs no script,
 *    which is a property of the markup.
 * 2. It proves the site works when the script never runs. It does not prove it
 *    works when the script fails halfway — a different failure with a different
 *    answer, and one no browser flag reproduces.
 */

const NAV = frMessages.trips;
const TRIP = { slug: "japon-2024", title: "Japon, printemps 2024" } as const;

/** The map's own figure, the one holding the drawing. */
const drawing = (page: Page) => page.locator("figure:has(svg)").first();

test("the whole journey works with JavaScript disabled", async ({ browser, baseURL }) => {
  /**
   * `browser.newContext` does not inherit the project's `use`, hence the explicit
   * `baseURL` — without it `page.goto("/fr")` throws on a relative URL. The same
   * note is in `about.spec.ts`, which learned it first.
   */
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();

  try {
    // ---- 1. The home page: a frozen map, and no control that does nothing. ----
    const home = await page.goto("/fr");
    expect(home?.status()).toBe(200);

    const figure = drawing(page);
    await expect(figure).toBeVisible();
    await expect(figure.locator(MAP_DRAWING_IN_FIGURE)).toHaveAttribute("viewBox", /[\d. ]+/);
    // The drawing itself, and not an empty ratio-locked box: 174 country shapes
    // are in the document the server sent.
    expect(await figure.locator(`${MAP_DRAWING_IN_FIGURE} path`).count()).toBeGreaterThan(170);

    /**
     * "Figée" is the half of the criterion that is about what must NOT be there.
     * TIW-14's zoom controls and its panel are rendered by the interaction layer
     * only once it has mounted; a zoom button in the server's HTML would be a
     * control that a reader without the script can focus, activate, and get
     * nothing from.
     */
    await expect(page.locator("button")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    /**
     * Every marker is a real link with its trip's name as text — **five since
     * TIW-18**, the untold trip's marker included.
     *
     * That marker is the reason this count is worth stating rather than
     * loosening: `maroc-2023` has no page, so its `href` is the entry it owns in
     * the listing instead. Making it a `<button>` — or an `<a>` with no `href` —
     * would have left it out of this count, which is exactly the regression this
     * script-less run exists to catch: a control that only works once the script
     * has mounted.
     */
    await expect(page.locator("a[data-trip]")).toHaveCount(5);
    await expect(page.getByRole("link", { name: new RegExp(TRIP.title) }).first()).toBeVisible();

    /**
     * ---- 2. The destinations, in words. ----
     *
     * Until 7 September 2026 this was « Les pays visités », a counted list of
     * countries under the drawing. The owner removed that block from the map tab
     * and the countries moved to the Pays tab, which step 3 below reaches with no
     * script at all. What has to be readable *here*, script-less, is what the
     * figure itself says: its caption, and the name of every marker.
     */
    await expect(page.locator("figcaption")).toContainText("5 voyages, 5 pays");
    for (const name of [
      "Islande, cercle d'or, Reykjavik",
      "Japon, printemps 2024, Tokyo",
      "Maroc, sud et Atlas, Marrakech — récit à venir",
    ]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }

    // ---- 3. Navigation: a link in the site's nav, followed with no script. ----
    await page.getByRole("navigation", { name: NAV.navLabel }).getByText(NAV.navCountries).click();
    await expect(page).toHaveURL(/\/fr\/voyages$/);
    await expect(page.getByRole("heading", { level: 1, name: NAV.allHeading })).toBeVisible();
    /**
     * The catalogue, not an empty block: five trips, announced as five — the
     * untold one included, which is the whole point of the state. It is listed
     * with its dates and its countries; only its own page is missing.
     */
    await expect(page.getByText("5 voyages", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(TRIP.title) }).first()).toBeVisible();

    /**
     * ---- 3b. The places listing (TIW-38), and a row that leads back into the
     * catalogue. ----
     *
     * Seven rows over five trips on this fixture — Tokyo and Kyoto in one journey,
     * Cusco and La Paz in another — which is the arithmetic that makes this page
     * something `/voyages` does not already say. Counted on `main` and not by
     * role: the header's own `<ul>` is four `<li>` of navigation.
     *
     * The row's href is a FRAGMENT into the catalogue, and following it with no
     * script is the point: it is the one link shape on this page, and a fragment
     * that names nothing drops the reader silently at the top of the listing.
     * `dead-links.populated.spec.ts` proves it resolves; this proves a reader with
     * no JavaScript can use it.
     */
    await page.getByRole("navigation", { name: NAV.navLabel }).getByText(NAV.navPlaces).click();
    await expect(page).toHaveURL(/\/fr\/villes$/);
    await expect(
      page.getByRole("heading", { level: 1, name: frMessages.places.heading })
    ).toBeVisible();
    await expect(page.locator("main ul > li")).toHaveCount(7);
    await expect(page.getByRole("link", { name: /^Kyoto/ })).toBeVisible();

    await page.getByRole("link", { name: /^Kyoto/ }).click();
    await expect(page).toHaveURL(/\/fr\/voyages#voyage-japon-2024$/);
    await expect(page.getByRole("heading", { level: 1, name: NAV.allHeading })).toBeVisible();

    // ---- 4. Reading a trip, reached from the listing. ----
    await page
      .getByRole("link", { name: new RegExp(TRIP.title) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/fr/voyages/${TRIP.slug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TRIP.title);

    /**
     * The itinerary reads: both stays, the move between them, and the mode of that
     * move.
     *
     * Anchored regular expressions and not the bare place names: a stay's heading
     * and the move's heading both contain "Tokyo" — "Tokyo …" and "De Tokyo à
     * Kyoto …" — and each heading's accessible name also carries the visible text
     * of the permalink beside it, so an exact match would name nothing. `^Tokyo`
     * is the stay; `^De Tokyo` is the move.
     */
    await expect(page.getByRole("heading", { name: /^Tokyo/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Kyoto/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^De Tokyo à Kyoto/ })).toBeVisible();
    await expect(page.getByText("Transport : Train")).toBeVisible();

    // The trip's own map is drawn here too, server-side and inert.
    await expect(drawing(page).locator(MAP_DRAWING_IN_FIGURE)).toHaveAttribute(
      "viewBox",
      /[\d. ]+/
    );

    /**
     * The photographs: every one carries both dimensions, which is what reserves
     * the box before the bytes arrive — the same property the CLS criterion is
     * about, asserted here because it is a property of the served markup and not
     * of the script.
     */
    const images = page.locator("main img");
    expect(await images.count()).toBeGreaterThan(0);
    for (const image of await images.all()) {
      await expect(image).toHaveAttribute("width", /^\d+$/);
      await expect(image).toHaveAttribute("height", /^\d+$/);
    }

    /**
     * The viewer's triggers degrade to what they are: a link to the file. Asserted
     * on the `href` rather than followed, because these files answer 404 on this
     * server for the reason this file's header gives.
     */
    const triggers = page.locator("a[data-photo-index]");
    expect(await triggers.count()).toBeGreaterThan(0);
    for (const trigger of await triggers.all()) {
      await expect(trigger).toHaveAttribute("href", /^\/photos\/.+\.(jpg|jpeg|png|avif|webp)$/);
    }

    // ---- 5. And back to the map, still with no script. ----
    await page.getByRole("link", { name: frMessages.trip.seeOnWorldMap }).click();
    expect(new URL(page.url()).pathname.replace(/\/$/, "")).toBe("/fr");
    await expect(drawing(page).locator(MAP_DRAWING_IN_FIGURE)).toHaveAttribute(
      "viewBox",
      /[\d. ]+/
    );
  } finally {
    await context.close();
  }
});

/**
 * The guard on the guard, and it is not a formality here.
 *
 * `javaScriptEnabled: false` is one option on one context. Drop it — or let a
 * later edit build the context from the default fixture — and every assertion
 * above still passes, on a page with the script running. The suite would then
 * report that the site works without JavaScript while never having turned it off.
 *
 * So one thing is asserted that is only true when the flag is on: TIW-14's zoom
 * controls exist on `/fr` with the script and cannot exist without it. This case
 * states the positive half, on the ordinary fixture page — the two together are
 * what make the flag load-bearing.
 */
test("the controls the script-less run refuses are really there with the script", async ({
  page,
}) => {
  await page.goto("/fr");

  /**
   * The zoom buttons were the control this case pointed at, and TIW-38 removed
   * them. What still has to be true is the thing the flag is load-bearing for:
   * with the script, the page really does gain interactive chrome, so its absence
   * in the script-less run means something. The panel's close button is that
   * chrome now — it needs a marker activated to exist, which is why this reaches
   * for one first.
   */
  await page.locator("a[data-trip]").first().click();
  await expect(page.getByRole("button", { name: frMessages.map.panelClose })).toBeVisible();
  expect(
    await page.locator("button").count(),
    "Aucun bouton sur /fr avec JavaScript : l'absence de bouton dans le parcours sans script ne prouve alors plus rien."
  ).toBeGreaterThan(0);
});
