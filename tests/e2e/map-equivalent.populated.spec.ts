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

/** The four rows, in the order the page must render them. */
const EXPECTED = [
  { name: "Bolivie", label: "Bolivie 1 voyage", anchor: "pays-bo" },
  { name: "Islande", label: "Islande 1 voyage", anchor: "pays-is" },
  { name: "Japon", label: "Japon 2 voyages", anchor: "pays-jp" },
  { name: "Pérou", label: "Pérou 1 voyage", anchor: "pays-pe" },
] as const;

test("the fixture really is the four trips this file assumes", async ({ page }) => {
  /**
   * The guard on the guard. Everything below is arithmetic over the fixture, so a
   * suite pointed at the *wrong* build — the empty one, on the wrong port — would
   * fail in four confusing ways instead of one clear one. This is that one.
   */
  await page.goto("/fr");

  await expect(page.getByRole("figure")).toHaveAccessibleName(
    "Carte du monde, recadrée sur les pays visités : 4 voyages, 4 pays"
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
   * Located by the fragment rather than by `h2 ~ ul a`: that sibling selector
   * also matches the "Derniers voyages" heading and its own list further down
   * the page, so it would have counted trips as countries. Nothing but a country
   * link carries `#pays-`.
   *
   * The count is *inside* each link, so it is part of the accessible name and a
   * reader tabbing through hears it. A count beside the link would satisfy a
   * visual check and be silent to the keyboard.
   */
  const links = page.locator("a[href*='#pays-']");
  await expect(links).toHaveCount(EXPECTED.length);

  const names = await links.evaluateAll((elements) =>
    elements.map((element) => (element.textContent ?? "").trim())
  );
  expect(names).toEqual(EXPECTED.map((entry) => entry.label));
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
  const countryLinks = page.locator("a[href*='#pays-']");
  await expect(countryLinks).toHaveCount(4);
});

/**
 * **The explicit keyboard journey, end to end.** An acceptance criterion in its
 * own right, and the one thing an automated audit cannot answer: axe checks that
 * elements *can* be focused, not that the path through them makes sense.
 *
 * The route walked here is the one a reader takes: in at the top of the document,
 * through the navigation, across the map's four markers, into the four countries,
 * and out the far side into the rest of the page. Then Enter on a country, and the
 * landing is checked — because a link that goes nowhere useful is a link that
 * passed every audit.
 */
test("a reader reaches every country by keyboard and lands on its trips", async ({ page }) => {
  await page.goto("/fr");

  /** The accessible name of whatever holds the focus, plus where it sits. */
  const focused = () =>
    page.evaluate(() => {
      const active = document.activeElement;

      return {
        tag: active?.tagName ?? "NONE",
        text: (active?.textContent ?? "").replace(/\s+/g, " ").trim(),
        href: active?.getAttribute("href") ?? null,
        insideSvg: Boolean(active?.closest("svg")),
      };
    });

  const journey: { tag: string; text: string; href: string | null }[] = [];

  // 40 presses is comfortably past the far side of the country list on this
  // fixture; the loop stops early once the last country has been passed.
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press("Tab");
    const stop = await focused();

    // Invariant of every single press, not of the journey as a whole: the focus
    // never enters the drawing.
    expect(stop.insideSvg).toBe(false);

    journey.push({ tag: stop.tag, text: stop.text, href: stop.href });

    if (stop.href?.includes(`#${EXPECTED[EXPECTED.length - 1]?.anchor}`) === true) {
      break;
    }
  }

  // 1. The first stop is the skip link — the document's own entry point.
  expect(journey[0]?.text).toBe(frMessages.trips.skipToContent);

  // 2. The four markers of the map are on the way, named by trip and place.
  const markerStops = journey.filter((stop) => /^\/fr\/voyages\/[a-z0-9-]+$/.test(stop.href ?? ""));
  expect(markerStops).toHaveLength(4);

  /**
   * 3. The four countries follow, in order, each announcing its own count. This
   * is the criterion "entirely navigable by keyboard" stated as the sequence a
   * reader actually receives rather than as a property of the markup.
   */
  const countryStops = journey.filter((stop) => stop.href?.includes("#pays-") === true);
  expect(countryStops.map((stop) => stop.text)).toEqual(EXPECTED.map((entry) => entry.label));

  // 4. The countries come after the markers: the equivalent is *under* the map in
  //    the tab order as well as on the screen.
  const firstCountry = journey.findIndex((stop) => stop.href?.includes("#pays-") === true);
  const lastMarker = journey.reduce(
    (last, stop, index) => (/^\/fr\/voyages\/[a-z0-9-]+$/.test(stop.href ?? "") ? index : last),
    -1
  );
  expect(firstCountry).toBeGreaterThan(lastMarker);

  /**
   * 5. And the focus leaves the map region entirely — no trap. One more Tab from
   *    the last country reaches something that is neither a marker nor a country.
   */
  await page.keyboard.press("Tab");
  const after = await focused();
  expect(after.insideSvg).toBe(false);
  expect(after.href?.includes("#pays-") ?? false).toBe(false);

  /**
   * 6. Enter on a country lands on the section of the listing that holds its
   *    trips. This is the assertion that makes "link rather than duplicate"
   *    honest: the count under the map is only useful if it leads to the trips it
   *    counts. A fragment matching no `id` would silently land at the top of the
   *    page and every other assertion here would still pass.
   */
  const japan = page.getByRole("link", { name: "Japon 2 voyages" });
  await japan.focus();
  await expect(japan).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/fr\/voyages#pays-jp$/);

  const section = page.locator("#pays-jp");
  await expect(section).toBeVisible();
  await expect(section.getByRole("heading", { level: 3, name: "Japon" })).toBeVisible();
  /**
   * The section's *own* list items, hence the direct-child selector: a `TripCard`
   * contains lists of its own, so `getByRole("listitem")` inside the section
   * counted 8 where the fixture has 2 — measured. Two is what the country link
   * promised, and this is the assertion that makes the count mean something.
   */
  await expect(section.locator("> ul > li")).toHaveCount(2);
  // In view, not merely present: the fragment moved the reader.
  await expect(section).toBeInViewport();
});

