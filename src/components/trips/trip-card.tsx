import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { hasStory } from "@/domain/trip";
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
  /**
   * **Whether this card links anywhere at all** (TIW-18).
   *
   * A trip whose récit is not written has no page: `tripStaticParams` leaves it
   * out of the build, so `/voyages/<slug>` is an immediate 404. `href` is
   * therefore computed inside this branch and not above it — a `const href` at the
   * top would be a dead address sitting in scope, waiting for the next edit to
   * render it.
   *
   * What the card shows instead is « Récit à venir » as **announced** text, which
   * is the one exception to the rule the rest of this file follows. `.cta` and the
   * fallback tile are `aria-hidden` because the link beside them already says what
   * they say; here there *is* no link, so this notice is the only thing that tells
   * a reader why the entry goes nowhere.
   */
  const told = hasStory(trip);
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
          /*
            **The fallback tile** (TIW-18), where a token gradient used to be.

            That gradient was the "emplacement gris" the acceptance criterion
            refuses by name: `aria-hidden`, carrying nothing, and three cards out
            of four on the populated listing. The criterion offers two shapes and
            the other one — a mini-map of the route — is out on the document
            budget rather than on taste: a drawing needs country shapes, ADR 0003
            refuses to prune them because that makes the geometry depend on the
            content, and the world's paths measure 30.1 KB brotli *once* in a
            document against a 100 KB budget. Sixty cards do not fit in that, and
            a route polyline with no coastline under it is not a map.

            So a typographic tile: the country, and the year. **Not the title**,
            which the criterion names and which is deliberately left out — the
            card's heading is the very next element, and a tile repeating it reads
            as a rendering fault rather than as a design.

            Still `aria-hidden`, and for the reason `.cta` is: every word in it is
            already in the card's own facts — the country in the list below, the
            year inside the date range — so announcing it would say the same two
            things twice. What changed is not what a screen reader hears; it is
            that a reader who *sees* the card is no longer shown a blank rectangle
            where a photograph would be.
          */
          <p className={styles.tile} aria-hidden="true">
            {/* Omitted rather than rendered blank for an empty list — unreachable
                through the façade (`TripSchema` demands a place) but the tile must
                degrade to the year, never to an empty line. Same posture as the
                countries fact below. */}
            {trip.countryCodes.length > 0 ? (
              <span className={styles.tileCountry}>{countryList}</span>
            ) : null}
            {/* `slice(0, 4)` on a `YYYY-MM-DD` and never a `Date`: the domain's
                rule about calendar days applies here too, and a `Date` would shift
                the year by one across a timezone on a 1 January departure. */}
            <span className={styles.tileYear}>{trip.startDate.slice(0, 4)}</span>
          </p>
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
        {/*
          `isNew === true && told`, and the second half is not belt-and-braces
          decoration. Through the real pipeline the pair cannot occur —
          `freshestTrip` skips untold trips before it compares — but this component
          takes a boolean from a caller, and the two props are independent at this
          boundary. A card saying « Nouveau récit » above « Récit à venir » would
          be contradicting itself in two adjacent lines.
        */}
        {isNew === true && told ? <p className={styles.badge}>{t("cardNew")}</p> : null}

        <Heading className={styles.title}>
          {told ? (
            <a className={styles.link} href={localePathname({ href: tripPath(trip.slug), locale })}>
              {trip.title}
            </a>
          ) : (
            /*
              **No anchor at all**, and not an `<a>` without an `href`.

              The distinction is the acceptance criterion: an anchor with no href
              has no link role, so it would satisfy "no link is rendered" while
              still being an element the card-wide `.link::after` overlay turns
              into a click target answering nothing. The heading survives — a
              listing walked by heading is how sixty entries get scanned — and only
              the affordance goes.
            */
            <span className={styles.titleText}>{trip.title}</span>
          )}
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

        {told ? (
          /*
            Visible affordance, not a control: the title above is the link, and
            `.link::after` makes this whole card its target. See the long note on
            `.cta` in the stylesheet for why a second `<a>` here would cost sixty
            duplicate tab stops and sixty identical link names.
          */
          <span className={styles.cta} aria-hidden="true">
            {t("cardRead")}
          </span>
        ) : (
          /*
            **The one announced decoration on this card**, and the exception is
            deliberate. `.cta` and the fallback tile are `aria-hidden` because the
            link beside them already says what they say; this card has no link, so
            this sentence is the only thing that tells a reader why the entry leads
            nowhere. Hidden, a screen reader would get a title, three facts and no
            explanation.

            "Lire le récit" is replaced rather than joined: the two side by side
            would be the card contradicting itself.
          */
          <p className={styles.pending}>{t("cardStoryToCome")}</p>
        )}
      </div>
    </article>
  );
}
