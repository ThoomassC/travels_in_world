import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations } from "./support/axe";
import { MAP_DRAWING } from "./support/map";

/**
 * The map's accessible equivalent on a **populated** journal, against its own
 * production build of `tests/fixtures/content/home-map` — five trips over five
 * countries, Japan holding two, one trip crossing Peru and Bolivia, Morocco's
 * story unwritten. See `playwright.config.ts` for why this file gets a second
 * server, and the fixture's own README for why those trips.
 *
 * **What the equivalent IS changed on 7 September 2026, and this file is where
 * that shows most.** Until then it was « Les pays visités », a counted list of
 * five country rows under the drawing, and roughly half the cases below were
 * about those rows: their order, their labels, their targets, their place in the
 * tab sequence. The owner removed the block from the map tab; the inventory it
 * held lives on the Pays and Villes tabs now, which have pages and tests of their
 * own.
 *
 * What remains here is the equivalent that is left, and it is not nothing: **five
 * real `<a href>` markers**, each named `{title}, {place}` — and `— récit à venir`
 * for the untold one — plus a `<figcaption>` that counts in words. That is what
 * carries WCAG 1.1.1 for a drawing the whole of which is `aria-hidden`. The cases
 * below were re-pointed at it rather than deleted, because the criteria they
 * serve did not change: nothing in the drawing is focusable, everything the
 * drawing says is said in text, and the keyboard reaches all of it and gets back
 * out.
 *
 * The one criterion that genuinely lost its channel is recorded where it belongs
 * rather than here: `src/app/[locale]/page.tsx` says what the removal costs 1.4.1
 * at the first published récit.
 */

test("the fixture really is the five trips this file assumes", async ({ page }) => {
  /**
   * The guard on the guard. Everything below is arithmetic over the fixture, so a
   * suite pointed at the *wrong* build — the empty one, on the wrong port — would
   * fail in five confusing ways instead of one clear one. This is that one.
   *
   * "5 pays" counts Morocco, which holds only an untold trip, and that is the
   * caption telling the truth: it answers *where has he been*, and a country
   * visited without being written about has still been visited. The distinction
   * belongs to the tint and to the row below, not to this number.
   */
  await page.goto("/fr");

  await expect(page.getByRole("figure")).toHaveAccessibleName(
    "Carte du monde, recadrée sur les voyages publiés : 5 voyages, 5 pays"
  );
});

test("nothing in the drawing is a link; the five markers beside it are", async ({ page }) => {
  await page.goto("/fr");

  // The whole dataset is drawn — 240 shapes at the 50m vintage, plus a second
  // pass over the 5 tinted ones split across two layers: 4 told, Morocco untold.
  const paths = page.locator(`${MAP_DRAWING} path`);
  expect(await paths.count()).toBeGreaterThan(170);

  // And none of them is reachable, nameable or focusable.
  const svg = page.locator(MAP_DRAWING);
  await expect(svg).toHaveAttribute("aria-hidden", "true");
  expect(await svg.locator("a, button, [tabindex], title, [role]").count()).toBe(0);

  /**
   * Five trips, so five links in the figure — not 240, and not 235 neutral shapes
   * quietly focusable. Asserted as a relation between the drawing and the text
   * beside it, which is the property the criterion states, and it survived the
   * removal of « Les pays visités » because the markers were always the other
   * half of it.
   *
   * Morocco's marker counts here even though its trip has no page: it is still a
   * real link, to that trip's entry in the listing, which is what keeps it
   * focusable and keyboard-operable. A marker with no link at all would have been
   * the easy answer and a 2.1.1 failure — the country would be tinted in the
   * drawing and unreachable everywhere else.
   */
  const markers = page.locator("figure a[data-trip]");
  await expect(markers).toHaveCount(5);

  /**
   * And each one is *named*, which is the whole of what makes them an equivalent
   * rather than five anonymous targets. The untold trip's name ends in the words
   * the drawing's copper tint cannot say.
   */
  const names = await markers.evaluateAll((elements) =>
    elements.map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()).sort()
  );
  expect(names).toEqual([
    "Islande, cercle d'or, Reykjavik",
    "Japon, printemps 2024, Tokyo",
    "Japon, retour à Osaka, Osaka",
    "Maroc, sud et Atlas, Marrakech — récit à venir",
    "Pérou et Bolivie, hiver 2023, Cusco — nouveau récit",
  ]);
});

