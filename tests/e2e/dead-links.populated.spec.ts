import { expect, test, type Page } from "@playwright/test";

/**
 * **Every internal link of every reachable page leads somewhere that exists.**
 *
 * The acceptance criterion this file answers is the one that is easiest to
 * believe already met: "aucun lien mort sur la carte comme dans les listes". No
 * test in this repository walked a rendered `href` before it.
 * `tests/build/durable-urls.test.ts` holds canonicals and the sitemap to the
 * prerendered pages — the addresses the site *advertises* — and says nothing
 * about the addresses it *links to*, which is where a reader actually goes.
 *
 * **It is not a hypothetical, and the repository has paid for it twice.** The
 * map's textual equivalent shipped `/fr/voyages#pays-bo`, a fragment matching no
 * id on a real build, and `src/components/map/visited-countries.tsx` records
 * measuring it: a fragment that resolves to nothing does not fail, it silently
 * leaves the reader at the top of a listing. And the trip page's own
 * `/#voyage-<slug>` pointed at a home page that did not yet emit those ids —
 * TIW-20's note calls it "a promise the URL made and the document did not keep".
 * Both were caught by hand.
 *
 * TIW-18 makes the class of fault permanent rather than incidental: a trip can
 * now exist with no page at all, so `tripPath(slug)` is a live 404 for anything
 * carrying `story: unwritten`. Three renderings had to choose a different
 * destination — the marker, the card's title, the country row — and "we
 * remembered in all three" is not a property anybody can check by reading.
 *
 * ## What it does
 *
 * A breadth-first crawl from `/fr`, following same-origin document links, and
 * then two assertions over everything it saw:
 *
 * 1. every internal path answered **200**;
 * 2. every fragment resolves to an element that really is in the target
 *    document.
 *
 * The second is the half that matters and the half a status check misses: a
 * dangling fragment is a 200.
 *
 * **What it deliberately does not do.** It never requests an external host — a
 * suite that fails when GitHub is slow is a suite that gets skipped — and it does
 * not follow `mailto:`. Those are `tests/e2e/about.spec.ts`'s business, which
 * asserts their shape without dialling them.
 */

/** Reader-facing pages only: Next's own error documents are not crawled into. */
const START = "/fr";

/**
 * A hard stop on the crawl, so a cycle or an unexpected route explosion fails as
 * a number rather than as a timeout. The fixture holds five trips, so the real
 * count is nine documents (`/fr`, `/fr/voyages`, `/fr/a-propos`, four trip pages,
 * and whatever those link to among the same set).
 */
const MAX_PAGES = 40;

type Reference = {
  /** The page the link was found on, so a failure names where to look. */
  readonly from: string;
  /** As written in the document. */
  readonly href: string;
  /** Path with no fragment, always locale-prefixed and absolute. */
  readonly path: string;
  /** Without the `#`, or `null` for a bare path. */
  readonly fragment: string | null;
};

/** External, `mailto:`, `tel:` — anything this suite must not dial. */
function isInternal(href: string): boolean {
  return href.startsWith("/") || href.startsWith("#");
}

/**
 * **Documents only.** A path whose last segment carries an extension is an asset,
 * and this crawl is about pages.
 *
 * The exclusion is named rather than left implicit because it was found by a
 * failure and the reason is not obvious: `PhotoGallery` renders each photograph as
 * a real `<a href="/photos/…/kyoto.jpg">` — deliberately, so a reader with no
 * JavaScript still opens the full-size image — and under this config those files
 * answer **404**. Not because anything is broken: `next start` serves the
 * repository's own `public/`, never the fixture's, which
 * `tests/e2e/photo-viewer.populated.spec.ts` states in its own header and works
 * within.
 *
 * So asserting a 200 here would be asserting a property of the *server's
 * configuration* and not of the link. That an asset a trip declares really exists
 * is `npm run validate:content`'s job — it checks the original and all three AVIF
 * rungs against the disk, case included — and the brand's own files are weighed by
 * `tests/build/brand.test.ts`. This guard covers the addresses a reader
 * *navigates* to.
 */
function isDocument(path: string): boolean {
  const last = path.split("/").at(-1) ?? "";

  return !last.includes(".");
}

/**
 * Splits an `href` into the document it names and the fragment inside it,
 * resolved against the page it was written on.
 *
 * `new URL` and not a hand-rolled split: `#` inside a query string, an empty
 * fragment (`href="#"`) and a bare fragment all have defined behaviour there, and
 * this is exactly the kind of parsing a regex gets subtly wrong — which would
 * make the guard lenient in the direction that matters.
 */
