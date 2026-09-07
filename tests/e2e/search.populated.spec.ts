import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations } from "./support/axe";

/**
 * The header's search, in a real browser and on a real build.
 *
 * **What only a browser can answer here.** `<details>` does not toggle on a click
 * of its summary in jsdom, the panel has no position and no scroll, the focus
 * ring is not painted, and "readable with JavaScript unavailable" cannot be told
 * from a hydrated page by any assertion made in a hydrated one. The unit suite
 * (`tests/components/search/`) owns the filter's arithmetic; this file owns the
 * gestures.
 *
 * The populated fixture rather than the repository's own content, for the reason
 * `playwright.content.config.ts` gives: the empty journal has nothing to find.
 */

const S = frMessages.search;

const openSearch = async (page: import("@playwright/test").Page) => {
  await page.getByRole("group").filter({ hasText: S.open }).locator("summary").click();
  await expect(page.getByLabel(S.field)).toBeVisible();
};

const visibleRows = (page: import("@playwright/test").Page) =>
  page.locator("[data-haystack]:not([hidden])");

test("the panel opens onto the whole index, and closes on Escape", async ({ page }) => {
  await page.goto("/fr");

  await openSearch(page);

  // Nothing typed: the panel is the complete index, which is also exactly what a
  // reader without JavaScript sees.
  const rows = await visibleRows(page).count();
  expect(rows).toBeGreaterThan(4);

  await page.keyboard.press("Escape");

  await expect(page.getByLabel(S.field)).toBeHidden();
  // 2.4.3: the focus goes back to what opened the panel, never to the document.
  await expect(page.locator("summary:focus")).toHaveCount(1);
});

test("typing narrows the list, names the count, and hides the empty groups", async ({ page }) => {
  await page.goto("/fr");
  await openSearch(page);

  await page.getByLabel(S.field).fill("tok");

  /**
   * "Tokyo" is a place of `japon-2024` and appears in that trip's haystack, so the
   * narrowed list holds the trip and the place and nothing else — the countries
   * and the site's own pages have no row left, and their labels go with them.
   * A label standing over an empty list is the defect this asserts against.
   */
  await expect(visibleRows(page)).toHaveCount(2);
  await expect(page.locator("[data-group]:not([hidden])")).toHaveCount(2);
  await expect(page.getByRole("status")).toHaveText(S.resultsMany.replace("{count}", "2"));

  await page.getByLabel(S.field).fill("reykjavik-sur-loire");

  await expect(visibleRows(page)).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText(S.resultsNone);
});

/**
 * **The accent fold, end to end.** The carnet spells "Pérou et Bolivie" and a
 * reader types "perou". The unit suite proves the two foldings agree as strings;
 * this proves the string that reaches the DOM is the folded one — the attribute is
 * written by the server and read by the client, and only a build exercises both.
 */
test("an unaccented query finds an accented name", async ({ page }) => {
  await page.goto("/fr");
  await openSearch(page);

  await page.getByLabel(S.field).fill("perou");

  await expect(visibleRows(page).first()).toContainText("Pérou");
});

test("the arrows walk the list and Enter follows the row", async ({ page }) => {
  await page.goto("/fr");
  await openSearch(page);

  await page.getByLabel(S.field).fill("islande");
  await page.keyboard.press("ArrowDown");

  /**
   * The focus is on the **link**, not on a synthetic "active option": that is the
   * whole design decision recorded in `src/components/search/site-search.tsx`, and
   * it is what makes Enter work without this component implementing Enter.
   */
  await expect(page.locator("[data-haystack]:not([hidden]) a:focus")).toHaveCount(1);

  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/fr\/voyages\/islande-2022$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("an untold trip's row leads to its entry, never to a page that was never built", async ({
  page,
}) => {
  await page.goto("/fr");
  await openSearch(page);

  // `maroc-2023` carries `story: unwritten`, so `tripStaticParams` never wrote a
  // page for it. A row pointing at one would be a 404 in the chrome of every
  // document on the site.
  await page.getByLabel(S.field).fill("maroc");

  await expect(visibleRows(page).locator("a").first()).toHaveAttribute(
    "href",
    "/fr/voyages#voyage-maroc-2023"
  );
});

/**
 * **THE SCRIPT-LESS HALF, and it is not a consolation prize.** With no JavaScript
 * the disclosure is native, the panel is the complete index, and every row is a
 * real link a reader can Tab to and follow. The field is inert — it filters
 * nothing — and that is the one thing to be honest about: it is a field beside a
 * list rather than a control that pretends to work.
 *
 * PROVEN BY DELIBERATE FAILURE, which is this repository's standard for a guard.
 * The ARIA 1.2 combobox pattern would have put `tabindex="-1"` on these rows;
 * that is the change, and this is what it does:
 *
 *   // src/components/search/search-index.tsx
 *   -<a className={styles.searchLink} href={entry.href}>
 *   +<a className={styles.searchLink} href={entry.href} tabIndex={-1}>
 *
 *   npm run test:e2e:content -> 1 failed | 6 passed
 *                               "Expected: 0   Received: 21"
 *
 * Twenty-one rows out of the tab order for the reader who has no script — which
 * is the whole reason `site-search.tsx` moves real focus instead.
 */
test("the whole index is usable with JavaScript disabled", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();

  try {
    await page.goto("/fr");
    await page.locator("details").filter({ hasText: S.open }).locator("summary").click();

    const links = page.locator("[data-haystack] a");
    expect(await links.count()).toBeGreaterThan(4);

    // Not a `tabindex` in sight: the client component moves focus with the arrows
    // rather than taking these out of the tab order, which is what keeps them
    // reachable here.
    await expect(page.locator("[data-haystack] a[tabindex]")).toHaveCount(0);

    const first = links.first();
    const href = await first.getAttribute("href");
    await first.click();

    await expect(page).toHaveURL(new RegExp(`${href}$`.replace("#", "#")));
  } finally {
    await context.close();
  }
});

test("the open panel has no WCAG 2.2 AA violation, in either theme", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/fr");
    await openSearch(page);
    await page.getByLabel(S.field).fill("a");

    const report = await auditPage(page);

    expect(report.violations, `search panel (${colorScheme}): ${describeViolations(report)}`).toEqual(
      []
    );
    expect(report.passes).toBeGreaterThan(10);
  }
});
