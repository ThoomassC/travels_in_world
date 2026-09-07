import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/i18n/messages/fr.json";
import { SiteBrand } from "@/components/site/site-brand";
import { SiteNav } from "@/components/site/site-nav";
import { defaultLocale } from "@/i18n/routing";

/**
 * The header lock-up, queried the way a reader meets it: by role and accessible
 * name.
 *
 * The message catalogue is the REAL one, like every other component test here. A
 * stub would let the component read a key that does not exist in `fr.json` and
 * still pass, which on a French-only site is invisible any other way — and this
 * component's whole accessible name is made of two of those keys.
 *
 * What no assertion below is about: pixels. jsdom computes no layout, so the
 * clearance between the trajectory and the aeroplane, the 32 px mark and the 44 px
 * target are checked by rendering in a real browser and by reading
 * `./brand-art.test.ts`, never here. Saying so is the point — a test that looked
 * like it covered the drawing would be worse than no test.
 */
function renderBrand(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("the logo is the link home", () => {
  it("points at the locale's home page", () => {
    renderBrand(<SiteBrand locale={defaultLocale} />);

    // `/fr`, never `/` — the prefix is what `localePathname` exists for, and a
    // logo linking to `/` would take a 307 through `next.config.ts` on every
    // click from every page of the site.
    expect(screen.getByRole("link")).toHaveAttribute("href", `/${defaultLocale}`);
  });

  it("announces the name AND where the link goes", () => {
    renderBrand(<SiteBrand locale={defaultLocale} />);

    /**
     * The criterion in two halves. "Travels in World" is the name; ", retour à
     * l'accueil" is the destination, because a reader who cannot see that this is
     * the logo in the top-left corner has no way to know that it leads home —
     * every other link on the site says where it goes.
     *
     * A regexp rather than an exact string: `dom-accessibility-api` and real
     * screen readers differ on whether adjacent inline text nodes are joined with
     * a space, and this test is about the two parts being there in order, not
     * about that whitespace.
     */
    expect(screen.getByRole("link")).toHaveAccessibleName(
      /^Travels in World\s*, retour à l’accueil$/
    );
  });

  it("never spells the name the way the repository does", () => {
    renderBrand(<SiteBrand locale={defaultLocale} />);

    /**
     * The regression this guards is a copy-paste from the repository name or the
     * directory: `travels_in_world` is announced "travels underscore in
     * underscore world" by NVDA and VoiceOver alike. Asserted on the computed
     * accessible name rather than on the message, so it also fails if a future
     * `aria-label` reintroduces it.
     */
    const name = screen.getByRole("link").textContent ?? "";

    expect(name).not.toContain("_");
    expect(name).toContain("Travels in World");
  });

  it("marks the English name as English inside a French document", () => {
    renderBrand(<SiteBrand locale={defaultLocale} />);

    /**
     * `<html lang="fr">` makes a screen reader read "Travels in World" with French
     * phonemes, which is not the name of this site. The `lang` attribute is what
     * switches the voice for those three words.
     *
     * Queried through the accessible name so this cannot pass on some other span:
     * the element carrying `lang` must be the one carrying the name.
     */
    /**
     * The lock-up sets the name on two lines since 7 September 2026, so the
     * element carrying `lang` is the pair and not a single text node —
     * `getByText` with a string matcher would look for one node holding the whole
     * name and find nothing. The matcher below asks for the element whose *own*
     * text is the name, which is exactly the element the attribute must be on:
     * putting `lang` on either half would leave the other read in French.
     */
    const word = screen.getByText(
      (_content, element) =>
        element?.textContent?.replace(/\s+/g, " ").trim() === "Travels in World" &&
        element.tagName === "SPAN" &&
        element.children.length === 2
    );

    expect(word).toHaveAttribute("lang", "en");
  });

  /**
   * **The two lines concatenate to one name, with a space.**
   *
   * The accessible name of the link is the concatenation of its descendants'
   * text, and two adjacent inline boxes can join to "Travelsin World" — measured.
   * The component renders an explicit space between them; this is what notices if
   * someone tidies it away, and `tests/e2e/brand.spec.ts` checks the same thing in
   * a real browser, which is the only place the algorithm actually runs.
   */
  it("joins the two lines of the wordmark with a space", () => {
    renderBrand(<SiteBrand locale={defaultLocale} />);

    const name = screen.getByRole("link").textContent ?? "";

    expect(name).toContain("Travels in World");
    expect(name).not.toContain("Travelsin");
  });

  it("hides the drawing from assistive technology", () => {
    const { container } = renderBrand(<SiteBrand locale={defaultLocale} />);
    const svg = container.querySelector("svg");

    // The mark says nothing the name beside it does not; announced, it is noise.
    // `focusable="false"` is for Trident/Edge, which put SVG in the tab order
    // regardless of `aria-hidden`.
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  });

  it("takes no colour of its own", () => {
    const { container } = renderBrand(<SiteBrand locale={defaultLocale} />);
    const markup = container.innerHTML;

    /**
     * The acceptance criterion says the colours follow the visitor's theme, and
     * the only way that stays true is if the component never names one. The
     * classes point at `./site-brand.module.css`, which reads `--logo-ink` and
     * `--logo-accent` — both redeclared in all three theme states of
     * `tokens.css`, and both overridable by a page.
     *
     * `fill="none"` on the trajectory is a paint *server*, not a colour: it is
     * what keeps a stroked open path from being filled between its endpoints.
     */
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(markup).not.toMatch(/\b(?:rgb|hsl|oklch|color-mix)\(/i);
    expect(markup).not.toMatch(/fill="(?!none)[^"]/);
    expect(markup).not.toMatch(/stroke="/);
  });
});

describe("the header carries both the brand and the nav", () => {
  it("puts the lock-up outside the navigation landmark", () => {
    renderBrand(<SiteNav locale={defaultLocale} />);

    /**
     * A logo that is also the way home is not a navigation *entry*. Inside the
     * `<ul>` it would make a screen reader announce one item more than there are
     * destinations, and offer one that is the same page as the first — "Carte" is
     * `/fr` too. So the landmark stays the list of the site's sections and nothing
     * else.
     *
     * This is the assertion that goes red if someone "tidies up" by moving the
     * lock-up into the list, which renders identically to the eye.
     *
     * Three since TIW-25 added "À propos", **four since TIW-38 split the trips
     * entry into « Pays » and « Villes »** — and the count is spelled out rather
     * than loosened to `toBeGreaterThan`, because "one item too many" is exactly
     * the failure being guarded. Raising it is therefore a deliberate edit each
     * time a destination is added, which is the whole design of this assertion:
     * the number moved because a `<li>` was added on purpose, and the lock-up is
     * still outside the list, which is the property under test.
     */
    const nav = screen.getByRole("navigation");

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(nav).not.toContainElement(
      screen.getByRole("link", { name: /^Travels in World\s*, retour/ })
    );
  });

  it("offers exactly one way home per role it plays", () => {
    renderBrand(<SiteNav locale={defaultLocale} />);

    /**
     * Three links to `/fr` — the logo, "Carte", and "Français" in the language
     * menu — and that is deliberate rather than a duplicate: each has a different
     * accessible name and answers a different question ("take me home" / "show me
     * the map" / "read this site in French"). Pinned so that removing any of them
     * becomes a decision instead of an accident.
     *
     * It was two until TIW-38 gave the header a real language menu. The third is
     * the one that is arguably a duplicate and is not: `localePathname` can only
     * build the locale's HOME page, because this component is rendered by the
     * layout and does not know the current path — `SiteNav`'s comment on the menu
     * states that limitation rather than hiding it, and this count is where it
     * shows.
     */
    const home = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === `/${defaultLocale}`);

    expect(home).toHaveLength(3);
  });

  it("names the two grains of the collection, and only one of them is a new URL", () => {
    renderBrand(<SiteNav locale={defaultLocale} />);

    /**
     * TIW-38 replaced « Tous les voyages » with two entries. The pair is pinned
     * together because the interesting fact is not that either exists — it is
     * that they point at two different pages while only ONE address was created.
     *
     * « Pays » is the catalogue, at the URL it has always had: every marker on
     * the map and every card in the journal links into `/voyages`, and
     * `src/i18n/paths.ts` records why renaming that segment was refused. A
     * regression that "renamed the page" by moving its URL shows up here as a
     * changed href under an unchanged label.
     */
    const nav = screen.getByRole("navigation");

    expect(nav.querySelector(`a[href="/${defaultLocale}/voyages"]`)).toHaveTextContent(
      frMessages.trips.navCountries
    );
    expect(nav.querySelector(`a[href="/${defaultLocale}/villes"]`)).toHaveTextContent(
      frMessages.trips.navPlaces
    );
  });

  it("carries the colophon on every page, because the layout renders this nav", () => {
    renderBrand(<SiteNav locale={defaultLocale} />);

    /**
     * TIW-25's "accessible depuis la navigation principale, sur toutes les pages".
     * The "sur toutes les pages" half is structural — `SiteNav` is rendered by
     * `src/app/[locale]/layout.tsx`, so every route under `[locale]` carries it —
     * and `tests/e2e/about.spec.ts` checks it on the served routes. What is pinned
     * here is the entry itself, locale-prefixed: a bare `/a-propos` would take a
     * 307 through `next.config.ts` on every click from every page of the site.
     */
    expect(screen.getByRole("link", { name: frMessages.trips.navAbout })).toHaveAttribute(
      "href",
      `/${defaultLocale}/a-propos`
    );
  });
});
