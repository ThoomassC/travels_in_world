import type { Metadata } from "next";
import type { Locale } from "@/i18n/routing";
import { FEED_PATH } from "./rss";

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
  /**
   * The page's OWN picture — a trip's cover photograph. Optional, and its absence
   * no longer means "no card": since TIW-23 it means the site's brand image,
   * {@link SITE_SHARE_IMAGE}. A page that has something of its own to show wins.
   */
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

/**
 * The site's own share image — the brand, for any page with no better one (TIW-23).
 *
 * WHY A PNG AND NOT THE SVG THAT ALREADY EXISTS. `src/app/icon.svg` is the same
 * mark and weighs a few hundred bytes, and every platform that unfurls a link
 * refuses it: an `og:image` a consumer cannot decode falls back to **no card**,
 * not to a card without a picture.
 *
 * WHY A COMMITTED FILE AND NOT A GENERATED ROUTE. TIW-21 measured what an
 * `opengraph-image` route does in this project — `ƒ` without
 * `generateStaticParams`, and *with* it a build column printing `●` while writing
 * no image to disk at all, so `npm run test:build` cannot weigh it either (README,
 * "Image de partage"). A file under `public/` is bytes the CDN serves.
 * `tests/build/brand.test.ts` asserts it exists and is really 1200 x 630.
 *
 * 1200 x 630 is the size all of those platforms document, and it is 1.91:1 — a
 * consumer cropping to 2:1 takes 15 px off each side, well outside the mark.
 *
 * REPLACING IT IS A FILE COPY over `public/opengraph-default.png`, with no code
 * change. The proportions are the one thing that is not free: a replacement of a
 * different size makes `og:image:width`/`height` lie, and a platform that reserved
 * the card's box from them reflows when the bytes arrive — which is the single
 * thing a preview must not do. The build test refuses it.
 */
const SITE_SHARE_IMAGE = {
  url: "/opengraph-default.png",
  width: 1200,
  height: 630,
} as const;

export function shareMetadata(page: SharePage): Metadata {
  /**
   * A trip's cover photograph wins; the brand is the fallback, and that order is
   * the whole point — a story shares as itself, and only a page with nothing of
   * its own to show falls back to saying which site it belongs to.
   *
   * The alt text is the site name, not a description of the drawing: the image
   * *is* the site name set in type, so "a comet on a trajectory" would describe
   * the decoration and drop the information. It comes from `page.siteName`, which
   * is already a message from the catalogue — no reader-facing literal here.
   */
  const image = page.image ?? { ...SITE_SHARE_IMAGE, alt: page.siteName };
  const images = [image];

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
    alternates: {
      canonical: page.path,
      /**
       * Feed discovery, and it is **here rather than in the layout** for a
       * measured reason: Next merges metadata shallowly per top-level field, so
       * every page that declares its own `alternates` — which is every page, for
       * the canonical above — would replace a layout-level declaration and lose
       * the feed link. Putting it in the builder means the two travel together
       * and no page can carry one without the other.
       *
       * Relative, like the canonical: `metadataBase` resolves it, in Next's
       * implementation rather than in a second one of ours. The path comes from
       * {@link FEED_PATH} so the head, the route's folder and the feed's own
       * `atom:link rel="self"` cannot disagree about one URL.
       */
      types: { "application/rss+xml": [{ url: FEED_PATH, title: page.siteName }] },
    },

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
     * `summary_large_image`, always — and it did not use to be. The rule was
     * "large only when there is an image to make large", because asking for the
     * large card without one produces the wide grey rectangle with a title
     * crammed into a corner. Since TIW-23 there is always an image: a trip's
     * cover, or the brand. The `undefined` branch is gone rather than kept as
     * dead code, and {@link SITE_SHARE_IMAGE} is what makes its absence true.
     *
     * No `site` / `creator` handle: this journal has no account on that platform,
     * and inventing one would put a wrong attribution on every card.
     */
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images,
    },

    robots: page.indexable === false ? { index: false, follow: true } : undefined,
  };
}
