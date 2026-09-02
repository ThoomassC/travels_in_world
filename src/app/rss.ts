import { isPlainDate } from "@/domain/geo";
import type { PlainDate } from "@/domain/geo";

/**
 * The RSS 2.0 serialiser — a pure function from a channel to a string, and
 * deliberately separate from the route that feeds it (`./feed.xml/route.ts`).
 *
 * **Why a module of its own.** The route reads the content façade, so it can only
 * be exercised through a build; escaping, ordering and date formatting are the
 * three things most likely to be wrong and the three that need no disk at all.
 * Split, every one of them is a unit test — the same posture `./site-url.ts`
 * takes with `siteUrlFrom`.
 *
 * **No dependency.** A feed is angle brackets and RFC 822 dates. `feed`,
 * `rss` and their kin are 40–100 KB of `node_modules` for the 60 lines below, and
 * `docs/adr/0009-le-poids-est-un-budget-mesure.md` is the standing answer: this
 * ships in no bundle, but a dependency is a thing to keep, audit and update, and
 * the budget's whole argument is that a name is not a reason.
 *
 * RSS 2.0 and not Atom, for one reason: it is what a reader's aggregator
 * discovers from `<link rel="alternate" type="application/rss+xml">`, which is
 * how the layout advertises it. The `atom:link rel="self"` element below is the
 * one Atom borrowing every validator asks for.
 */

/**
 * The feed's own address, written once and read from three places that have to
 * agree about one URL: the route's folder name (`src/app/feed.xml/`), the
 * `atom:link rel="self"` element below, and the `<link rel="alternate">` the
 * document head advertises so a browser and an aggregator can discover it.
 *
 * It lives here rather than beside the handler because a `route.ts` may only
 * export the names Next recognises — an extra one fails the build's own route
 * type check, which is a good rule and not one to work around.
 */
export const FEED_PATH = "/feed.xml";

/** One story in the feed. */
export type FeedItem = {
  readonly title: string;
  /** Absolute — an aggregator on another host cannot resolve a relative one. */
  readonly url: string;
  readonly publishedAt: PlainDate;
  readonly description: string;
};

export type FeedChannel = {
  readonly title: string;
  readonly description: string;
  /** Absolute URL of the page the feed is *about*. */
  readonly siteUrl: string;
  /** Absolute URL of the feed itself, for `atom:link rel="self"`. */
  readonly feedUrl: string;
  /** A BCP 47 tag — `fr`. */
  readonly language: string;
  readonly items: readonly FeedItem[];
};

/**
 * The five characters XML gives up, plus the C0 control range.
 *
 * The five are the ordinary ones. The controls are the half nobody writes and
 * every parser enforces: XML 1.0 forbids every C0 codepoint except tab, newline
 * and carriage return **even escaped**, so a title carrying one produces a
 * document an aggregator refuses whole — not one broken item, the entire feed.
 * `tests/fixtures/content/escape-sequence-value` exists because a `\e[2J` really
 * did reach this repository's content layer once, so the input is not
 * hypothetical.
 *
 * Stripped rather than escaped, because there is no escape that is legal: `&#x1B;`
 * is refused by the same rule.
 */
