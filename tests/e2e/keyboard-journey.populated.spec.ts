import { expect, test, type Page } from "@playwright/test";
import frMessages from "../../src/i18n/messages/fr.json" with { type: "json" };

/**
 * TIW-26's fifth acceptance criterion, whole and in one go: **accueil → carte →
 * panneau → voyage → retour carte, au clavier seul.**
 *
 * **Why this exists when three files already press keys.** They each prove a leg,
 * and every one of them starts its leg with `locator.focus()` — which is a
 * scripted jump to an element, not a reader arriving at it.
 * `map-equivalent.populated.spec.ts` walks the country list with real `Tab`
 * presses; `map-interaction.populated.spec.ts` calls `marker(...).focus()` and
 * then `panel.getByRole("link").focus()`. Both are the right tests for what they
 * assert. Neither can answer the question this criterion asks, which is whether
 * the *whole* path is walkable — and a path is exactly the thing that can be
 * broken at a join while every leg passes: an element that is focusable but never
 * reached, a `tabindex` that skips a block, a panel whose only link comes before
 * its own close button in the DOM and after it on screen.
 *
 * So nothing here focuses anything. `Tab`, `Enter`, and the browser's own answer
 * about where the focus went.
 *
 * **The journey's last leg is the one that had no test at all.** Getting *back*
 * to the map from a trip page goes through the header's "Voir sur la carte du
 * monde" — a link whose fragment (`/fr#voyage-<slug>`) the trip page's own comment
 * calls a forward-compatible seam. That it lands a keyboard reader on the map was
 * asserted nowhere.
 */

/** The trip this journey uses: one city, so its zone panel holds exactly one card. */
const TRIP = { slug: "islande-2022", title: "Islande, cercle d'or", place: "Reykjavik" } as const;

/**
 * Comfortably past the far side of any block on this fixture, and small enough
 * that a broken journey fails in seconds rather than hanging.
 */
const MAX_PRESSES = 40;

type Stop = {
  readonly tag: string;
  readonly text: string;
  readonly href: string | null;
  readonly isMarker: boolean;
  readonly inDialog: boolean;
  readonly inMain: boolean;
};

/** Where the focus is, read from the live document rather than inferred. */
const focused = (page: Page): Promise<Stop> =>
  page.evaluate(() => {
    const active = document.activeElement;

    return {
      tag: active?.tagName.toLowerCase() ?? "(aucun)",
      text: (active?.textContent ?? "").replace(/\s+/g, " ").trim(),
      href: active?.getAttribute("href") ?? null,
      isMarker: Boolean(active?.matches("a[data-trip]")),
      inDialog: Boolean(active?.closest('[role="dialog"]')),
      inMain: Boolean(active?.closest("main")),
    };
  });

/**
 * Presses `Tab` until `reached` answers true, and fails with the whole path when
 * it never does.
 *
 * The failure message is the reason this is a helper: "timed out" tells a reader
 * nothing, whereas the list of stops says exactly where the focus stopped going
 * where it should — which is the only useful thing to know about a broken tab
 * order.
 */
async function tabUntil(page: Page, what: string, reached: (stop: Stop) => boolean): Promise<Stop> {
  const walked: string[] = [];

  for (let press = 1; press <= MAX_PRESSES; press += 1) {
    await page.keyboard.press("Tab");
    const stop = await focused(page);
    walked.push(
      `${press}. <${stop.tag}> ${stop.text || "(sans texte)"}${stop.href === null ? "" : ` [${stop.href}]`}`
    );

    if (reached(stop)) {
      return stop;
    }
  }

  throw new Error(
    `${MAX_PRESSES} pressions de Tab sans atteindre ${what}. Le chemin parcouru :\n${walked.join("\n")}`
  );
}

