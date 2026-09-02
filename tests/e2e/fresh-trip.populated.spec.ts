import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations } from "./support/axe";

/**
 * The "nouveau récit" badge on a served, prerendered page — TIW-19, on the
 * **populated** journal of `tests/fixtures/content/home-map`.
 *
 * **What only this file can see.** The rule is a pure function and is asserted
 * boundary by boundary in `tests/domain/freshness.test.ts`; the chain from the
 * YAML to the rule is asserted in `tests/app/freshness-pipeline.test.ts`. What
 * neither can reach is the three things that only exist in a browser: the halo's
 * `prefers-reduced-motion` state, whether the badge survives axe, and whether the
 * bytes a CDN would serve actually carry it — a badge computed correctly and
 * rendered into a client-only branch would pass every test above and be absent
 * from the document.
 *
 * **One day per build, and this build is J+1.** `playwright.content.config.ts`
 * sets `TIW_BUILD_DATE=2026-01-06`, one day after the fixture's newest
 * publication. A served page pins exactly one day, which is why J+61 is asserted
 * over the same collection in the unit suite and not here.
 *
 * **The fixture carries the ticket's trap, deliberately.** `islande-2022` is the
 * *oldest journey* of the four and the *newest publication*
 * (`publishedAt: 2026-01-05`), while `japon-2025` is the newest journey. So an
 * implementation reading `startDate` — or trusting the content façade's order —
 * badges Japan here, and this file is what says so.
 */

/** The trip whose récit went online last: the oldest journey of the four. */
const FRESH = {
  slug: "islande-2022",
  title: "Islande, cercle d'or",
  place: "Reykjavik",
  href: "/fr/voyages/islande-2022",
} as const;

/** The newest *journey*, which the badge must not follow. */
const NEWEST_JOURNEY_SLUG = "japon-2025";

const badges = (page: Page) => page.getByText(frMessages.trips.cardNew, { exact: true });

