import { expect, test } from "@playwright/test";
// The import attribute is required here and not in the Vitest specs: Playwright
// loads specs as real ESM (package.json is `type: "module"`), where Node mandates
// it for JSON, while Vite resolves JSON imports itself.
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations } from "./support/axe";

/**
 * The photo viewer, against a production build — which is the only place its
 * behaviour exists.
 *
 * **Why this file is `*.populated.spec.ts`.** It runs under
 * `playwright.content.config.ts`, the second run TIW-15 added, which serves a build
 * of `tests/fixtures/content/home-map` instead of the repository's own (empty)
 * `content/trips`. The viewer can only be exercised on a trip page that *has*
 * photographs, and `routing.spec.ts` asserts the empty state of `/fr` on purpose
 * because that is what production serves today.
 *
 * Reusing that run rather than adding a third build is the whole reason
 * `japon-2024` gained four photographs: the fixture is already served by a build
 * the suite pays for. TIW-15 had written "no photos, deliberately" in its README
 * and the reason was `TripCard`'s substitute cover — so three of the four trips
 * still have none, and both branches of that card are now exercised where before
 * only one was. The README carries the amended reasoning.
 *
 * **What the unit suite cannot see, which is why every case below is here.** jsdom
 * implements `<dialog>` as an ordinary element: no `showModal`, no top layer, no
 * focus trap, no `Escape`, and `::backdrop` does not exist. So the four acceptance
 * criteria about the keyboard — open, walk, trap, restore — are *only* provable in
 * a browser, and a green component test proves none of them.
 *
 * **One thing this cannot prove, stated rather than left to be discovered.**
 * `next start` serves the repository's own `public/`, not the fixture's, and no
 * configuration moves it — so the photographs 404 here. Every element, every box
 * and every interaction is real; the decoding of an AVIF is not. That is asserted
 * where it can be, against the real encoder, in `tests/content/photo-files.test.ts`.
 */

const TRIP = "/fr/voyages/japon-2024";

const photos = frMessages.photos;

/** The dialog, found the way a reader's screen reader finds it. */
const viewer = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: photos.viewerHeading });

