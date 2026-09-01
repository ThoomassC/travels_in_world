import type { ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PhotoFigure } from "@/components/photos/photo-figure";
import type { PhotoView } from "@/components/photos/photo-figure";
import type { PlainDate } from "@/domain/geo";
import type { Duration } from "@/domain/trip";
import { formatDayRange, machineDate } from "./dates";
import styles from "./trip-header.module.css";

/**
 * The header of a trip page, and the acceptance criterion it exists for: *this
 * page must stand on its own.* Most visitors arrive here from a search engine or
 * a shared link, having never seen the map or the index — so everything needed
 * to know what this trip was has to be here, before any scrolling, without a
 * word of prior context.
 *
 * Hence the shape: a title, then a definition list of the five facts, then the
 * cover, then the two ways out. Nothing is a bare number and nothing is a bare
 * icon; every value has a `<dt>` naming it.
 *
 * **The duration is derived, never authored.** It arrives as a `Duration` from
 * `durationOf`, which reads the two dates. `content/README.md` has no field for
 * it, deliberately: a duration written by hand is a duration that disagrees with
 * the dates the day one of them is corrected.
 *
 * Takes plain data rather than a `TripDetail` so it can be rendered in a unit
 * test without a content directory or a server context.
 */

/**
 * The cover is a {@link PhotoView} and no longer a local four-field shape.
 *
 * Re-declaring it here would be a second contract to keep in step with the
 * pipeline: TIW-17 made `blurDataUrl` a required field of every photo, and a copy
 * of the shape is how the header would keep rendering a cover with no placeholder
 * while nothing anywhere says so. The alias is kept so the page's existing type
 * reference stays valid.
 */
export type TripHeaderCover = PhotoView;

/**
 * The cover's rendered width, told to the browser so it picks the right rung of
 * the derivative ladder.
 *
 * The reading column is `68ch` — ~34 rem at the default font size — and below
 * that the image is the viewport less `main`'s 1.5 rem of padding on each side.
 * `max-block-size: 38vh` crops the box further (see the module), which only ever
 * makes the needed *width* smaller, so this is an upper bound and never an
 * under-estimate: the browser is allowed to pick a smaller rung, never forced
 * into a bigger one.
 */
const COVER_SIZES = "(min-width: 37rem) 34rem, calc(100vw - 3rem)";

export type TripHeaderProps = {
  readonly title: string;
  readonly startDate: PlainDate;
  readonly endDate: PlainDate;
  readonly duration: Duration;
  /** Localised and already sorted — the same names the map's caption uses. */
  readonly countryNames: readonly string[];
  /** In the order the trip travels them, not the order they were declared. */
  readonly cityNames: readonly string[];
  readonly readingMinutes: number;
  readonly cover: TripHeaderCover | null;
  readonly worldMapHref: string;
  readonly allTripsHref: string;
};

