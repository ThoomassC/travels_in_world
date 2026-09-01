import { expect, test } from "@playwright/test";
// The import attribute is required here and not in the Vitest specs: Playwright
// loads specs as real ESM (package.json is `type: "module"`), where Node mandates
// it for JSON, while Vite resolves JSON imports itself.
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations } from "./support/axe";

/**
 * "À propos" (TIW-25), on the served production build.
 *
 * What is here and not in the unit suite, and why each one needs a browser:
 *
 * - **reachability from every page.** The entry is rendered by the layout, which
 *   no jsdom test exercises; the only way to know it is really on `/fr` *and*
 *   `/fr/voyages` is to load both.
 * - **zero client JavaScript.** Asserted the only way it can be — by loading the
 *   page in a context with JavaScript switched off. A green suite in a
 *   JavaScript-enabled browser cannot tell a server-rendered page from a hydrated
 *   one.
 * - **the axe audit.** Contrast is computed from real laid-out pixels; jsdom has
 *   no layout.
 *
 * The three unknown links (portfolio, Instagram, contact) are absent from the
 * build this runs against, which is what makes the "no dead anchor" assertion
 * below meaningful today rather than in the abstract.
 */

const ABOUT = "/fr/a-propos";

test("the colophon is one click away from every page of the site", async ({ page }) => {
  for (const from of ["/fr", "/fr/voyages"]) {
    await page.goto(from);

    const nav = page.getByRole("navigation", { name: frMessages.trips.navLabel });
    const entry = nav.getByRole("link", { name: frMessages.trips.navAbout });

    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`${ABOUT}$`));
  }

  await expect(
    page.getByRole("heading", { level: 1, name: frMessages.about.heading })
  ).toBeVisible();
});

test("the page says who made this and how, under one h1 and two h2", async ({ page }) => {
  await page.goto(ABOUT);

  // One `<h1>` per document, and the two sections under it — the outline a screen
  // reader navigates by, asserted rather than assumed.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 2, name: frMessages.about.madeHeading })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: frMessages.about.linksHeading })
  ).toBeVisible();

  await expect(page.getByText(frMessages.about.intro)).toBeVisible();
  await expect(page.getByText(frMessages.about.stack)).toBeVisible();
});

test("the link to the public repository is there, and says where it goes", async ({ page }) => {
  await page.goto(ABOUT);

  /**
   * Queried by accessible name, which is the criterion itself: "lien vers le
   * dépôt", never "ici". The name is the label plus the host and path, so it
   * still says the destination when it is read out of context.
   */
  const repository = page.getByRole("link", {
    name: `${frMessages.about.linkRepository} github.com/ThoomassC/travels_in_world`,
  });

  await expect(repository).toBeVisible();
  await expect(repository).toHaveAttribute("href", "https://github.com/ThoomassC/travels_in_world");
  // No new tab: the reader keeps the back button, and there is no `rel="noopener"`
  // to get wrong.
  await expect(repository).not.toHaveAttribute("target", /.*/);
});

test("nothing on the page is an anchor that goes nowhere", async ({ page }) => {
  await page.goto(ABOUT);

  /**
   * THE ASSERTION THIS TICKET EXISTS FOR. Three of the four outbound links are
   * facts nobody has declared yet, and the failure they must never take is a
   * placeholder: `href="#"`, `href=""`, or a "lien à venir" that a screen reader
   * announces as a link and that does nothing when activated.
   *
   * Asserted over the whole document rather than over the links list, so it also
   * covers anything a future edit adds outside it.
   */
  const hrefs = await page
    .locator("a")
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""));

  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(href, "an anchor with no destination").not.toBe("");
    expect(href, "an anchor pointing at nothing").not.toBe("#");
    expect(href.startsWith("javascript:"), `href="${href}"`).toBe(false);
  }
});

test("the links nobody has declared are simply not on the page", async ({ page }) => {
  await page.goto(ABOUT);

  /**
   * The other direction of the same criterion, on the state the site really ships:
   * the portfolio, the Instagram account and the contact address are unknown, so
   * their labels must be nowhere in the document.
   *
   * **This test is meant to go red the day one of them is filled in**, and that is
   * its value rather than a maintenance cost: filling `identity.ts` in becomes a
   * deliberate act with a visible diff here, instead of a silent change to a public
   * page.
   */
  for (const absent of [
    frMessages.about.linkPortfolio,
    frMessages.about.linkInstagram,
    frMessages.about.linkContact,
  ]) {
    await expect(page.getByText(absent)).toHaveCount(0);
  }

  await expect(page.getByText(/à venir|bientôt|coming soon/i)).toHaveCount(0);
});

test("the page never scrolls sideways at 320 px", async ({ page }) => {
  /**
   * 320 px is the narrowest layout `src/styles/tokens.css` supports, and this page
   * carries the one thing on the site that cannot be hyphenated or wrapped at a
   * space: a URL. `overflow-wrap: anywhere` on the destination line is what keeps
   * it inside the column, and nothing else in the repository would notice if that
   * declaration were dropped — a horizontal scrollbar on a phone is invisible to
   * every other assertion here.
   *
   * WCAG 2.2 1.4.10 (Reflow) is the criterion; the assertion is the mechanism.
   */
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(ABOUT);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("the page is readable with JavaScript disabled", async ({ browser, baseURL }) => {
  /**
   * The ticket's real deliverable is "an irreproachable technical execution on the
   * public journeys", and this page is the cheapest one on the site: no
   * `'use client'`, no library, plain anchors. Switching JavaScript off is the only
   * way to assert that.
   *
   * `browser.newContext` does not inherit the project's `use`, hence the explicit
   * `baseURL` — without it `page.goto("/fr/a-propos")` throws on a relative URL.
   */
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();

  try {
    const response = await page.goto(ABOUT);

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: frMessages.about.heading })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(frMessages.about.linkRepository) })
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

/**
 * The automated audit, on both themes — the same shape and the same reason as
 * `map-equivalent.spec.ts`: every colour on this page comes from a token that is
 * redeclared under `prefers-color-scheme: dark`, so a contrast failure can exist in
 * one theme and not the other. This page introduces two colour pairings the rest of
 * the site does not have (`--text-muted` at `--text-sm` for the destination line,
 * and the underlined label on `--accent-quiet` on hover), which is exactly the kind
 * of thing that passes in light and fails in dark.
 */
for (const colorScheme of ["light", "dark"] as const) {
  test(`the page passes an axe audit at WCAG 2.2 AA in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(ABOUT);

    const report = await auditPage(page);

    /**
     * No allowance here, unlike the map's page: this one holds no known documented
     * violation, and it must not acquire one silently. The `target-size` exemption
     * of `map-equivalent.populated.spec.ts` belongs to the drawing's markers and to
     * nothing else.
     */
    expect(report.violations, describeViolations(report)).toEqual([]);
    // A green audit on a page axe never really inspected is the failure mode this
    // guards: zero violations and zero passes is an empty run.
    expect(report.passes).toBeGreaterThan(10);
  });
}