test.describe("the trip page's photos", () => {
  test("renders each one with its AVIF sources and its reserved box", async ({ page }) => {
    await page.goto(TRIP);

    const triggers = page.locator("[data-photo-index]");
    // The fixture declares four photos, one of which is the cover: the cover is
    // shown by the header and is not a trigger, so three remain.
    await expect(triggers).toHaveCount(3);

    const images = page.locator("main img");
    for (const image of await images.all()) {
      // Both dimensions on every image: this is what reserves the space before
      // the bytes arrive, and it is the acceptance criterion about layout shift.
      await expect(image).toHaveAttribute("width", /^\d+$/);
      await expect(image).toHaveAttribute("height", /^\d+$/);
    }

    // The modern format, as a `<source>` the browser can choose — one per photo
    // plus the cover, since the fixture's 600 px photographs offer the 480 rung.
    const avif = page.locator('main picture source[type="image/avif"]');
    expect(await avif.count()).toBeGreaterThanOrEqual(3);
    await expect(avif.first()).toHaveAttribute("srcset", /-480\.avif 480w/);
  });

  test("paints a blurred placeholder under each photo until it arrives", async ({ page }) => {
    await page.goto(TRIP);

    const style = await page.locator("main img").first().getAttribute("style");

    expect(style).toContain("data:image/webp;base64,");
  });

  /**
   * A photo carrying `placeSlug` belongs to its step, not to the trip's gallery.
   * The fixture attaches Kyoto's photograph to Kyoto, so it has to appear inside
   * that stay and **nowhere else** — the same image twice on one page is the
   * defect the cover exclusion already exists for.
   */
  test("shows a photo attached to a place inside that place's step, and only there", async ({
    page,
  }) => {
    await page.goto(TRIP);

    const kyoto = page.locator('img[src="/photos/japon-2024/kyoto.jpg"]');
    await expect(kyoto).toHaveCount(1);

    const step = page.locator('li[data-place="kyoto"]');
    await expect(step.locator('img[src="/photos/japon-2024/kyoto.jpg"]')).toHaveCount(1);
  });

  /**
   * The progressive base the viewer is grafted onto: with no JavaScript at all, a
   * photo is a link to the full-size file. The viewer *intercepts* that link; it
   * does not replace it. So a reader without JavaScript — and every
   * middle-click, Cmd-click and "open in new tab" — still gets the photograph.
   */
  test("is a page of real links to the full-size files without JavaScript", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();

    try {
      const response = await page.goto(TRIP);
      expect(response?.status()).toBe(200);

      const links = page.locator("main a[data-photo-index]");
      await expect(links).toHaveCount(3);
      await expect(links.first()).toHaveAttribute("href", /^\/photos\/japon-2024\/.+\.jpg$/);
      // And no dialog is open, obviously — but also none is *rendered* with
      // content, which is what keeps the document within its budget.
      await expect(page.locator("dialog h2")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

test.describe("the viewer", () => {
  test("opens on a click, and announces where the reader is", async ({ page }) => {
    await page.goto(TRIP);

    await page.locator("[data-photo-index]").first().click();

    await expect(viewer(page)).toBeVisible();
    await expect(page.getByText("Photo 1 sur 3")).toBeVisible();
  });

  test("opens the photo that was clicked, not the first one", async ({ page }) => {
    await page.goto(TRIP);

    // The third trigger of the page, whichever gallery it sits in: the numbering
    // is derived once for the whole page (`collection.ts`), so a click has to open
    // exactly that photo — the bug this pins is three loops each counting from 0.
    const third = page.locator("[data-photo-index]").nth(2);
    const expected = await third.getAttribute("data-photo-index");

    await third.click();

    await expect(page.getByText(`Photo ${Number(expected) + 1} sur 3`)).toBeVisible();
  });

  test("walks forward and back with the arrow keys, and stops at both ends", async ({ page }) => {
    await page.goto(TRIP);
    await page.locator("[data-photo-index]").first().click();
    await expect(viewer(page)).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("Photo 2 sur 3")).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("Photo 1 sur 3")).toBeVisible();

    /**
     * Clamped, not wrapping. A wrapping viewer cannot tell a reader they have seen
     * everything: the last photo followed by the first looks exactly like one
     * more, and the only way out of the loop is to notice a picture repeating.
     */
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("Photo 1 sur 3")).toBeVisible();

    for (let step = 0; step < 5; step += 1) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(page.getByText("Photo 3 sur 3")).toBeVisible();
  });

  test("walks with the visible controls too, so the shortcut is discoverable", async ({ page }) => {
    await page.goto(TRIP);
    await page.locator("[data-photo-index]").first().click();

    await page.getByRole("button", { name: photos.next }).click();
    await expect(page.getByText("Photo 2 sur 3")).toBeVisible();

    await page.getByRole("button", { name: photos.previous }).click();
    await expect(page.getByText("Photo 1 sur 3")).toBeVisible();
  });

  /**
   * The focus trap, which is the whole reason this component uses a native
   * `<dialog>` with `showModal()` rather than a hand-written modal.
   *
   * **What is asserted is that nothing *behind* the dialog can be reached**, and
   * not that `document.activeElement` is always inside it — because it is not, and
   * the difference is browser behaviour rather than a defect. Measured on this
   * build, tabbing from the open viewer:
   *
   *     open   BUTTON « Fermer la visionneuse »   inDialog=true
   *     tab 1  BUTTON « Photo précédente »        inDialog=true
   *     tab 2  BUTTON « Photo suivante »          inDialog=true
   *     tab 3  BODY                               inDialog=false
   *     tab 4  BUTTON « Fermer la visionneuse »   inDialog=true
   *
   * The wrap-around passes through the document root, as a tab cycle does; what
   * matters is that the skip link, the navigation and the photo triggers behind
   * the modal are never among the stops. So the assertion is on the set of
   * elements actually focused over a full cycle and a half — a strictly stronger
   * statement than "inside the dialog", since it would also catch focus escaping
   * to a *specific* element behind it, which `inDialog` alone would report the
   * same way as this harmless `BODY`.
   */
  test("lets nothing behind it take the focus while it is open", async ({ page }) => {
    await page.goto(TRIP);
    await page.locator("[data-photo-index]").first().click();
    await expect(viewer(page)).toBeVisible();

    const stops: string[] = [];
    // More presses than there are controls, so the walk necessarily wraps twice.
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const active = document.activeElement;
          if (active === null) return "null";
          const dialog = document.querySelector("dialog");
          if (dialog !== null && dialog.contains(active)) return "dialog";

          return active === document.body ? "body" : `ESCAPED:${active.tagName}`;
        })
      );
    }

    expect(stops.filter((stop) => stop.startsWith("ESCAPED"))).toEqual([]);
    // And the trap is real rather than vacuous: the walk did land inside.
    expect(stops).toContain("dialog");
  });

  test("closes on Escape and hands the focus back to the photo that was clicked", async ({
    page,
  }) => {
    await page.goto(TRIP);
    const trigger = page.locator("[data-photo-index]").first();
    await trigger.click();
    await expect(viewer(page)).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(viewer(page)).toBeHidden();
    /**
     * Restored to the *trigger*, not merely to the document: a reader's next `Tab`
     * has to continue from the photo they opened (WCAG 2.4.3). A browser is
     * supposed to do this on its own, but the specification leaves it to
     * implementations and the element it remembers is not necessarily the one that
     * opened the viewer — a swipe, for instance, focuses nothing.
     */
    await expect(trigger).toBeFocused();
  });

  test("closes on the cross, and hands the focus back too", async ({ page }) => {
    await page.goto(TRIP);
    const trigger = page.locator("[data-photo-index]").first();
    await trigger.click();

    await page.getByRole("button", { name: photos.close }).click();

    await expect(viewer(page)).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  /**
   * Navigation by dragging, driven through real pointer events — Playwright's
   * mouse produces `pointerdown`/`pointerup` in Chromium, so this exercises the
   * same handlers a finger would. What it does **not** reproduce is a touch
   * pointer's `touch-action` interaction with the browser's own scrolling; that is
   * a browser behaviour, declared in CSS (`pan-y pinch-zoom`) and not something a
   * synthetic gesture can assert.
   */
  test("moves to the next photo on a drag to the left", async ({ page }) => {
    await page.goto(TRIP);
    await page.locator("[data-photo-index]").first().click();
    await expect(viewer(page)).toBeVisible();

    const frame = viewer(page).locator("figure");
    const box = await frame.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;

    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByText("Photo 2 sur 3")).toBeVisible();
  });

  test("ignores a mostly vertical drag, which is a scroll", async ({ page }) => {
    await page.goto(TRIP);
    await page.locator("[data-photo-index]").first().click();

    const frame = viewer(page).locator("figure");
    const box = await frame.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;

    await page.mouse.move(box.x + box.width / 2, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height - 10, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByText("Photo 1 sur 3")).toBeVisible();
    await expect(viewer(page)).toBeVisible();
  });

  test("does not hijack a modified click, so opening in a new tab still works", async ({
    page,
  }) => {
    await page.goto(TRIP);

    await page
      .locator("[data-photo-index]")
      .first()
      .click({ modifiers: ["Shift"] });

    // The reader asked the browser for the file, not this component for a modal.
    await expect(viewer(page)).toBeHidden();
  });
});

