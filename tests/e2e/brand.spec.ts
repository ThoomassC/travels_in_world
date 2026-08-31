import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };

/**
 * The brand, in a real rendering engine — the two things about it that only a
 * browser can answer.
 *
 * 1. **Does the favicon DECODE.** `src/app/icon.svg` is fetched as its own
 *    document and parsed as XML, not as HTML. It broke three times on this branch,
 *    each time silently: an XML comment mentioning `--logo-ink`, then a bare `<`
 *    in a CSS comment outside CDATA, then the CDATA terminator spelled out in the
 *    prose. Every one of them left `next build` at exit 0, every unit test green
 *    and every `<link rel="icon">` in place, with no icon on the site.
 *    `tests/build/brand.test.ts` asserts the link exists; only this file asserts
 *    that what it points at can be drawn.
 *
 * 2. **Does the ink follow the theme.** The favicon cannot inherit the page's
 *    custom properties — it is a separate document — so it carries its own
 *    `prefers-color-scheme` query. Whether a browser propagates the visitor's
 *    preference into an image document is a browser behaviour, not ours, and the
 *    only honest way to check it is to rasterise the thing and look at a pixel.
 *
 * Chromium only, like the rest of this suite. Firefox and Safari are NOT covered
 * here and are named as unverified in the pull request.
 */

const BRAND_NAME = frMessages.brand.name;

test("the logo leads home from a page that is not home", async ({ page }) => {
  await page.goto("/fr/voyages");

  /**
   * Queried by accessible name, which is the criterion itself: the name is the
   * brand AND where the link goes, because a reader who cannot see that this is
   * the logo in the corner has no way to know it leads home.
   */
  const logo = page.getByRole("link", {
    name: new RegExp(
      `^${BRAND_NAME}\\s*, ${frMessages.brand.homeDestination.replace(/^,\s*/, "")}`
    ),
  });

  await expect(logo).toBeVisible();
  await logo.click();
  await expect(page).toHaveURL("/fr");
});

test("the favicon is a document the browser can actually draw", async ({ page }) => {
  await page.goto("/fr");

  const size = await page.evaluate(async () => {
    const image = new Image();
    image.src = "/icon.svg";
    // Rejects on a malformed document, which is exactly the failure being guarded.
    await image.decode();

    return { width: image.naturalWidth, height: image.naturalHeight };
  });

  // 48 x 48 is the `viewBox` and the intrinsic size the file declares. Zero is
  // what a parse error produces, and it is what this test exists to refuse.
  expect(size).toEqual({ width: 48, height: 48 });
});

/**
 * Rasterise the favicon at 16 px — tab-bar size — and read the pixel at the
 * centre of the comet's head, which is solid ink in both themes.
 *
 * Not tainted, so `getImageData` is allowed: the SVG is same-origin. The sample
 * point comes from the geometry — the head disc is centred at (29.5, 18) in a
 * 48-unit box, so (0.61, 0.375) of the way across at any size.
 */
async function inkLuminanceAt16px(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(async () => {
    const image = new Image();
    image.src = "/icon.svg";
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(image, 0, 0, 16, 16);

    const x = Math.round(0.61 * 16);
    const y = Math.round(0.375 * 16);
    const [r, g, b, alpha] = context.getImageData(x, y, 1, 1).data;
    if (alpha === undefined || alpha < 200) {
      throw new Error(`the sample point is not inside the mark (alpha ${String(alpha)})`);
    }

    // Rec. 709 luma is enough here: the question is "light or dark", not a ratio.
    return (0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)) / 255;
  });
}

test("the favicon inks itself dark on a light system and light on a dark one", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/fr");
  const light = await inkLuminanceAt16px(page);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/fr");
  const dark = await inkLuminanceAt16px(page);

  /**
   * `#0c2731` is 0.02 relative luma, `#eef7fa` is 0.91. The thresholds are wide
   * on purpose: this asserts that the embedded media query is honoured and which
   * way round, not the exact hex — the hexes are pinned in
   * `tests/components/site/brand-art.test.ts`, against `tokens.css`.
   *
   * If BOTH came back dark, the mark would be near-invisible on a dark tab bar
   * and nothing else in this repository would notice.
   */
  expect(light).toBeLessThan(0.2);
  expect(dark).toBeGreaterThan(0.6);
});

test("the icon and share files are all really served", async ({ request }) => {
  /**
   * The `<link>` tags and the `og:image` are strings; these are the bytes. A
   * renamed file leaves every tag in place and every test green, and shows up as a
   * missing favicon or a card with no picture — on a link already sent.
   */
  const files: readonly (readonly [string, string])[] = [
    ["/icon.svg", "image/svg+xml"],
    ["/apple-icon.png", "image/png"],
    ["/opengraph-default.png", "image/png"],
  ];

  for (const [pathname, type] of files) {
    const response = await request.get(pathname);

    expect(response.status(), `${pathname} is not served`).toBe(200);
    expect(response.headers()["content-type"]).toContain(type);
  }
});
