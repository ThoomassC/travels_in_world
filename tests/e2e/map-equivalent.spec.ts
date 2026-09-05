import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations } from "./support/axe";

/**
 * The map's accessible equivalent, on the content the repository really ships.
 *
 * **What that content is changed with TIW-36, and this header said the opposite
 * for two tickets.** `content/trips` is still empty — no récit is written — but
 * `content/places.yaml` now holds fourteen *visited places*: somewhere the journal
 * has been, with no date, no step and no page. So the state this file asserts is
 * no longer "nothing at all": it is a drawing cropped on fourteen markers, five
 * tinted countries, and not one trip. That is production, and it is the state the
 * journal will stay in until the first récit is written.
 *
 * The fallback half — the genuinely empty journal — is not reachable from the
 * repository's own content any more. It is covered where it can be: by the
 * component suite, which renders `VisitedCountries` with neither trip nor place,
 * and by `tests/content/validate-places.test.ts`, which builds a journal with no
 * places file at all.
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
    /**
     * The fourteen places and the five countries they reach, and **no mention of
     * a voyage at all** — there is none, and « 14 voyages » is exactly the
     * invented fact `docs/lieux-visites.md` refuses. Cropped, because a journal
     * whose markers are all in western Europe and Crete is not showing the world.
     */
    name: "Carte du monde, recadrée sur les balises : 14 lieux visités, 5 pays",
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
  // cycling inside one region. Since TIW-36 the page also offers fourteen place
  // markers, so thirty presses walk well past the skip link and the navigation.
  expect(new Set(visited).size).toBeGreaterThan(2);
});

test("the equivalent names the five countries and the fourteen places, and links to no page", async ({
  page,
}) => {
  await page.goto("/fr");

  const region = page.getByRole("region", { name: frMessages.map.countriesHeading });

  await expect(
    page.getByRole("heading", { level: 2, name: frMessages.map.countriesHeading })
  ).toBeVisible();

  /**
   * The five countries the client's fourteen places reach, in French alphabetical
   * order — the order `tallyVisitedCountries` collates, and the order this list
   * must not re-derive. Every one of them holds only places, so every row says
   * « récit à venir » and **none of them is a link**: the row's link exists to
   * lead into the trips, and there are none.
   */
  for (const country of ["Belgique", "Espagne", "France", "Grèce", "Suisse"]) {
    await expect(region.getByText(country, { exact: true })).toBeVisible();
  }
  expect(await region.getByRole("link").count()).toBe(0);
  expect(await region.getByText(frMessages.map.countryStoryToCome).count()).toBe(5);

  /**
   * And the fourteen anchors the markers point at, all present. The half a status
   * check misses: a fragment matching no id is a 200 that deposits the reader at
   * the top of the page without a word.
   */
  const markers = page.locator("figure a[data-place]");
  expect(await markers.count()).toBe(14);

  for (const marker of await markers.all()) {
    const slug = await marker.getAttribute("data-place");

    await expect(marker).toHaveAttribute("href", `#lieu-${slug ?? ""}`);
    await expect(page.locator(`#lieu-${slug ?? ""}`)).toBeVisible();
  }

  /**
   * **No link anywhere on this page leads to a trip page**, which is the whole
   * guarantee of the design: `src/content/loader.ts` has no door that could
   * produce an address for a visited place, so no code path can build one. Stated
   * from the served document, because that is where a reader would find it.
   */
  const hrefs = await page.$$eval("a[href]", (anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href") ?? "")
  );
  expect(hrefs.filter((href) => href.includes("/voyages/"))).toEqual([]);
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
    /**
     * The fourteen markers and their fourteen anchors, with no script at all —
     * which is what « la carte reste affichée dans une version figée » means for a
     * journal made of places. The markers are real `<a href>` in the served HTML,
     * and their destinations are ids in the same document, so nothing here needs
     * JavaScript to work and nothing here can 404.
     */
    expect(await page.locator("figure a[data-place]").count()).toBe(14);
    await expect(page.locator("#lieu-rouen")).toBeVisible();
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
 *
 * **It still expects ZERO violations, with fourteen overlapping markers on the
 * page — and that is a measurement rather than an assumption** (TIW-36). The
 * question this ticket had to answer is whether the narrow `target-size`
 * allowance the *populated* spec carries had to be widened to this one. Measured
 * on this very build, in both themes:
 *
 *     violations = []
 *     incomplete = ["color-contrast", "target-size"]
 *     passes     = 24
 *
 * axe answers `target-size` as **incomplete** here and not as a violation: it can
 * see that markers overlap and declines to decide. So nothing had to be tolerated
 * on this route, and the allowance stays exactly where it was — one rule, and only
 * while every element it fired on is inside the map's own `<figure>`. The day axe
 * promotes that incomplete to a violation this test goes red, which is the right
 * direction: it is a decision to take, not one to have already been made.
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