/**
 * The last acceptance criterion, and the one that only a viewport can answer:
 * « aucune image ne dépasse la largeur de l'écran sur mobile ».
 *
 * Asserted on `scrollWidth` and not on each image's box, because an image can be
 * within its container and the *page* still scroll sideways — which is what a
 * reader actually experiences. 320 px is the narrowest viewport worth supporting.
 */
test.describe("on a 320 px screen", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("no photo makes the page scroll sideways", async ({ page }) => {
    await page.goto(TRIP);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the open viewer does not scroll sideways either", async ({ page }) => {
    await page.goto(TRIP);
    await page.locator("[data-photo-index]").first().click();
    await expect(viewer(page)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * **A trip with no photograph at all** — the first acceptance criterion of TIW-18,
 * and the one that turned out to be already met.
 *
 * It is pinned here rather than reimplemented, because *already met* is a claim
 * about the served bytes and nothing in the suite was checking it. The trip page
 * omits the gallery section, the cover and the viewer by three separate
 * conditions in three different places (`galleryPhotos.length > 0`,
 * `cover === null`, `viewer.length > 0`), and any one of them could be relaxed by
 * an edit that looked like tidying — leaving an empty `<section>` under a heading
 * promising photos, which is exactly the "cadre vide" the ticket is named after.
 *
 * `japon-2025` is the trip: one stay in Osaka, no `photos` key at all, so the
 * schema's `.default([])` is what the page receives — the ordinary shape of a
 * `trip.yaml` that never mentions photographs.
 */
test.describe("a trip with no photograph", () => {
  const BARE_TRIP = "/fr/voyages/japon-2025";

  test("renders no image element, so there is no broken-image glyph to paint", async ({ page }) => {
    await page.goto(BARE_TRIP);

    /**
     * Asserted on the *elements* and not on the styling, because that is what the
     * criterion is about: an `<img>` with an absent or empty `src` is precisely
     * what makes a browser draw its broken-image icon, and a `<picture>` commits
     * to whichever `<source>` it selected (ADR 0014). No element, nothing to
     * break.
     */
    await expect(page.locator("img")).toHaveCount(0);
    await expect(page.locator("picture")).toHaveCount(0);
  });

  test("omits the gallery section rather than showing an empty one", async ({ page }) => {
    await page.goto(BARE_TRIP);

    /**
     * The heading is the thing that must not exist. "Photos du voyage" over
     * nothing promises something nobody has undertaken to deliver — and it is a
     * heading, so a screen-reader reader walking the page by heading is sent to an
     * empty chapter.
     */
    await expect(page.getByRole("heading", { name: frMessages.trip.photosHeading })).toHaveCount(0);

    // The two chapters that do belong to every trip are still there, so this does
    // not pass by the page having failed to render.
    await expect(page.getByRole("heading", { name: frMessages.trip.mapHeading })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: frMessages.trip.timelineHeading })
    ).toBeVisible();
  });

  test("mounts no viewer, since nothing could ever open it", async ({ page }) => {
    await page.goto(BARE_TRIP);

    /**
     * A `<dialog>` with no photograph in it is a dialog no trigger can reach, and
     * it would still be in the document for a screen reader to meet. The count is
     * zero rather than "not visible": `<dialog>` is hidden until `showModal`, so
     * "not visible" would pass on a page that shipped one.
     */
    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(page.locator("[data-photo-index]")).toHaveCount(0);
  });

  test("has no WCAG 2.2 AA violation axe can find", async ({ page }) => {
    /**
     * The photoless page audited in its own right. The populated audits elsewhere
     * run on `/fr` and `/fr/voyages`; a trip page with every optional block absent
     * is a different document, and "no empty frame" is precisely the kind of
     * defect that shows up as an empty landmark or a heading with no content.
     */
    await page.goto(BARE_TRIP);
    const report = await auditPage(page);

    expect(report.violations, describeViolations(report)).toEqual([]);
    expect(report.passes).toBeGreaterThan(10);
  });
});
