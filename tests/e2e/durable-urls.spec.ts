import { expect, test } from "@playwright/test";
// The import attribute is required here and not in the Vitest specs — see the note
// at the top of `routing.spec.ts`.
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { RENAMED_TRIP, WITHDRAWN_TRIP } from "./slug-history.fixture";

/**
 * Durable addresses, against a production build — because every one of these is an
 * HTTP fact and not a rendered one. A status code, a `Location` header, a
 * `Content-Type`: none of them is visible to a unit test, and the redirect in
 * particular is served by the routing layer from `next.config.ts` and therefore does
 * not exist at all under `next dev` in the same shape.
 *
 * The register these slugs come from is injected by `playwright.config.ts`; the
 * fixture module says why, and why that is not a weaker test than a committed entry.
 */

test("the renamed address answers 301 and names the new one", async ({ request }) => {
  /**
   * `maxRedirects: 0` and `request` rather than `page.goto`: the browser follows the
   * hop, so a page-level assertion can only see where it landed and would pass just
   * as happily on a 302, a 307 or a 308. The criterion is the code.
   */
  const response = await request.get(`/fr/voyages/${RENAMED_TRIP.from}`, { maxRedirects: 0 });

  expect(response.status()).toBe(301);
  expect(new URL(response.headers()["location"] ?? "", "http://127.0.0.1").pathname).toBe(
    `/fr/voyages/${RENAMED_TRIP.to}`
  );
});

test("301 and not Next's default 308", async ({ request }) => {
  /**
   * Worth its own case because the mistake is one word. `permanent: true` — the field
   * every example uses — emits 308, which several link unfurlers and older clients
   * treat as an unknown 3xx and refuse to follow. `statusCode: 301` is the entry
   * `src/i18n/slug-history.ts` builds, and this is what notices if it reverts.
   */
  const response = await request.get(`/fr/voyages/${RENAMED_TRIP.from}`, { maxRedirects: 0 });

  expect(response.status()).not.toBe(308);
  expect(response.status()).not.toBe(307);
});

test("the alias does not invent an address under an inactive locale", async ({ request }) => {
  /**
   * `/:locale(fr)` and not `/:locale`. An open parameter would answer 301 here and
   * send a crawler to `/de/voyages/<new>`, which is a 404 reached through a permanent
   * redirect — worse than the 404 it replaces, because the hop gets recorded.
   * `routing.spec.ts` pins that `/de` 404s where it stands; this keeps the aliases
   * from undoing it.
   */
  const response = await request.get(`/de/voyages/${RENAMED_TRIP.from}`, { maxRedirects: 0 });

  expect(response.status()).toBe(404);
});

test("an address that was never used is still a plain 404", async ({ request }) => {
  // The register must not turn every unknown slug into a redirect: only the ones
  // that were really renamed.
  const response = await request.get("/fr/voyages/jamais-publie", { maxRedirects: 0 });

  expect(response.status()).toBe(404);
});

/**
 * The withdrawn address.
 *
 * **200, where the acceptance criterion asks for 410.** Measured on this branch and
 * recorded in `src/app/[locale]/voyages/[slug]/withdrawn-notice.tsx`: a Route Handler
 * returning 200 builds as `○`, the same handler returning 410 builds as `ƒ`, and Next
 * exposes no prerenderable interrupt for 410 the way it does for 404, 401 and 403. A
 * real 410 therefore costs a server function on a URL with nothing to compute, against
 * invariant 1. What is asserted here is everything else the criterion asks for — and
 * the status is asserted too, explicitly, so the day a genuine 410 becomes possible
 * this test is the one that has to change and says so.
 *
 * TIW-31 went back and re-measured both doors; neither opened. Next's fallback
 * statuses are still the same closed set of three, on `canary` as on 16.3.1, and the
 * one mechanism that could answer 410 — a `routes` rule in `vercel.json` — is read by
 * the deployment platform and by nothing here. This suite runs `next start`, which
 * never opens that file, so it could not assert such a rule even if one were
 * configured. That is why the pin below stays 200 rather than becoming a skip.
 */
