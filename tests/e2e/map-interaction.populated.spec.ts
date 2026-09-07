import { expect, test, type Locator, type Page } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations, firedOnlyInsideTheMap } from "./support/axe";
import { MAP_DRAWING } from "./support/map";

/**
 * TIW-14's interaction layer, against a **production build** of
 * `tests/fixtures/content/home-map` — four trips, of which Tokyo and Osaka are
 * about 400 km apart and therefore one zone at any realistic rendered scale.
 *
 * **This file is the judge of the ticket**, and the reason is that most of what
 * TIW-14 promises cannot be asserted anywhere else. `Escape`, the focus coming
 * back to the marker, the tooltip appearing on keyboard focus, the 44 px cross,
 * the restoration after a reload, the wheel's modifier rule, the difference
 * between a drag and a tap: every one of them is a property of a real browser
 * over real layout. jsdom computes no layout at all, so
 * `tests/components/map/map-viewport.test.tsx` can only judge the state machine.
 *
 * **What is honestly NOT covered here, and is verified by hand.** Two things:
 *
 * 1. **Whether the browser hands the two-finger gesture to the page.** The test
 *    below dispatches real `TouchEvent`s with two touch points, which proves the
 *    listener's branch — one finger moves nothing, two move the map — and it
 *    proves the `touch-action` value the browser reads. It does not prove that a
 *    physical pinch on a phone reaches that listener rather than being consumed
 *    as a page zoom; Chromium's synthesised touches and a real digitiser are not
 *    the same input path. Checked by hand on iOS Safari 18 and Chrome Android.
 * 2. **The pull-to-close sheet.** Same reason, one level worse: it depends on the
 *    browser not claiming the vertical gesture first, which is what
 *    `touch-action: none` on the header is for. The state machine has no unit
 *    test either — a pointer sequence in jsdom with a zero-sized box cannot cross
 *    a 72 px threshold. Checked by hand at 390 × 844.
 *
 * Both are named in the ticket's report as manual, not as covered.
 */

const marker = (page: Page, title: string, place: string): Locator =>
  page.getByRole("link", {
    name: frMessages.map.markLabel.replace("{title}", title).replace("{place}", place),
  });

const TOKYO = { title: "Japon, printemps 2024", place: "Tokyo", slug: "japon-2024" } as const;
const OSAKA = { title: "Japon, retour à Osaka", place: "Osaka", slug: "japon-2025" } as const;
const REYKJAVIK = {
  title: "Islande, cercle d'or",
  place: "Reykjavik",
  slug: "islande-2022",
} as const;

const viewBox = async (page: Page): Promise<readonly number[]> => {
  const raw = await page.locator(MAP_DRAWING).getAttribute("viewBox");

  return (raw ?? "").split(" ").map(Number);
};

const frameWidth = async (page: Page): Promise<number> => (await viewBox(page))[2] ?? Number.NaN;

/**
 * `Ctrl` + wheel over a point of the drawing — the only zoom left since TIW-38
 * removed the three buttons. `fx`/`fy` place the pointer, because the zoom is
 * towards the cursor and several cases depend on where it was.
 */
async function wheelZoom(page: Page, notches: number, fx = 0.5, fy = 0.5): Promise<void> {
  await pointAt(page, fx, fy);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, notches);
  await page.keyboard.up("Control");
}

/**
 * The pointer surface. NOT the `<svg>`, which carries `pointer-events: none` by
 * the design ADR 0003 records — Playwright refuses to hover it, and that refusal
 * is itself the proof that no country can be hovered or clicked.
 */
const canvas = (page: Page): Locator => page.locator(MAP_DRAWING).locator("..");

/**
 * Puts the pointer at a fraction of the canvas, by coordinates.
 *
 * `locator.hover()` aims at an element's centre and fails when anything overlaps
 * it — which on this map is the normal case, since the markers are 44 px targets
 * over a drawing. Moving the mouse to a chosen point is what a reader does.
 *
 * **The scroll is not decoration, and TIW-19 is what proved it.** `page.mouse`
 * works in *viewport* coordinates, so a point computed from a bounding box is
 * only usable if the box is on screen — and nothing here ensured that. TIW-19
 * puts a 45 px banner above the map on the home page, and at Playwright's default
 * 1280 x 720 the `(0.5, 0.75)` point then landed at y = 720.6: six tenths of a
 * pixel outside the viewport. `mouse.move` accepted it, `mouse.wheel` dispatched
 * on nothing, and the wheel assertion failed on an **empty** list of events
 * rather than on a wrong one — a failure that says nothing about its own cause.
 * The margin before that ticket was those same six tenths of a pixel in the other
 * direction: this helper was passing by luck, and any block added above the map
 * would have spent it.
 *
 * `scrollIntoViewIfNeeded` first, *then* read the box: the box moves when the
 * page does, so the order is the whole of the fix.
 */
async function pointAt(page: Page, fx: number, fy: number): Promise<void> {
  await canvas(page).scrollIntoViewIfNeeded();

  const box = await canvas(page).boundingBox();

  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) * fx,
    (box?.y ?? 0) + (box?.height ?? 0) * fy
  );
}

