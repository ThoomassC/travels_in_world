import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { COUNTRY_SEGMENT } from "@/i18n/paths";
import { locales } from "@/i18n/routing";

/**
 * Where the country pages (TIW-39) are advertised, and where they must not be.
 *
 * **The sitemap: yes.** `tests/build/durable-urls.test.ts` compares the prerendered
 * set and `sitemap.xml` in *both* directions, so a page missing from the sitemap
 * and a URL advertised with no page behind it are both build failures — but that
 * suite needs `npm run build` first. This one asserts the same property on the
 * function itself, which is what makes it part of `npm test`.
 *
 * **The feed: no.** A feed carries récits. An `<item>` is read months later in a
 * client that kept it, and a subscriber who is told "something new" and finds a
 * list of seven towns has been told wrong. The feed already filters on `hasStory`
 * for that reason; the assertion below is about a different mistake — adding
 * country pages to it *on purpose*, which no filter can refuse.
 *
 * The façade is mocked rather than reached: `@/content/trips` carries
 * `import "server-only"`, which resolves under Next's bundler and nowhere else.
 * A factory means Vitest never loads the real module, so the guard is never
 * executed — only the alias is resolved.
 */

const SUMMARIES = [
  {
    slug: "gand-bruges",
    title: "Gand et Bruges",
    startDate: "2025-05-01",
    endDate: "2025-05-04",
    publishedAt: "2025-05-10",
    duration: { nights: 3, days: 4 },
    countryCodes: ["BE"],
    firstArrival: { name: "Gand", countryCode: "BE" },
    tags: [],
    story: "unwritten" as const,
  },
  {
    slug: "annecy",
    title: "Annecy",
    startDate: "2024-07-01",
    endDate: "2024-07-05",
    publishedAt: "2024-07-10",
    duration: { nights: 4, days: 5 },
    countryCodes: ["FR"],
    firstArrival: { name: "Annecy", countryCode: "FR" },
    tags: [],
    story: "written" as const,
  },
];

vi.mock("@/content/trips", () => ({
  listTripSummaries: () => Promise.resolve(SUMMARIES),
}));

const { default: sitemap } = await import("@/app/sitemap");

const paths = async (): Promise<readonly string[]> =>
  (await sitemap()).map((entry) => new URL(entry.url).pathname);

describe("sitemap.xml carries the countries", () => {
  it("advertises the index, once per active locale", async () => {
    const found = await paths();

    for (const locale of locales) {
      expect(found).toContain(`/${locale}/${COUNTRY_SEGMENT}`);
    }
  });

  it("advertises one page per visited country, once per active locale", async () => {
    const found = await paths();

    for (const locale of locales) {
      expect(found).toContain(`/${locale}/${COUNTRY_SEGMENT}/france`);
      expect(found).toContain(`/${locale}/${COUNTRY_SEGMENT}/belgique`);
    }
  });

  /**
   * A sitemap is a *promise* that an address exists, and `generateStaticParams`
   * builds a page only for a country the carnet reaches. A country advertised
   * here with no page behind it is exactly the mistake
   * `tests/build/durable-urls.test.ts` refuses on the artefact.
   */
  it("advertises no country the carnet has not been to", async () => {
    const found = await paths();

    expect(found.filter((entry) => entry.startsWith(`/fr/${COUNTRY_SEGMENT}/`))).toEqual([
      "/fr/pays/belgique",
      "/fr/pays/france",
    ]);
  });

  /**
   * The order is the slug's and not the content's, so two builds of the same
   * carnet write the same file. `localisedEntry` is what supplies the `hreflang`
   * block; asserted here because a page declaring its own `alternates` without
   * the language set is a silent regression the unit test on `shareMetadata`
   * cannot see.
   */
  it("names every locale as an alternate of a country page", async () => {
    const entry = (await sitemap()).find((row) => row.url.endsWith("/fr/pays/france"));
    const languages = entry?.alternates?.languages ?? {};

    expect(Object.keys(languages).sort()).toEqual([...locales, "x-default"].sort());
  });
});

describe("feed.xml carries récits and not countries", () => {
  /**
   * A source sweep, and deliberately: the feed's own module cannot be imported
   * here (it reaches the content façade at module scope through a Route Handler),
   * and what is being guarded is not a filter but an intention. The day somebody
   * adds a country address to the feed, this goes red and they have to argue for
   * it — which is the whole point.
   */
  const ROOT = path.resolve(import.meta.dirname, "../..");
  const feed = readFileSync(path.join(ROOT, "src/app/feed.xml/route.ts"), "utf8");

  it("builds no country address", () => {
    expect(feed).not.toContain("countryPath");
    expect(feed).not.toContain("countriesPath");
    expect(feed).not.toContain("COUNTRY_SEGMENT");
  });

  it("writes no country segment of its own", () => {
    expect(feed).not.toMatch(/["'`]\/pays/);
  });
});
