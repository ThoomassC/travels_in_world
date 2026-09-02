import { expect, test, type Page } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };

/**
 * The heading outline of the four screens TIW-26 names — **and the reason it is a
 * test of its own rather than one more assertion inside the axe audits.**
 *
 * The criterion asks for "aucune violation d'accessibilité automatique bloquante
 * (contrastes, noms accessibles, **ordre des titres**)". axe-core has exactly that
 * rule, `heading-order`, and the audits in this repository do not run it.
 *
 * Not by oversight: `tests/e2e/support/axe.ts` runs `runOnly` on the WCAG 2.2 AA
 * tags, and its header says why — axe's default set also carries "best-practice"
 * rules, and a suite failing on those fails against nothing a reader can appeal
 * to. `heading-order` is one of them. Measured, from the resolved package:
 *
 *   heading-order  ["cat.semantics", "best-practice"]
 *   color-contrast ["cat.color", "wcag2aa", "wcag143", … ]
 *
 * So the tag filter is right and the criterion is still uncovered. **Proven by
 * deliberate failure**: turning `<h2>Où se situe ce voyage</h2>` into an `<h4>` on
 * the trip page left every axe audit in this repository green, on both themes.
 *
 * The outline is therefore asserted directly, which costs no dependency and has
 * the side benefit of being readable: a failure prints the outline it found.
 *
 * **Why populated.** On the repository's own empty `content/trips`, `/fr/voyages`
 * renders an empty-state block with no `<h3>` and no `<h4>`, and the trip page does
 * not exist at all. The outline worth pinning is the one with content in it — a
 * continent, a country, a trip: three nested levels that only appear then.
 */

type Heading = { readonly level: number; readonly text: string };

/**
 * Every heading of the document in source order, real tags and ARIA ones alike.
 *
 * `[role="heading"]` is included because a screen reader treats it as one, and
 * `aria-level` is what decides its depth; nothing on this site uses that form
 * today, and the day something does it must not slip out of this check.
 *
 * Visually hidden headings are deliberately **kept**: a screen reader reads them,
 * so they are part of the outline. `display: none` ones would not be, and none
 * exists here — measured, the lists below are the whole of what each page renders.
 */
const outlineOf = (page: Page): Promise<Heading[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].map((heading) => {
      const tag = /^H([1-6])$/.exec(heading.tagName);
      const aria = heading.getAttribute("aria-level");

      return {
        level: tag === null ? Number(aria ?? 0) : Number(tag[1]),
        text: (heading.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
      };
    })
  );

/** The outline as a reader of a failure would want to see it. */
const describeOutline = (outline: readonly Heading[]): string =>
  outline
    .map((heading) => `${"  ".repeat(heading.level - 1)}h${heading.level} ${heading.text}`)
    .join("\n");

/**
 * One `<h1>`, first, and no level skipped after it.
 *
 * Those are the two things an outline can get wrong that matter: a document with
 * two `<h1>`s has no title, and a jump from `<h2>` to `<h4>` tells a reader
 * navigating by heading that a section is missing.
 */
function expectWellFormed(outline: readonly Heading[], where: string): void {
  const printed = `\n${describeOutline(outline)}`;

  // Guards the guard: a selector that matched nothing would pass every assertion
  // below on an empty array. Every screen of this site has at least a title and
  // two sections.
  expect(
    outline.length,
    `Aucun titre trouvé sur ${where} : le sélecteur n'a rien vu, donc les assertions suivantes porteraient sur une liste vide.`
  ).toBeGreaterThanOrEqual(3);

  const firstLevels = outline.filter((heading) => heading.level === 1);
  expect(firstLevels, `${where} doit porter exactement un h1.${printed}`).toHaveLength(1);
  expect(outline[0]?.level, `le premier titre de ${where} doit être le h1.${printed}`).toBe(1);

  for (const [index, heading] of outline.entries()) {
    if (index === 0) continue;

    const previous = outline[index - 1]?.level ?? 1;
    expect(
      heading.level,
      `${where} saute un niveau de titre : « ${heading.text} » est un h${heading.level} après un h${previous}.${printed}`
    ).toBeLessThanOrEqual(previous + 1);
  }
}

for (const route of ["/fr", "/fr/voyages", "/fr/voyages/japon-2024", "/fr/a-propos"] as const) {
  test(`${route} has a well-formed heading outline`, async ({ page }) => {
    await page.goto(route);

    expectWellFormed(await outlineOf(page), route);
  });
}

/**
 * The map's selection panel, open — the fifth screen, and the one an outline is
 * most likely to break.
 *
 * The panel's own `<h2>` and its cards' `<h3>` are injected into a document that
 * already has an outline, at a place decided by the interaction layer rather than
 * by the page. A panel rendering an `<h3>` heading with no `<h2>` above it, or
 * cards at `<h4>`, would be invisible to every case above.
 */
test("the map panel keeps the outline well-formed when it opens", async ({ page }) => {
  await page.goto("/fr");

  await page
    .getByRole("link", {
      name: frMessages.map.markLabel
        .replace("{title}", "Islande, cercle d'or")
        .replace("{place}", "Reykjavik"),
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();

  expectWellFormed(await outlineOf(page), "/fr avec le panneau ouvert");
});
