import { describe, expect, it } from "vitest";
import { renderRssFeed, rfc822Date } from "@/app/rss";
import type { FeedChannel, FeedItem } from "@/app/rss";

/**
 * The feed's serialisation, tested without a build.
 *
 * `src/app/feed.xml/route.ts` reads the content façade and can only be exercised
 * through `next build` — which `tests/build/feed.test.ts` does, on the real
 * artefact. What lives here is the three things most likely to be wrong and least
 * in need of a disk: the ordering, the escaping and the date format. The split is
 * the one `site-url.ts` already makes with `siteUrlFrom`.
 */

const item = (overrides: Partial<FeedItem> = {}): FeedItem => ({
  title: "Japon, printemps 2024",
  url: "https://travels-in-world.example/fr/voyages/japon-2024",
  publishedAt: "2024-05-02",
  description: "12–22 avril 2024 — Japon",
  ...overrides,
});

const channel = (items: readonly FeedItem[]): FeedChannel => ({
  title: "Travels in World",
  description: "Carnet de voyages.",
  siteUrl: "https://travels-in-world.example/fr",
  feedUrl: "https://travels-in-world.example/feed.xml",
  language: "fr",
  items,
});

/** Item titles in the order they appear in the document. */
const titlesIn = (xml: string): readonly string[] =>
  [...xml.matchAll(/<item>[\s\S]*?<title>([^<]*)<\/title>/g)].map((match) => match[1] ?? "");

describe("rfc822Date", () => {
  /**
   * The format RSS 2.0 requires, and the one thing about it that is not obvious:
   * the day and month abbreviations are English by specification, so `Intl` is
   * the wrong tool and `toUTCString` is the right one.
   */
  it("writes a calendar day as an RFC 822 instant at midnight UTC", () => {
    expect(rfc822Date("2024-05-02")).toBe("Thu, 02 May 2024 00:00:00 GMT");
  });

  /**
   * **UTC and never the build machine's zone.** A `new Date("2024-01-01")`
   * formatted locally is 31 December everywhere west of Greenwich, and this would
   * publish the machine's timezone as part of the feed. The turn of the year is
   * the reading where it is most visible.
   */
  it("keeps the day the author wrote, across a year boundary", () => {
    expect(rfc822Date("2024-01-01")).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
    expect(rfc822Date("2023-12-31")).toBe("Sun, 31 Dec 2023 00:00:00 GMT");
  });

  it.each(["2024-5-2", "2024-02-30", "pas-un-jour", ""])(
    "answers empty for %o rather than emitting an invalid date",
    (day) => {
      expect(rfc822Date(day)).toBe("");
    }
  );
});

