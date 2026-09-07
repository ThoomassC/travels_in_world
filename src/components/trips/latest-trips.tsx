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
 * **One, and the number is here rather than at the call site.** It used to be
 * three — TIW-13's acceptance criterion — and it is one since the owner asked, on
 * 7 September 2026, that the block show only the journal's most recent trip. The
 * constant stays in this file rather than becoming a `count` prop for the same
 * reason it was never one: it is not a knob, it is what "derniers voyages" means
 * on this site, and a prop would let the home page and this component disagree
 * about that. There is still exactly one caller, and a second one would need the
 * same answer, not its own.
 *
 * **The empty state is a different block, not this one with nothing in it.**
 * That is the criterion, and it is the right reading: a "Derniers voyages"
 * heading above nothing tells a reader the site is broken, where "Le carnet
 * commence ici" tells them it is new. Nothing empty is rendered — no heading, no
 * list, no "0 voyage" counter.
 */

/**
 * How many trips the block shows, named so the test and the code cite one value.
 *
 * No longer TIW-13's acceptance criterion — that one said three. The owner asked
 * on 7 September 2026 for the single most recent trip, under a ribbon. Kept as a
 * named constant rather than inlined: three call sites read it (the slice, and
 * two suites that count what the block renders), and a bare `1` in the middle of
 * `latestTrips(trips, 1)` is the kind of number a reader cannot tell from a
 * typo.
 */
export const LATEST_TRIP_COUNT = 1;

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
   * The fresh trip may well not be the one shown here: it is the newest
   * *publication*, and this block shows the newest *journey*. That is the
   * ticket's own trap and the correct outcome — no badge appears in this block
   * then, and the banner above still announces it. Since the block dropped from
   * three cards to one it is the ordinary case rather than the edge one.
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
        Still a `<ul>`, with one item in it, and that is deliberate rather than
        left over from the three-card version. The count is what a screen reader
        announces on entering: "1 élément" is the difference between knowing the
        block is finished and scrolling to find out — the same argument that put
        the list here, and it is *stronger* at one, because a lone card is exactly
        what a reader might take for the first of several. `role="list"` for the
        Safari / VoiceOver reason recorded on the map's marker list.
      */}
      <ul className={cardStyles.grid} role="list">
        {latest.map((trip, index) => (
          <li key={trip.slug} className={styles.item}>
            {/*
              **The ribbon, and it is not the card's `Nouveau récit` badge.**

              Two different claims, which can be true of the same card at the same
              time. `isNew` — `trips.cardNew`, resolved by `freshestTrip` and gated
              on `hasStory` — means "this is the journal's most recently *published*
              récit". This ribbon means "this is the most recent *journey* of this
              list". A trip with no récit written can carry the ribbon and can never
              carry the badge; a 2019 trip whose story was published this morning
              carries the badge in the full listing and no ribbon anywhere. Folding
              one into the other would lose a fact, so `TripCard` is left alone and
              the ribbon lives here.

              **Here, and not in `TripCard`, because "the most recent of this list"
              is a property of the list.** A card sees one trip and cannot know its
              rank; the same card is rendered by the full listing, where the claim
              would be false. Same reasoning as `isNew`, one level out.

              **Real text, before the card, in the card's own `<li>`.** Not an
              `aria-label`, not a `::before { content: }`, not a visually hidden
              twin of a coloured strip — this repository has taken that decision
              three times (the card's badge, the map marker's label, the banner's
              chip) and the argument is unchanged: an attribute is a string no
              translator sees in context, a pseudo-element is text an engine may or
              may not announce, and a hidden twin is two copies of one string to
              keep in step. Strip every rule from the stylesheet and "Nouveau !" is
              still on the page, still ahead of the trip it qualifies.

              `index === 0` and not "because the count is one": `latestTrips` hands
              back the front of a list the content façade ordered by `startDate`
              descending, so the first item *is* the most recent. Written this way
              the ribbon stays correct if the count ever goes back up, and the
              claim stays a property of the data rather than of the constant.
            */}
            {index === 0 ? <p className={styles.ribbon}>{t("latestRibbon")}</p> : null}

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