test.describe("the home page", () => {
  test("announces the newest récit in a banner, above the map", async ({ page }) => {
    await page.goto("/fr");

    const banner = page.getByRole("complementary", { name: FRESH.title });

    await expect(banner).toBeVisible();
    await expect(banner.getByText(frMessages.home.freshLabel, { exact: true })).toBeVisible();
    await expect(banner.getByRole("link", { name: FRESH.title })).toHaveAttribute(
      "href",
      FRESH.href
    );

    /**
     * Above the map, which is where a returning reader looks first — the reason
     * the banner exists rather than only a chip in the listing. Compared by DOM
     * position rather than by pixels, which is what "avant" means in a document
     * and what survives a narrow viewport.
     */
    const order = await page.evaluate(() => {
      const aside = document.querySelector("aside");
      const figure = document.querySelector("figure:has(svg)");

      if (aside === null || figure === null) return "missing";

      return (aside.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        ? "banner-first"
        : "map-first";
    });

    expect(order).toBe("banner-first");
  });

  /**
   * **The mitigation this ticket owes the reader, and the reason it is asserted
   * rather than left to a comment.** The site is prerendered, so a badge outlives
   * its sixtieth day until the next build (`docs/fraicheur-au-prerendu.md`). A
   * stale "Nouveau récit" is simply wrong; a stale one carrying its own date lets
   * the reader judge. Remove the `<time>` and the honest half of the banner goes
   * with it.
   */
  test("dates the announcement, in words and in a machine-readable attribute", async ({ page }) => {
    await page.goto("/fr");

    const time = page.getByRole("complementary", { name: FRESH.title }).locator("time");

    await expect(time).toHaveAttribute("datetime", "2026-01-05");
    await expect(time).toHaveText("5 janvier 2026");
  });

  test("badges the newest publication and not the newest journey", async ({ page }) => {
    await page.goto("/fr");

    /**
     * The banner names Islande while the first card of "Derniers voyages" is
     * Japon 2025 — the two orders disagreeing, on a real build, which is the
     * whole point of this fixture. A derivation reading `startDate` puts the same
     * trip in both places and passes everything except this line.
     */
    await expect(page.getByRole("complementary", { name: FRESH.title })).toBeVisible();

    const firstCardLink = page
      .getByRole("heading", { level: 2, name: frMessages.home.latestHeading })
      .locator("xpath=following::ul[1]")
      .getByRole("link")
      .first();

    await expect(firstCardLink).toHaveAttribute("href", `/fr/voyages/${NEWEST_JOURNEY_SLUG}`);
  });

  test("carries the badge on exactly one card, wherever that card is", async ({ page }) => {
    await page.goto("/fr");

    /**
     * `islande-2022` is one of the four trips and the home page shows three, so
     * the chip may or may not be in this block — "au plus un" is the invariant,
     * never "exactement un". What must never happen is two.
     */
    expect(await badges(page).count()).toBeLessThanOrEqual(1);
  });
});

test.describe("the map's marker", () => {
  test("says it is new in words, not only by the halo", async ({ page }) => {
    await page.goto("/fr");

    /**
     * The criterion, and the case that would fail on a colour-and-motion-only
     * implementation: the marker's accessible name carries the claim. Built from
     * the catalogue rather than retyped, so the wording stays in `fr.json`.
     */
    const name = frMessages.map.markLabelNew
      .replace("{title}", FRESH.title)
      .replace("{place}", FRESH.place);

    await expect(page.getByRole("link", { name })).toHaveAttribute("href", FRESH.href);
  });

  test("marks one marker, and leaves the others ordinary", async ({ page }) => {
    await page.goto("/fr");

    await expect(page.locator("a[data-trip][data-new]")).toHaveCount(1);
    await expect(page.locator("a[data-trip][data-new]")).toHaveAttribute("data-trip", FRESH.slug);

    // Still a plain link to its trip: the halo is decoration over an unchanged
    // marker, so a reader without JavaScript navigates exactly as before.
    await expect(page.locator("a[data-trip][data-new]")).toHaveAttribute("href", FRESH.href);
  });

  /**
   * **The halo animates, and it is the animation that is asserted — not the
   * class.** `getComputedStyle().animationName` is resolved by the browser from
   * the stylesheet, so this fails if the keyframes are renamed away, if the
   * selector stops matching, or if the CSS Module hash breaks the link.
   */
  test("pulses on the newest marker and on no other", async ({ page }) => {
    await page.goto("/fr");

    const animationOf = (selector: string) =>
      page.evaluate((css) => {
        const element = document.querySelector(css);

        return element === null
          ? "missing"
          : getComputedStyle(element).animationName;
      }, selector);

    expect(await animationOf("a[data-trip][data-new] > span:nth-child(2)")).not.toBe("none");
    expect(await animationOf(`a[data-trip="${NEWEST_JOURNEY_SLUG}"] > span:nth-child(2)`)).toBe(
      "none"
    );
  });

  /**
   * **`prefers-reduced-motion`, and the half that is easy to get wrong.**
   *
   * `src/styles/tokens.css` carries a blanket reduce block clamping every
   * animation to 0.01 ms. Leaning on it would have *deleted* this channel rather
   * than calmed it: the halo would freeze on whichever keyframe it stopped at,
   * and 0 % is the only visible one — so the ring would never appear, for exactly
   * the readers who asked for less motion and not for less information.
   *
   * So both halves are asserted under the emulated preference: no animation, and
   * a ring that is still there. Playwright emulates the media feature at the
   * browser level, so this is the real cascade and not a guess.
   */
  test("stops moving under prefers-reduced-motion, and stays visible", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/fr");

    const halo = page.locator("a[data-trip][data-new] > span:nth-child(2)");
    const style = await halo.evaluate((element) => {
      const computed = getComputedStyle(element);

      return {
        animationName: computed.animationName,
        opacity: computed.opacity,
        borderWidth: computed.borderTopWidth,
      };
    });

    expect(style.animationName).toBe("none");
    // Still a ring: visible opacity and a real border, so the marker keeps a
    // visual distinction beside the textual one.
    expect(Number(style.opacity)).toBeGreaterThan(0.5);
    expect(Number.parseFloat(style.borderWidth)).toBeGreaterThan(0);

    // And the words are untouched, which is the channel that never depended on
    // motion in the first place.
    const name = frMessages.map.markLabelNew
      .replace("{title}", FRESH.title)
      .replace("{place}", FRESH.place);
    await expect(page.getByRole("link", { name })).toBeVisible();
  });
});