test("the withdrawn address explains itself instead of 404ing", async ({ page }) => {
  const response = await page.goto(`/fr/voyages/${WITHDRAWN_TRIP}`);

  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: frMessages.withdrawn.title })
  ).toBeVisible();
  await expect(page.getByText(frMessages.withdrawn.body)).toBeVisible();

  // The two ways out: the map, and — through the home page's own latest-trips block
  // — the full listing. With `content/trips/` empty that block shows its honest
  // waiting message, which is the production state today.
  await expect(page.getByRole("link", { name: frMessages.withdrawn.backMap })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: frMessages.home.emptyHeading })
  ).toBeVisible();
});

test("the withdrawn page asks not to be indexed, and keeps its canonical", async ({ page }) => {
  await page.goto(`/fr/voyages/${WITHDRAWN_TRIP}`);

  // `noindex` is what actually removes the page from an index; a 410 is a request to.
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  // And `follow`, because the links out of the page are the point of it.
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /follow/);
  await expect(page.locator("head link[rel=canonical]")).toHaveAttribute(
    "href",
    new RegExp(`/fr/voyages/${WITHDRAWN_TRIP}$`)
  );
});

test("the withdrawn page carries the skip link's target like every other route", async ({
  page,
}) => {
  // The `id` belongs to the page and the link to the layout, so it is exactly the
  // kind of thing that ships on one route and not on the next — the reason
  // `routing.spec.ts` re-asserts it per route.
  await page.goto(`/fr/voyages/${WITHDRAWN_TRIP}`);

  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await expect(page.locator("main")).toBeFocused();
});

test("the 404 page offers the map and the listing", async ({ page }) => {
  await page.goto("/fr/nulle-part");

  // The criterion: a human title and two ways out. The map serves the reader who
  // knows which trip they wanted; the listing serves the one who does not.
  await expect(
    page.getByRole("heading", { level: 1, name: frMessages.notFound.title })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: frMessages.notFound.backHome })).toHaveAttribute(
    "href",
    "/fr"
  );
  await expect(page.getByRole("link", { name: frMessages.notFound.backTrips })).toHaveAttribute(
    "href",
    "/fr/voyages"
  );
});

test("robots.txt is served, invites crawlers and names the sitemap", async ({ request }) => {
  const response = await request.get("/robots.txt");
  const body = await response.text();

  expect(response.status()).toBe(200);
  expect(body).toContain("User-Agent: *");
  expect(body).toContain("Allow: /");
  expect(body).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
});

test("sitemap.xml is served as XML and lists the index pages", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  const body = await response.text();

  expect(response.status()).toBe(200);
  // The `Content-Type` matters: a sitemap served as `text/plain` is one a crawler
  // fetches and discards.
  expect(response.headers()["content-type"]).toContain("xml");
  expect(body).toContain("<urlset");
  expect(body).toMatch(/<loc>https?:\/\/\S+\/fr<\/loc>/);
  expect(body).toMatch(/<loc>https?:\/\/\S+\/fr\/voyages<\/loc>/);
});

test("the sitemap advertises neither the renamed nor the withdrawn address", async ({
  request,
}) => {
  const body = await (await request.get("/sitemap.xml")).text();

  // A redirect in a sitemap asks a crawler to index a hop; a withdrawn story asking
  // to be de-indexed while the sitemap asks for it to be crawled says two things at
  // once. `tests/build/durable-urls.test.ts` makes the same check on the artefact,
  // in both directions; this is the served answer.
  expect(body).not.toContain(`/fr/voyages/${RENAMED_TRIP.from}`);
  expect(body).not.toContain(`/fr/voyages/${WITHDRAWN_TRIP}`);
});

test("the home page declares its own canonical, absolutely", async ({ page }) => {
  await page.goto("/fr");

  const canonical = page.locator("head link[rel=canonical]");

  await expect(canonical).toHaveAttribute("href", /^https?:\/\/[^/]+\/fr$/);
  // Never `localhost`: that is what Next writes when `metadataBase` is unset, with a
  // warning nobody reads in CI.
  await expect(canonical).not.toHaveAttribute("href", /localhost/);
});
