import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations } from "./support/axe";

/**
 * The header's search, in a real browser and on a real build.
 *
 * **What only a browser can answer here, and it is now the whole architecture.**
 * The panel opens on `:focus-within` — a stylesheet rule, no script — and jsdom
 * evaluates no pseudo-class, so the unit suite cannot see the disclosure *at all*:
 * `tests/components/search/site-search.test.tsx` says so at the top and confines
 * itself to the panel's content. Everything below the field is therefore this
 * file's: that it opens on focus, that it opens with JavaScript switched off, that
 * Escape closes it without throwing the reader out of the field, and that the
 * inline completion selects what it added.
 *
 * The populated fixture rather than the repository's own content, for the reason
 * `playwright.content.config.ts` gives: the empty journal has nothing to find.
 */

const S = frMessages.search;

/** The panel is open when its rows are painted. There is no other state to read. */
const visibleRows = (page: import("@playwright/test").Page) =>
  page.locator("[data-haystack]:not([hidden])");

const openSearch = async (page: import("@playwright/test").Page) => {
  await page.getByLabel(S.field).click();
  await expect(visibleRows(page).first()).toBeVisible();
};

/**
 * **The field is there before anything is done to it**, which is the whole of the
 * direction the owner chose: the search stopped being a thing to find.
 */
test("the field is in the bar at rest, and the panel is not", async ({ page }) => {
  await page.goto("/fr");

  await expect(page.getByLabel(S.field)).toBeVisible();
  await expect(visibleRows(page).first()).toBeHidden();
});

