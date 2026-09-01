import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { findTrip, tripStaticParams } from "@/content/trips";
import type { TripDetail } from "@/content/trips";
import { unplacedPhotos, viewerPhotos } from "@/components/photos/collection";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { PhotoViewer } from "@/components/photos/photo-viewer";
import { TripHeader } from "@/components/timeline/trip-header";
import { TripMiniMap } from "@/components/timeline/trip-mini-map";
import type { MiniMapMark } from "@/components/timeline/trip-mini-map";
import { TripTimeline } from "@/components/timeline/trip-timeline";
import { timelineSteps } from "@/components/timeline/steps";
import { tripWordCount } from "@/components/timeline/reading";
import { estimateReadingMinutes, visitedPlaces } from "@/domain/trip";
import { localePathname } from "@/i18n/pathname";
import { tripsPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import { buildWorldGeometry, projectPoint } from "@/map";
import { MAIN_CONTENT_ID } from "../../main-content";
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

/**
 * The gallery grid's `id`. Named here rather than inside `PhotoGallery`, which
 * renders several times per page — one grid per stay that has photos — and cannot
 * invent a unique one for each.
 */
const GALLERY_ID = "galerie-du-voyage";

/**
 * The rendered width of a gallery photo, told to the browser so it picks the
 * right rung of the derivative ladder.
 *
 * Derived from the layout and not guessed: the reading column is `68ch` — ~34 rem
 * at the default font size — and the grid's `minmax(min(100%, 14rem), 1fr)` fits
 * two tracks of ~17 rem in it, gap included. Below that it collapses to one track
 * the width of the column, which on a phone is the viewport less `main`'s 1.5 rem
 * of padding on each side. 480 px covers 17 rem at 1×, 960 px at 2×.
 */
const GALLERY_SIZES = "(min-width: 37rem) 17rem, calc(100vw - 3rem)";

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

/**
 * The listing, and not the home page.
 *
 * It pointed at `/` until TIW-20 landed, because `tripsPath()` did not exist yet
 * — which made the page's two ways out lead to the same place while one of them
 * was labelled "Tous les voyages". Two reviews caught it independently: a link
 * whose text names a page that exists and whose href goes elsewhere is a 2.4.4
 * failure, and after the merge it would have been a 3.2.4 one as well — the same
 * label pointing at two destinations on one site, since the site navigation uses
 * `tripsPath()` for it.
 */
function allTripsHref(locale: Locale): string {
  return localePathname({ href: tripsPath(), locale });
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

  const cover = coverOf(trip);

  /**
   * The page's photos, shared out three ways by one derivation.
   *
   * `viewerPhotos` decides which photos the viewer holds — every declared photo
   * except the cover, which the header has already shown — in which order, and
   * stamps each with the index its `<a>` hands to the viewer. `unplacedPhotos`
   * then takes the subset that belongs to the trip's own gallery: a photo naming
   * a place is shown inside that place's step instead, by `timelineSteps`, which
   * calls the same two functions on the same trip and therefore cannot number a
   * photo differently. See `collection.ts` for why the numbering lives there.
   */
  const viewer = viewerPhotos(trip);
  const galleryPhotos = unplacedPhotos(viewer);

  return (
    /*
      `id` and `tabIndex={-1}`: the skip link TIW-20 put in the layout targets
      `#contenu` on every route, so a page without the id sends it nowhere. The
      negative tabindex is what makes Safari actually move focus rather than only
      scroll — and it keeps `<main>` out of the tab order.
    */
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className={styles.page}>
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
          cover={cover}
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
            stopNumbers={stopNumbers}
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
         * The trip's gallery: the photos attached to no place. One that names a
         * place has already appeared inside that place's step above, which is
         * where a reader following the itinerary meets it, and showing it again
         * here would put the same image twice on one page.
         *
         * The section is omitted rather than shown empty: "no photos yet" on a
         * finished trip promises something nobody has undertaken to deliver. A
         * trip whose every photo is attached to a place — or whose only photo
         * *is* its cover — has no gallery at all, and the timeline carries the
         * pictures.
         *
         * **The cover is excluded, and it was not.** `TripSchema` requires
         * `coverPhotoSrc` to be one of `photos[]`, so iterating the array whole
         * rendered that image twice — measured in the served HTML: the same `src`
         * appeared at the top and again in the gallery, and a screen reader
         * announced the same `alt` twice with nothing to say the two were one
         * photo. That exclusion now lives in `viewerPhotos`, so it holds for the
         * timeline and the viewer too and not only here.
         */}
        {galleryPhotos.length > 0 ? (
          <section className={styles.section} aria-labelledby="photos-du-voyage">
            <h2 className={styles.sectionHeading} id="photos-du-voyage">
              {t("photosHeading")}
            </h2>
            <PhotoGallery id={GALLERY_ID} photos={galleryPhotos} sizes={GALLERY_SIZES} />
          </section>
        ) : null}
      </article>

      {/*
       * The viewer: ONE per page, holding every photo of the trip, mounted after
       * the article because a modal is interface and not part of the composition
       * an `<article>` promises to be syndicatable on its own.
       *
       * One per page and not one per gallery, and the reason is the reader's:
       * with a viewer per grid, the arrows would stop at the edge of whichever
       * step or gallery the photo happened to be filed under, and « photo 2 sur
       * 2 » would be said of a trip with eleven photographs. One viewer walks the
       * trip. It is also one `<dialog>` in the top layer, one delegated listener
       * and one piece of state instead of N of each.
       *
       * `scopeId` is the `<main>` and not the gallery, because the triggers are in
       * two places — the timeline's stays and the gallery. `data-photo-index` is
       * what selects them, so nothing else on the page is intercepted.
       *
       * Through `PhotoViewer`, the server shell that reads the catalogue and hands
       * the client component six plain strings. Measured, and the reason that
       * shell exists: calling `useTranslations` inside the client component put
       * next-intl's client `IntlProvider` into the shared chunk of every
       * `[locale]` route — 1.8 KB brotli on `/fr`, which has no viewer on it.
       *
       * Omitted entirely when the trip has no photo: the viewer would render an
       * empty `<dialog>` nothing can ever open, and its JavaScript would be
       * fetched for it.
       */}
      {viewer.length > 0 ? <PhotoViewer photos={viewer} scopeId={MAIN_CONTENT_ID} /> : null}
    </main>
  );
}