describe("renderRssFeed", () => {
  it("is a well-formed RSS 2.0 document with a self link", () => {
    const xml = renderRssFeed(channel([item()]));

    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain(
      '<atom:link href="https://travels-in-world.example/feed.xml" rel="self" type="application/rss+xml"/>'
    );
    expect(xml).toContain("<language>fr</language>");
  });

  it("carries one item per story, with a permalink guid", () => {
    const xml = renderRssFeed(channel([item()]));

    expect(xml).toContain("<link>https://travels-in-world.example/fr/voyages/japon-2024</link>");
    expect(xml).toContain(
      '<guid isPermaLink="true">https://travels-in-world.example/fr/voyages/japon-2024</guid>'
    );
    expect(xml).toContain("<pubDate>Thu, 02 May 2024 00:00:00 GMT</pubDate>");
  });

  /**
   * **The acceptance criterion, and the ticket's own trap inside it.** "Du plus
   * récent au plus ancien" is by *publication*, and the content façade hands its
   * collection over by `startDate` — a different order, right for a listing of
   * journeys and wrong for a feed. A serialiser trusting its input would be
   * correct on almost every fixture and wrong on the one trip this ticket exists
   * for: an old journey written up today.
   */
  it("orders by publication date, descending, whatever order it was handed", () => {
    const xml = renderRssFeed(
      channel([
        item({ title: "Vieux voyage, récit publié hier", publishedAt: "2026-03-01", url: "u/a" }),
        item({ title: "Voyage récent, récit ancien", publishedAt: "2025-01-01", url: "u/b" }),
        item({ title: "Le plus vieux des deux", publishedAt: "2024-05-02", url: "u/c" }),
      ])
    );

    expect(titlesIn(xml)).toEqual([
      "Vieux voyage, récit publié hier",
      "Voyage récent, récit ancien",
      "Le plus vieux des deux",
    ]);
  });

  it("breaks a same-day tie on the URL, so two builds agree", () => {
    const xml = renderRssFeed(
      channel([
        item({ title: "Bravo", publishedAt: "2026-03-01", url: "u/b" }),
        item({ title: "Alpha", publishedAt: "2026-03-01", url: "u/a" }),
      ])
    );

    expect(titlesIn(xml)).toEqual(["Alpha", "Bravo"]);
  });

  it("leaves the array it was given in its own order", () => {
    // The caller's array is the content façade's memoised projection, shared
    // with every page of the build — the reasoning `summaryOf` records.
    const items = [item({ publishedAt: "2024-05-02", url: "u/a" }), item({ publishedAt: "2026-03-01", url: "u/b" })];

    renderRssFeed(channel(items));

    expect(items.map((entry) => entry.url)).toEqual(["u/a", "u/b"]);
  });

  it("dates the channel from the newest item and never from the clock", () => {
    /**
     * A `lastBuildDate` taken from `new Date()` would move on every rebuild, and
     * `.github/workflows/refresh.yml` rebuilds this site daily — so the feed
     * would announce a change every morning while nothing had changed. Same
     * reasoning as the sitemap's `lastModified`.
     */
    const xml = renderRssFeed(
      channel([item({ publishedAt: "2024-05-02", url: "u/a" }), item({ publishedAt: "2026-03-01", url: "u/b" })])
    );

    expect(xml).toContain("<lastBuildDate>Sun, 01 Mar 2026 00:00:00 GMT</lastBuildDate>");
  });

  describe("an empty journal", () => {
    /**
     * The third acceptance criterion, seen from the feed: a site with no
     * published trip serves a valid, empty channel. Not a 404, not a broken
     * document — an aggregator that subscribed before the first récit must keep
     * a working subscription.
     */
    it("is still a valid document, with no item and no build date", () => {
      const xml = renderRssFeed(channel([]));

      expect(xml).toContain("<channel>");
      expect(xml).toContain("</rss>");
      expect(xml).not.toContain("<item>");
      expect(xml).not.toContain("<lastBuildDate>");
    });
  });

  describe("escaping", () => {
    it("escapes the five characters XML reserves", () => {
      const xml = renderRssFeed(
        channel([item({ title: `Rome & Milan <"L'été">`, description: "a & b" })])
      );

      expect(xml).toContain("<title>Rome &amp; Milan &lt;&quot;L&apos;été&quot;&gt;</title>");
      expect(xml).toContain("<description>a &amp; b</description>");
    });

    it("escapes an ampersand in a URL rather than emitting a bare one", () => {
      // No trip URL carries a query today, and that is exactly why this is worth
      // pinning: the day one does, a bare `&` breaks the whole document.
      const xml = renderRssFeed(channel([item({ url: "https://x.example/a?b=1&c=2" })]));

      expect(xml).toContain("<link>https://x.example/a?b=1&amp;c=2</link>");
      expect(xml).not.toMatch(/<link>[^<]*&(?!amp;)/);
    });

    /**
     * **The half nobody writes and every parser enforces.** XML 1.0 forbids the
     * C0 controls outright — even escaped — so one of them makes an aggregator
     * refuse the *whole* feed rather than one item.
     * `tests/fixtures/content/escape-sequence-value` exists because such a value
     * really did reach this repository's content layer, so this is not
     * hypothetical.
     */
    it("strips the control characters no escape can rescue", () => {
      const xml = renderRssFeed(
        channel([item({ title: "Japon\u001B[2Jdisparu\u0000", description: "ok\u0007" })])
      );

      expect(xml).toContain("<title>Japon[2Jdisparu</title>");
      expect(xml).toContain("<description>ok</description>");
      expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(xml)).toBe(false);
    });

    it("keeps the newlines and tabs XML does allow", () => {
      const xml = renderRssFeed(channel([item({ description: "deux\nlignes" })]));

      expect(xml).toContain("deux\nlignes");
    });
  });
});