test("shift-tab walks back out of the country list the way it came", async ({ page }) => {
  // The other direction, which a trap can break on its own: a container that
  // catches backwards focus is just as stuck.
  await page.goto("/fr");

  const bolivia = page.getByRole("link", { name: "Bolivie 1 voyage" });
  await bolivia.focus();
  await page.keyboard.press("Shift+Tab");

  const back = await page.evaluate(() => ({
    href: document.activeElement?.getAttribute("href") ?? null,
    insideSvg: Boolean(document.activeElement?.closest("svg")),
  }));

  expect(back.insideSvg).toBe(false);
  // Backwards from the first country is the last marker of the map, not Bolivia
  // again and not nothing.
  expect(back.href).toMatch(/^\/fr\/voyages\/[a-z0-9-]+$/);
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
    expect(html).toContain(`#${entry.anchor}`);
  }
  // Two trips for Japan and one for the rest: the count itself is in the bytes.
  expect(html).toContain("2 voyages");
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
    "Carte du monde, recadrée sur les pays visités : 4 voyages, 4 pays"
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

test("the populated home page has no WCAG 2.2 AA violation, in either theme", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/fr");

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
      `${colorScheme}: ${describeViolations({ ...report, violations: unexpected })}`
    ).toEqual([]);
    expect(report.passes).toBeGreaterThan(10);
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

  expect(report.violations.map((violation) => violation.id)).toEqual([KNOWN_MARKER_OVERLAP]);
  expect(await firedOnlyInsideTheMap(page, report.violations[0]?.targets ?? [])).toBe(true);
});
