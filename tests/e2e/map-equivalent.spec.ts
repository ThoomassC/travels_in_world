import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations } from "./support/axe";

/**
 * The map's accessible equivalent, on the content the repository really ships:
 * `content/trips` is empty, so this file asserts the **fallback** half of TIW-15
 * — the state a reader gets today, and the state the drawing degrades to.
 *
 * The populated half lives in `map-equivalent.populated.spec.ts`, against a
 * second build; see the note in `playwright.config.ts` for why there are two.
 *
 * Everything here needs a real browser. The accessible name of a `<figure>` is
 * computed from its `<figcaption>` by the engine and jsdom's approximation is not
 * the same algorithm; a focus trap is only observable by really pressing Tab; and
 * "readable with JavaScript unavailable" cannot be told from a hydrated page by
 * any assertion made in a JavaScript-enabled one.
 */

test("the map container carries a role and an accessible name", async ({ page }) => {
  await page.goto("/fr");

  /**
   * `role="figure"` comes from the `<figure>` element and the name from its
   * `<figcaption>` — native HTML-AAM, no ARIA attribute involved. Queried
   * *through* the role and the name, so this fails if either is missing.
   *
   * The name is asserted as the counter and nothing more. Until TIW-15 the
   * caption also carried a visually hidden enumeration of every visited country,
   * which meant the figure's accessible *name* grew with the journal — forty
   * country names in a label. `VisitedCountries` carries them now.
   */
  const figure = page.getByRole("figure", {
    name: "Carte du monde : aucun voyage publié, aucun pays",
  });

  await expect(figure).toBeVisible();
});

test("no country of the drawing is a tab stop, and the map traps no focus", async ({ page }) => {
  await page.goto("/fr");

  // The drawing is really there: 177 shapes of the 110m dataset.
  const paths = page.locator("figure svg path");
  expect(await paths.count()).toBeGreaterThan(100);

  /**
   * The whole drawing is out of the accessibility tree and out of the tab order,
   * which is what makes "only the visited countries are links, the other 174 are
   * not tab stops and are hidden from assistive technology" true. It is asserted
   * here as a *browser* fact rather than as an attribute: `aria-hidden` on the
   * `<svg>` plus no interactive descendant is the mechanism, and this is the
   * outcome.
   */
  const svg = page.locator("figure svg");
  await expect(svg).toHaveAttribute("aria-hidden", "true");
  await expect(svg).toHaveAttribute("focusable", "false");
  expect(await svg.locator("a, button, [tabindex], title, [role]").count()).toBe(0);

  /**
   * Tab through the document and record where the focus goes. The map holds no
   * focus, so a finite number of presses must walk past it and reach the end of
   * the document — a trap would loop forever inside the figure.
   */
  const visited: string[] = [];

  for (let press = 0; press < 30; press += 1) {
    await page.keyboard.press("Tab");

    const inside = await page.evaluate(() => {
      const active = document.activeElement;

      return {
        insideSvg: active?.closest("svg") !== null && active?.closest("svg") !== undefined,
        tag: active?.tagName ?? "NONE",
        name: (active?.textContent ?? "").trim().slice(0, 40),
      };
    });

    // The focus never enters the drawing, on any press.
    expect(inside.insideSvg).toBe(false);
    visited.push(`${inside.tag}:${inside.name}`);
  }

  // Not a trap: the focus really moved through distinct elements rather than
  // cycling inside one region. With an empty journal the page offers the skip
  // link, two navigation links and the way out of the fallback block.
  expect(new Set(visited).size).toBeGreaterThan(2);
});

test("the fallback block stands in for the drawing rather than leaving an empty frame", async ({
  page,
}) => {
  await page.goto("/fr");

  /**
   * The acceptance criterion, on the state that reaches it today: no visited
   * country, so the equivalent says so in words and offers the complete listing.
   * "Never an empty frame" means never a bordered rectangle with a heading over
   * nothing — so the heading, the sentence and the way out are all asserted.
   */
  await expect(
    page.getByRole("heading", { level: 2, name: frMessages.map.countriesHeading })
  ).toBeVisible();
  await expect(page.getByText(frMessages.map.countriesEmpty)).toBeVisible();

  const out = page.getByRole("link", { name: frMessages.map.allTrips });
  await expect(out).toBeVisible();

  // An empty list is not announced at all — "liste, 0 élément" over a map that is
  // simply not populated yet is worse than no list. Asserted inside the block's
  // own landmark, so the page's other lists (the navigation) do not mask it.
  await expect(
    page.getByRole("region", { name: frMessages.map.countriesHeading }).getByRole("list")
  ).toHaveCount(0);

  await out.click();
  await expect(page).toHaveURL(/\/fr\/voyages$/);
});

test("the fallback block is readable with JavaScript disabled", async ({ browser, baseURL }) => {
  /**
   * Trivially true and asserted anyway. The map layer ships zero bytes of
   * JavaScript — the milestone's two sanctioned `'use client'` boundaries belong
   * to TIW-14 and TIW-17, and neither is this — so there is no script to fail.
   * This test is what keeps that true: the day someone makes the equivalent
   * interactive, it goes red here instead of on a reader's machine.
   */
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();

  try {
    const response = await page.goto("/fr");

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 2, name: frMessages.map.countriesHeading })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: frMessages.map.allTrips })).toBeVisible();
  } finally {
    await context.close();
  }
});

/**
 * The automated audit the acceptance criteria ask for, on both themes of both
 * prerendered routes a reader can reach.
 *
 * The dark theme is not a formality: every colour on this page comes from a token
 * that is redeclared under `prefers-color-scheme: dark`, so a contrast failure can
 * exist in one theme and not the other. `emulateMedia` is what makes the second
 * half of the palette testable at all.
 */
for (const route of ["/fr", "/fr/voyages"] as const) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`${route} has no WCAG 2.2 AA violation in the ${colorScheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto(route);

      const report = await auditPage(page);

      expect(report.violations, describeViolations(report)).toEqual([]);
      // A green audit on a page axe never really inspected is the failure mode
      // this guards: zero violations and zero passes is an empty run.
      expect(report.passes).toBeGreaterThan(10);
    });
  }
}