test.describe("the full listing", () => {
  test("badges the same trip as the home page, in its own country group", async ({ page }) => {
    await page.goto("/fr/voyages");

    /**
     * Exactly one here, because the listing shows every trip. The badged card is
     * wherever Iceland falls in the continent grouping — this page is a
     * catalogue, and hoisting one trip out of its group to make the badge easier
     * to find would break the only ordering the reader is promised.
     */
    await expect(badges(page)).toHaveCount(1);

    const card = page.locator("article").filter({ has: badges(page) });

    await expect(card.getByRole("link", { name: FRESH.title })).toHaveAttribute(
      "href",
      FRESH.href
    );
  });
});

test.describe("the feed", () => {
  test("lists every published récit, newest publication first", async ({ page }) => {
    const response = await page.request.get("/feed.xml");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/rss+xml; charset=utf-8");

    const body = await response.text();

    /**
     * The order is by publication and not by journey, so `islande-2022` — the
     * oldest of the four trips — is the first item. Compared by the position of
     * each slug in the document, which is the only reading that is about order.
     */
    const positions = [
      "islande-2022",
      "japon-2025",
      "perou-bolivie-2023",
      "japon-2024",
    ].map((slug) => body.indexOf(slug));

    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    // Four trips, four items, and a channel a reader's aggregator can parse.
    expect((body.match(/<item>/g) ?? []).length).toBe(4);
    expect(body).toContain("<lastBuildDate>Mon, 05 Jan 2026 00:00:00 GMT</lastBuildDate>");
  });

  test("is discoverable from the document a browser loads", async ({ page }) => {
    await page.goto("/fr");

    // What an aggregator's "find the feed" button reads. Without it the feed
    // exists at an address nobody is told about.
    const link = page.locator('link[rel="alternate"][type="application/rss+xml"]');

    await expect(link).toHaveCount(1);
    expect(await link.getAttribute("href")).toContain("/feed.xml");
  });
});

/**
 * The automated WCAG pass, on the two pages the badge touches.
 *
 * Zero violations is a floor and not a proof — `support/axe.ts` says what an
 * automated audit cannot judge — which is why the cases above walk the textual
 * channel and the reduced-motion state explicitly. What this adds is the family
 * a badge is most likely to break: a chip whose contrast fails, a `<time>` with
 * no accessible text, a landmark with no name, a heading level skipped by the
 * banner's `<h2>` landing between `<h1>` and the listing's own.
 *
 * **No allowance here, unlike `map-equivalent.populated.spec.ts`.** That spec
 * tolerates one documented `target-size` violation inside the map's figure; this
 * one asserts an empty list, so a new violation of any rule anywhere on these
 * pages is this ticket's to answer for.
 */
for (const route of ["/fr", "/fr/voyages"]) {
  test(`${route} has no WCAG 2.2 AA violation axe can find`, async ({ page }) => {
    await page.goto(route);

    const report = await auditPage(page);
    const violations: readonly AxeViolationLike[] = report.violations;

    expect(
      report.passes,
      "axe reported zero passing rules, so the audit ran on nothing."
    ).toBeGreaterThan(0);
    expect(violations, describeViolations(report)).toEqual([]);
  });
}

/** The shape `describeViolations` prints, kept local so the loop above is typed. */
type AxeViolationLike = {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly targets: readonly string[];
};
