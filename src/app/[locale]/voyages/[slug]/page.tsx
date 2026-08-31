import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { findTrip, tripStaticParams } from "@/content/trips";
import type { TripDetail } from "@/content/trips";
import { TripHeader } from "@/components/timeline/trip-header";
import { TripMiniMap } from "@/components/timeline/trip-mini-map";
import type { MiniMapMark } from "@/components/timeline/trip-mini-map";
import { TripTimeline } from "@/components/timeline/trip-timeline";
import { timelineSteps } from "@/components/timeline/steps";
import { tripWordCount } from "@/components/timeline/reading";
import { estimateReadingMinutes, visitedPlaces } from "@/domain/trip";
import { localePathname } from "@/i18n/pathname";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import { buildWorldGeometry, projectPoint } from "@/map";
import styles from "./page.module.css";

/**
 * The trip page: a header that stands alone, the itinerary as a timeline, and a
 * map of this trip and no other.
 *
 * **`dynamicParams = false` is load-bearing, and it is the publication frontier
 * for drafts.** Being absent from `generateStaticParams` is *not* by itself a
 * 404: under the App Router's defaults an unknown slug is rendered on demand,
 * which — as `tripStaticParams`' own comment records, measured — traces the
 * draft's `trip.yaml` into the server function's bundle, keeps
 * `process.env.TIW_DRAFTS` as a *runtime* read, and takes the publish/hide
 * decision per request. With this line the same request answers 404 immediately,
 * creates no ISR cache entry, and reads no file. Do not remove it.
 */
export const dynamicParams = false;

type TripPageParams = { locale: string; slug: string };

type TripPageProps = {
  params: Promise<TripPageParams>;
};

/**
 * Only `{ slug }`: the parent `[locale]` layout already generates the locales,
 * and Next runs a child's `generateStaticParams` once per set of params the
 * parent produced. Returning the locale here as well would multiply the routes
 * by the number of locales twice over.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return [...(await tripStaticParams())];
}

/**
 * The two links out of this page, built with `localePathname` and never with
 * `getPathname` from `@/i18n/navigation`.
 *
 * That is not a style preference: every export of `@/i18n/navigation` comes from
 * one `createNavigation(routing)` in a module that imports next-intl's
 * `"use client"` `BaseLink` at the top level, so importing *any* of them
 * registers a client reference for the route and ships 12.4 KB of JavaScript for
 * an `href` a plain `<a>` renders for free. Measured, and guarded by a
 * fingerprint test in `tests/build/prerender.test.ts`. See
 * `docs/adr/0005-getpathname-sans-le-link-client.md`.
 *
 * **The fragment is a forward-compatible seam, not a working feature today.**
 * `/#voyage-<slug>` names this trip on the world map; the home page that will
 * honour it is TIW-20's and the framing behind it is TIW-14's. Until then the
 * link lands on the world map at the top of the page, which is a degradation
 * with no broken state in it — the reader still arrives at the map.
 *
 * A marker adds its place after a double hyphen. `SlugSchema` forbids `--`
 * inside a slug, so `voyage-japon-2024--tokyo` splits back into trip and place
 * unambiguously, and each marker gets a distinct href rather than four links
 * pointing at one target.
 */
function worldMapHref(locale: Locale, tripSlug: string, placeSlug?: string): string {
  const fragment = placeSlug === undefined ? tripSlug : `${tripSlug}--${placeSlug}`;

  return localePathname({ href: `/#voyage-${fragment}`, locale });
}

function allTripsHref(locale: Locale): string {
  return localePathname({ href: "/", locale });
}

/** The declared photo behind `coverPhotoSrc`. `TripSchema` already refuses a
 * cover that is not one of the trip's photos, so a miss here means an unparsed
 * value rather than a content fault — and `null` renders no cover at all. */
function coverOf(trip: TripDetail) {
  if (trip.coverPhotoSrc === undefined) {
    return null;
  }

  return trip.photos.find((photo) => photo.src === trip.coverPhotoSrc) ?? null;
}

async function loadTrip(params: Promise<TripPageParams>) {
  const { locale, slug } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const trip = await findTrip(slug);
  if (trip === undefined) {
    notFound();
  }

  return { locale, trip };
}