/**
 * **The explicit keyboard journey, end to end.** An acceptance criterion in its
 * own right, and the one thing an automated audit cannot answer: axe checks that
 * elements *can* be focused, not that the path through them makes sense.
 *
 * The route walked here is the one a reader takes: in at the top of the document,
 * through the navigation, across the map's five markers, and out the far side
 * into the rest of the page. Then Enter, twice, on the two kinds of marker — the
 * one whose récit is written and the one whose is not — because a control that
 * does nothing useful is a control that passed every audit.
 *
 * **This journey used to have a fifth leg**, through the five country rows of
 * « Les pays visités ». The block is gone; the legs that remain are the ones that
 * were always the harder half — the drawing must stay out of the tab order, and
 * the figure must not trap what enters it.
 */
test("a reader reaches every trip by keyboard, and activating one opens it", async ({ page }) => {
  await page.goto("/fr");

  /**
   * Where the focus is, and — crucially — *which block* it is in. Asserted by
   * position in the document rather than by href pattern: a marker's href is
   * `/fr/voyages/<slug>` for a told trip and `/fr/voyages#voyage-<slug>` for an
   * untold one, and neither shape identifies "in the map".
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
      };
    });

  type Stop = Awaited<ReturnType<typeof focused>>;
  const journey: Stop[] = [];

  // 30 presses is comfortably past the far side of the marker list on this
  // fixture; the loop stops early once the focus has left the figure again.
  for (let press = 0; press < 30; press += 1) {
    await page.keyboard.press("Tab");
    const stop = await focused();

    // Invariant of every single press, not of the journey as a whole: the focus
    // never enters the drawing.
    expect(stop.insideSvg).toBe(false);

    journey.push(stop);

    if (journey.some((earlier) => earlier.isMarker) && !stop.inMap) {
      break;
    }
  }

  // 1. The first stop is the skip link — the document's own entry point.
  expect(journey[0]?.text).toBe(frMessages.trips.skipToContent);

  /**
   * 2a. **There are no controls in the journey any more** (TIW-38). The three
   * zoom buttons used to come BEFORE the markers, deliberately: with sixty
   * published trips, controls placed after the marker list would be sixty tab
   * stops away. They are gone, so the assertion that survives is that none came
   * back unannounced — a control reappearing after the markers would be the exact
   * regression that ordering existed to prevent, and nothing else in this suite
   * looks at the sequence.
   */
  const controlStops = journey.filter((stop) => stop.isControl);
  expect(controlStops).toHaveLength(0);

  /**
   * 2b. Then the map's five markers, one per trip the journal holds — the untold
   * one included, since it is a real link like the others (TIW-18). This is the
   * criterion "entirely navigable by keyboard" stated as the sequence a reader
   * actually receives rather than as a property of the markup.
   */
  const markerStops = journey.filter((stop) => stop.isMarker);
  expect(markerStops).toHaveLength(5);
  expect(markerStops.map((stop) => stop.text).sort()).toEqual([
    "Islande, cercle d'or, Reykjavik",
    "Japon, printemps 2024, Tokyo",
    "Japon, retour à Osaka, Osaka",
    "Maroc, sud et Atlas, Marrakech — récit à venir",
    "Pérou et Bolivie, hiver 2023, Cusco — nouveau récit",
  ]);

  /**
   * 3. And the focus leaves the figure entirely — no trap. The loop above stops
   *    on the first stop outside it, so the last entry is that proof.
   */
  const last = journey[journey.length - 1];
  expect(last?.inMap).toBe(false);
  expect(last?.insideSvg).toBe(false);

  /**
   * 4. Enter on a marker does something, and **what it does depends on whether
   *    the script is there** — which is the one thing this leg exists to pin.
   *
   *    With JavaScript, TIW-14's interaction layer intercepts the activation and
   *    opens the selection panel at `?voyage=<slug>`; the reader stays on the map.
   *    Measured, and it is why an earlier version of this case — asserting a
   *    navigation to the trip's page — was wrong rather than the code being so.
   *
   *    The `href` is what a reader **without** the script follows, so it is
   *    asserted as an attribute rather than by pressing Enter. And the two kinds
   *    of trip carry two different ones, which is the whole of TIW-18's marker
   *    rule: Iceland's récit is written, so its marker addresses that trip's own
   *    page; Morocco's is not, so `tripStaticParams` never built one and the
   *    marker addresses the trip's entry in the listing instead. A marker
   *    pointing at `/fr/voyages/maroc-2023` would be a 404 rendered into the HTML
   *    with a green build. `tests/e2e/no-javascript.populated.spec.ts` is where
   *    those addresses are actually walked with the script off.
   */
  for (const [label, slug, href] of [
    ["Islande, cercle d'or, Reykjavik", "islande-2022", "/fr/voyages/islande-2022"],
    [
      "Maroc, sud et Atlas, Marrakech — récit à venir",
      "maroc-2023",
      "/fr/voyages#voyage-maroc-2023",
    ],
  ] as const) {
    await page.goto("/fr");
    const marker = page.getByRole("link", { name: label });

    await expect(marker).toHaveAttribute("href", href);

    await marker.focus();
    await expect(marker).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(new RegExp(`\\?voyage=${slug}$`));
    await expect(page.getByRole("dialog")).toBeVisible();
  }
});

