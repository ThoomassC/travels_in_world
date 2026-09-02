import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { localePathname } from "@/i18n/pathname";
import { tripsPath } from "@/i18n/paths";
import type { Locale } from "@/i18n/routing";
import { latestTrips } from "./catalogue";
import type { TripEntry } from "./entry";
import cardStyles from "./trip-card.module.css";
import { TripCard } from "./trip-card";
import styles from "./latest-trips.module.css";

/**
 * The home page's second block: the most recent trips, or an honest sentence
 * saying there are none yet.
 *
 * **Three, and the number is here rather than at the call site.** It is the
 * acceptance criterion's number and this component is the only thing that
 * implements it; a `count` prop would let the home page and this file disagree
 * about what "derniers voyages" means, and there is no second caller to serve.
 *
 * **The empty state is a different block, not this one with nothing in it.**
 * That is the criterion, and it is the right reading: a "Derniers voyages"
 * heading above nothing tells a reader the site is broken, where "Le carnet
 * commence ici" tells them it is new. Nothing empty is rendered — no heading, no
 * list, no "0 voyage" counter.
 */

/** The acceptance criterion's number, named so the test and the code cite one value. */
export const LATEST_TRIP_COUNT = 3;

export type LatestTripsProps = {
  /** Already ordered by the content façade: `startDate` descending, then `slug`. */
  readonly trips: readonly TripEntry[];
  readonly locale: Locale;
  /**
   * The slug of the journal's newest récit, when there is a fresh one (TIW-19).
   *
   * A slug and not a boolean per card: the page resolves it once and every
   * placement compares against the same answer, which is what makes "le voyage le
   * plus récent le porte, et seulement lui" a property of the data rather than a
   * discipline. `undefined` — no publication inside the window — is a state this
   * block renders unchanged, badge-less.
   *
   * The fresh trip may well not be among the three shown here: it is the newest
   * *publication*, and this list is the newest *journeys*. That is the ticket's
   * own trap and the correct outcome — no badge appears in this block then, and
   * the banner above still announces it.
   */
  readonly freshSlug?: string;
};

export function LatestTrips({ trips, locale, freshSlug }: LatestTripsProps): ReactElement {
  const t = useTranslations("home");
  const latest = latestTrips(trips, LATEST_TRIP_COUNT);

  if (latest.length === 0) {
    return (
      <section className={styles.empty} aria-labelledby="latest-heading">
        <h2 id="latest-heading" className={styles.heading}>
          {t("emptyHeading")}
        </h2>
        <p className={styles.emptyBody}>{t("emptyBody")}</p>
      </section>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="latest-heading">
      <h2 id="latest-heading" className={styles.heading}>
        {t("latestHeading")}
      </h2>

      {/*
        A `<ul>` and not a bare `<div>` of cards: the count is what a screen
        reader announces on entering, and "3 éléments" is the difference between
        knowing the block is finished and scrolling to find out. `role="list"`
        for the Safari / VoiceOver reason recorded on the map's marker list.
      */}
      <ul className={cardStyles.grid} role="list">
        {latest.map((trip) => (
          <li key={trip.slug}>
            <TripCard
              trip={trip}
              locale={locale}
              headingLevel={3}
              isNew={trip.slug === freshSlug}
            />
          </li>
        ))}
      </ul>

      <a className={styles.more} href={localePathname({ href: tripsPath(), locale })}>
        {t("latestAll")}
      </a>
    </section>
  );
}