export async function generateMetadata({ params }: TripPageProps): Promise<Metadata> {
  const { locale, trip } = await loadTrip(params);
  const t = await getTranslations({ locale, namespace: "trip" });
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });

  return {
    title: trip.title,
    description: t("metaDescription", {
      title: trip.title,
      duration: t("durationValue", {
        days: trip.duration.days,
        nights: trip.duration.nights,
      }),
      cities: list.format(visitedPlaces(trip).map((place) => place.name)),
    }),
  };
}

export default async function TripPage({ params }: TripPageProps) {
  const { locale, trip } = await loadTrip(params);
  const t = await getTranslations({ locale, namespace: "trip" });

  /**
   * One geometry build for the page, feeding both the map and the header's list
   * of countries. `buildWorldGeometry` returns the visited shapes already
   * localised and sorted, so the two never name the same countries differently
   * or in a different order — which is what a second `Intl.DisplayNames` here
   * would eventually do.
   */
  const world = buildWorldGeometry({ visitedCountryCodes: trip.countryCodes, locale });

  const cities = visitedPlaces(trip);
  const stopNumbers = new Map(cities.map((place, index) => [place.slug, index + 1]));

  /**
   * A place whose coordinates do not project is dropped from the markers rather
   * than placed at a default. `CoordinatesSchema` already refuses (0, 0) — "the
   * signature of a failed geocoding, not a place on earth" — so this is the
   * residual case of a projection that has no answer, and a marker invented for
   * it would be a confident dot in the wrong country.
   */
  const marks: MiniMapMark[] = cities.flatMap((place) => {
    const point = projectPoint(place.coordinates);

    return point === null
      ? []
      : [
          {
            placeSlug: place.slug,
            placeName: place.name,
            href: worldMapHref(locale, trip.slug, place.slug),
            point,
          },
        ];
  });

  return (
    <main className={styles.page}>
      {/*
       * `<article>`: this page is a self-contained composition that would still
       * make sense syndicated out of the site — which is the criterion the whole
       * header is built around.
       */}
      <article className={styles.trip}>
        <TripHeader
          title={trip.title}
          startDate={trip.startDate}
          endDate={trip.endDate}
          duration={trip.duration}
          countryNames={world.visited.map((country) => country.name)}
          cityNames={cities.map((place) => place.name)}
          readingMinutes={estimateReadingMinutes(tripWordCount(trip))}
          cover={coverOf(trip)}
          worldMapHref={worldMapHref(locale, trip.slug)}
          allTripsHref={allTripsHref(locale)}
        />

        <section className={styles.section} aria-labelledby="carte-du-voyage">
          <h2 className={styles.sectionHeading} id="carte-du-voyage">
            {t("mapHeading")}
          </h2>
          <TripMiniMap
            countries={world.countries}
            visited={world.visited}
            marks={marks}
            world={{ width: world.width, height: world.height }}
          />
        </section>

        <section className={styles.section} aria-labelledby="deroule-du-voyage">
          <h2 className={styles.sectionHeading} id="deroule-du-voyage">
            {t("timelineHeading")}
          </h2>
          {/*
           * `TripSchema` requires at least one step (`steps: z.array(...).min(1)`),
           * so there is no empty timeline to render an empty state for: a trip
           * with no steps cannot be loaded at all.
           */}
          <TripTimeline steps={timelineSteps(trip)} stopNumbers={stopNumbers} />
        </section>

        {/*
         * The gallery is the trip's own `photos[]`, which is where every photo
         * this content model has lives — they are declared on the trip, not on a
         * step, so there is no per-step gallery to render. The section is omitted
         * rather than shown empty: "no photos yet" on a finished trip promises
         * something nobody has undertaken to deliver. See the ticket report on
         * what TIW-17 owns here.
         */}
        {trip.photos.length > 0 ? (
          <section className={styles.section} aria-labelledby="photos-du-voyage">
            <h2 className={styles.sectionHeading} id="photos-du-voyage">
              {t("photosHeading")}
            </h2>
            <ul className={styles.gallery} role="list">
              {trip.photos.map((photo) => (
                <li key={photo.src} className={styles.galleryItem}>
                  {/* A plain `<img>` for the same reason as the cover: this page
                      ships no JavaScript, and `next/image` is a client
                      component. `width`/`height` are mandatory in the schema, so
                      the box is reserved before the bytes arrive. */}
                  <img
                    className={styles.photo}
                    src={photo.src}
                    alt={photo.alt}
                    width={photo.width}
                    height={photo.height}
                    loading="lazy"
                    decoding="async"
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </main>
  );
}