test("shift-tab walks back out of the marker list the way it came", async ({ page }) => {
  // The other direction, which a trap can break on its own: a container that
  // catches backwards focus is just as stuck.
  await page.goto("/fr");

  const where = () =>
    page.evaluate(() => ({
      insideSvg: Boolean(document.activeElement?.closest("svg")),
      inMap: Boolean(document.activeElement?.closest("figure")),
      isMarker: Boolean(document.activeElement?.matches("a[data-trip]")),
      tag: document.activeElement?.tagName ?? "NONE",
    }));

  await page.locator("figure a[data-trip]").first().focus();
  await page.keyboard.press("Shift+Tab");

  /**
   * One step back from the first marker is **the zoom slider**, measured — TIW-38
   * put a range input in the same `<figure>`, before the marker list. So the
   * focus is still in the map, and that is correct rather than a trap: it has
   * left the markers for the control that precedes them.
   */
  const first = await where();
  expect(first.insideSvg).toBe(false);
  expect(first.isMarker).toBe(false);
  expect(first.tag).toBe("INPUT");

  // And one more step leaves the figure altogether, which is the property a
  // backwards trap would break.
  await page.keyboard.press("Shift+Tab");
  const second = await where();
  expect(second.insideSvg).toBe(false);
  expect(second.inMap).toBe(false);
});

test("the markers are in the HTML the server sent, not assembled by a script", async ({
  request,
}) => {
  /**
   * Fetched as bytes, with no browser and no JavaScript at all: "présente dans le
   * DOM rendu par le serveur" is a property of the response, and the only way to
   * assert it is to read the response. A page rendered by hydration would satisfy
   * every other test in this file and fail this one.
   *
   * It is also the indexer's and the slow connection's view of the page, which is
   * one of the reasons the marker is a real `<a href>` and not a script-driven
   * hit area.
   */
  const response = await request.get("/fr");
  expect(response.status()).toBe(200);

  const html = await response.text();

  for (const [name, href] of [
    ["Islande, cercle d'or, Reykjavik", "/fr/voyages/islande-2022"],
    ["Japon, printemps 2024, Tokyo", "/fr/voyages/japon-2024"],
    ["Japon, retour à Osaka, Osaka", "/fr/voyages/japon-2025"],
    ["Maroc, sud et Atlas, Marrakech — récit à venir", "/fr/voyages#voyage-maroc-2023"],
    ["Pérou et Bolivie, hiver 2023, Cusco — nouveau récit", "/fr/voyages/perou-bolivie-2023"],
  ] as const) {
    expect(html).toContain(name);
    expect(html).toContain(`href="${href}"`);
  }

  // The count is in the bytes too, in the caption the figure is named by.
  expect(html).toContain("5 voyages, 5 pays");
  // And not a single dangling fragment: `#pays-` was the spelling that shipped
  // once, pointing at sections `TripCatalogue` does not emit for a crossed
  // country. Nothing writes it any more, and this is what notices if it returns.
  expect(html).not.toContain("#pays-");
});

