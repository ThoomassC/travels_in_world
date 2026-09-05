import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };

/**
 * TIW-14's interaction layer on the content the repository really ships.
 *
 * **What that content is changed with TIW-36**, and this header said "no marker"
 * for two tickets. `content/trips` is still empty — no récit is written — but
 * `content/places.yaml` holds fourteen *visited places*, so production today is a
 * map cropped on fourteen markers with **no trip among them**. That is a state
 * the populated build cannot produce and this one now can: markers that are real
 * links, and not one panel to open, because a zone offers trips and there are
 * none.
 *
 * The populated half — panels, tooltips, zones, the focus coming back to a marker
 * — lives in `map-interaction.populated.spec.ts` against a second build; see the
 * note in `playwright.config.ts` for why there are two.
 *
 * **What this file is for.** An interaction layer added to an empty map must be
 * *harmless*, not absent. Every one of these cases is a way the new client
 * component could quietly break the page nobody has published a trip to yet: a
 * panel that opens onto nothing, a `?carte=` written on load, a zoom that leaves
 * the world, a control that answers no keyboard. None of them is observable on
 * the populated build, where there is always a marker to blame instead.
 */

const viewBox = async (page: import("@playwright/test").Page): Promise<readonly number[]> => {
  const raw = await page.locator("figure svg").getAttribute("viewBox");

  return (raw ?? "").split(" ").map(Number);
};

const control = (page: import("@playwright/test").Page, name: string) =>
  page.locator("figure").getByRole("button", { name });

test("the map is cropped on the fourteen places, and stays inside the world", async ({ page }) => {
  /**
   * `frameAround` fitted around the fourteen markers — western Europe and Crete —
   * which is the current production rendering. Asserted as a *property* and not
   * as four numbers: the exact frame is a function of fourteen coordinates the
   * geocoder resolved, so pinning it here would make this spec red the day a
   * fifteenth place arrives, for a reason that is not its own.
   *
   * What must hold whatever the content is: the frame is narrower than the world
   * (there is something to crop on) and it never leaves it.
   */
  await page.goto("/fr");
  const [x, y, width, height] = await viewBox(page);

  expect(width ?? 0).toBeLessThan(960);
  expect(x ?? -1).toBeGreaterThanOrEqual(0);
  expect(y ?? -1).toBeGreaterThanOrEqual(0);
  expect((x ?? 0) + (width ?? 0)).toBeLessThanOrEqual(960.05);
  expect((y ?? 0) + (height ?? 0)).toBeLessThanOrEqual(500.05);
});

test("the three zoom controls are there, named, and 44 px", async ({ page }) => {
  await page.goto("/fr");

  for (const name of [
    frMessages.map.zoomIn,
    frMessages.map.zoomOut,
    frMessages.map.zoomReset,
  ] as const) {
    const button = control(page, name);
    await expect(button).toBeVisible();

    const box = await button.boundingBox();
    // The same WCAG 2.5.8 minimum the markers carry, measured on the rendered
    // element rather than read off a stylesheet.
    expect(box?.width ?? 0, `${name} is narrower than 44 px`).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0, `${name} is shorter than 44 px`).toBeGreaterThanOrEqual(44);
  }
});

test("zooming never leaves the world, and the reset restores the served frame", async ({
  page,
}) => {
  /**
   * `clampViewport`'s cap, exercised from a frame that is **already cropped**
   * since TIW-36: zooming out repeatedly must stop at the world's own edge rather
   * than showing grey space beyond it, and the reset must come back to the frame
   * the server rendered — not to the world.
   */
  await page.goto("/fr");
  const served = await viewBox(page);

  for (let press = 0; press < 8; press += 1) {
    await control(page, frMessages.map.zoomOut).click();
  }
  const widest = await viewBox(page);
  expect(widest[2] ?? 0).toBeLessThanOrEqual(960.05);
  expect((widest[0] ?? 0) + (widest[2] ?? 0)).toBeLessThanOrEqual(960.05);

  await control(page, frMessages.map.zoomReset).click();
  expect(await viewBox(page)).toEqual(served);

  await control(page, frMessages.map.zoomIn).click();
  await control(page, frMessages.map.zoomIn).click();
  const cropped = await viewBox(page);
  expect(cropped[2] ?? 0).toBeLessThan(served[2] ?? 0);
  expect(cropped[0] ?? -1).toBeGreaterThanOrEqual(0);
  expect((cropped[0] ?? 0) + (cropped[2] ?? 0)).toBeLessThanOrEqual(960.05);
  expect((cropped[1] ?? 0) + (cropped[3] ?? 0)).toBeLessThanOrEqual(500.05);

  await control(page, frMessages.map.zoomReset).click();
  expect(await viewBox(page)).toEqual(served);
});

