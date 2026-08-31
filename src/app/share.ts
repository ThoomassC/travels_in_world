import type { Metadata } from "next";
import type { Locale } from "@/i18n/routing";

/**
 * What a page hands a messaging app, a social network and a crawler — built once,
 * here, from what the page already knows.
 *
 * WHY A BUILDER AND NOT THREE OBJECTS PER PAGE. Next merges metadata **shallowly,
 * per top-level field**: a page that declares `openGraph` replaces the layout's
 * `openGraph` entirely rather than adding to it. So `siteName`, `locale` and
 * `type` have to be repeated in every page that sets a single Open Graph field,
 * and "repeated in every page" is how three pages end up announcing three
 * different site names. This function is the repetition, written once.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never builds an absolute URL. Every URL it
 * returns is site-relative and `metadataBase` — set in `src/app/[locale]/layout.tsx`
 * — resolves it. One resolution, in Next's implementation, instead of a second one
 * of ours next to it. See `src/app/site-url.ts` for where the origin comes from.
 */

/**
 * The share image, when the page has one.
 *
 * `width`/`height` are required rather than optional, and that is not tidiness:
 * `og:image:width` and `og:image:height` are what let a platform reserve the card's
 * box before the bytes arrive, and a card that reflows after the image loads is the
 * one thing a preview must not do. `TripSchema` makes both mandatory on every
 * photo, so a trip's cover always has them — there is no case to make them
 * optional for.
 */
export type ShareImage = {
  /** Site-relative, e.g. `/photos/japon-2024/tokyo.jpg`. */
  readonly url: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
};

export type SharePage = {
  readonly locale: Locale;
  /** The page's own URL, locale prefix included, as `localePathname` builds it. */
  readonly path: string;
  readonly title: string;
  readonly description: string;
  /** From the message catalogue — never a literal, like every other reader-facing string. */
  readonly siteName: string;
  /**
   * `"article"` for a trip — it has an author, a date and a subject — and
   * `"website"` for the map and the listing, which are indexes of it. The
   * distinction is what makes a trip preview say "a story" rather than "a site".
   */
  readonly type: "website" | "article";
  readonly image?: ShareImage;
  /**
   * `false` on the page of a withdrawn trip, and nowhere else. It emits
   * `noindex, follow`: the story is gone, the links out of the page are not.
   *
   * Note what it does NOT do — it does not suppress the canonical, because the two
   * answer different questions: `noindex` says "do not list this", the canonical
   * says "this URL is the one address for what is here". A withdrawn page that
   * dropped its canonical would let a crawler treat a query-string variant of the
   * same URL as a second page.
   */
  readonly indexable?: boolean;
};

/**
 * Open Graph wants `language_TERRITORY` (`fr_FR`), the routing config holds a bare
 * language (`fr`), and the mapping between them is derived rather than written
 * down: a table of two entries is a table that goes stale the day `en` is
 * activated and nobody remembers it exists.
 *
 * `Intl.Locale#maximize` is CLDR's "add the likely subtags" — `fr` → `fr-Latn-FR`,
 * `en` → `en-Latn-US`. A locale with no likely region falls back to the bare
 * language, which is tolerated by every consumer and is better than an invented
 * territory.
 */
export function openGraphLocale(locale: Locale): string {
  const region = new Intl.Locale(locale).maximize().region;

  return region === undefined ? locale : `${locale}_${region}`;
}

export function shareMetadata(page: SharePage): Metadata {
  const images = page.image === undefined ? undefined : [page.image];

  return {
    title: page.title,
    description: page.description,

    /**
     * The canonical, and it is relative on purpose: `metadataBase` turns it into
     * the absolute URL the tag requires. Declared on **every** page rather than
     * inherited — the layout's canonical is the home page's own, so a page that
     * forgot this line would claim the home page as its canonical and ask to be
     * de-indexed in favour of it. `tests/build/durable-urls.test.ts` reads every
     * prerendered document and refuses one whose canonical is not its own URL.
     */
    alternates: { canonical: page.path },

    openGraph: {
      type: page.type,
      url: page.path,
      siteName: page.siteName,
      title: page.title,
      description: page.description,
      locale: openGraphLocale(page.locale),
      images,
    },

    /**
     * `summary_large_image` only when there is an image to make large; `summary`
     * otherwise. Asking for the large card without an image is what produces the
     * wide grey rectangle with a title crammed into a corner.
     *
     * No `site` / `creator` handle: this journal has no account on that platform,
     * and inventing one would put a wrong attribution on every card.
     */
    twitter: {
      card: page.image === undefined ? "summary" : "summary_large_image",
      title: page.title,
      description: page.description,
      images,
    },

    robots: page.indexable === false ? { index: false, follow: true } : undefined,
  };
}