test("the caption tells the truth about what the drawing shows", async ({ page }) => {
  /**
   * The bug this closes, end to end and on a real build.
   *
   * `frameAround` crops to the extent of the markers, and the fixture's trips —
   * Tokyo, Osaka, Cusco, Reykjavik, and Marrakech since TIW-18 — span 212° of
   * longitude, which is wide but not the world: the served `viewBox` is
   * `177.3 0 764.4 398.2`, so 764 units of 960. Marrakech falls strictly inside
   * that extent, which is why the fifth trip did not move a single unit of it. The caption used to say "Carte du monde" over that picture
   * regardless, and over the 288-unit crop a *single* published trip produces —
   * a label read aloud, describing something it did not match.
   *
   * Asserted as the relation rather than as two literals: the wording is checked
   * against the width the page really served, so the day the framing floor or the
   * fixture changes, this either stays true or fails loudly.
   */
  await page.goto("/fr");

  const viewBox = await page.locator(MAP_DRAWING).getAttribute("viewBox");
  const width = Number(viewBox?.split(" ")[2]);

  expect(width).toBeLessThan(960);
  await expect(page.locator("figcaption")).toHaveText(
    "Carte du monde, recadrée sur les voyages publiés : 5 voyages, 5 pays"
  );
});

/**
 * The automated audit of the populated home page — the run the previous audit of
 * this map could not do, because it ran on an empty journal where there is no
 * marker, no country row and no count.
 *
 * **It used to allow one violation through by name, and no longer needs to.**
 * `target-size` (WCAG 2.5.8) fired on the map's *markers* as soon as two trips
 * sat close together at the rendered scale: Tokyo and Osaka are about 400 km
 * apart, which over a 764-unit crop of the world is a handful of pixels, so the
 * two 44 px targets overlap and the one underneath keeps less than 24 px of
 * reachable area.
 *
 * **The overlap is still there. What changed is that axe stopped ruling on it,**
 * and this distinction is the whole reason the allowance was deleted rather than
 * quietly left in place. Since the marker became the inline pennant of
 * `src/components/map/mark-art.ts`, the drawing is translated up and left out of
 * its 44 px link box, and axe answers — measured, running the rule alone on this
 * fixture:
 *
 *   violations: []
 *   incomplete: target-size on a[data-trip="japon-2024"]
 *               "Element size could not be accurately determined due to
 *                overflow content"
 *
 * So the audit below is green because the rule became *undecidable*, not because
 * the markers were separated. The test after it is what keeps that from reading
 * as a fix: it measures the two boxes itself and fails if the overlap ever
 * silently becomes something else.
 *
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` records the overlap as a
 * measured, accepted cost of positioning HTML markers in percentages over a fluid
 * map ("chaque `<a>` mesure bien 44 px … mais l'aire réellement atteignable de la
 * balise du dessous ne l'est pas") and assigns the real fix — clustering, with a
 * zoom that can actually separate them — to TIW-14.
 *
 * This audit therefore demands **zero** violations, on both routes and in both
 * themes. If an axe bump (the dependency is a caret range) starts ruling on the
 * overlap again, this goes red and someone re-reads the trade rather than
 * inheriting an allowance nobody has looked at.
 */
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

      expect(report.violations, `${route} (${colorScheme}): ${describeViolations(report)}`).toEqual(
        []
      );
      expect(report.passes).toBeGreaterThan(10);
    }
  }
});