function referenceOf(from: string, href: string, origin: string): Reference {
  const resolved = new URL(href, `${origin}${from}`);
  const fragment = resolved.hash === "" ? null : decodeURIComponent(resolved.hash.slice(1));

  return { from, href, path: normalisePath(resolved.pathname), fragment };
}

/**
 * One document, one key: a trailing slash is dropped.
 *
 * Found by a failure, and the cause is real rather than cosmetic. The trip page's
 * way back to the map is `localePathname({ href: "/#voyage-<slug>" })`, which
 * renders `/fr/#voyage-<slug>` — so `new URL` reports the pathname as `/fr/`. Next
 * serves the same document for both spellings, so leaving them distinct would
 * crawl the home page twice and, worse, split its ids across two keys: a fragment
 * written `/fr/#…` would be checked against a map entry that happened to be
 * populated from `/fr`, or not, depending on crawl order.
 */
function normalisePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

async function hrefsOn(page: Page): Promise<readonly string[]> {
  return page.$$eval("a[href]", (anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href") ?? "")
  );
}

/** Every `id` in the document, which is what a fragment has to match. */
async function idsOn(page: Page): Promise<readonly string[]> {
  return page.$$eval("[id]", (elements) => elements.map((element) => element.id));
}

test("no rendered link on any page leads to an address that does not exist", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1").origin;

  /** Path → the ids that document really contains. */
  const idsByPath = new Map<string, ReadonlySet<string>>();
  /** Every internal link seen anywhere, kept with the page it was written on. */
  const references: Reference[] = [];

  const queue: string[] = [START];
  const crawled = new Set<string>();

  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (crawled.has(path)) {
      continue;
    }
    crawled.add(path);
    expect(crawled.size, "the crawl found more documents than this fixture can hold").toBeLessThan(
      MAX_PAGES
    );

    /**
     * `waitUntil: "domcontentloaded"` and not the default `load`: the assertions
     * are about server-rendered markup, and every href and every id below is in
     * the document before a single byte of JavaScript runs. Waiting for images
     * would also mean waiting for the fixture's photographs, which 404 here —
     * `next start` serves the repository's `public/`, as
     * `photo-viewer.populated.spec.ts` states at length.
     */
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });

    expect(response?.status(), `${path} was linked to and did not answer 200`).toBe(200);

    idsByPath.set(path, new Set(await idsOn(page)));

    for (const href of await hrefsOn(page)) {
      if (!isInternal(href)) {
        continue;
      }
      const reference = referenceOf(path, href, origin);
      if (!isDocument(reference.path)) {
        continue;
      }
      references.push(reference);

      if (!crawled.has(reference.path)) {
        queue.push(reference.path);
      }
    }
  }

  /**
   * The crawl reached the whole site, which is the guard on the guard: a run that
   * followed nothing would report success for having checked one page. Seven
   * documents on this fixture — three index pages plus the four trips that have a
   * récit, and **not** `maroc-2023`, which has none.
   *
   * Written out rather than counted, so the day a route arrives somebody has to
   * decide whether a reader should reach it from `/fr` at all.
   */
  expect([...crawled].sort()).toEqual([
    "/fr",
    "/fr/a-propos",
    "/fr/voyages",
    "/fr/voyages/islande-2022",
    "/fr/voyages/japon-2024",
    "/fr/voyages/japon-2025",
    "/fr/voyages/perou-bolivie-2023",
  ]);

  // And it really did find links to check, in quantity.
  expect(references.length).toBeGreaterThan(30);

  /**
   * Every fragment resolves. Collected into one list rather than asserted in the
   * loop so that a failure names *all* the dangling references at once — the
   * shape `describeViolations` gives the axe audits, and the difference between
   * one fix and one fix per run.
   */
  const dangling = references.filter((reference) => {
    if (reference.fragment === null) {
      return false;
    }
    const ids = idsByPath.get(reference.path);

    // A fragment into a document the crawl never opened cannot be checked, which
    // must read as a failure and not as a pass.
    return ids === undefined || !ids.has(reference.fragment);
  });

  expect(
    dangling.map((reference) => `${reference.from} → ${reference.href}`),
    "these links carry a fragment that matches no element in the page they point at"
  ).toEqual([]);
});