test("the fixture really is the build this file assumes", async ({ page }) => {
  // The guard on the guard, in the shape the equivalent's spec uses: a suite
  // pointed at the empty build would fail below in a dozen confusing ways.
  await page.goto("/fr");

  await expect(page.getByRole("figure")).toHaveAccessibleName(
    "Carte du monde, recadrée sur les voyages publiés : 5 voyages, 5 pays"
  );
});

test("without JavaScript the map is still drawn and every destination still reachable", async ({
  request,
}) => {
  /**
   * The acceptance criterion "without JavaScript: the map stays shown in a frozen
   * version and the list of destinations stays usable — never an empty frame".
   *
   * Fetched as **bytes**, with no browser at all, because that is what the
   * criterion is about. And it is asserted here rather than as a fallback built
   * for the occasion: TIW-13 and TIW-15 already met it, and what this test
   * defends is that TIW-14 did not take it away by moving the drawing into a
   * client component.
   *
   * The three things that must be in the response, and one that must not be.
   */
  const response = await request.get("/fr");
  expect(response.status()).toBe(200);
  const html = await response.text();

  // 1. The drawing, with a real frame — not an empty ratio-locked box.
  expect(html).toMatch(/<svg[^>]*viewBox="[\d. ]+"/);
  expect(html.match(/<path /g)?.length ?? 0).toBeGreaterThan(170);

  // 2. Every marker is a real link to its trip, with its name as text.
  for (const trip of [TOKYO, OSAKA, REYKJAVIK]) {
    expect(html).toContain(`href="/fr/voyages/${trip.slug}"`);
    expect(html).toContain(trip.title);
  }

  // 3. The untold trip's marker too, pointing at the listing rather than at a
  //    page the build never wrote — the half of the equivalent that used to be
  //    checked here through « Les pays visités », removed on 7 September 2026.
  expect(html).toContain('href="/fr/voyages#voyage-maroc-2023"');

  /**
   * 4. And NOT the controls, nor the panel. A zoom button in the server's HTML
   *    would be a control that does nothing for a reader without the script, so
   *    both are rendered only once the interaction layer has mounted.
   *
   *    **Asserted on the elements and not on the strings**, which is a correction
   *    the first version of this test earned: the labels are resolved on the
   *    server and handed to the client component as props, so they DO travel in
   *    the flight payload (`self.__next_f.push`) whether or not anything renders
   *    them. That is the payload's job and it is not markup — a reader without
   *    JavaScript never reads it, and the strings are 60 bytes rather than the
   *    1.9 KB `use-intl` would have cost in the bundle. What must be absent is a
   *    control in the document, and that is what these three lines say.
   */
  expect(html).not.toMatch(/<button/);
  expect(html).not.toContain('role="dialog"');
  expect(html).not.toContain("data-interactive");
});