test("the marker overlap is still there, undecided rather than fixed", async ({ page }) => {
  /**
   * The other half of the deleted allowance, and the reason this test exists at
   * all: a green audit above says only that axe found nothing to rule on, and
   * "axe stopped ruling" and "the defect went away" are not the same sentence.
   * This one asks the *page*, not axe.
   *
   * It asserts on geometry rather than on a rule id, so it survives the caret
   * range on `axe-core` and it survives the marker's shape changing again. It
   * goes red the day TIW-14 clusters the markers — which is the day to delete it,
   * and to say so in the ADR.
   */
  await page.goto("/fr");

  const overlap = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>("a[data-trip]")].map((link) => ({
      slug: link.dataset.trip ?? "?",
      rect: link.getBoundingClientRect(),
    }));

    let worst = 0;
    let pair: readonly [string, string] = ["", ""];

    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        const area = Math.max(0, x) * Math.max(0, y);

        if (area > worst) {
          worst = area;
          pair = [a.slug, b.slug];
        }
      }
    }

    return { worst, pair, size: boxes[0]?.rect.width ?? 0 };
  });

  // The targets are the full 44 px WCAG 2.5.8 asks for — that half was never the
  // problem, and a marker that shrank would be a different, real regression.
  expect(overlap.size).toBeCloseTo(44, 0);

  /**
   * Tokyo and Osaka, measured on this fixture at the default viewport: the two
   * boxes overlap by 32 × 40 px, so the one underneath keeps far less than the
   * 24 px of clear space the rule asks for. The assertion is loose on purpose —
   * the exact figure moves with the crop — and tight on the thing that matters:
   * there IS a substantial overlap, and it is between the two Japanese trips.
   */
  expect(overlap.worst).toBeGreaterThan(24 * 24);
  expect([...overlap.pair].sort()).toEqual(["japon-2024", "japon-2025"]);

  /**
   * And axe's own current answer, recorded so the next reader does not have to
   * re-run the probe to learn why the audit above is green: the rule is
   * `incomplete`, not passing. If it ever moves back into `violations`, the audit
   * test goes red first and this line explains what happened.
   */
  const report = await auditPage(page);
  expect(report.incomplete).toContain("target-size");
});

/**
 * **THE TWO COUNTRY STATES DIFFER BY SOMETHING THAT IS NOT A COLOUR** — WCAG 1.4.1,
 * and the guard that turns a comment into a property.
 *
 * Since TIW-38 the drawing tells "this country has a récit" from "this one does
 * not" with copper against teal, a difference of hue alone. An audit measured the
 * two outlines at **1.08:1** in the light theme and **1.02:1** simulated for a
 * deuteranope — identical, in other words — while `world-map.module.css` carried a
 * comment claiming the outline was "also thicker". Both states were declared at
 * `stroke-width: 2`. The comment named a channel the stylesheet did not have.
 *
 * The channel exists now — 3.5 device pixels against 2 — and this is what keeps it
 * existing. It runs **here** and not in a unit test for two reasons: the widths are
 * a *computed* style, which needs a browser; and this fixture is the only place in
 * the repository where both states are rendered at once, because every trip in
 * `content/trips` is `story: unwritten` and the real site paints one tint.
 *
 * The assertion is a relation and not two numbers, so a future redesign may move
 * both as long as they stay apart.
 *
 * PROVEN BY DELIBERATE FAILURE, on the state the audit found:
 *
 *   // src/components/map/world-map.module.css, .visited path
 *   -  stroke-width: 3.5;
 *   +  stroke-width: 2;
 *
 *   npm run test:e2e:content  ->  1 failed | 96 passed
 *                                 "Expected: > 2   Received: 2"
 */
test("a reader who separates no hues can still tell the two country states apart", async ({
  page,
}) => {
  await page.goto("/fr");

  const widths = await page.evaluate(() => {
    const widthOf = (selector: string) => {
      const [shape] = document.querySelectorAll<SVGPathElement>(selector);
      return shape === undefined ? null : Number(getComputedStyle(shape).strokeWidth.replace("px", ""));
    };

    return {
      land: widthOf("figure svg g:not([class*='visited']):not([class*='untold']) path"),
      told: widthOf("figure svg g[class*='visited'] path"),
      untold: widthOf("figure svg g[class*='untold'] path"),
    };
  });

  // The fixture really renders both states — without this the comparison below
  // would be vacuously true on a journal with one tint.
  expect(widths.told, "no told country is drawn: the fixture changed").not.toBeNull();
  expect(widths.untold, "no untold country is drawn: the fixture changed").not.toBeNull();

  expect(widths.told).toBeGreaterThan(Number(widths.untold));
  // And both are still heavier than neutral land, which is the older distinction
  // this one must not have swallowed.
  expect(Number(widths.untold)).toBeGreaterThan(Number(widths.land));
});
