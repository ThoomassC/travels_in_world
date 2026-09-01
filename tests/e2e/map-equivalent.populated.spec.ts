import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import {
  auditPage,
  describeViolations,
  firedOnlyInsideTheMap,
  type AxeViolation,
} from "./support/axe";

/**
 * The map's accessible equivalent on a **populated** journal, against its own
 * production build of `tests/fixtures/content/home-map` — four trips over four
 * countries, Japan holding two, one trip crossing Peru and Bolivia. See
 * `playwright.config.ts` for why this file gets a second server, and the
 * fixture's own README for why those four trips.
 *
 * This is the half of TIW-15 that cannot be asserted on the repository's empty
 * content: a count of trips per country needs trips, and the number this ticket
 * exists to add is precisely that count.
 *
 * Expected table, by French alphabetical order — the order `buildWorldGeometry`
 * collates `visited` in, and the order this list must not re-derive:
 *
 *     Bolivie 1 voyage · Islande 1 voyage · Japon 2 voyages · Pérou 1 voyage
 */

/**
 * The four rows, in the order the page must render them, each with the target its
 * link carries.
 *
 * **A country holding one trip goes straight to that trip; several go to the
 * listing.** The first version sent every row to `/fr/voyages#pays-<code>` and it
 * dangled: `TripCatalogue` files a trip under its *first arrival* country only,
 * so Bolivia — merely crossed by `perou-bolivie-2023` — had no section, and
 * `#pays-bo` matched nothing on a real build. A fragment matching no id does not
 * fail; it silently leaves the reader at the top of the listing. Both targets
 * below are routes, so neither can dangle.
 */
const EXPECTED = [
  { name: "Bolivie", label: "Bolivie 1 voyage", href: "/fr/voyages/perou-bolivie-2023" },
  { name: "Islande", label: "Islande 1 voyage", href: "/fr/voyages/islande-2022" },
  { name: "Japon", label: "Japon 2 voyages", href: "/fr/voyages" },
  { name: "Pérou", label: "Pérou 1 voyage", href: "/fr/voyages/perou-bolivie-2023" },
] as const;

/** Every row of the equivalent, located by its heading's region. */
const countryLinks = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Les pays visités" }).getByRole("link");

test("the fixture really is the four trips this file assumes", async ({ page }) => {
  /**
   * The guard on the guard. Everything below is arithmetic over the fixture, so a
   * suite pointed at the *wrong* build — the empty one, on the wrong port — would
   * fail in four confusing ways instead of one clear one. This is that one.
   */
  await page.goto("/fr");

  await expect(page.getByRole("figure")).toHaveAccessibleName(
    "Carte du monde, recadrée sur les voyages publiés : 4 voyages, 4 pays"
  );
});

test("the countries and their trip counts are under the map, in the reader's alphabet", async ({
  page,
}) => {
  await page.goto("/fr");

  await expect(
    page.getByRole("heading", { level: 2, name: frMessages.map.countriesHeading })
  ).toBeVisible();

  /**
   * Located through the block's own landmark rather than by a sibling selector:
   * `h2 ~ ul a` also matches the "Derniers voyages" heading and its list further
   * down the page, so it would have counted trips as countries.
   *
   * The count is *inside* each link, so it is part of the accessible name and a
   * reader tabbing through hears it. A count beside the link would satisfy a
   * visual check and be silent to the keyboard.
   */
  const links = countryLinks(page);
  await expect(links).toHaveCount(EXPECTED.length);

  const names = await links.evaluateAll((elements) =>
    elements.map((element) => (element.textContent ?? "").trim())
  );
  expect(names).toEqual(EXPECTED.map((entry) => entry.label));

  // And every link goes where the row promises.
  for (const entry of EXPECTED) {
    await expect(page.getByRole("link", { name: entry.label })).toHaveAttribute("href", entry.href);
  }
});

test("only the visited countries are links; the other 174 shapes are not", async ({ page }) => {
  await page.goto("/fr");

  // The whole dataset is drawn — 177 shapes plus a second pass over the 4 visited.
  const paths = page.locator("figure svg path");
  expect(await paths.count()).toBeGreaterThan(170);

  // And none of them is reachable, nameable or focusable.
  const svg = page.locator("figure svg");
  await expect(svg).toHaveAttribute("aria-hidden", "true");
  expect(await svg.locator("a, button, [tabindex], title, [role]").count()).toBe(0);

  /**
   * Four countries hold a trip, so four country links exist — not 177, and not
   * 174 neutral ones quietly focusable. Asserted as a relation between the
   * drawing and the equivalent, which is the property the criterion states.
   */
  await expect(countryLinks(page)).toHaveCount(4);
});