test("the untold trip has no page, and nothing anywhere links to one", async ({
  page,
  request,
}) => {
  /**
   * The two halves of TIW-18's criterion, stated as one test because either alone
   * is satisfiable while the pair is broken.
   *
   * The crawl above proves that every link *it followed* resolves — but it
   * discovers pages *through* links, so a link to `/fr/voyages/maroc-2023` would
   * have made the crawl visit it and fail on the 404. This states the same thing
   * from the other end, which is the direction that reads as the criterion: the
   * address is genuinely absent, and the bytes of the two pages that render this
   * trip do not mention it.
   */
  const gone = await request.get("/fr/voyages/maroc-2023");

  expect(gone.status(), "an untold trip must have no page at all").toBe(404);

  for (const route of ["/fr", "/fr/voyages"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });

    /**
     * Asserted on the rendered `href`s and not on the HTML text, deliberately: the
     * slug appears in both documents in perfectly correct places — the marker's
     * `data-trip`, the listing entry's `id`, the fragment
     * `/fr/voyages#voyage-maroc-2023` — so a `not.toContain("maroc-2023")` would
     * be red on a correct page. What must not exist is the *link*.
     */
    expect(
      (await hrefsOn(page)).filter((href) => href.includes("/voyages/maroc-2023")),
      `${route} renders a link to a trip page that was never built`
    ).toEqual([]);
  }

  /**
   * The other half, and it is the half a `not.toContain` would let rot: none of
   * this must pass by the trip having quietly disappeared from the journal. It is
   * on both pages, in the shape each page gives it — a marker on the map, an
   * addressable entry in the listing — and neither shape is a link to a page.
   */
  await page.goto("/fr", { waitUntil: "domcontentloaded" });
  await expect(page.locator('a[data-trip="maroc-2023"]')).toHaveAttribute(
    "href",
    "/fr/voyages#voyage-maroc-2023"
  );

  await page.goto("/fr/voyages", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#voyage-maroc-2023")).toContainText("Récit à venir");
});

test("the untold marker opens the panel with JavaScript, and navigates without it", async ({
  page,
  browser,
}) => {
  /**
   * **The two behaviours of one marker**, and the reason the href had to stay a
   * real address rather than become a `<button>`.
   *
   * Written as one test because they are one decision. TIW-14's interaction layer
   * intercepts a plain activation on any marker whose zone has a panel and opens
   * the panel instead of navigating — so with the script running, an untold
   * marker's job is to show « Récit à venir » in the panel, which is exactly what
   * the acceptance criterion asks of it. With the script absent, the same element
   * is a link, and it has to land the reader somewhere real.
   *
   * The first half of this used to assert a navigation and was wrong about the
   * product, not about the code: pressing Enter gave `/fr?voyage=maroc-2023`, the
   * panel's own addressable state. That is the criterion working, so the test
   * follows it.
   */

  // 1. With JavaScript: the panel opens, and it is where « Récit à venir » is read.
  await page.goto("/fr");

  const marker = page.locator('a[data-trip="maroc-2023"]');

  await expect(marker).toHaveAttribute("href", "/fr/voyages#voyage-maroc-2023");
  await marker.focus();
  await page.keyboard.press("Enter");

  const panel = page.getByRole("dialog");

  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Récit à venir");
  /**
   * And the panel's own card carries no link either — which is the whole point.
   * A panel is the one place a reader is *most* likely to expect one, so a card
   * that grew a "Lire le récit" link here would be a dead address in the most
   * inviting spot on the page.
   */
  await expect(panel.locator('a[href*="/voyages/maroc-2023"]')).toHaveCount(0);

  // 2. Without JavaScript: the same element is a link, and it lands on the entry.
  const bare = await browser.newContext({ javaScriptEnabled: false });

  try {
    const noScript = await bare.newPage();
    await noScript.goto("/fr");
    await noScript.locator('a[data-trip="maroc-2023"]').click();

    await expect(noScript).toHaveURL(/\/fr\/voyages#voyage-maroc-2023$/);

    /**
     * The fragment resolves to the trip's own entry, which is what `#pays-bo`
     * failed to do: a real page, a real 200, and the reader deposited at the top
     * of a listing with no idea why.
     */
    const entry = noScript.locator("#voyage-maroc-2023");

    await expect(entry).toBeVisible();
    await expect(entry).toContainText("Récit à venir");
    await expect(entry.locator("a")).toHaveCount(0);
  } finally {
    await bare.close();
  }
});
