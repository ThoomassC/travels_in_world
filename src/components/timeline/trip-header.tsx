import type { ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
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

export type TripHeaderCover = {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
};

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
            {t.rich("datesValue", {
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
         * A plain `<img>`, not `next/image`. Two reasons, and the second is the
         * decisive one: `next/image` is a client component, and this page ships
         * zero bytes of JavaScript; and the photo pipeline that would give the
         * optimiser something to work with is TIW-17, unbuilt — `npm run
         * index-photos` still exits 1 on purpose. The intrinsic `width` and
         * `height` come from the schema, which makes them mandatory content
         * rather than a hint, so the box is reserved before the bytes arrive and
         * nothing shifts under the reader.
         */
        <img
          className={styles.cover}
          src={cover.src}
          alt={cover.alt}
          width={cover.width}
          height={cover.height}
          /* Above the fold by construction: this is the LCP candidate, so it is
             fetched eagerly and at high priority rather than lazily. */
          loading="eager"
          fetchPriority="high"
          decoding="async"
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
