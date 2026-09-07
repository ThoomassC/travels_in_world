import { expect, test } from "@playwright/test";

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

/**
 * Zoom, since TIW-38 removed the three buttons: `Ctrl` and the wheel, over the
 * middle of the drawing.
 *
 * A helper and not three lines in each case, because the sequence has a trap —
 * the modifier has to be held across the notch, and releasing it first makes the
 * page scroll instead of the map zooming, which reads as "the zoom is broken"
 * rather than "the test is wrong".
 */
async function wheelZoom(page: import("@playwright/test").Page, notches: number): Promise<void> {
  const box = await page.locator("figure svg").boundingBox();
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2
  );
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, notches);
  await page.keyboard.up("Control");
}

test("the empty map still frames the whole world", async ({ page }) => {
  // `frameAround`'s first rule: no usable point means the whole world. It is not a
  // theoretical case — it is the current production rendering.
  await page.goto("/fr");

  expect(await viewBox(page)).toEqual([0, 0, 960, 500]);
});

test("zooming an empty map never leaves the world", async ({ page }) => {
  /**
   * The frame is already the world here, so zooming out is the degenerate case
   * that `clampViewport` has to answer without moving: `world.width` is both the
   * starting width and the cap. A frame that grew past it would show grey space
   * beyond the map's own edge.
   *
   * Driven by `Ctrl` + wheel since TIW-38 took the buttons away. The reset went
   * with them, so the second half of this case — "and the reset restores it" — is
   * gone rather than rewritten: there is nothing left that restores anything.
   */
  await page.goto("/fr");
  const world = await viewBox(page);

  await wheelZoom(page, 240);
  expect(await viewBox(page)).toEqual(world);

  await wheelZoom(page, -240);
  const cropped = await viewBox(page);
  expect(cropped[2] ?? 0).toBeLessThan(960);
  expect(cropped[0] ?? -1).toBeGreaterThanOrEqual(0);
  expect((cropped[0] ?? 0) + (cropped[2] ?? 0)).toBeLessThanOrEqual(960.05);
  expect((cropped[1] ?? 0) + (cropped[3] ?? 0)).toBeLessThanOrEqual(500.05);
});

/*
 * "the controls are reachable and operable by keyboard alone" lived here and is
 * gone with the buttons (TIW-38). It asserted the thing that is no longer true:
 * the zoom has no keyboard path any more. That is a deliberate loss, argued where
 * the controls used to be rendered — `src/components/map/map-viewport.tsx` — and
 * it is defensible only because the drawing is `aria-hidden` and everything it
 * shows is also written beside it. Deleting the test rather than weakening it: a
 * case that asserts less than its name promises is worse than no case.
 */

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
  // The interaction layer has mounted once the canvas is marked; there is no
  // button left to wait for since TIW-38.
  await page.waitForFunction(() => document.querySelector("[data-interactive]") !== null);
  expect(new URL(page.url()).search).toBe("");

  await wheelZoom(page, -240);
  await expect.poll(() => new URL(page.url()).searchParams.get("carte")?.split(",").length).toBe(3);
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
  // No panel in the document: it is rendered only once the interaction layer has
  // mounted, so a reader without the script is never shown a control that cannot
  // work. Since TIW-38 there is no zoom button at all, in either state, so this
  // assertion has become weaker than it reads — it is kept because the panel's
  // close button is still gated the same way.
  expect(html).not.toMatch(/<button/);
  expect(html).not.toContain("data-interactive");
});

/**
 * **`--chrome-height` has to be the bar's real height, or the map runs under the
 * fold.**
 *
 * This is a guard on a hand-copied number, and it exists because the number was
 * wrong for the whole life of TIW-38. `src/styles/tokens.css` declared
 * `--chrome-height: 4rem` once, with no media query; `site-nav.module.css` stacks
 * the bar into three rows at `58rem`, where it really measures 200 px. The map
 * subtracts the token from `100dvh` to size itself, so between 26rem and 58rem it
 * over-claimed 136 px of viewport and its `<figure>` ended 51 to 66 px BELOW the
 * fold — measured at 844x390, 900x600, 928x600 and 820x600, on the page whose
 * only subject is that map.
 *
 * Nothing could have caught it. The fold guard in `journal-notice.spec.ts` runs at
 * 1152x800 and 1280x720, both *above* the breakpoint, so the bar is never stacked
 * there; the narrow cases in `map-interaction.populated.spec.ts` measure the
 * canvas's aspect ratio and never the figure's position. The hole was exactly
 * complementary to the two guards that existed.
 *
 * So this compares the token with the element it claims to describe, at four
 * widths that straddle the breakpoint. It is the only thing standing between the
 * two `58rem` literals — one in `site-nav.module.css`, one now in `tokens.css` —
 * and a silent disagreement.
 *
 * **320 px is deliberately not in the list.** Below 26rem the nav links wrap and
 * the bar grows to 248 px, which is content-driven and has no media query to hang
 * a value on, so the token stays at 12.5rem and is knowingly short. It costs
 * nothing: at that width the map's `min()` is bound by its *width* term, so the
 * height budget — and therefore this token — never reaches the result. Asserting
 * there would be asserting a number nobody reads.
 */
const CHROME_HEIGHT_WIDTHS = [1280, 1024, 900, 640] as const;

for (const width of CHROME_HEIGHT_WIDTHS) {
  test(`the header is exactly --chrome-height tall at ${String(width)} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/fr");

    const measured = await page.evaluate(() => {
      const bar = document.querySelector("header");
      if (bar === null) throw new Error("no header");

      const declared = getComputedStyle(document.documentElement)
        .getPropertyValue("--chrome-height")
        .trim();

      // `rem` resolved against the document's own root size rather than assumed
      // to be 16: a reader who has enlarged their default text moves both sides
      // of this comparison, and the test has to move with them.
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);

      return {
        real: bar.getBoundingClientRect().height,
        declared: Number.parseFloat(declared) * (declared.endsWith("rem") ? rootFontSize : 1),
      };
    });

    expect(
      measured.real,
      `the bar measures ${String(measured.real)} px where --chrome-height claims ` +
        `${String(measured.declared)} px — the map subtracts the claim from 100dvh, so the ` +
        `difference is how far it runs under the fold`
    ).toBeCloseTo(measured.declared, 0);
  });
}