/**
 * **The explicit keyboard journey, end to end.** An acceptance criterion in its
 * own right, and the one thing an automated audit cannot answer: axe checks that
 * elements *can* be focused, not that the path through them makes sense.
 *
 * The route walked here is the one a reader takes: in at the top of the document,
 * through the navigation, across the map's four markers, into the four countries,
 * and out the far side into the rest of the page. Then Enter, twice, on the two
 * kinds of country row — because a link that goes nowhere useful is a link that
 * passed every audit.
 */
test("a reader reaches every country by keyboard and lands on its trips", async ({ page }) => {
  await page.goto("/fr");

  /**
   * Where the focus is, and — crucially — *which block* it is in.
   *
   * Not by href pattern: a country holding one trip now links to that trip's own
   * page, which is the same shape as a marker's href (`/fr/voyages/<slug>`). The
   * two are told apart by the part of the document they live in, which is what the
   * criterion is actually about — the equivalent is under the map.
   */
  const focused = () =>
    page.evaluate(() => {
      const active = document.activeElement;

      return {
        text: (active?.textContent ?? "").replace(/\s+/g, " ").trim(),
        href: active?.getAttribute("href") ?? null,
        insideSvg: Boolean(active?.closest("svg")),
        inMap: Boolean(active?.closest("figure")),
        /**
         * A marker, told apart from the three zoom controls TIW-14 added to the
         * same `<figure>`. Both are "in the map"; only one is a trip.
         */
        isMarker: Boolean(active?.matches("a[data-trip]")),
        isControl: Boolean(active?.closest("figure") && active?.matches("button")),
        inEquivalent: Boolean(active?.closest("section[aria-labelledby='pays-visites']")),
      };
    });

  type Stop = Awaited<ReturnType<typeof focused>>;
  const journey: Stop[] = [];

  // 40 presses is comfortably past the far side of the country list on this
  // fixture; the loop stops early once the last country has been passed.
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press("Tab");
    const stop = await focused();

    // Invariant of every single press, not of the journey as a whole: the focus
    // never enters the drawing.
    expect(stop.insideSvg).toBe(false);

    journey.push(stop);

    if (stop.inEquivalent && stop.text === EXPECTED[EXPECTED.length - 1]?.label) {
      break;
    }
  }

  // 1. The first stop is the skip link — the document's own entry point.
  expect(journey[0]?.text).toBe(frMessages.trips.skipToContent);

  /**
   * 2a. TIW-14's three zoom controls come BEFORE the markers, and that ordering
   * is a deliberate decision rather than an accident of the DOM: with sixty
   * published trips, controls placed after the marker list would be sixty tab
   * stops away, so a reader on a keyboard would have to walk the whole map to
   * reach the button that makes the map smaller. They are rendered first and
   * positioned over the map's corner by CSS.
   */
  const controlStops = journey.filter((stop) => stop.isControl);
  expect(controlStops).toHaveLength(3);
  /**
   * `endsWith` and not equality: a control's text node is its visible glyph
   * followed by its visually hidden name — "+Zoomer sur la carte" — which is the
   * shape the markers use too (a dot, then real text). The glyph is deliberately
   * not asserted here; it is a rendering choice, and the name is the contract.
   */
  expect(controlStops.map((stop) => stop.text.endsWith(frMessages.map.zoomIn))).toEqual([
    true,
    false,
    false,
  ]);
  expect(controlStops.map((stop) => stop.text.endsWith(frMessages.map.zoomOut))).toEqual([
    false,
    true,
    false,
  ]);
  expect(controlStops.map((stop) => stop.text.endsWith(frMessages.map.zoomReset))).toEqual([
    false,
    false,
    true,
  ]);

  // 2b. Then the map's four markers, one per published trip.
  const markerStops = journey.filter((stop) => stop.isMarker);
  expect(markerStops).toHaveLength(4);

  const lastControl = journey.reduce((last, stop, index) => (stop.isControl ? index : last), -1);
  const firstMarker = journey.findIndex((stop) => stop.isMarker);
  expect(firstMarker).toBeGreaterThan(lastControl);

  /**
   * 3. The four countries follow, in order, each announcing its own count. This is
   * the criterion "entirely navigable by keyboard" stated as the sequence a reader
   * actually receives rather than as a property of the markup.
   */
  const countryStops = journey.filter((stop) => stop.inEquivalent);
  expect(countryStops.map((stop) => stop.text)).toEqual(EXPECTED.map((entry) => entry.label));
  expect(countryStops.map((stop) => stop.href)).toEqual(EXPECTED.map((entry) => entry.href));

  // 4. The countries come after the markers: the equivalent is *under* the map in
  //    the tab order as well as on the screen.
  const firstCountry = journey.findIndex((stop) => stop.inEquivalent);
  const lastMarker = journey.reduce((last, stop, index) => (stop.isMarker ? index : last), -1);
  expect(firstCountry).toBeGreaterThan(lastMarker);

  /**
   * 5. And the focus leaves both blocks entirely — no trap. One more Tab from the
   *    last country reaches something that is neither a marker nor a country.
   */
  await page.keyboard.press("Tab");
  const after = await focused();
  expect(after.insideSvg).toBe(false);
  expect(after.inMap).toBe(false);
  expect(after.inEquivalent).toBe(false);

  /**
   * 6. Enter on a country holding one trip lands on that trip. This is the
   *    assertion that makes "link rather than duplicate" honest: the count under
   *    the map is only useful if it leads to the trips it counts.
   *
   *    Iceland is the plain case; **Bolivia is the case that broke the first
   *    version.** Its trip is filed on `/fr/voyages` under Peru, so the fragment
   *    `#pays-bo` this row used to carry matched nothing at all — and the trip page
   *    is the one document that does name Bolivia.
   */
  for (const [label, slug] of [
    ["Islande 1 voyage", "islande-2022"],
    ["Bolivie 1 voyage", "perou-bolivie-2023"],
  ] as const) {
    await page.goto("/fr");
    const row = page.getByRole("link", { name: label });
    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(new RegExp(`/fr/voyages/${slug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }

  /**
   * 7. And a country holding several lands on the listing, where its own heading
   *    holds exactly the number the row promised. The count is only meaningful if
   *    it matches what the reader then finds.
   */
  await page.goto("/fr");
  const japan = page.getByRole("link", { name: "Japon 2 voyages" });
  await japan.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/fr\/voyages$/);

  const japanSection = page.locator("section:has(> h3)").filter({ hasText: "Japon" }).first();
  await expect(japanSection.getByRole("heading", { level: 3, name: "Japon" })).toBeVisible();
  /**
   * The section's *own* list items, hence the direct-child selector: a `TripCard`
   * contains lists of its own, so `getByRole("listitem")` inside the section
   * counted 8 where the fixture has 2 — measured.
   */
  await expect(japanSection.locator("> ul > li")).toHaveCount(2);
});

test("shift-tab walks back out of the country list the way it came", async ({ page }) => {
  // The other direction, which a trap can break on its own: a container that
  // catches backwards focus is just as stuck.
  await page.goto("/fr");

  const bolivia = page.getByRole("link", { name: "Bolivie 1 voyage" });
  await bolivia.focus();
  await page.keyboard.press("Shift+Tab");

  const back = await page.evaluate(() => ({
    insideSvg: Boolean(document.activeElement?.closest("svg")),
    inMap: Boolean(document.activeElement?.closest("figure")),
    inEquivalent: Boolean(
      document.activeElement?.closest("section[aria-labelledby='pays-visites']")
    ),
  }));

  expect(back.insideSvg).toBe(false);
  // Backwards from the first country is the map's last marker — so the focus left
  // the equivalent rather than sticking on Bolivia or falling nowhere.
  expect(back.inEquivalent).toBe(false);
  expect(back.inMap).toBe(true);
});

test("the list is in the HTML the server sent, not assembled by a script", async ({ request }) => {
  /**
   * Fetched as bytes, with no browser and no JavaScript at all: "présente dans le
   * DOM rendu par le serveur" is a property of the response, and the only way to
   * assert it is to read the response. A page rendered by hydration would satisfy
   * every other test in this file and fail this one.
   *
   * It is also the indexer's and the slow connection's view of the page, which the
   * ticket names as reasons this list exists at all.
   */
  const response = await request.get("/fr");
  expect(response.status()).toBe(200);

  const html = await response.text();

  expect(html).toContain(frMessages.map.countriesHeading);
  for (const entry of EXPECTED) {
    expect(html).toContain(entry.name);
    expect(html).toContain(`href="${entry.href}"`);
  }
  // Two trips for Japan and one for the rest: the count itself is in the bytes.
  expect(html).toContain("2 voyages");
  // And not a single dangling fragment, which is what the first version shipped.
  expect(html).not.toContain("#pays-");
});

test("the caption tells the truth about what the drawing shows", async ({ page }) => {
  /**
   * The bug this closes, end to end and on a real build.
   *
   * `frameAround` crops to the extent of the markers, and the fixture's four
   * trips — Tokyo, Osaka, Cusco, Reykjavik — span 212° of longitude, which is
   * wide but not the world: the served `viewBox` is `177.3 0 764.4 398.2`, so
   * 764 units of 960. The caption used to say "Carte du monde" over that picture
   * regardless, and over the 288-unit crop a *single* published trip produces —
   * a label read aloud, describing something it did not match.
   *
   * Asserted as the relation rather than as two literals: the wording is checked
   * against the width the page really served, so the day the framing floor or the
   * fixture changes, this either stays true or fails loudly.
   */
  await page.goto("/fr");

  const viewBox = await page.locator("figure svg").getAttribute("viewBox");
  const width = Number(viewBox?.split(" ")[2]);

  expect(width).toBeLessThan(960);
  await expect(page.locator("figcaption")).toHaveText(
    "Carte du monde, recadrée sur les voyages publiés : 4 voyages, 4 pays"
  );
});

/**
 * The automated audit of the populated home page — the run the previous audit of
 * this map could not do, because it ran on an empty journal where there is no
 * marker, no country row and no count.
 *
 * **It found one violation, and it is allowed through by name.** `target-size`
 * (WCAG 2.5.8) fires on the map's *markers* as soon as two trips sit close
 * together at the rendered scale: Tokyo and Osaka are about 400 km apart, which
 * over a 764-unit crop of the world is a handful of pixels, so the two 44 px
 * targets overlap and the one underneath keeps less than 24 px of reachable area.
 *
 * That is not a defect of the textual equivalent and not a regression of this
 * ticket — the markers are untouched here.
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` records it as a measured,
 * accepted cost of positioning HTML markers in percentages over a fluid map
 * ("chaque `<a>` mesure bien 44 px … mais l'aire réellement atteignable de la
 * balise du dessous ne l'est pas") and assigns the real fix — clustering, with a
 * zoom that can actually separate them — to TIW-14. What this ticket did was make
 * it visible.
 *
 * The allowance is as narrow as it can be made: the `target-size` rule only, and
 * only while every element it fired on is inside the map's `<figure>`. The
 * country list is a sibling of that figure, so a target-size failure on a country
 * row fails this test — as does any other rule, anywhere.
 */
const KNOWN_MARKER_OVERLAP = "target-size";

test("the populated pages have no WCAG 2.2 AA violation, in either theme", async ({ page }) => {
  /**
   * Both prerendered routes, and `/fr/voyages` matters here specifically: on the
   * repository's empty content `TripCatalogue` renders nothing at all, so the
   * listing is only ever audited *populated* from this file.
   */
  for (const route of ["/fr", "/fr/voyages"] as const) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(route);

      const report = await auditPage(page);

      const unexpected: AxeViolation[] = [];

      for (const violation of report.violations) {
        const confinedToTheDrawing =
          violation.id === KNOWN_MARKER_OVERLAP &&
          (await firedOnlyInsideTheMap(page, violation.targets));

        if (!confinedToTheDrawing) {
          unexpected.push(violation);
        }
      }

      expect(
        unexpected,
        `${route} (${colorScheme}): ${describeViolations({ ...report, violations: unexpected })}`
      ).toEqual([]);
      expect(report.passes).toBeGreaterThan(10);
    }
  }
});

test("the marker overlap is the only violation, and it never reaches the country list", async ({
  page,
}) => {
  /**
   * The other half of the allowance above: an exception nobody re-reads becomes a
   * blanket. This pins what is actually being tolerated — one rule, on the
   * drawing's markers — so that the day TIW-14 clusters them, this test goes red
   * and the allowance can be deleted rather than inherited.
   */
  await page.goto("/fr");

  const report = await auditPage(page);

  /**
   * This goes red in **two** directions, and only one of them is a defect.
   *
   * A *new* rule id appearing is a regression to fix. `target-size` *ceasing* to
   * fire is the good news — TIW-14 clustered the markers, or the fixture moved, or
   * axe changed its heuristic (`axe-core` is a caret range) — and the action then
   * is to delete the allowance in the audit above along with this test, not to
   * make either of them pass again.
   */
  expect(
    report.violations.map((violation) => violation.id),
    `Expected exactly the known marker overlap. If target-size no longer fires, delete the allowance in the audit test above and this test with it; if a different rule appears, that one is a regression. Got: ${describeViolations(report)}`
  ).toEqual([KNOWN_MARKER_OVERLAP]);
  expect(await firedOnlyInsideTheMap(page, report.violations[0]?.targets ?? [])).toBe(true);
});