test("the controls are reachable and operable by keyboard alone", async ({ page }) => {
  /**
   * A pointer-only zoom would be a WCAG 2.1.1 failure, and it is the easy mistake
   * to make when the headline gestures are a wheel and a pinch. The buttons ARE
   * the keyboard path, so they have to be walked to and pressed with keys only.
   */
  await page.goto("/fr");

  // Tab in from the top of the document until the first control has the focus.
  let reached = false;
  for (let press = 0; press < 12 && !reached; press += 1) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(
      (name) => (document.activeElement?.textContent ?? "").endsWith(name),
      frMessages.map.zoomIn
    );
  }
  expect(reached, "the zoom-in control was not reachable within 12 tab presses").toBe(true);

  const served = await viewBox(page);
  await page.keyboard.press("Enter");
  expect((await viewBox(page))[2] ?? 0).toBeLessThan(served[2] ?? 0);

  // Space activates a button too, and forgetting it is a classic of custom
  // controls — these are real `<button>`s, so it comes for free and is asserted.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press(" ");
  expect(await viewBox(page)).toEqual(served);
});

test("there are markers and no panel, because none of them is a trip", async ({ page }) => {
  /**
   * **The state TIW-36 made reachable, and the one no other spec can assert**: a
   * map with fourteen markers and nothing to select. A zone exists to offer several
   * *trips* under one activation and to offer them with a card; a visited place has
   * none, so it is not zoned, and its marker is a plain link — one behaviour, with
   * or without JavaScript, instead of two to keep in step.
   */
  await page.goto("/fr");

  expect(await page.locator("figure a[data-place]").count()).toBe(14);
  // `data-trip` is the whole interface to the interaction layer, and no marker on
  // this page carries it: none of them is a trip.
  await expect(page.locator("a[data-trip]")).toHaveCount(0);
  await expect(page.locator("figure a[data-zone]")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  /**
   * Activating a place navigates rather than opening anything — driven from the
   * **keyboard**, and that is not a detail of convenience.
   *
   * A pointer click on Rouen's marker is intercepted by Gand's: the two are 250 km
   * apart, which at this crop is about ten pixels, so two 44 px targets overlap and
   * the one underneath keeps almost no reachable area. That is the measured,
   * accepted cost `docs/adr/0003-carte-svg-inerte-et-balises-html.md` records for
   * HTML markers positioned in percentages over a fluid map, and the audit below
   * reports it by name. What a *place* does not have to recover from it is a
   * zone panel, since a zone offers trips; what it has instead is the keyboard —
   * both markers are in the tab order whatever they overlap — the entry in the
   * list under the map, and a zoom that genuinely separates them, because
   * `--mark-x`/`--mark-y` are world units.
   *
   * So this asserts the path that must work for every marker, buried or not.
   */
  const served = await viewBox(page);
  await page.locator('figure a[data-place="rouen"]').focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/fr#lieu-rouen$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // And an address naming a trip that does not exist leaves the map alone.
  await page.goto("/fr?voyage=japon-2024");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("figure svg")).toBeVisible();
  expect(await viewBox(page)).toEqual(served);
});

test("the address bar stays clean until the reader moves the map", async ({ page }) => {
  /**
   * `writeMapState` omits the `carte` parameter while the view still equals the
   * frame the server rendered. Without that, simply loading `/fr` would rewrite
   * the address into `/fr?carte=0,0,960` — a shareable link pinning a state
   * nobody chose, and a different URL in every reader's history for the same page.
   */
  await page.goto("/fr");
  await page.waitForFunction(() => document.querySelector("figure button") !== null);
  expect(new URL(page.url()).search).toBe("");

  await control(page, frMessages.map.zoomIn).click();
  expect(new URL(page.url()).searchParams.get("carte")?.split(",")).toHaveLength(3);
});

test("the map is drawn by the server, markers and all, controls excluded", async ({ request }) => {
  /**
   * The bytes, with no browser: the acceptance criterion "without JavaScript the
   * map stays shown in a frozen version — never an empty frame" on the content
   * that is actually deployed. Since TIW-36 that includes the fourteen markers,
   * which are real `<a href>` in the document rather than anything a script
   * builds.
   */
  const response = await request.get("/fr");
  expect(response.status()).toBe(200);
  const html = await response.text();

  // The frame the server chose, whatever its numbers: a `viewBox` on the figure's
  // own `<svg>`, and not the 38 × 32 one of the site's inline icon.
  expect(html).toMatch(/viewBox="[\d.]+ [\d.]+ [\d.]+ [\d.]+"/);
  expect(html.match(/data-place="/g)?.length ?? 0).toBe(14);
  expect(html.match(/<path /g)?.length ?? 0).toBeGreaterThan(170);
  // No control and no panel in the document: they are rendered only once the
  // interaction layer has mounted, so a reader without the script is never shown
  // a button that cannot work. (The labels themselves travel in the flight
  // payload as props — see the note in the populated spec.)
  expect(html).not.toMatch(/<button/);
  expect(html).not.toContain("data-interactive");
});
