import { describe, expect, it } from "vitest";
import { openGraphLocale, shareMetadata } from "@/app/share";
import { routing } from "@/i18n/routing";

/**
 * What a page hands a link unfurler. The interesting assertions here are the ones a
 * rendered page cannot make: that the canonical is the page's OWN url (the layout's
 * is the home page's, so a page that inherits it asks to be de-indexed in its
 * favour), and that a page with no picture of its own falls back to the site's
 * brand image rather than to no card at all.
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

/**
 * The feed link travels with the canonical, and TIW-19 put it there rather than
 * in the layout — so this block sits beside the canonical's, because they are one
 * decision.
 *
 * Next merges metadata shallowly per top-level field: a page declaring
 * `alternates` replaces the layout's entirely, and every page here declares one
 * for its canonical. A feed link declared one segment up would therefore appear
 * on exactly the pages that forgot their canonical, which is nowhere.
 */
describe("the feed link", () => {
  it("is advertised on every page the builder serves", () => {
    const types = shareMetadata(page).alternates?.types;

    expect(types).toEqual({
      "application/rss+xml": [{ url: "/feed.xml", title: "Travels in World" }],
    });
  });

  it("stays relative, for `metadataBase` to resolve — like the canonical", () => {
    /**
     * `Metadata["alternates"]["types"]` is typed as a string, a `URL` or a list
     * of descriptors, so the value is narrowed rather than destructured — a
     * spread would compile against the union and break `next build`'s own
     * typecheck, which is stricter here than it looks.
     */
    const declared = shareMetadata(page).alternates?.types?.["application/rss+xml"];
    const first = Array.isArray(declared) ? declared[0] : declared;
    const url =
      typeof first === "string" ? first : first instanceof URL ? first.href : first?.url;

    expect(typeof url).toBe("string");
    expect(String(url).startsWith("http")).toBe(false);
  });

  it("survives on a page that is not indexable", () => {
    // A withdrawn récit is still part of a journal a reader may subscribe to;
    // `noindex` is about listing this page, not about the site's feed.
    const types = shareMetadata({ ...page, indexable: false }).alternates?.types;

    expect(types).toHaveProperty("application/rss+xml");
  });
});

describe("the canonical", () => {
  it("is the page's own path", () => {
    expect(shareMetadata(page).alternates?.canonical).toBe("/fr/voyages/japon-2024");
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

    expect(metadata.alternates?.canonical).toBe("/fr/voyages/japon-2024");
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

  it("falls back to the site's own image when the page has none", () => {
    /**
     * TIW-23 replaced "no image" with "the brand". Until then a page without a
     * photograph emitted no `og:image` at all and unfurled as a bare line of text
     * in a conversation; this case used to assert `images` was `undefined`.
     *
     * The order is the part that matters, and the case above is what pins it: a
     * trip's cover photograph wins, and this only fills the gap. A committed PNG
     * rather than the SVG that already exists, because every platform refuses the
     * SVG — the reasoning is in `src/app/share.ts`.
     */
    expect(shareMetadata(page).openGraph).toMatchObject({
      images: [{ url: "/opengraph-default.png", width: 1200, height: 630 }],
    });
  });

  it("gives the fallback the site name as its alt text", () => {
    /**
     * The image *is* the site name set in type, so the site name is a literally
     * accurate alternative — and it arrives through `page.siteName`, which is
     * already a message from the catalogue. That is what lets this builder gain a
     * default image without gaining a reader-facing literal.
     */
    expect(shareMetadata(page).openGraph).toMatchObject({
      images: [{ alt: "Travels in World" }],
    });
  });

  it("keeps the fallback relative, for `metadataBase` to resolve", () => {
    // A platform fetching the card runs on another host, so a relative `og:image`
    // is not fetchable — and the resolution belongs to Next, once. The absolute
    // result is asserted against the built HTML in `tests/build/brand.test.ts`.
    const images = shareMetadata(page).openGraph?.images as readonly { url: string }[];

    expect(images[0]?.url.startsWith("/")).toBe(true);
  });
});

describe("the Twitter card", () => {
  it("always asks for the large card, because there is always an image", () => {
    /**
     * This case used to assert the opposite for a page with no image, and the
     * reason was sound: `summary_large_image` without an image is what produces
     * the wide grey rectangle with a title crammed into a corner.
     *
     * Since TIW-23 there is no such page — a trip without a photograph gets the
     * brand — so the small card would now understate every one of them. The
     * `summary` branch was deleted rather than left as dead code; what keeps this
     * honest is the fallback asserted above, not this assertion.
     */
    expect(shareMetadata({ ...page, image }).twitter).toMatchObject({
      card: "summary_large_image",
    });
    expect(shareMetadata(page).twitter).toMatchObject({ card: "summary_large_image" });
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
