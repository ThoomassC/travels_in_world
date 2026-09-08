import { expect, test } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };
import { auditPage, describeViolations } from "./support/axe";
import { MAP_DRAWING } from "./support/map";

/**
 * The countries the carnet still wants to reach — the map's fourth tint, at the
 * owner's request: *« ajouter une nouvelle couleur sur les pays que je souhaite
 * voir avec un hover de texte qui dit "nom du pays : à venir" »*.
 *
 * **What only a browser can answer, and it is the whole feature.** The label is
 * visually hidden at rest and painted on `:hover` — a stylesheet rule, so jsdom
 * sees the text either way and cannot tell the two states apart at all. The unit
 * suite therefore asserts that the text *exists*; everything about the reveal,
 * about what it covers and about the drawing staying inert under a pointer is
 * here.
 *
 * The fixture's own wish list is `tests/fixtures/content/home-map/wishlist.yaml`,
 * and its header says why those two countries and not the owner's four: they have
 * to sit inside the frame the five markers already fix, and far enough from every
 * marker that two 44 px targets never overlap.
 */

const M = frMessages.map;
const WISHED = ["Croatie", "Viêt Nam"] as const;

const noteFor = (page: import("@playwright/test").Page, country: string) =>
  page
    .getByRole("list", { name: M.wishedListLabel })
    .locator("li")
    .filter({ hasText: `${country} : à venir` });

test("the caption names every country still to come, with nothing hovered", async ({ page }) => {
  await page.goto("/fr");

  /*
    **The line that closes the gap the hover leaves.** A sighted reader with a
    keyboard or a touch screen has no hover state; without this they would see two
    hatched countries and no name anywhere — the mark that used to stand on them
    is gone too, at the owner's request. Asserted first because it is the channel
    that owes nothing to a pointer.
  */
  const caption = page.locator("figcaption");

  for (const country of WISHED) {
    await expect(caption).toContainText(country);
  }
});

test("each note is read at rest and painted on hover", async ({ page }) => {
  await page.goto("/fr");

  const note = noteFor(page, "Croatie");
  const label = note.getByText("Croatie : à venir");

  // At rest the label is in the document — a screen reader has it — and clipped to
  // a single pixel, which is this project's visually-hidden recipe.
  await expect(label).toHaveCount(1);
  const resting = await label.boundingBox();
  expect(resting?.width ?? 99).toBeLessThan(2);

  await note.hover();

  const revealed = await label.boundingBox();
  expect(revealed?.width ?? 0).toBeGreaterThan(40);
});

/**
 * **WCAG 1.4.13, measured rather than asserted in a comment.**
 *
 * *Hoverable*: the label is inside the box the pointer is on, so moving onto the
 * label keeps it up — checked by hovering the label itself and finding it still
 * painted. *Persistent*: nothing but leaving removes it. *Dismissible* is claimed
 * by exemption — the label obscures no other content — and that claim is the one
 * a test can hold: the revealed box must not cover a marker.
 */
test("the revealed label stays up under the pointer and covers no marker", async ({ page }) => {
  await page.goto("/fr");

  const note = noteFor(page, "Croatie");
  const label = note.getByText("Croatie : à venir");

  await note.hover();
  await label.hover();
  await expect(label).toBeVisible();
  expect((await label.boundingBox())?.width ?? 0).toBeGreaterThan(40);

  const labelBox = await label.boundingBox();
  const markers = page.locator("figure a[data-trip]");

  for (let index = 0; index < (await markers.count()); index += 1) {
    const markerBox = await markers.nth(index).boundingBox();
    if (markerBox === null || labelBox === null) {
      continue;
    }
    const overlaps =
      labelBox.x < markerBox.x + markerBox.width &&
      markerBox.x < labelBox.x + labelBox.width &&
      labelBox.y < markerBox.y + markerBox.height &&
      markerBox.y < labelBox.y + labelBox.height;

    expect(overlaps, `the note covers the marker at index ${index}`).toBe(false);
  }
});

