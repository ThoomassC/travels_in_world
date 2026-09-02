import type { ReactElement, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { localePathname } from "@/i18n/pathname";
import { tripPath } from "@/i18n/paths";
import type { Locale } from "@/i18n/routing";
import type { TripEntry } from "./entry";
import { formatPublicationDay } from "./format";
import styles from "./fresh-trip-banner.module.css";

/**
 * The home page's banner for the journal's newest récit — the second of the
 * badge's three placements (TIW-19), and the only one that says *when*.
 *
 * **Rendered by the page only when there is one**, never as an empty shell: a
 * banner announcing nothing is worse than no banner, and "un site sans aucun
 * voyage publié n'affiche ni bandeau ni badge" is an acceptance criterion. So
 * this component takes a `TripEntry` and not a `TripEntry | undefined` — the
 * absence is decided one level up, where the page already branches, rather than
 * by a component that can return `null` and be forgotten in a test.
 *
 * **It prints the publication date, and that is a deliberate mitigation rather
 * than a decoration.** The site is prerendered, so the badge expires at the first
 * build after its sixtieth day and not at midnight on it
 * (`docs/fraicheur-au-prerendu.md`). A stale "Nouveau récit" is wrong; a stale
 * "Nouveau récit — publié le 3 mars" lets the reader see that for themselves. It
 * is the cheapest honest answer to the one case the deployment cadence does not
 * cover.
 *
 * **`<aside>` and not `<section>`.** The banner is a pointer *into* the page's
 * own content — the same trip appears in "Derniers voyages" a screen below — so
 * it is complementary rather than a chapter of the document. It carries an
 * accessible name so it shows up in a screen reader's landmark list as something
 * other than "complementary".
 *
 * Synchronous, hence `useTranslations` and not `getTranslations`: the same reason
 * `TripCard` records — an `async` component cannot be rendered by Testing Library
 * at all, so the pages await and hand plain data down.
 */

/** One `id`, because there is at most one banner on a document. */
const HEADING_ID = "fresh-trip-heading";

export type FreshTripBannerProps = {
  readonly trip: TripEntry;
  readonly locale: Locale;
};

export function FreshTripBanner({ trip, locale }: FreshTripBannerProps): ReactElement {
  const t = useTranslations("home");
  const href = localePathname({ href: tripPath(trip.slug), locale });

  return (
    <aside className={styles.banner} aria-labelledby={HEADING_ID}>
      {/*
        The textual badge, identical in wording to the card's chip and to the
        marker's suffix. One sentence for one fact across three placements: a
        reader who meets the trip twice must not have to work out that "Nouveau"
        here and "nouveau récit" there are the same claim.
      */}
      <p className={styles.flag}>{t("freshLabel")}</p>

      {/*
        `<h2>`, a sibling of "Derniers voyages" below it: the banner is a peer
        chapter of the home page, not a sub-heading of the hero. Its text is the
        trip's own title rather than a label like "Le dernier récit publié",
        which the chip above already says — a heading list that reads "Nouveau
        récit / Le dernier récit publié / Derniers voyages" is three ways of
        naming one block and no way of naming the trip.

        The title is the link, and the only one here: a second "Lire le récit"
        anchor would be two tab stops to one page, the defect `TripCard` records
        at length.
      */}
      <h2 id={HEADING_ID} className={styles.heading}>
        <a className={styles.link} href={href}>
          {trip.title}
        </a>
      </h2>

      <p className={styles.published}>
        {t.rich("freshPublished", {
          date: formatPublicationDay(locale, trip.publishedAt),
          /*
            A real `<time datetime>`, so the date is machine-readable as well as
            legible. The rich-text hole is how a `<time>` gets *inside* a
            translated sentence without splitting the sentence into fragments a
            translator can never reorder — the pattern `trip.datesValue` already
            uses on the trip page.
          */
          on: (chunks: ReactNode) => <time dateTime={trip.publishedAt}>{chunks}</time>,
        })}
      </p>
    </aside>
  );
}
