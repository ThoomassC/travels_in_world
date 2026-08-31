import { describe, expect, it } from "vitest";
import { openGraphLocale, shareMetadata } from "@/app/share";
import { routing } from "@/i18n/routing";

/**
 * What a page hands a link unfurler. The interesting assertions here are the ones a
 * rendered page cannot make: that the canonical is the page's OWN url (the layout's
 * is the home page's, so a page that inherits it asks to be de-indexed in its
 * favour), and that a page with no image asks for the small card instead of the
 * large one.
 */

const page = {
  locale: routing.defaultLocale,
  path: "/fr/voyages/japon-2024",
  title: "Japon, printemps 2024",
  description: "Japon, printemps 2024 — 5 jours, 4 nuits, Tokyo et Kyoto.",
  siteName: "Travels in World",
  type: "article",
} as const;

const image = {
  url: "/photos/japon-2024/tokyo.jpg",
  alt: "Une ruelle de Shinjuku sous la pluie",
  width: 1600,
  height: 1067,
} as const;

describe("the canonical", () => {
  it("is the page's own path", () => {
    expect(shareMetadata(page).alternates).toEqual({ canonical: "/fr/voyages/japon-2024" });
  });

  it("stays relative, for `metadataBase` to resolve", () => {
    /**
     * One resolution, in Next's implementation, rather than a second one of ours
     * beside it. `metadataBase` is declared in `src/app/[locale]/layout.tsx`; the
     * absolute result is asserted against the built HTML in
     * `tests/build/durable-urls.test.ts`.
     */
    const canonical = shareMetadata(page).alternates?.canonical;

    expect(typeof canonical === "string" && canonical.startsWith("/")).toBe(true);
  });

  it("is declared even on a page that is not indexable", () => {
    // `noindex` and a canonical answer different questions: one says "do not list
    // this", the other says "this URL is the one address for what is here". A
    // withdrawn page without a canonical would let a query-string variant of it
    // count as a second page.
    const metadata = shareMetadata({ ...page, indexable: false });

    expect(metadata.alternates).toEqual({ canonical: "/fr/voyages/japon-2024" });
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("leaves `robots` unset when the page is indexable", () => {
    // Unset and not `{ index: true }`: indexable is the default, and emitting the
    // tag to say so is noise a crawler already assumes.
    expect(shareMetadata(page).robots).toBeUndefined();
    expect(shareMetadata({ ...page, indexable: true }).robots).toBeUndefined();
  });
});

describe("the Open Graph block", () => {
  it("repeats the site name and the locale, because Next replaces rather than merges", () => {
    /**
     * The reason this builder exists. Next merges metadata shallowly per top-level
     * field: a page declaring `openGraph` drops the layout's entirely, so a page
     * that set only `title` there would lose `og:site_name` and `og:locale` with
     * nothing to say so.
     */
    expect(shareMetadata(page).openGraph).toMatchObject({
      siteName: "Travels in World",
      locale: "fr_FR",
      url: "/fr/voyages/japon-2024",
      type: "article",
      title: page.title,
      description: page.description,
    });
  });

  it("carries the image with its dimensions and its alt text", () => {
    // `og:image:width` / `og:image:height` are what let a platform reserve the
    // card's box before the bytes arrive; a card that reflows after the image loads
    // is the one thing a preview must not do.
    expect(shareMetadata({ ...page, image }).openGraph).toMatchObject({ images: [image] });
  });

  it("omits the images field entirely when there is none", () => {
    // `images: []` would emit nothing either, but `undefined` is what keeps Next
    // from writing an empty `og:image` — verified against the built HTML.
    expect(shareMetadata(page).openGraph?.images).toBeUndefined();
  });
});

describe("the Twitter card", () => {
  it("asks for the large card only when there is an image to make large", () => {
    /**
     * `summary_large_image` without an image is what produces the wide grey
     * rectangle with a title crammed into a corner. A trip with no photograph yet
     * gets the small card, which is honest.
     */
    expect(shareMetadata({ ...page, image }).twitter).toMatchObject({
      card: "summary_large_image",
    });
    expect(shareMetadata(page).twitter).toMatchObject({ card: "summary" });
  });

  it("names no account", () => {
    // This journal has none on that platform, and inventing a handle would put a
    // wrong attribution on every card.
    expect(shareMetadata({ ...page, image }).twitter).not.toHaveProperty("site");
    expect(shareMetadata({ ...page, image }).twitter).not.toHaveProperty("creator");
  });
});

describe("openGraphLocale", () => {
  it("turns the routing locale into Open Graph's language_TERRITORY", () => {
    expect(openGraphLocale("fr")).toBe("fr_FR");
  });

  it("derives the territory rather than reading a table", () => {
    /**
     * `Intl.Locale#maximize` is CLDR's likely-subtags. A two-entry table would be a
     * table that goes stale the day `en` is activated and nobody remembers it
     * exists, so the alarm is here instead: this asserts the mechanism on a locale
     * the site does not have yet.
     */
    expect(new Intl.Locale("en").maximize().region).toBe("US");
  });

  it("covers every active locale", () => {
    // Derived from `routing.locales`, so the day `en` is declared this case starts
    // exercising it with no diff here.
    for (const locale of routing.locales) {
      expect(openGraphLocale(locale)).toMatch(/^[a-z]{2}(_[A-Z]{2})?$/);
    }
  });
});
