import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { localePathname } from "@/i18n/pathname";
import { tripPath } from "@/i18n/paths";
import type { Locale } from "@/i18n/routing";
import type { TripEntry } from "./entry";
import { countryListOf, formatDateRange } from "./format";
import styles from "./trip-card.module.css";

/**
 * One trip in a listing: its cover, its title, the countries it crossed, its
 * dates, its duration and a read affordance.
 *
 * **Synchronous, and therefore testable.** `useTranslations` works in a
 * synchronous Server Component where `getTranslations` needs an `async` one, and
 * an `async` component cannot be rendered by Testing Library at all. That is the
 * same reason `src/components/map/world-map.tsx` gives, and it is why the pages
 * — which must `await` their params and the content façade — do the awaiting and
 * hand plain data down.
 *
 * **The href is assembled here rather than received.** `tripPath` +
 * `localePathname` are pure functions in `src/i18n/**`, which is where invariant
 * 2 requires every internal URL to be built, and both are free of client
 * JavaScript (`docs/adr/0005-getpathname-sans-le-link-client.md`). The map
 * component receives its `href` instead, but for a different reason: it must
 * render from seven shapes with no i18n module in the graph at all.
 */

/**
 * `<h3>` under a `<h2>` section on the home page, `<h4>` under the country
 * heading of the full listing.
 *
 * A prop rather than a fixed tag: the level of a heading is a property of where
 * it sits, and hard-coding `<h3>` would either skip a level on the listing page
 * or flatten the home page's section. A skipped level is a real navigation
 * defect for a screen-reader user walking a page by heading, and it is invisible
 * to everyone else.
 */
export type TripCardProps = {
  readonly trip: TripEntry;
  readonly locale: Locale;
  readonly headingLevel: 3 | 4;
  /**
   * Whether this card is the journal's newest récit (TIW-19) — the third of the
   * badge's three placements, beside the map's marker and the home banner.
   *
   * **A boolean, decided upstream, and not `freshestTrip(…)` called here.** A card
   * sees one trip and cannot know it is the newest of sixty; more importantly the
   * derivation needs *today*, and a component that read a clock would put the
   * whole rule out of reach of a test (`docs/fraicheur-au-prerendu.md`). The page
   * asks once and marks one card, which is also what makes "and only it" true by
   * construction rather than by every caller remembering.
   */
  readonly isNew?: boolean;
};

export function TripCard({ trip, locale, headingLevel, isNew }: TripCardProps): ReactElement {
  const t = useTranslations("trips");
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const href = localePathname({ href: tripPath(trip.slug), locale });
  /**
   * `countryListOf` and never `join(", ")`: the last separator of a list is a
   * property of the language, and the same two countries were printing
   * "Bolivie, Pérou" here while the map's caption and the trip page both printed
   * "Bolivie et Pérou". The locale is passed explicitly, as everywhere in
   * `./format`.
   */
  const countryList = countryListOf(locale, trip.countryCodes);

  return (
    <article className={styles.card}>
      <div className={styles.thumbnail}>
        {trip.coverPhotoSrc === undefined ? (
          // Decorative by construction: it carries no information a reader could
          // be deprived of, so it says nothing rather than saying "no photo".
          <div className={styles.placeholder} aria-hidden="true" />
        ) : (
          /*
            `alt=""`, deliberately, and it is the correct value rather than a
            missing one: the cover repeats the trip whose title is the very next
            thing in the card, so describing it would make a screen reader
            announce the same trip twice. `TripSummary` carries no `alt` for the
            cover either — the photo's own alt text lives on `photos[]`, which
            only the trip page receives — so inventing one here is not on offer.

            A plain `<img>` and not `next/image`: the listing needs no
            responsive art direction, the ratio is locked in CSS so there is no
            layout shift to prevent, and `next/image` would put a client runtime
            on a page that ships none. `loading="lazy"` is what keeps sixty
            covers off the critical path.
          */
          /*
            `@next/next/no-img-element` advises `next/image` for LCP and
            bandwidth. It is refused here, once, with the reason recorded rather
            than left as a warning that invites the next reader to "fix" it:
            `next/image` is a client component, so it would register a client
            reference on a page that ships zero byte of JavaScript today and
            whose acceptance criterion is that it stays readable without any.
            The two things the rule is really about are handled — the ratio is
            locked in CSS so there is no layout shift, and `loading="lazy"` keeps
            sixty covers off the critical path. Revisit it the day the project
            takes a considered decision about image optimisation, which is
            TIW-17's neighbourhood and not this ticket's.
          */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.image}
            src={trip.coverPhotoSrc}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
      </div>

      <div className={styles.body}>
        {/*
          **Real text, and it is the whole accessibility of this badge.** The
          acceptance criterion is explicit: a distinction carried by an animation
          or by a colour does not exist for half the readers. So the badge is a
          `<p>` holding a sentence, before the title, and a screen reader meets
          "Nouveau récit" then the trip — the order a reader scanning the card
          reads it in. Its styling is a chip; remove every rule in
          `trip-card.module.css` and the information is still there.

          Not `aria-label`, not a `::before` with `content:`, not a
          `visually-hidden` twin of a coloured dot — the first is a string no
          translator sees in context, the second is text a screen reader may or
          may not announce depending on the engine, and the third is two copies of
          one string to keep in step. This repository has taken the same decision
          three times: see the map marker's label.
        */}
        {isNew === true ? <p className={styles.badge}>{t("cardNew")}</p> : null}

        <Heading className={styles.title}>
          <a className={styles.link} href={href}>
            {trip.title}
          </a>
        </Heading>

        {/*
          Three facts, as a list rather than one sentence: a screen reader then
          announces them as three items instead of running "Japon 12–26 avril
          2024 11 jours" together, and the separators stay a border in CSS rather
          than punctuation someone has to hear. `role="list"` for the Safari /
          VoiceOver reason recorded on the map's marker list — `list-style: none`
          strips the role there, and jsdom cannot see it.
        */}
        <ul className={styles.meta} role="list">
          {/*
            Tested on `countryCodes` and not on the formatted string: an empty
            list formats to `""`, and `"" ? … : null` would work by accident
            while reading as a test of the wrong thing.
          */}
          {trip.countryCodes.length > 0 ? <li>{countryList}</li> : null}
          <li>{formatDateRange(locale, trip.startDate, trip.endDate)}</li>
          <li>{t("cardDuration", { days: trip.duration.days })}</li>
        </ul>

        {/*
          Visible affordance, not a control: the title above is the link, and
          `.link::after` makes this whole card its target. See the long note on
          `.cta` in the stylesheet for why a second `<a>` here would cost sixty
          duplicate tab stops and sixty identical link names.
        */}
        <span className={styles.cta} aria-hidden="true">
          {t("cardRead")}
        </span>
      </div>
    </article>
  );
}
