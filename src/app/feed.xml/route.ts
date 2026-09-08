import { getTranslations } from "next-intl/server";
import { countryListOf, formatDateRange } from "@/components/trips/format";
import { listTripSummaries } from "@/content/trips";
import { hasStory } from "@/domain/trip";
import { localePathname } from "@/i18n/pathname";
import { tripPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { FEED_PATH, renderRssFeed } from "../rss";
import type { FeedItem } from "../rss";
import { absoluteUrl } from "../site-url";

/**
 * `/feed.xml` — every published récit, newest publication first (TIW-19).
 *
 * **It lists published trips only, and that is not a filter written here.**
 * `listTripSummaries()` is the content façade, which already removes drafts — the
 * same call, with the same answer, as the home page, the listing and the sitemap.
 * A feed deciding publication for itself would be a *second* publication rule, and
 * two rules is how a draft ends up broadcast to every subscriber by the one file
 * nobody reads. `src/app/sitemap.ts` states this at length and it applies here
 * word for word; `tests/build/feed.test.ts` reads the built artefact and would
 * catch the leak, but not having a second rule is what makes it impossible.
 *
 * **The order is `publishedAt` descending — not the façade's.** The collection
 * arrives sorted by `startDate`, which is right for a listing of journeys and
 * wrong for a feed of stories: a 2019 journey written up this morning belongs at
 * the top. `renderRssFeed` owns that sort so it cannot be forgotten here, and
 * `tests/app/rss.test.ts` pins it.
 *
 * **This route is prerendered**, like `sitemap.ts` and `robots.ts` — but *not* for
 * the same reason, and the difference is the trap. Those two are metadata file
 * conventions, which Next keeps static by default. A plain Route Handler is
 * **not** cached by default since Next 15 (`node_modules/next/dist/docs/01-app/
 * 01-getting-started/15-route-handlers.md`, "Route Handlers are not cached by
 * default"), so without the `dynamic` export below this would be a `ƒ` — a server
 * function on a site whose central invariant is that there are none. Verify in
 * `npm run build`: `○ /feed.xml`, never `ƒ`; `npm run test:build` is the guard
 * that actually holds it, since it derives its route list from the manifest.
 */
export const dynamic = "force-static";

/**
 * The feed is served in the default locale and in that locale only — including
 * now that `en` and `es` are active, which is a decision and not an omission.
 *
 * **What a second feed would carry.** Every `<item>` here is a récit's title, its
 * dates and its countries, and `content/trips/**` holds those in French with no
 * per-locale field (`src/i18n/routing.ts` says so at length: the chrome is
 * translated, the stories are not). So `/feed.en.xml` would broadcast the same
 * French titles under an English channel name, at a second address a subscriber
 * would have to choose between — three channels of one journal, differing by two
 * strings and a URL prefix. That is a worse answer than one address, not a more
 * complete one.
 *
 * The consequence, stated rather than left to be found: the
 * `<link rel="alternate" type="application/rss+xml">` in the head of `/en/...`
 * and `/es/...` points at this French feed. It is the only feed that exists, and
 * its items are the French stories those pages already show.
 *
 * The shape stays right for the day the récits are translated: every
 * locale-bound value below goes through this one constant, so a per-locale feed
 * is a loop over `routing.locales` and a `[locale]` segment in the route's path —
 * not a rewrite. Until then, `renderRssFeed`'s `language` says `fr`, truthfully.
 */
const FEED_LOCALE = routing.defaultLocale;

export async function GET(): Promise<Response> {
  /**
   * **The trips with a récit, and not every trip the journal holds** (TIW-18).
   *
   * Every `<item>` of a feed is an address a reader will follow, days or months
   * after it was written, from software that keeps it. A trip whose story is not
   * written has no page — `tripStaticParams` leaves it out — so advertising it here
   * would put a permanent 404 in the one channel nobody re-reads before clicking.
   *
   * Filtered here rather than by the façade, because the map and the listings need
   * exactly the trips this drops: see the note on `listTripSummaries`.
   * `tests/build/durable-urls.test.ts` is what would catch the mistake in the
   * other direction — it holds the sitemap and the prerendered pages to each
   * other in both directions — and this filter is the same rule applied one
   * channel over.
   */
  const trips = (await listTripSummaries()).filter(hasStory);

  /**
   * `getTranslations({ locale, namespace })` and never the implicit form. This
   * handler runs outside the `[locale]` segment, so there is no request locale
   * for next-intl to find — and the implicit call would go looking for one in the
   * request headers, which is the single read that de-statifies the whole tree
   * with `next build` still exiting 0. Invariant 1 breaking in silence; the same
   * reasoning, at length, in `src/app/not-found.tsx`.
   */
  const site = await getTranslations({ locale: FEED_LOCALE, namespace: "metadata" });

  const items: readonly FeedItem[] = trips.map((trip) => ({
    title: trip.title,
    url: absoluteUrl(localePathname({ href: tripPath(trip.slug), locale: FEED_LOCALE })),
    publishedAt: trip.publishedAt,
    /**
     * The facts a subscriber needs to decide whether to open it, and the same
     * two a card shows: when, and where. Built from the listing's own formatters
     * rather than from a second spelling — `formatDateRange` collapses a range
     * the way French does and `countryListOf` knows that the last separator of a
     * list is a property of the language.
     *
     * No excerpt of the récit: `TripSchema` carries no prose field yet (the note
     * on `estimateReadingMinutes` says so), so there is nothing to excerpt, and
     * inventing a sentence per trip would put a second description of a story
     * beside the one its own page writes.
     */
    description: `${formatDateRange(FEED_LOCALE, trip.startDate, trip.endDate)} — ${countryListOf(
      FEED_LOCALE,
      trip.countryCodes
    )}`,
  }));

  const body = renderRssFeed({
    title: site("title"),
    description: site("description"),
    siteUrl: absoluteUrl(localePathname({ href: "/", locale: FEED_LOCALE })),
    feedUrl: absoluteUrl(FEED_PATH),
    language: FEED_LOCALE,
    items,
  });

  return new Response(body, {
    headers: {
      /**
       * `application/rss+xml` with an explicit charset. Without the charset some
       * aggregators fall back to Latin-1 and every accented city name in the
       * feed is mojibake — and this is a French site.
       */
      "content-type": "application/rss+xml; charset=utf-8",
    },
  });
}
