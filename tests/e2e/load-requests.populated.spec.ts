import { expect, test } from "@playwright/test";

/**
 * TIW-26's third acceptance criterion: **no network request to a geometry file
 * nor to a third-party service on load**, on every screen of the site.
 *
 * **Why it needs a test and is not obvious from the code.** The world map is SVG
 * computed at build time by d3-geo, so the geometry travels *inside* the
 * document and `world-atlas` never reaches the browser —
 * `docs/adr/0009-le-poids-est-un-budget-mesure.md` records that as measured, by a
 * `grep` over `.next/static`. A grep over a build directory is not the same claim
 * as this one: it says the bytes are not in a chunk, not that nothing fetches
 * them. A `fetch("/countries-110m.json")` added inside the interaction layer, a
 * font moved to Google Fonts, an analytics snippet, a map tile server behind a
 * "just to try" — each ships a green build, a green lint and a green unit suite,
 * and each is a request from a reader's phone to somebody else's server.
 *
 * The test therefore asks the browser what it actually asked for, and refuses
 * anything that did not come from this origin.
 *
 * **Why it is a `*.populated.spec.ts`.** The repository's `content/trips` is empty
 * until TIW-24, so the default run has no trip page to load and its map carries no
 * marker. This config serves `tests/fixtures/content/home-map`, which is the site
 * with content in it — and content is what would carry a photo host, a tile URL or
 * an embedded video.
 */

/** The four screens the acceptance criteria name, on the fixture's content. */
const ROUTES = ["/fr", "/fr/voyages", "/fr/voyages/japon-2024", "/fr/a-propos"] as const;

/**
 * Names that would mean a geometry payload arrived over the network rather than
 * inside the document.
 *
 * A list of substrings and not of exact paths: the point is to catch the shape of
 * the mistake — a TopoJSON or GeoJSON fetched at runtime — whatever it ends up
 * being called. `topojson` and `world-atlas` are the two packages the façade
 * encapsulates (ADR 0002), `110m`/`50m` are the vintage names, and the two
 * extensions are the formats.
 */
const GEOMETRY_MARKERS = [
  "topojson",
  "geojson",
  "world-atlas",
  "countries-110m",
  "countries-50m",
  ".topo.json",
] as const;

/**
 * The `rel` values that open a connection to another host before anything is
 * even requested from it. They would not show up as a *request*, which is why
 * they are read off the document instead.
 */
const CONNECTING_RELS = ["preconnect", "dns-prefetch", "prefetch", "preload", "modulepreload"];

for (const route of ROUTES) {
  test(`${route} loads without one request leaving this origin`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
    const requested: string[] = [];

    page.on("request", (request) => {
      requested.push(request.url());
    });

    await page.goto(route, { waitUntil: "load" });
    /**
     * A beat past `load`, because that is where a third-party snippet lives: an
     * analytics tag or a font loader is deliberately deferred, so a check that
     * stops at `load` is a check it walks straight past.
     */
    await page.waitForTimeout(1_000);

    /**
     * Guards the guard, and it is the failure mode this whole file would take:
     * `page.on("request")` attached to the wrong page, a navigation that never
     * happened, a `waitUntil` that resolved on nothing — and `[] === []` passes
     * while reading no bytes at all. Every route of this site fetches at least
     * the document and its stylesheet.
     */
    expect(
      requested.length,
      `Aucune requête observée sur ${route} : l'écoute n'a rien capté, donc les assertions ci-dessous passeraient sur une liste vide.`
    ).toBeGreaterThan(2);

    const external = requested.filter((url) => !url.startsWith(`${origin}/`));
    expect(
      external,
      `Ces requêtes sortent de l'origine servie. Le site ne doit rien demander à un tiers au chargement : ${external.join(", ")}`
    ).toEqual([]);

    const geometry = requested.filter((url) =>
      GEOMETRY_MARKERS.some((marker) => url.toLowerCase().includes(marker))
    );
    expect(
      geometry,
      `Ces requêtes ressemblent à un fichier de géométrie. Les tracés du planisphère sont calculés au build et vivent dans le document (ADR 0003 et 0009) ; une requête ici veut dire qu'une couche est repassée par le réseau : ${geometry.join(", ")}`
    ).toEqual([]);

    /**
     * The document's own declarations, for what a request list cannot see: a
     * `preconnect` is a TCP and TLS handshake with a third party that happens
     * whether or not anything is ever fetched over it, and it does not appear as a
     * request. Same for a `preload` of an off-origin font.
     */
    const hosts = await page.evaluate((rels) => {
      const found: string[] = [];

      for (const link of document.querySelectorAll("link[href]")) {
        const rel = (link.getAttribute("rel") ?? "").toLowerCase();
        if (!rels.some((candidate) => rel.split(/\s+/).includes(candidate))) continue;

        const href = link.getAttribute("href") ?? "";
        if (/^https?:\/\//i.test(href) && !href.startsWith(window.location.origin)) {
          found.push(`${rel} → ${href}`);
        }
      }

      return found;
    }, CONNECTING_RELS);

    expect(
      hosts,
      `Le document ouvre une connexion vers un autre hôte avant même de lui demander quoi que ce soit : ${hosts.join(", ")}`
    ).toEqual([]);
  });
}

/**
 * The interaction layer, asked the same question in the one state a page load
 * cannot reach.
 *
 * TIW-14's map zooms, pans and opens a panel. A tile server, a geocoder or a
 * lazily fetched geometry would be invisible to every case above — nothing of the
 * sort is requested until a reader touches the map. So the map is used, and then
 * the list is read again.
 */
test("using the map fetches nothing beyond this origin either", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1").origin;

  await page.goto("/fr", { waitUntil: "load" });

  const afterLoad: string[] = [];
  page.on("request", (request) => {
    afterLoad.push(request.url());
  });

  const figure = page.locator("figure");
  await figure.getByRole("button", { name: "Zoomer sur la carte" }).click();
  await page.getByRole("link", { name: "Islande, cercle d'or, Reykjavik" }).click({ force: true });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(1_000);

  const external = afterLoad.filter((url) => !url.startsWith(`${origin}/`));
  expect(
    external,
    `Zoomer et ouvrir un panneau a déclenché des requêtes hors origine : ${external.join(", ")}`
  ).toEqual([]);

  const geometry = afterLoad.filter((url) =>
    GEOMETRY_MARKERS.some((marker) => url.toLowerCase().includes(marker))
  );
  expect(
    geometry,
    `Zoomer a fait chercher de la géométrie sur le réseau : ${geometry.join(", ")}`
  ).toEqual([]);
});
