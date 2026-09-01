import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };

/**
 * TIW-14's interaction layer on the content the repository really ships:
 * `content/trips` is **empty** until TIW-24, so this is the state of production
 * today and the state Thomas sees running `npm run dev`. A world map, no marker,
 * nothing to select.
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

test("the empty map still frames the whole world", async ({ page }) => {
  // `frameAround`'s first rule: no usable point means the whole world. It is not a
  // theoretical case — it is the current production rendering.
  await page.goto("/fr");

  expect(await viewBox(page)).toEqual([0, 0, 960, 500]);
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

test("zooming an empty map never leaves the world, and the reset restores it", async ({ page }) => {
  /**
   * The frame is already the world here, so zooming out is the degenerate case
   * that `clampViewport` has to answer without moving: `world.width` is both the
   * starting width and the cap. A frame that grew past it would show grey space
   * beyond the map's own edge.
   */
  await page.goto("/fr");
  const world = await viewBox(page);

  await control(page, frMessages.map.zoomOut).click();
  expect(await viewBox(page)).toEqual(world);

  await control(page, frMessages.map.zoomIn).click();
  await control(page, frMessages.map.zoomIn).click();
  const cropped = await viewBox(page);
  expect(cropped[2] ?? 0).toBeLessThan(960);
  expect(cropped[0] ?? -1).toBeGreaterThanOrEqual(0);
  expect((cropped[0] ?? 0) + (cropped[2] ?? 0)).toBeLessThanOrEqual(960.05);
  expect((cropped[1] ?? 0) + (cropped[3] ?? 0)).toBeLessThanOrEqual(500.05);

  await control(page, frMessages.map.zoomReset).click();
  expect(await viewBox(page)).toEqual(world);
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

  const world = await viewBox(page);
  await page.keyboard.press("Enter");
  expect((await viewBox(page))[2] ?? 0).toBeLessThan(world[2] ?? 0);

  // Space activates a button too, and forgetting it is a classic of custom
  // controls — these are real `<button>`s, so it comes for free and is asserted.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press(" ");
  expect(await viewBox(page)).toEqual(world);
});

test("there is nothing to select, and nothing pretends there is", async ({ page }) => {
  await page.goto("/fr");

  // No marker, so no list and no panel — and no dialog that could open onto
  // nothing. An empty labelled list would announce "trips on the map, 0 items".
  await expect(page.locator("a[data-trip]")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // And an address naming a trip that cannot exist yet leaves the map alone.
  await page.goto("/fr?voyage=japon-2024");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("figure svg")).toBeVisible();
  expect(await viewBox(page)).toEqual([0, 0, 960, 500]);
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

test("the empty map is drawn by the server, controls and all excluded", async ({ request }) => {
  /**
   * The bytes, with no browser: the acceptance criterion "without JavaScript the
   * map stays shown in a frozen version — never an empty frame" on the content
   * that is actually deployed.
   */
  const response = await request.get("/fr");
  expect(response.status()).toBe(200);
  const html = await response.text();

  expect(html).toContain('viewBox="0 0 960 500"');
  expect(html.match(/<path /g)?.length ?? 0).toBeGreaterThan(170);
  // No control and no panel in the document: they are rendered only once the
  // interaction layer has mounted, so a reader without the script is never shown
  // a button that cannot work. (The labels themselves travel in the flight
  // payload as props — see the note in the populated spec.)
  expect(html).not.toMatch(/<button/);
  expect(html).not.toContain("data-interactive");
});