export function TripHeader({
  title,
  startDate,
  endDate,
  duration,
  countryNames,
  cityNames,
  readingMinutes,
  cover,
  worldMapHref,
  allTripsHref,
}: TripHeaderProps): ReactElement {
  const t = useTranslations("trip");
  const locale = useLocale();

  // The separator and the final conjunction are properties of the language, not
  // of this component: "Tokyo, Kyoto et Osaka" in French, "and" in English.
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
  const range = formatDayRange(startDate, endDate, locale);

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>

      {/* A visually hidden heading rather than an `aria-label` on the `<dl>`:
          `dl` has no reliable implicit role, so a label on it is ignored by some
          screen readers, whereas a heading is navigable and announced by all of
          them. */}
      <h2 className={styles.visuallyHidden}>{t("summaryLabel")}</h2>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt className={styles.term}>{t("countriesTerm")}</dt>
          <dd className={styles.value}>{list.format(countryNames)}</dd>
        </div>

        <div className={styles.fact}>
          <dt className={styles.term}>{t("datesTerm")}</dt>
          <dd className={styles.value}>
            {/*
             * `<time>` on each end rather than around the sentence: a range
             * needs two machine-readable dates and `dateTime` holds one.
             *
             * The tags are named `<from>`/`<to>` and the values `{start}`/
             * `{end}` on purpose — next-intl resolves tags and placeholders from
             * the same `values` object, so reusing one name for both would make
             * the message ambiguous.
             */}
            {startDate === endDate
              ? /*
                 * A one-day trip is one date, never a range from a day to itself.
                 *
                 * This is a coherence fix, not a taste: the trip card on
                 * `/fr/voyages` already prints such a trip as `1 juin 2024`, and
                 * its suite pins that behaviour by name — "prints a one-day trip
                 * as one date, **not as a range from a day to itself**". This
                 * header printed « du 1 juin au 1 juin 2024 » for the same trip,
                 * so the site said it twice, two ways, one of them the very
                 * spelling the neighbouring test calls the defect.
                 *
                 * A separate message rather than a formatter trick: the French
                 * « le … » and « du … au … » are different sentences, and the
                 * choice between them is a translation, not a date format.
                 */
                t.rich("datesValueSingleDay", {
                  start: range.end,
                  from: (chunks) => <time dateTime={machineDate(startDate)}>{chunks}</time>,
                })
              : t.rich("datesValue", {
                  start: range.start,
                  end: range.end,
                  from: (chunks) => <time dateTime={machineDate(startDate)}>{chunks}</time>,
                  to: (chunks) => <time dateTime={machineDate(endDate)}>{chunks}</time>,
                })}
          </dd>
        </div>

        <div className={styles.fact}>
          <dt className={styles.term}>{t("durationTerm")}</dt>
          <dd className={styles.value}>
            {t("durationValue", { days: duration.days, nights: duration.nights })}
          </dd>
        </div>

        <div className={styles.fact}>
          <dt className={styles.term}>{t("citiesTerm")}</dt>
          <dd className={styles.value}>{list.format(cityNames)}</dd>
        </div>

        <div className={styles.fact}>
          <dt className={styles.term}>{t("readingTerm")}</dt>
          <dd className={styles.value}>{t("readingValue", { minutes: readingMinutes })}</dd>
        </div>
      </dl>

      {cover === null ? null : (
        /*
         * Through `PhotoFigure`, which is now the one place this site emits an
         * image — `<picture>`, the AVIF `srcset` from the ladder in
         * `@/domain/photo`, and the blurred placeholder. Still no `next/image`:
         * the optimiser is a client component and the derivatives are already on
         * disk, written by `npm run index-photos` at authoring time.
         *
         * Rendering it here rather than passing `sizes` down to a local `<img>`
         * is the choice that stops the markup drifting: the gallery, a step and
         * the viewer would otherwise emit a `<picture>` and the cover an `<img>`,
         * and the cover — the LCP of the page — would be the one image with no
         * modern format and no placeholder.
         *
         * **The cover is not a viewer trigger.** It is the page's editorial
         * opening; wrapping it in a link would put a modal and a tab stop before
         * the reader has met the trip's summary. It is excluded from the viewer's
         * array as well, which is what keeps "photo 3 sur 11" counting the photos
         * a reader can actually open — see `collection.ts`.
         */
        <PhotoFigure
          photo={cover}
          sizes={COVER_SIZES}
          className={styles.cover}
          /* Above the fold by construction: this is the LCP candidate, so it is
             fetched eagerly and at high priority rather than lazily. */
          loading="eager"
          fetchPriority="high"
        />
      )}

      {/*
       * Both ways out, in the header — the criterion asks for them "without
       * reaching the footer", because a reader who landed here from a search
       * result has no back button to a site they have never seen.
       *
       * The labels are deliberately not "Retour": most visitors have never been
       * to the map or the index, and "back" to a place you have not been is a
       * promise the interface cannot keep.
       */}
      <nav className={styles.links} aria-label={t("navLabel")}>
        <a className={styles.link} href={worldMapHref}>
          {t("seeOnWorldMap")}
        </a>
        <a className={styles.link} href={allTripsHref}>
          {t("allTrips")}
        </a>
      </nav>
    </header>
  );
}
