import { expect, test, type Page } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations } from "./support/axe";

/**
 * The filters of `/fr/voyages` and `/fr/villes`, in a real browser and on a real
 * build.
 *
 * **This file is where the feature is actually proved, and that is not a figure
 * of speech.** The whole mechanism is a generated stylesheet: a radio button
 * changes which rules match, and the browser hides the rest. Nothing in the unit
 * suite can see any of it — jsdom applies no `:has()` cascade to a hidden `<li>`,
 * and no assertion made in a Node process can tell a stylesheet that reached the
 * document from one React hoisted nowhere. The unit suite owns the arithmetic and
 * the markup; this owns the only question a reader has, which is whether the list
 * actually gets shorter.
 *
 * **And it is the only thing that can prove there is no JavaScript in it.** The
 * last case switches scripting off and filters anyway. If a future change reached
 * for state, that case is what would go red — before the client-boundary budget
 * in `AGENTS.md` was quietly spent.
 *
 * The populated fixture: five trips over five countries and four years, one of
 * them crossing two countries, which is the shape every case below leans on.
 */

const TRIPS = frMessages.trips;
const PLACES = frMessages.places;

/** The entries a reader can actually see — `:visible` is what reads the cascade. */
const visibleTrips = (page: Page) => page.locator("li[data-facets]:visible");

/** The count line the sheet reveals — the only one of them a reader can see. */
const statusLine = (page: Page) => page.locator("[data-facet-status]:visible");

/**
 * The catalogue's own wording, chosen by count. Read from `fr.json` rather than
 * retyped, so a rewording moves the assertion with it — and spelled out here
 * because these two messages are plurals, which the search suite's single
 * `replace` does not cover.
 */
function plural(message: string, count: number): string {
  const branches = /one \{([^}]*)\} other \{([^}]*)\}/.exec(message);
  const chosen = count === 1 ? branches?.[1] : branches?.[2];

  if (chosen === undefined) {
    throw new Error(`Not a plural message: ${message}`);
  }

  return chosen.replace("#", String(count));
}

test("the catalogue narrows to one country, and says how many are left", async ({ page }) => {
  await page.goto("/fr/voyages");

  // Nothing chosen: the whole journal, and no count line — the page's own
  // introduction already carries that number, and saying it twice is noise.
  await expect(visibleTrips(page)).toHaveCount(5);
  await expect(statusLine(page)).toHaveCount(0);

  await page.getByRole("radio", { name: "Japon 2 voyages" }).check();

  await expect(visibleTrips(page)).toHaveCount(2);
  await expect(statusLine(page)).toHaveText(plural(TRIPS.filterShowing, 2));

  /**
   * The chapters go with their cards. A continent heading standing over an empty
   * grid is the empty block the acceptance criteria refuse, and it is the half of
   * the sheet that `:has()` does rather than `:not()`.
   */
  await expect(page.locator("[data-facet-group]:visible")).toHaveCount(2);
});

/**
 * The cross-country case, and the reason the country axis is built from every
 * country an itinerary touches rather than from the one it is filed under:
 * `buildCatalogue` files "Pérou et Bolivie" under its first arrival, so before
 * this filter existed the word Bolivie appeared nowhere a reader could act on.
 */
test("a country a trip merely crosses still finds it", async ({ page }) => {
  await page.goto("/fr/voyages");

  await page.getByRole("radio", { name: "Bolivie 1 voyage" }).check();

  await expect(visibleTrips(page)).toHaveCount(1);
  await expect(visibleTrips(page)).toContainText("Pérou et Bolivie");
});

test("a year cuts across the countries the page is grouped by", async ({ page }) => {
  await page.goto("/fr/voyages");

  await page.getByRole("radio", { name: "2023 2 voyages" }).check();

  // Maroc and Pérou-Bolivie: two trips under two different chapters, which is the
  // cut the grouping cannot make on its own.
  await expect(visibleTrips(page)).toHaveCount(2);
  await expect(page.locator("[data-facet-group]:visible")).toHaveCount(4);
});

/**
 * One choice at a time is the design, not a limitation discovered late: it is
 * what keeps every count on every pill exactly true. Asserted, because a shared
 * `name` is one attribute away from two independent groups whose numbers would
 * start lying without anything failing.
 */
test("choosing on one axis clears the other", async ({ page }) => {
  await page.goto("/fr/voyages");

  await page.getByRole("radio", { name: "Japon 2 voyages" }).check();
  await page.getByRole("radio", { name: "2023 2 voyages" }).check();

  await expect(page.getByRole("radio", { name: "Japon 2 voyages" })).not.toBeChecked();
  await expect(visibleTrips(page)).toHaveCount(2);
});

/**
 * The count beside a continent counts the whole chapter, so it stops being true
 * the moment a choice hides half of it. It is dropped while a filter is on, and
 * the count line under the control — the number the reader has just changed —
 * answers instead.
 */
test("the chapter counts step aside rather than say a number that is no longer true", async ({
  page,
}) => {
  await page.goto("/fr/voyages");

  await expect(page.locator("[data-facet-total]:visible").first()).toBeVisible();

  await page.getByRole("radio", { name: "Japon 2 voyages" }).check();

  await expect(page.locator("[data-facet-total]:visible")).toHaveCount(0);
});

test("the places list filters on the one axis a place carries", async ({ page }) => {
  await page.goto("/fr/villes");

  const rows = page.locator("li[data-facets]:visible");
  const total = await rows.count();
  expect(total).toBeGreaterThan(4);

  await page.getByRole("radio", { name: /^Japon / }).check();

  const left = await rows.count();
  expect(left).toBeGreaterThan(0);
  expect(left).toBeLessThan(total);
  await expect(statusLine(page)).toHaveText(plural(PLACES.filterShowing, left));
});

/**
 * The keyboard, which is free here and would not be behind a custom control: a
 * radio group is one Tab stop and the arrows move *the choice*, so a reader who
 * never touches a pointer filters with two keys.
 */
test("the whole control is one Tab stop and the arrows change the choice", async ({ page }) => {
  await page.goto("/fr/voyages");

  await page.getByRole("radio", { name: /^Tous les voyages/ }).focus();
  await page.keyboard.press("ArrowDown");

  const focused = page.locator("input[type=radio]:focus");
  await expect(focused).toBeChecked();
  await expect(focused).not.toHaveValue("all");
  // The choice took effect on the page and not only on the control.
  expect(await visibleTrips(page).count()).toBeLessThan(5);
});

test("a filtered catalogue has no accessibility violation", async ({ page }) => {
  await page.goto("/fr/voyages");
  await page.getByRole("radio", { name: "Japon 2 voyages" }).check();

  const report = await auditPage(page);

  expect(report.passes).toBeGreaterThan(0);
  expect(report.violations, describeViolations(report)).toEqual([]);
});

/**
 * **The case the whole design exists for.** No script runs on this page at all —
 * and the filter works, the count line appears, the chapters follow. A filter
 * built on state would fail here, which is exactly what makes this the guard on
 * the client-boundary budget rather than a nicety.
 */
test("it filters with JavaScript switched off", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();

  try {
    await page.goto("/fr/voyages");

    await expect(visibleTrips(page)).toHaveCount(5);

    await page.getByRole("radio", { name: "Japon 2 voyages" }).check();

    await expect(visibleTrips(page)).toHaveCount(2);
    await expect(statusLine(page)).toHaveText(plural(TRIPS.filterShowing, 2));
  } finally {
    await context.close();
  }
});