test("a keyboard alone walks accueil → carte → panneau → voyage → retour carte", async ({
  page,
}) => {
  await page.goto("/fr");

  /**
   * Leg 0 — the document's own entry point. Asserted rather than skipped over:
   * the skip link is the first focusable thing on every page of this site, and a
   * journey that did not start there would be walking a different document from
   * the one a reader gets.
   */
  await page.keyboard.press("Tab");
  expect(await focused(page)).toMatchObject({
    tag: "a",
    text: frMessages.trips.skipToContent,
  });

  /**
   * Leg 1 — accueil → carte. The marker is reached by pressing Tab from the top
   * of the page, through the navigation and TIW-14's three zoom controls, with no
   * jump. `isMarker` (`a[data-trip]`) tells a marker apart from a country row of
   * the textual equivalent, which carries the same kind of href.
   */
  const marker = await tabUntil(
    page,
    `la balise de « ${TRIP.title} »`,
    (stop) => stop.isMarker && stop.href === `/fr/voyages/${TRIP.slug}`
  );
  expect(marker.text).toContain(TRIP.place);
  expect(marker.inMain, "la balise est dans le contenu et non dans le chrome").toBe(true);

  /**
   * Leg 2 — carte → panneau. `Enter` on a marker opens the panel instead of
   * following the link, and the focus moves into it. Both halves matter: a panel
   * that opens without taking the focus leaves a keyboard reader on a marker
   * behind a sheet.
   */
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();

  /**
   * Leg 3 — panneau → voyage. Tab from the panel must reach the trip's own link
   * *inside* the panel — `inDialog`, so a tab order that escaped the sheet and
   * landed on the marker list underneath fails here rather than passing on a link
   * with the right href in the wrong place.
   */
  const story = await tabUntil(
    page,
    `le lien vers « ${TRIP.title} » dans le panneau`,
    (stop) => stop.inDialog && stop.href === `/fr/voyages/${TRIP.slug}`
  );
  expect(story.tag).toBe("a");

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/fr/voyages/${TRIP.slug}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TRIP.title);

  /**
   * Leg 4 — voyage → retour carte, the leg nothing covered. The header's first
   * way out is "Voir sur la carte du monde"; a reader must reach it by Tab and
   * land on a drawn map, not on a fragment that resolves to nothing.
   */
  const back = await tabUntil(
    page,
    `le lien « ${frMessages.trip.seeOnWorldMap} » de l'en-tête du voyage`,
    (stop) => stop.text === frMessages.trip.seeOnWorldMap
  );
  expect(back.tag).toBe("a");
  expect(back.href, "le retour à la carte nomme ce voyage dans son fragment").toContain(
    `#voyage-${TRIP.slug}`
  );

  await page.keyboard.press("Enter");

  /**
   * `toHaveURL`, which retries, and not a bare `page.url()` — which is what the
   * first version of this line read, and it was measurably wrong:
   * `keyboard.press("Enter")` resolves when the key has been dispatched, not when
   * the navigation it started has committed. The assertion failed with
   * `/fr/voyages/islande-2022` against a link whose `href` the case above had just
   * proved correct, which is the least useful shape a failure can take.
   */
  await expect(page).toHaveURL(new RegExp(`/fr/?#voyage-${TRIP.slug}$`));

  /**
   * And the map is really there. The fragment is a seam the trip page's own
   * comment describes as landing "au sommet de la page" until TIW-20's home page
   * honours it — a degradation with no broken state in it. What the criterion
   * requires is that the reader arrives at the map, so that is what is asserted:
   * the drawing, with a frame.
   */
  const figure = page.locator("figure").first();
  await expect(figure).toBeVisible();
  await expect(figure.locator("svg")).toHaveAttribute("viewBox", /[\d. ]+/);

  /**
   * **The journey closes on the marker it left from**, and this assertion is not
   * the one this file was written with — it is what measuring produced.
   *
   * The expectation was the skip link: a fresh document, focus at the top, first
   * Tab on the first focusable element. What the browser actually does is honour
   * the fragment as a *sequential focus navigation starting point*, so the next
   * Tab lands on what `#voyage-islande-2022` names — which is the marker's own
   * `<li>`. `src/components/map/world-map.tsx` puts the `id` there deliberately,
   * and its comment says exactly why: "so the browser's sequential navigation
   * starting point lands on the marker rather than past it".
   *
   * So the loop closes where a reader would want it to: back on the map, on the
   * balise of the trip just read, one Tab away — not at the top of a document
   * they have to walk again. Worth pinning, because it is a property of two files
   * agreeing and nothing else in the suite says it.
   *
   * One correction for whoever reads the trip page next, since it was measured
   * here: the comment above `worldMapHref` in
   * `src/app/[locale]/voyages/[slug]/page.tsx` says this link "lands on the world
   * map at the top of the page" until the home page honours the fragment. The
   * anchors landed with TIW-14, so the *arrival* is now the right marker. What is
   * still true in that note is the rest of it — the map is not re-framed on the
   * trip, which is the part TIW-14 assigns to the framing.
   */
  await page.keyboard.press("Tab");
  const closing = await focused(page);
  expect(
    closing.isMarker,
    `retour au clavier : le focus est sur <${closing.tag}> « ${closing.text} » et non sur une balise de la carte`
  ).toBe(true);
  expect(closing.href).toBe(`/fr/voyages/${TRIP.slug}`);
  expect(closing.text).toContain(TRIP.place);
});