test("focusing the field opens the whole index, and Escape closes it", async ({ page }) => {
  await page.goto("/fr");

  await openSearch(page);

  // Nothing typed: the panel is the complete index, which is also exactly what a
  // reader without JavaScript sees.
  const rows = await visibleRows(page).count();
  expect(rows).toBeGreaterThan(4);

  await page.keyboard.press("Escape");

  await expect(visibleRows(page).first()).toBeHidden();
  /*
    **And the caret stays put.** Escape dismisses the suggestions; it does not
    throw the reader out of the field they are typing in — which is what the old
    `<details>` did, because closing a disclosure has to return focus to its
    summary. There is no summary any more, so there is nothing to return to.
  */
  await expect(page.getByLabel(S.field)).toBeFocused();
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
 * **The inline completion**, and it is asserted on the *selection* because that is
 * what makes it usable: the tail the field added has to be selected, so the next
 * keystroke replaces it instead of appending to it.
 *
 * `pressSequentially` and not `fill`: `fill` sets the value in one go and
 * dispatches a single event with no `inputType`, which is precisely the shape the
 * component refuses to complete on. Only a real keystroke carries "insertText".
 */
test("the field completes the first suggestion and selects what it added", async ({ page }) => {
  await page.goto("/fr");
  await openSearch(page);

  // "isl" and not a prettier prefix: the fixture's trips are Islande, Japon,
  // Maroc and Pérou, and a completion case has to name one of them.
  await page.getByLabel(S.field).pressSequentially("isl");

  const state = await page
    .getByLabel(S.field)
    .evaluate((node: HTMLInputElement) => ({
      value: node.value,
      start: node.selectionStart,
      end: node.selectionEnd,
    }));

  expect(state.value.toLowerCase().startsWith("isl")).toBe(true);
  expect(state.value.length).toBeGreaterThan(3);
  // The three characters typed are left alone; everything past them is selected.
  expect(state.start).toBe(3);
  expect(state.end).toBe(state.value.length);
});

/**
 * And the other half of that behaviour, which is what keeps the field usable:
 * Backspace must not put back what it just removed.
 */
test("the completion does not fight the backspace key", async ({ page }) => {
  await page.goto("/fr");
  await openSearch(page);

  await page.getByLabel(S.field).pressSequentially("isl");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");

  /*
    `"Is"` and not `"is"`: the completion canonicalises what it kept. Typing "i"
    offered "Islande, cercle d'or" with everything past the first character
    selected, so the "s" the reader typed next replaced a selection that began
    after the carnet's own capital. The first Backspace then removes the selected
    tail and the second one character — which leaves the prefix as the carnet
    spells it. That is what a native inline completion does, and asserting the
    reader's own lower case here would be asserting a bug.
  */
  await expect(page.getByLabel(S.field)).toHaveValue("Is");
});

/**
 * **The accent fold, end to end.** The carnet spells "Genève" and a reader types
 * "geneve". The unit suite proves the two foldings agree as strings; this proves
 * the string that reaches the DOM is the folded one — the attribute is written by
 * the server and read by the client, and only a build exercises both.
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

/**
 * Enter **in the field** follows the first suggestion, which is the promise the
 * completion makes: the field has just written a trip's name into itself.
 */
test("Enter in the field goes to the suggestion it is showing", async ({ page }) => {
  await page.goto("/fr");
  await openSearch(page);

  await page.getByLabel(S.field).fill("islande");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/fr\/voyages\/islande-2022$/);
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
 * The illustrated rows the owner chose — a vignette and a pennant on a trip, and
 * on nothing else.
 *
 * Asserted in a browser and not in jsdom for one reason: both drawings are
 * `<use>` references into a `<symbol>` defined once per document, and whether a
 * reference resolves to a painted shape is a rendering question. A `<use>` at the
 * wrong id renders nothing at all, silently, and the markup is identical.
 */
test("a trip's row flies the map's pennant, and a place's row does not", async ({ page }) => {
  await page.goto("/fr");
  await openSearch(page);

  await page.getByLabel(S.field).fill("reykjavik");

  /*
    Addressed by the id prefix `entries.ts` builds — `q-t-` for a trip, `q-l-` for
    a place — and not by position. Every place is in its own trip's haystack, so a
    query that finds a place finds that trip too, and the trip's row comes first.
  */
  const tile = page.locator('[id^="q-t-"]:not([hidden]) svg').first();

  await expect(tile).toBeVisible();
  // Not merely present: a `<use>` that resolves to nothing has a zero box.
  const box = await tile.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(20);

  await expect(page.locator('[id^="q-l-"]:not([hidden])')).not.toHaveCount(0);
  await expect(page.locator('[id^="q-l-"]:not([hidden]) svg')).toHaveCount(0);
});

/**
 * **THE SCRIPT-LESS HALF, AND IT GOT BETTER RATHER THAN WORSE.** The disclosure
 * used to be a `<details>` a reader had to click; it is now `:focus-within` in the
 * stylesheet, so tabbing into the field opens the complete index — every trip,
 * place, country and page, as real links — with no script running at all. The
 * field itself is inert, which is the one thing to be honest about: it filters
 * nothing, it is a field beside a list rather than a control that pretends to work.
 *
 * PROVEN BY DELIBERATE FAILURE, which is this repository's standard for a guard.
 * The ARIA 1.2 combobox pattern would have put `tabindex="-1"` on these rows;
 * that is the change, and this is what it does:
 *
 *   // src/components/search/search-index.tsx
 *   -<a className={styles.searchLink} href={entry.href}>
 *   +<a className={styles.searchLink} href={entry.href} tabIndex={-1}>
 *
 *   npm run test:e2e:content -> 1 failed | 10 passed
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

    // No click on a summary: there is none. The field takes focus and the
    // stylesheet does the rest.
    await page.getByLabel(S.field).focus();

    const links = page.locator("[data-haystack] a");
    await expect(links.first()).toBeVisible();
    expect(await links.count()).toBeGreaterThan(4);

    // Not a `tabindex` in sight: the client component moves focus with the arrows
    // rather than taking these out of the tab order, which is what keeps them
    // reachable here.
    await expect(page.locator("[data-haystack] a[tabindex]")).toHaveCount(0);

    const first = links.first();
    const href = await first.getAttribute("href");
    await first.click();

    await expect(page).toHaveURL(new RegExp(`${href}$`));
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

    expect(
      report.violations,
      `search panel (${colorScheme}): ${describeViolations(report)}`
    ).toEqual([]);
    expect(report.passes).toBeGreaterThan(10);
  }
});

/**
 * **The focus ring is on the pill and not inside it**, which is a defect the owner
 * reported by looking at it: *« quand on clique sur la barre de recherche on a un
 * carré noir qui apparaît »*. The library's recipe was landing on the bare
 * `<input>` — a sharp-cornered black rectangle inside a rounded teal pill.
 *
 * Only a browser can answer this: `:focus-visible` and `:has()` are both pseudo-
 * classes jsdom does not evaluate, and the whole question is which of two nested
 * elements the ring is painted on.
 *
 * The ring is *moved*, never removed — 2.4.7 — so both halves are asserted here.
 *
 * PROVEN BY DELIBERATE FAILURE, by restoring the rule that produced the report:
 *
 *   // src/components/search/site-search.module.css
 *   -.searchField:focus,
 *   -.searchField:focus-visible { outline: none; box-shadow: none; }
 *   +.searchField:focus { outline: none; }
 *   +.searchField:focus-visible { outline: 3px solid var(--focus-outer); outline-offset: 4px; }
 *
 *   npx playwright test --config playwright.content.config.ts search.populated
 *     -> 1 failed | 12 passed
 *        "the input still draws its own ring: expected 'solid' to be 'none'"
 */
test("clicking the field rings the pill and never the input inside it", async ({ page }) => {
  await page.goto("/fr");

  await page.getByLabel(S.field).click();

  const field = page.getByLabel(S.field);
  const frame = field.locator("xpath=ancestor::label[1]");

  const inputRing = await field.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outline: style.outlineStyle, shadow: style.boxShadow };
  });
  const frameRing = await frame.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outline: style.outlineStyle, width: style.outlineWidth, shadow: style.boxShadow };
  });

  expect(inputRing.outline, "the input still draws its own ring").toBe("none");
  expect(inputRing.shadow).toBe("none");

  expect(frameRing.outline, "the pill has no focus ring at all").toBe("solid");
  expect(Number.parseFloat(frameRing.width)).toBeGreaterThanOrEqual(2);
  expect(frameRing.shadow).not.toBe("none");
});