/**
 * **THE INVARIANT THIS FEATURE WAS MOST LIKELY TO BREAK.**
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` holds the drawing
 * `aria-hidden` and free of pointer events: nothing that is not a trip may be
 * hovered, focused or clicked. A note on a country wants a hover, and the way it
 * got one is that the note is **HTML over the drawing**, on the anchor `@/map`
 * computed — exactly what a marker is. The shapes never became interactive.
 */
test("the drawing is still inert, notes or no notes", async ({ page }) => {
  await page.goto("/fr");

  const drawing = page.locator(MAP_DRAWING);

  await expect(drawing).toHaveAttribute("aria-hidden", "true");
  await expect(drawing.locator("a, button, [tabindex]")).toHaveCount(0);
  expect(await drawing.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
});

/**
 * The notes are not tab stops, and that is a decision rather than an omission: a
 * focus stop whose only effect is to reveal text a screen reader already reads is
 * a stop that exists for nobody, and there would be one per wished country in
 * front of every marker on the map.
 */
test("the notes add no tab stop between the reader and the markers", async ({ page }) => {
  await page.goto("/fr");

  await expect(page.getByRole("list", { name: M.wishedListLabel }).locator("[tabindex]")).toHaveCount(
    0
  );
  await expect(
    page.getByRole("list", { name: M.wishedListLabel }).locator("a, button")
  ).toHaveCount(0);
});

test("the map has no WCAG 2.2 AA violation with a note revealed, in either theme", async ({
  page,
}) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/fr");
    await noteFor(page, "Croatie").hover();

    const report = await auditPage(page);

    /*
      No `target-size` allowance here, unlike `map-equivalent.populated.spec.ts`:
      the fixture's two wished countries are placed far enough from every marker
      that nothing overlaps, and the file's own header says so. If this starts
      failing on that rule, the fixture moved — not the component.
    */
    expect(report.violations, `wished notes (${colorScheme}): ${describeViolations(report)}`).toEqual(
      []
    );
    expect(report.passes).toBeGreaterThan(10);
  }
});

/**
 * **The marks on the wished countries are gone, and what is left must not eat a
 * click.** The owner asked for them: *« dans les pays à venir enlève les balises
 * »* — a hollow ring standing on a country that holds no trip read as a marker
 * that was not one.
 *
 * What replaced it is the target with nothing drawn in it, which creates a defect
 * of its own if it is careless: this layer sits *over* the markers, so an
 * invisible box wide enough to be findable is also wide enough to swallow a
 * marker's click. Both halves are asserted here, and the second is the one that
 * would be silent.
 */
test("a wished country carries no mark, and its hover zone steals no marker", async ({ page }) => {
  await page.goto("/fr");

  const zone = noteFor(page, "Croatie").locator("span").first();

  // Nothing is painted: no border, no background, no ink of its own.
  const paint = await zone.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      border: style.borderTopWidth,
      background: style.backgroundImage === "none" ? style.backgroundColor : "image",
    };
  });

  expect(paint.border).toBe("0px");
  expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(paint.background);

  // And it overlaps no marker's 44 px target.
  const zoneBox = await zone.boundingBox();
  const markers = page.locator("figure a[data-trip]");

  for (let index = 0; index < (await markers.count()); index += 1) {
    const markerBox = await markers.nth(index).boundingBox();
    if (markerBox === null || zoneBox === null) {
      continue;
    }
    const overlaps =
      zoneBox.x < markerBox.x + markerBox.width &&
      markerBox.x < zoneBox.x + zoneBox.width &&
      zoneBox.y < markerBox.y + markerBox.height &&
      markerBox.y < zoneBox.y + zoneBox.height;

    expect(overlaps, `the hover zone covers the marker at index ${index}`).toBe(false);
  }
});
