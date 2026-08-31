import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
// `@/components/map` and not `@/components/map/world-map`: the deep specifier is
// caught by the `"**/map/*"` half of the geometry façade's guard, which compares
// strings and cannot tell `src/components/map` from a relative spelling of
// `src/map`. See the header of `src/components/map/index.ts`.
import { WorldMap, type TripMark } from "@/components/map";
import { LatestTrips } from "@/components/trips/latest-trips";
import { listTripSummaries } from "@/content/trips";
import { buildWorldGeometry, projectPoint } from "@/map";
import { localePathname } from "@/i18n/pathname";
import { tripPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import styles from "./page.module.css";

type HomePageProps = {
  params: Promise<{ locale: string }>;
};

/**
 * React's `CSSProperties` is closed — its index signature was removed on purpose
 * — so a custom property does not typecheck in an object literal without being
 * named. Naming it in the type rather than casting the literal is what keeps
 * every *other* typo in the same object an error; identical note in
 * `src/components/map/world-map.tsx`.
 */
type MapFrameStyle = CSSProperties & Record<"--world-aspect", string>;

/**
 * The home page: one sentence saying what this is, the world map, and the start
 * of the latest-trips block.
 *
 * **This is the one file holding both façades**, by design rather than by
 * accumulation. `docs/adr/0003-carte-svg-inerte-et-balises-html.md` requires that
 * nothing under `src/components/map/**` import `@/map` or `@/content/trips` as a
 * *value*, so the whole map layer renders under jsdom from a seven-shape fixture;
 * `src/components/trips/**` follows the same rule for the same reason. The
 * joining therefore happens here — which is also the only place holding a real
 * `TripSummary` next to the narrowed `TripEntry` and a real `CountryShape` next
 * to the narrowed `MapCountry`, so a rename in either façade fails
 * `npm run typecheck` here and nowhere else.
 *
 * **The three states this page must be right in**, all reachable today: no
 * published trip — the production state until the first `trip.yaml` lands, since
 * `content/trips` is empty — one trip, and sixty. `frameAround` owns the first
 * two for the map; `LatestTrips` owns all three for the listing.
 */
export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  /**
   * One read of the content, used twice, and deliberately not a `Promise.all`:
   * `buildWorldGeometry` needs the country codes this very list produces, so the
   * two are genuinely sequential rather than a waterfall someone forgot to
   * flatten. The façade memoises its parse for the whole build, so a second call
   * would cost no second disk read — only a second projection of the same trips.
   */
  const trips = await listTripSummaries();
  const t = await getTranslations("home");

  const world = buildWorldGeometry({
    // Duplicates are the normal case — several trips share a country — and
    // `buildWorldGeometry` de-duplicates on its side. Flattening is all this owes.
    visitedCountryCodes: trips.flatMap((trip) => [...trip.countryCodes]),
    locale,
  });

  /**
   * One marker per trip, anchored where its first step arrives — the same
   * anchoring `buildCatalogue` files a trip under, so the map and the listing
   * agree about where a trip "is".
   *
   * `flatMap` rather than `map`: `projectPoint` answers `null` for a coordinate
   * the projection declines, and a marker built from it would carry `NaN`
   * percentages — an attribute the browser ignores, so an invisible link with
   * nothing in the console to say so. Dropping it costs one marker on a map that
   * still works, and the `<figcaption>` counts `marks`, so the figure a reader is
   * told stays true to what was drawn.
   */
  const marks: readonly TripMark[] = trips.flatMap((trip) => {
    const point = projectPoint(trip.firstArrival.coordinates);

    return point === null
      ? []
      : [
          {
            slug: trip.slug,
            title: trip.title,
            placeName: trip.firstArrival.name,
            href: localePathname({ href: tripPath(trip.slug), locale }),
            point,
          },
        ];
  });

  const mapFrameStyle: MapFrameStyle = {
    "--world-aspect": String(world.width / world.height),
  };

  return (
    <main>
      <section className={styles.hero}>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.intro}>{t("intro")}</p>

        <div className={styles.mapFrame} style={mapFrameStyle}>
          <WorldMap
            countries={world.countries}
            visited={world.visited}
            marks={marks}
            world={{ width: world.width, height: world.height }}
          />
        </div>
      </section>

      <LatestTrips trips={trips} locale={locale} />
    </main>
  );
}