const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function escapeXml(value: string): string {
  return value
    .replace(FORBIDDEN_CONTROLS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * A calendar day as the RFC 822 date RSS requires — `Thu, 02 May 2024 00:00:00
 * GMT`.
 *
 * **Built from the civil fields with `Date.UTC` and read back with
 * `toUTCString()`**, so the build machine's timezone never enters: a
 * `new Date("2024-05-02")` formatted locally is the 1st everywhere west of
 * Greenwich, and this would put that machine's zone into a published feed. Same
 * trap, same answer as `src/components/timeline/dates.ts` and `src/domain/geo.ts`.
 *
 * `toUTCString()` and not `Intl`: its output format is fixed by the language
 * specification in English abbreviations, which is exactly what RFC 822 wants and
 * exactly what a locale-aware formatter would break.
 *
 * A day the schema would have refused answers with the empty string, and the
 * element is then omitted rather than emitted invalid — `pubDate` is optional in
 * RSS 2.0, and half a date is worse than none.
 */
export function rfc822Date(day: PlainDate): string {
  if (!isPlainDate(day)) {
    return "";
  }

  const year = Number.parseInt(day.slice(0, 4), 10);
  const month = Number.parseInt(day.slice(5, 7), 10);
  const date = Number.parseInt(day.slice(8, 10), 10);

  return new Date(Date.UTC(year, month - 1, date)).toUTCString();
}

/**
 * Newest publication first, ties broken on the URL, ascending.
 *
 * **The ordering is this module's guarantee and not the caller's**, which is the
 * one design decision in this file. "Du plus récent au plus ancien" is an
 * acceptance criterion, and the collection arrives from the content façade in
 * `startDate` order — a different order, correct for a listing of *journeys* and
 * wrong for a feed of *publications*. A serialiser that trusted its input would
 * be correct on most fixtures and wrong on the one trip this ticket is about: a
 * 2019 journey written up today.
 *
 * The tiebreak exists for the same reason `byMostRecentThenSlug` has one: `sort`
 * is stable, so a comparator answering 0 for two same-day publications looks
 * deterministic while silently deferring to directory order.
 *
 * On a copy, never in place: the caller's array is the façade's memoised
 * projection, shared with every page of the build.
 */
function byNewestPublication(items: readonly FeedItem[]): readonly FeedItem[] {
  return [...items].sort((left, right) => {
    if (left.publishedAt !== right.publishedAt) {
      return left.publishedAt < right.publishedAt ? 1 : -1;
    }

    return left.url < right.url ? -1 : left.url > right.url ? 1 : 0;
  });
}

function renderItem(item: FeedItem): string {
  const pubDate = rfc822Date(item.publishedAt);

  return [
    "    <item>",
    `      <title>${escapeXml(item.title)}</title>`,
    `      <link>${escapeXml(item.url)}</link>`,
    /**
     * `isPermaLink="true"`, and the URL is the trip's own page. An aggregator
     * keys "have I shown this already" on the guid, so it has to be stable for
     * the life of the story — which is exactly the promise `src/i18n/slug-history.ts`
     * already makes about a trip's address (TIW-21): a rename leaves a 301 and
     * the *new* URL is the one advertised, here as in the sitemap.
     */
    `      <guid isPermaLink="true">${escapeXml(item.url)}</guid>`,
    ...(pubDate === "" ? [] : [`      <pubDate>${pubDate}</pubDate>`]),
    `      <description>${escapeXml(item.description)}</description>`,
    "    </item>",
  ].join("\n");
}

/**
 * The whole document, as a string.
 *
 * `lastBuildDate` is the newest item's publication day and **never the build
 * clock**, which is the same reasoning `src/app/sitemap.ts` gives for not
 * stamping every URL with the deployment's time: a feed whose header moves on
 * every rebuild tells an aggregator that something changed when nothing did. With
 * `.github/workflows/refresh.yml` rebuilding daily (see
 * `docs/fraicheur-au-prerendu.md`), that is not a theoretical nicety — it is the
 * difference between a daily rebuild being invisible and it being a daily poll of
 * unchanged content. An empty feed carries no `lastBuildDate` at all.
 */
export function renderRssFeed(channel: FeedChannel): string {
  const items = byNewestPublication(channel.items);
  const lastBuild = items[0] === undefined ? "" : rfc822Date(items[0].publishedAt);

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(channel.title)}</title>`,
    `    <link>${escapeXml(channel.siteUrl)}</link>`,
    `    <description>${escapeXml(channel.description)}</description>`,
    `    <language>${escapeXml(channel.language)}</language>`,
    `    <atom:link href="${escapeXml(channel.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    ...(lastBuild === "" ? [] : [`    <lastBuildDate>${lastBuild}</lastBuildDate>`]),
    ...items.map(renderItem),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