test.describe("the trip panel", () => {
  test("a marker opens the panel instead of navigating, and the URL says so", async ({ page }) => {
    await page.goto("/fr");

    /**
     * Osaka and not Tokyo, and the reason is the defect this ticket inherits: the
     * two markers overlap at this crop, and Osaka — the more recent trip, so the
     * first tab stop and the last painted — is the one a pointer reaches. Tokyo's
     * own reachability is asserted below, by keyboard and through the panel,
     * which is what the zone exists for.
     */
    await marker(page, OSAKA.title, OSAKA.place).click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    // Still on the home page: the activation opened a panel and did not follow
    // the link — while the link itself is untouched in the document.
    await expect(page).toHaveURL(/\/fr\?/);
    expect(new URL(page.url()).searchParams.get("voyage")).toBe(OSAKA.slug);
    await expect(marker(page, OSAKA.title, OSAKA.place)).toHaveAttribute(
      "href",
      `/fr/voyages/${OSAKA.slug}`
    );
  });

  test("the panel carries a cover, a title, dates, a duration and a way to read", async ({
    page,
  }) => {
    /**
     * The criterion's own list, on the real `TripCard` the page hands the map.
     * The fixture has no photos on purpose — its README says why — so the cover
     * slot is the card's placeholder, which is what a trip without a photo really
     * renders.
     */
    await page.goto("/fr");
    await marker(page, REYKJAVIK.title, REYKJAVIK.place).click();

    const panel = page.getByRole("dialog");
    const card = panel.locator("article");

    await expect(card).toHaveCount(1);
    await expect(card.getByRole("heading", { name: REYKJAVIK.title })).toBeVisible();
    // Dates and duration, asserted by shape rather than by a literal: both are
    // formatted by `Intl` from the trip's own calendar days, and pinning the
    // exact French wording here would duplicate `tests/components/trips`.
    await expect(card).toContainText("2022");
    await expect(card).toContainText(/\d+ jours?/);
    await expect(card.getByText(frMessages.trips.cardRead)).toBeVisible();
    await expect(card.getByRole("link", { name: REYKJAVIK.title })).toHaveAttribute(
      "href",
      `/fr/voyages/${REYKJAVIK.slug}`
    );
  });

  test("several trips in one zone are all reachable, newest first, with no sideways scroll", async ({
    page,
  }) => {
    /**
     * Tokyo and Osaka. Two 44 px targets a few pixels apart at this crop — the
     * pair that makes axe's `target-size` rule fire on this map — so a reader
     * clicking there cannot have meant one of them in particular. The criterion
     * is that both are listed, date descending, and reachable without horizontal
     * scrolling.
     */
    await page.goto("/fr");
    // Osaka is the marker a pointer reaches; the panel is the zone's, not its own.
    await marker(page, OSAKA.title, OSAKA.place).click();

    const panel = page.getByRole("dialog");
    await expect(panel).toHaveAccessibleName("Les 2 voyages à cet endroit");

    const titles = await panel.locator("article h3").allInnerTexts();
    expect(titles).toEqual([OSAKA.title, TOKYO.title]);

    // No horizontal scrolling anywhere: not inside the panel, not on the page.
    const overflow = await panel.evaluate((node) => ({
      panel: node.scrollWidth - node.clientWidth,
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.panel).toBeLessThanOrEqual(1);
    expect(overflow.document).toBeLessThanOrEqual(1);

    // And every card's own link is reachable — a scroll container nobody can
    // scroll would satisfy the sentence above and fail the criterion.
    for (const trip of [OSAKA, TOKYO]) {
      await expect(panel.getByRole("link", { name: trip.title })).toBeVisible();
    }
  });

  test("Escape closes the panel and gives the focus back to the marker", async ({ page }) => {
    // Two acceptance criteria, and the second is the one a panel most often
    // loses: after closing, the focus must be back on the thing that opened it,
    // not on the body at the top of the document.
    await page.goto("/fr");
    const trigger = marker(page, OSAKA.title, OSAKA.place);

    await trigger.click();
    await expect(page.getByRole("dialog")).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(new URL(page.url()).searchParams.get("voyage")).toBeNull();
  });

  test("the cross closes it too, and it is at least 44 px", async ({ page }) => {
    await page.goto("/fr");
    const trigger = marker(page, REYKJAVIK.title, REYKJAVIK.place);
    await trigger.click();

    const close = page.getByRole("button", { name: frMessages.map.panelClose });
    const box = await close.boundingBox();

    // The criterion's number, measured on the rendered element rather than read
    // off a stylesheet.
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await close.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("a keyboard alone opens the panel, reaches the story and follows it", async ({ page }) => {
    /**
     * The path that decides whether the panel is an improvement or a regression.
     * Before this ticket, Enter on a marker navigated to the trip; now it opens a
     * panel, so the story has to stay one activation away — and the panel's link
     * is the same href the marker carries.
     */
    await page.goto("/fr");

    await marker(page, REYKJAVIK.title, REYKJAVIK.place).focus();
    await page.keyboard.press("Enter");

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();

    await panel.getByRole("link", { name: REYKJAVIK.title }).focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(new RegExp(`/fr/voyages/${REYKJAVIK.slug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a modified click still opens the trip in a new tab", async ({ page, context }) => {
    // The other half of "the link stays a link": Ctrl/Cmd-click means something
    // to a browser, and this ticket must not have taken it away.
    await page.goto("/fr");

    const [opened] = await Promise.all([
      context.waitForEvent("page"),
      marker(page, REYKJAVIK.title, REYKJAVIK.place).click({ modifiers: ["ControlOrMeta"] }),
    ]);

    await expect(page.getByRole("dialog")).toHaveCount(0);

    /**
     * `waitForURL` and not `waitForLoadState()`, and the difference is why this
     * case was flaky — it failed two full runs out of four on 7 September 2026,
     * always with `about:blank` where the trip's path was expected.
     *
     * `context.waitForEvent("page")` resolves the moment the tab exists, which is
     * before it has navigated anywhere. `waitForLoadState()` then waits for the
     * `load` of whatever is currently there — and `about:blank` is already loaded,
     * so it returns immediately and the assertion reads the blank URL. Waiting on
     * the URL waits for the thing the test is actually about.
     */
    await opened.waitForURL(new RegExp(`/fr/voyages/${REYKJAVIK.slug}$`));
    expect(new URL(opened.url()).pathname).toBe(`/fr/voyages/${REYKJAVIK.slug}`);
    await opened.close();
  });

  test("the panel is lateral above 768 px and a sheet below", async ({ page }) => {
    await page.goto("/fr");

    await page.setViewportSize({ width: 1280, height: 900 });
    await marker(page, REYKJAVIK.title, REYKJAVIK.place).click();
    const lateral = await page.getByRole("dialog").boundingBox();
    // Down the right-hand side: narrower than half the viewport, and tall.
    expect(lateral?.width ?? 0).toBeLessThan(640);
    expect((lateral?.x ?? 0) + (lateral?.width ?? 0)).toBeGreaterThan(640);
    expect(lateral?.height ?? 0).toBeGreaterThan(200);

    await page.setViewportSize({ width: 390, height: 844 });
    const sheet = await page.getByRole("dialog").boundingBox();
    // Across the bottom: full width, anchored to the bottom edge.
    expect(sheet?.width ?? 0).toBeGreaterThan(380);
    expect((sheet?.y ?? 0) + (sheet?.height ?? 0)).toBeGreaterThanOrEqual(840);
  });
});

test.describe("the tooltip", () => {
  const labelOf = (page: Page, trip: { title: string; place: string }) =>
    marker(page, trip.title, trip.place).locator("span").last();

  test("appears on hover and on keyboard focus, and is the link's own name", async ({ page }) => {
    /**
     * The criterion has two halves and the second is the one that is usually
     * missed: "the tooltip appears on hover **and on keyboard focus**; no
     * information is available on hover alone."
     *
     * It is met structurally here rather than by two rules — the bubble IS the
     * link's accessible name, one text node, so a screen reader has always had it
     * and the pointer now sees it. What is asserted is that both triggers reveal
     * the same element.
     */
    await page.goto("/fr");
    const label = labelOf(page, REYKJAVIK);

    // Hidden by opacity, never by `display` or `visibility`: those would drop it
    // from the accessibility tree and leave the link unnamed.
    await expect(label).toHaveCSS("opacity", "0");
    await expect(label).toHaveCSS("visibility", "visible");

    await marker(page, REYKJAVIK.title, REYKJAVIK.place).hover();
    await expect(label).toHaveCSS("opacity", "1");

    await page.mouse.move(0, 0);
    await expect(label).toHaveCSS("opacity", "0");

    await marker(page, REYKJAVIK.title, REYKJAVIK.place).focus();
    await expect(label).toHaveCSS("opacity", "1");
    await expect(label).toHaveText(`${REYKJAVIK.title}, ${REYKJAVIK.place}`);
  });

  test("Escape dismisses it without moving the pointer", async ({ page }) => {
    // WCAG 1.4.13 "dismissible", for a bubble that does draw over its
    // neighbours. And the re-arming, so dismissing one does not silence the map.
    await page.goto("/fr");
    const label = labelOf(page, REYKJAVIK);

    await marker(page, REYKJAVIK.title, REYKJAVIK.place).hover();
    await expect(label).toHaveCSS("opacity", "1");

    await page.keyboard.press("Escape");
    await expect(label).toHaveCSS("opacity", "0");

    await page.keyboard.press("Tab");
    await expect(label).toHaveCSS("opacity", "1");
  });

  test("never gives the page a horizontal scrollbar, even at the edge of a phone", async ({
    page,
  }) => {
    /**
     * The one thing the tooltip could break and nothing else would notice: it is
     * absolutely positioned and centred on its marker, so a marker near an edge
     * pushes it past the document's own edge — WCAG 1.4.10. `.figure` clips the
     * inline axis with `overflow-x: clip` and an `overflow-clip-margin` wide
     * enough for a marker's own overhang.
     */
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/fr");

    /**
     * `force: true`, and the reason is the overlap this ticket inherits: at 320 px
     * a 44 px target is 16 % of the map's width, so the markers cover each other
     * and Playwright's hit-target check refuses to aim at a specific one. Forcing
     * still moves the real pointer to the real coordinates, which is all this test
     * needs — some tooltip is shown, and the question is only whether the document
     * got wider.
     */
    const markers = page.locator("a[data-trip]");
    const count = await markers.count();
    // Five since TIW-18, the untold trip's marker included: it is a link like the
    // others and carries the same tooltip, so it can widen the document the same
    // way and has to be walked here too.
    expect(count).toBe(5);

    for (let index = 0; index < count; index += 1) {
      await markers.nth(index).hover({ force: true });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `a tooltip near marker ${index} widened the document`).toBeLessThanOrEqual(
        1
      );
    }
  });
});

test.describe("zoom and pan", () => {
  test("the wheel zooms, and the frame never leaves the world", async ({ page }) => {
    /**
     * Was "the buttons zoom, the reset goes back, …" until TIW-38 removed the
     * three controls. The reset went with them and there is no assertion standing
     * in for it: nothing restores the initial frame any more, and pretending
     * otherwise here would be the test lying about the product.
     */
    await page.goto("/fr");
    const initial = await viewBox(page);

    await wheelZoom(page, -240);
    await expect.poll(async () => frameWidth(page)).toBeLessThan(initial[2] ?? 0);

    await wheelZoom(page, 480);
    const wide = await viewBox(page);
    expect(wide[0] ?? -1).toBeGreaterThanOrEqual(0);
    expect((wide[0] ?? 0) + (wide[2] ?? 0)).toBeLessThanOrEqual(960.05);
    expect((wide[1] ?? 0) + (wide[3] ?? 0)).toBeLessThanOrEqual(500.05);
  });

  test("a marker stays on the country it names at every zoom level", async ({ page }) => {
    /**
     * The property the whole `--frame-*` mechanism exists for, and the one that
     * silently breaks: the container's `aspect-ratio` and the `viewBox` must carry
     * the same numbers, or `preserveAspectRatio` letterboxes the drawing and every
     * marker slides off its country.
     *
     * Asserted as a *relation* measured in the browser: where the marker's box
     * actually is, against where the projected point should be given the rendered
     * canvas. Twelve pixels of tolerance covers the marker's own centring and the
     * one-decimal rounding; a letterboxed SVG is off by tens.
     */
    await page.goto("/fr");

    const drift = async () =>
      page.evaluate((drawing) => {
        const svg = document.querySelector(drawing);
        const canvas = svg?.parentElement;
        const link = document.querySelector<HTMLElement>('a[data-trip="islande-2022"]');
        const item = link?.closest("li");
        if (canvas === null || canvas === undefined || item === null || item === undefined) {
          return null;
        }

        /**
         * `--frame-*` is set on the canvas; `--mark-*` on the marker's own `<li>`.
         * Reading both from the canvas is what the first version of this test did,
         * and custom properties inherit DOWN — so `--mark-x` came back empty,
         * `Number("")` gave 0, and the expectation was a fiction that failed by
         * 344 px. Each is read where it is declared.
         */
        const frame = (name: string) =>
          Number(getComputedStyle(canvas).getPropertyValue(name).trim());
        const mark = (name: string) => Number(getComputedStyle(item).getPropertyValue(name).trim());
        const box = canvas.getBoundingClientRect();
        const markBox = item.getBoundingClientRect();

        const expectedX =
          box.left + ((mark("--mark-x") - frame("--frame-x")) / frame("--frame-w")) * box.width;
        const expectedY =
          box.top + ((mark("--mark-y") - frame("--frame-y")) / frame("--frame-h")) * box.height;

        return {
          x: Math.abs(markBox.left + markBox.width / 2 - expectedX),
          y: Math.abs(markBox.top + markBox.height / 2 - expectedY),
          ratio: box.width / box.height,
          frameRatio: frame("--frame-w") / frame("--frame-h"),
        };
      }, MAP_DRAWING);

    // Four levels, driven by the wheel since TIW-38: the initial frame, two
    // notches in, then one back out.
    for (const notches of [0, -240, -240, 240]) {
      if (notches !== 0) {
        await wheelZoom(page, notches);
      }
      const measured = await drift();
      expect(measured).not.toBeNull();
      expect(measured?.x ?? 99).toBeLessThan(12);
      expect(measured?.y ?? 99).toBeLessThan(12);
      // The canvas really is the frame's shape, so the SVG is never letterboxed.
      expect(measured?.ratio ?? 0).toBeCloseTo(measured?.frameRatio ?? -1, 1);
    }
  });

  /**
   * The same property as the test above, at the widths where it actually breaks.
   *
   * **Why the test above never saw it.** Both Playwright configs declare a single
   * project, `devices["Desktop Chrome"]` — 1280 x 720. At that size the height
   * `.canvas` asks for (`100dvh` less the chrome and the two block paddings) is
   * short enough that the width the ratio derives from it fits in the viewport,
   * so `max-inline-size: 100%` never clips anything and `aspect-ratio` is honoured.
   * Narrow the viewport and that stops being true — and the CSS then asks for
   * three incompatible things at once:
   *
   *     aspect-ratio: var(--frame-w) / var(--frame-h);
   *     block-size: calc(100dvh - ...);   inline-size: auto;   max-inline-size: 100%;
   *
   * When `max-inline-size` clips the `auto` width, the browser **drops
   * `aspect-ratio`** rather than reducing the height with it. The box keeps the
   * full `dvh` height with a clipped width, the `<svg>` — which has no
   * `preserveAspectRatio` attribute, so `xMidYMid meet` — draws its frame
   * centred inside that box with empty bands above and below, and the markers,
   * being HTML positioned in percentages of the **box** (`.mark`, this file's
   * `--mark-*`/`--frame-*` arithmetic), follow the box rather than the drawing.
   * Every one of them slides off the country it names.
   *
   * The invariant is written three times in the repository — `docs/adr/0003`, the
   * header of `frameAround` in `src/components/map/frame.ts`, and the `.canvas`
   * rule itself — and none of the three was executable at a phone's width until
   * this test. `page.setViewportSize` is enough: no second Playwright project,
   * so the rest of the suite keeps running once against one build.
   */
  const NARROW_VIEWPORTS = [
    // The phone the ticket's manual checks use, and the size the `touch` block
    // at the bottom of this file already runs at.
    { label: "390 x 844", width: 390, height: 844 },
    // The floor this file already keeps for the tooltip's overflow, at the same
    // height, so a failure here means the width and not a second variable.
    { label: "320 x 844", width: 320, height: 844 },
  ] as const;

  for (const viewport of NARROW_VIEWPORTS) {
    test(`the canvas keeps the frame's exact ratio at ${viewport.label}, so no marker leaves the drawing`, async ({
      page,
    }) => {
      // The viewport before the navigation: `block-size` is a `dvh` calculation,
      // so the box is a function of the window and resizing after the paint would
      // measure a relayout rather than the rendering a reader gets.
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/fr");
      await expect(page.locator(MAP_DRAWING)).toBeVisible();

      const measured = await page.evaluate((drawing) => {
        const svg = document.querySelector(drawing);
        const canvas = svg?.parentElement;
        if (!(svg instanceof SVGSVGElement) || canvas === null || canvas === undefined) {
          return null;
        }

        /**
         * Same reading as the test above — `--frame-*` on the canvas, `--mark-*`
         * on each marker's own `<li>`, because custom properties inherit DOWN and
         * reading both from one element gives `Number("")` and a fiction.
         */
        const frame = (name: string) =>
          Number(getComputedStyle(canvas).getPropertyValue(name).trim());
        const box = canvas.getBoundingClientRect();

        /**
         * Where the drawing really is, asked of the browser rather than
         * re-implemented here: `getScreenCTM()` maps user units to client pixels
         * through whatever the `viewBox` mapping decided, letterboxing included.
         * Transforming the frame's two corners with it gives the rectangle the
         * `<svg>` actually paints — which is the box itself when the ratios
         * agree, and a band-inset rectangle when they do not.
         */
        const ctm = svg.getScreenCTM();
        if (ctm === null) {
          return null;
        }
        const toScreen = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(ctm);
        const topLeft = toScreen(frame("--frame-x"), frame("--frame-y"));
        const bottomRight = toScreen(
          frame("--frame-x") + frame("--frame-w"),
          frame("--frame-y") + frame("--frame-h")
        );

        const marks = [...document.querySelectorAll<HTMLElement>("a[data-trip]")]
          .map((link) => {
            const item = link.closest("li") ?? link;
            const markBox = item.getBoundingClientRect();
            const style = getComputedStyle(item);
            const mark = (name: string) => Number(style.getPropertyValue(name).trim());
            const centreX = markBox.left + markBox.width / 2;
            const centreY = markBox.top + markBox.height / 2;
            const target = toScreen(mark("--mark-x"), mark("--mark-y"));

            return {
              slug: link.dataset.trip ?? "?",
              x: Math.abs(centreX - target.x),
              y: Math.abs(centreY - target.y),
              // Zero while the marker's centre is on the painted rectangle; the
              // number of pixels it stands off it otherwise.
              outsideBy: Math.max(
                0,
                topLeft.x - centreX,
                centreX - bottomRight.x,
                topLeft.y - centreY,
                centreY - bottomRight.y
              ),
            };
          })
          /**
           * Worst first, and it is the failure *message* this is for rather than
           * the verdict — all five are asserted either way. In DOM order the list
           * starts with the most recent trip (`--mark-order` paints them
           * inverted), which is an accident of z-index: the first run of this test
           * reported a marker 12 px off while another was 162 px off the drawing,
           * and a reader has to be handed the number that shows the size of the
           * defect, not the first one the document happened to carry.
           */
          .sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y));

        return {
          ratio: box.width / box.height,
          frameRatio: frame("--frame-w") / frame("--frame-h"),
          box: { width: box.width, height: box.height },
          drawn: { width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y },
          marks,
        };
      }, MAP_DRAWING);

      expect(measured).not.toBeNull();
      // Five markers since TIW-18, the untold trip's included — the same count
      // the tooltip's overflow test walks, and the guard that an empty list is
      // not what makes the loop below pass.
      expect(measured?.marks ?? []).toHaveLength(5);

      /**
       * Carried into every message below, because the number that explains the
       * failure is not the number that is asserted: a marker 162 px off its
       * country says nothing on its own, and `canvas 326x684 for a drawing of
       * 326x170` says the whole of it in one line.
       */
      const shape =
        `canvas ${measured?.box.width.toFixed(1)} x ${measured?.box.height.toFixed(1)} ` +
        `(ratio ${measured?.ratio.toFixed(3)}) for a frame of ratio ${measured?.frameRatio.toFixed(3)}, ` +
        `so the SVG paints ${measured?.drawn.width.toFixed(1)} x ${measured?.drawn.height.toFixed(1)}`;

      for (const mark of measured?.marks ?? []) {
        // The consequence a reader sees, asserted first: a marker outside the
        // painted rectangle names a country that is not under it at all.
        expect(
          mark.outsideBy,
          `marker ${mark.slug} sits ${mark.outsideBy.toFixed(1)} px outside the rectangle the SVG paints — ${shape}`
        ).toBeLessThanOrEqual(1);
        // Then the distance to its own country, with the neighbour test's twelve
        // pixels: the marker's own centring plus one-decimal rounding.
        expect(
          mark.x,
          `marker ${mark.slug} is ${mark.x.toFixed(1)} px off its country on the x axis — ${shape}`
        ).toBeLessThan(12);
        expect(
          mark.y,
          `marker ${mark.slug} is ${mark.y.toFixed(1)} px off its country on the y axis — ${shape}`
        ).toBeLessThan(12);
      }

      // And the cause, in the shape the test above asserts it: the box IS the
      // frame's ratio, so `preserveAspectRatio` has nothing to letterbox.
      expect(measured?.ratio ?? 0, shape).toBeCloseTo(measured?.frameRatio ?? -1, 1);
    });
  }

  test("the wheel alone scrolls the page and says which combination zooms", async ({ page }) => {
    /**
     * "On desktop the wheel alone does not zoom, and an ephemeral message says
     * which combination is expected."
     *
     * The listener is registered natively with `passive: false`, because React
     * registers `wheel` passively on the root and a `preventDefault()` in an
     * `onWheel` prop is ignored with a console warning. This is what proves the
     * registration, not just the branch.
     */
    await page.goto("/fr");
    const before = await viewBox(page);

    /**
     * Recorded from a listener on `document`, in the bubble phase — so it runs
     * *after* the canvas's own and reports what the canvas decided.
     *
     * This is what the criterion is actually about, and it is a better assertion
     * than "the page scrolled": whether a wheel notch moves the document depends
     * on the document being taller than the viewport, which is a property of the
     * fixture rather than of this ticket. `defaultPrevented` is the browser's own
     * record of whether the page was allowed to scroll.
     */
    await page.evaluate(() => {
      const seen: boolean[] = [];
      Object.defineProperty(window, "__wheelPrevented", { value: seen, configurable: true });
      document.addEventListener(
        "wheel",
        (event) => {
          seen.push(event.defaultPrevented);
        },
        { passive: true }
      );
    });

    await pointAt(page, 0.5, 0.75);
    await page.mouse.wheel(0, 240);

    // The frame did not move, and the scroll was left to the browser.
    expect(await viewBox(page)).toEqual(before);
    expect(
      await page.evaluate(
        () => (window as unknown as { __wheelPrevented: boolean[] }).__wheelPrevented
      )
    ).toEqual([false]);

    /**
     * There used to be a third assertion here: a message appeared saying to hold
     * Ctrl, and went away on its own. TIW-38 removed the hint at the owner's
     * request, so what is left to guard is the behaviour rather than its
     * explanation — the wheel must still refuse to zoom and must still leave the
     * scroll to the browser, which is what the two assertions above check.
     *
     * The loss is real and is recorded rather than papered over: a sighted mouse
     * reader now has nothing telling them the modifier exists. The three named
     * buttons are the discoverable path.
     */
  });

  test("Ctrl and the wheel do zoom, towards the pointer", async ({ page }) => {
    await page.goto("/fr");
    const before = await frameWidth(page);

    await page.evaluate(() => {
      const seen: boolean[] = [];
      Object.defineProperty(window, "__wheelPrevented", { value: seen, configurable: true });
      document.addEventListener(
        "wheel",
        (event) => {
          seen.push(event.defaultPrevented);
        },
        { passive: true }
      );
    });

    await pointAt(page, 0.25, 0.2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");

    await expect.poll(async () => frameWidth(page)).toBeLessThan(before);
    /**
     * And the page was NOT allowed to scroll or to zoom itself — which is the half
     * that needs the listener to be registered with `passive: false`. React
     * registers `wheel` passively on the root container, so an `onWheel` prop
     * cannot do this at all; the listener is native for exactly this reason.
     */
    expect(
      await page.evaluate(
        () => (window as unknown as { __wheelPrevented: boolean[] }).__wheelPrevented
      )
    ).toEqual([true]);
  });

  test("a drag that ends on a marker does not open its panel", async ({ page }) => {
    /**
     * The acceptance criterion, and the reason it needs a real browser: the
     * browser fires `click` on the marker after the release whatever happened in
     * between, so only the distance travelled can tell a pan from a tap.
     */
    await page.goto("/fr");
    const target = marker(page, REYKJAVIK.title, REYKJAVIK.place);
    const box = await target.boundingBox();
    const from = {
      x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
    };

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Away and back, so the release lands on the marker again — the case the
    // criterion actually describes.
    await page.mouse.move(from.x + 120, from.y + 40, { steps: 8 });
    await page.mouse.move(from.x, from.y, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByRole("dialog")).toHaveCount(0);

    // And the very next click still works: the suppression is for one activation.
    await target.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("a drag pans the map, and never past the world's edge", async ({ page }) => {
    await page.goto("/fr");
    // Zoom in first: at the initial crop there is somewhere to pan to, but the
    // clamp is easier to reach and to assert from a tighter frame.
    await wheelZoom(page, -240);
    await wheelZoom(page, -240);
    const before = await viewBox(page);

    const box = await canvas(page).boundingBox();
    const centre = {
      x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
    };

    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x - 200, centre.y, { steps: 10 });
    await page.mouse.up();

    const after = await viewBox(page);
    // Dragging left reveals what is to the east: the window slid right.
    expect(after[0] ?? 0).toBeGreaterThan(before[0] ?? 0);
    expect((after[0] ?? 0) + (after[2] ?? 0)).toBeLessThanOrEqual(960.05);
    // A pan is never a zoom.
    expect(after[2] ?? 0).toBeCloseTo(before[2] ?? -1, 1);
  });
});

test.describe("the state a shared address restores", () => {
  test("a reload brings back the same frame and the same panel", async ({ page }) => {
    /**
     * "The selection is reflected in the URL; a reload restores the same map and
     * panel state." Done with a query string, which is invisible to the prerender
     * — no route, no request header, so `/fr` stays `●` in the build output and
     * `npm run test:build` keeps passing.
     */
    await page.goto("/fr");

    await wheelZoom(page, -240);
    await marker(page, OSAKA.title, OSAKA.place).click();

    const shared = page.url();
    const params = new URL(shared).searchParams;
    expect(params.get("carte")?.split(",")).toHaveLength(3);
    expect(params.get("voyage")).toBe(OSAKA.slug);

    const framed = await viewBox(page);

    await page.goto(shared);

    await expect(page.getByRole("dialog")).toHaveAccessibleName("Les 2 voyages à cet endroit");
    await expect.poll(async () => (await viewBox(page)).join(" ")).toBe(framed.join(" "));
    // Restoring must not steal the focus: the reader has not asked for anything.
    await expect(page.getByRole("dialog")).not.toBeFocused();
  });

  test("the restored panel still gives the focus back to its marker", async ({ page }) => {
    // The focus-return contract has to survive a reload, or a shared link leaves
    // a keyboard reader with a panel they can close only into nowhere.
    await page.goto(`/fr?voyage=${REYKJAVIK.slug}`);
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(marker(page, REYKJAVIK.title, REYKJAVIK.place)).toBeFocused();
  });

  test("Back closes the panel", async ({ page }) => {
    await page.goto("/fr");
    await marker(page, OSAKA.title, OSAKA.place).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.goBack();

    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("an address naming no marker shows the map and cleans itself up", async ({ page }) => {
    await page.goto("/fr?voyage=un-voyage-disparu");

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(MAP_DRAWING)).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("voyage")).toBeNull();
  });

  test("an address carrying nonsense shows the map at the frame the build chose", async ({
    page,
  }) => {
    // A hand-shortened URL, or one mangled by a link unroller. Never a blank
    // drawing: a `viewBox` of `NaN` is ignored by the browser without a word.
    await page.goto("/fr");
    const initial = (await viewBox(page)).join(" ");

    for (const raw of ["NaN,0,300", "1,2", "0,0,-5", "bidon", ""]) {
      await page.goto(`/fr?carte=${encodeURIComponent(raw)}`);
      await expect.poll(async () => (await viewBox(page)).join(" ")).toBe(initial);
    }
  });
});

test.describe("touch", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("one finger leaves the map alone; two move it", async ({ page }) => {
    /**
     * "On mobile, one finger scrolls the page, two fingers manipulate the map."
     *
     * **What this proves and what it does not.** It dispatches real `TouchEvent`s
     * with one and then two touch points, so it proves the listener's branch and
     * that the two-finger path is registered non-passively (a passive listener
     * cannot `preventDefault`, and React registers `touchmove` passively — which
     * is why this listener is native). It does NOT prove that a physical pinch on
     * a phone reaches the page rather than being consumed as a browser zoom;
     * `touch-action` is what decides that, so the value is asserted below and the
     * gesture itself is on the ticket's manual list.
     */
    await page.goto("/fr");

    const surface = canvas(page);
    // The browser's own contract: vertical panning stays the page's, everything
    // else comes to the listener.
    await expect(surface).toHaveCSS("touch-action", "pan-y");

    const before = (await viewBox(page)).join(" ");

    const swipe = (points: readonly { x: number; y: number }[][]) =>
      surface.evaluate(
        (node, frames) => {
          const touchesFor = (frame: { x: number; y: number }[]) =>
            frame.map(
              (point, index) =>
                new Touch({
                  identifier: index,
                  target: node,
                  clientX: point.x,
                  clientY: point.y,
                })
            );

          const send = (type: string, frame: { x: number; y: number }[]) => {
            const touches = touchesFor(frame);
            node.dispatchEvent(
              new TouchEvent(type, {
                touches,
                targetTouches: touches,
                changedTouches: touches,
                bubbles: true,
                cancelable: true,
              })
            );
          };

          const [first, ...rest] = frames;
          if (first === undefined) return;
          send("touchstart", first);
          for (const frame of rest) {
            send("touchmove", frame);
          }
          send("touchend", []);
        },
        points as { x: number; y: number }[][]
      );

    // One finger, a long drag: nothing moves on the map.
    await swipe([[{ x: 200, y: 300 }], [{ x: 200, y: 200 }], [{ x: 200, y: 120 }]]);
    expect((await viewBox(page)).join(" ")).toBe(before);

    // Two fingers, spreading apart: the map zooms in.
    await swipe([
      [
        { x: 160, y: 300 },
        { x: 240, y: 300 },
      ],
      [
        { x: 120, y: 300 },
        { x: 280, y: 300 },
      ],
      [
        { x: 80, y: 300 },
        { x: 320, y: 300 },
      ],
    ]);

    await expect.poll(async () => (await viewBox(page)).join(" ")).not.toBe(before);
    expect(await frameWidth(page)).toBeLessThan(Number(before.split(" ")[2]));
  });

  test("a tap on a marker opens its panel", async ({ page }) => {
    await page.goto("/fr");

    await marker(page, REYKJAVIK.title, REYKJAVIK.place).tap();

    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test("the interactive map has no WCAG 2.2 AA violation, panel open, in either theme", async ({
  page,
}) => {
  /**
   * The automated audit with the panel OPEN — the state the previous audit of
   * this page could not reach, because there was no panel to open.
   *
   * `target-size` stays allowed, and only inside the map's own `<figure>`, exactly
   * as `map-equivalent.populated.spec.ts` allows it: Tokyo and Osaka overlap at
   * this crop and the marker underneath keeps less than 24 px of reachable area.
   * TIW-14 is what makes that reachable rather than what fixes it — the panel now
   * lists both trips, and zooming in separates the two markers — and the note in
   * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` should be read alongside
   * `zonesOf`.
   *
   * Everything the panel itself adds is audited without allowance: the dialog's
   * name, the cross's contrast, the cards inside it, the zoom controls.
   */
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/fr");
    await marker(page, OSAKA.title, OSAKA.place).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const report = await auditPage(page);
    const unexpected = [];

    for (const violation of report.violations) {
      const confined =
        violation.id === "target-size" && (await firedOnlyInsideTheMap(page, violation.targets));
      if (!confined) {
        unexpected.push(violation);
      }
    }

    expect(
      unexpected,
      `panel open (${colorScheme}): ${describeViolations({ ...report, violations: unexpected })}`
    ).toEqual([]);
    expect(report.passes).toBeGreaterThan(10);
  }
});
