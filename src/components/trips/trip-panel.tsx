import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { PhotoFigure } from "@/components/photos/photo-figure";
import type { PhotoView } from "@/components/photos/photo-figure";
import { hasStory } from "@/domain/trip";
import { localePathname } from "@/i18n/pathname";
import { tripPath, tripsPath } from "@/i18n/paths";
import type { Locale } from "@/i18n/routing";
import type { TripEntry } from "./entry";
import { countryListOf, formatDateRange } from "./format";
import styles from "./trip-panel.module.css";

/**
 * The body of the map panel, once a marker names ONE trip.
 *
 * **What changed, and why this component exists.** Clicking a marker used to
 * open a panel listing every trip near that point — « Les 6 voyages à cet
 * endroit » — which answered a question nobody had asked: the reader had already
 * picked a place. The owner's words are the whole specification: « quand je clique
 * sur un voyage je veux le descriptif avec les photos du voyage, pas les autres
 * voyages du pays. »
 *
 * **What "le descriptif" is, exactly.** `src/domain/schema.ts` has no prose field
 * — no summary, no excerpt, no teaser — so a description assembled here would be
 * a field invented in a component. What the content model does hold is countries,
 * dates, duration, places and photos, and that is what this renders. The day a
 * prose field is authored, it arrives through `TripEntry` and lands above the
 * facts; nothing here has to be undone for that.
 *
 * **Synchronous, and therefore testable.** `useTranslations` works in a
 * synchronous Server Component where `getTranslations` needs an `async` one, and
 * an `async` component cannot be rendered by Testing Library at all — the reason
 * `trip-card.tsx` and `world-map.tsx` already record. No `'use client'`: this is
 * HTML and CSS, and the project's client budget of three is spent
 * (`AGENTS.md`).
 *
 * **Nothing of `@/map` or `@/content/trips` is imported as a value.** The panel
 * is assembled by the page, which already holds both; the `import type` lines
 * above are erased before module resolution, so this layer still renders under
 * jsdom from a literal.
 */

/**
 * The `sizes` the thumbnails are told, derived from the panel's own geometry
 * rather than guessed.
 *
 * The panel is `min(24rem, 42vw)` from 769 px up and the full viewport below —
 * `world-map.module.css`, `.panel` — its body pads `var(--space-3)` on each side
 * (1.5 rem total) and the strip is three tracks with two `var(--space-2)` gaps
 * (1 rem). So a track is `(24rem - 2.5rem) / 3 ≈ 7.17rem` on a wide screen and
 * `(100vw - 2.5rem) / 3 ≈ 33vw` on a narrow one.
 *
 * Both figures are rounded UP, never down: over-stating `sizes` makes the browser
 * pick a rung it did not strictly need, under-stating it makes the browser pick a
 * rung too small and paint a blurred photograph — the one failure of a `srcset`
 * that shows as a bug rather than as bytes.
 */
const PANEL_PHOTO_SIZES = "(min-width: 769px) 7.5rem, 34vw";

export type TripPanelProps = {
  /** The same narrowed type `TripCard` takes — see `./entry`. */
  readonly trip: TripEntry;
  readonly locale: Locale;
  /** The cities in itinerary order, resolved by the page. */
  readonly cityNames: readonly string[];
  /** Already ordered and capped by `panelPhotos`. Empty is the ordinary state. */
  readonly photos: readonly PhotoView[];
};

export function TripPanel({ trip, locale, cityNames, photos }: TripPanelProps): ReactElement {
  const t = useTranslations("trips");
  const tPhotos = useTranslations("photos");

  /**
   * The separator and the final conjunction are properties of the language —
   * "Tokyo, Kyoto et Osaka" in French, "and" in English — so never `join(", ")`.
   * The two options are the ones `src/components/timeline/trip-header.tsx` and
   * `./format` both pass, so the three views of a list on this site are formatted
   * by one rule rather than by three nearby choices.
   */
  const cities = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });

  /**
   * `countryListOf` and `formatDateRange` from `./format`, exactly as the card
   * calls them. Two spellings of one date on one site is drift by construction,
   * and this panel and the card it opens beside show the same trip.
   */
  const countryList = countryListOf(locale, trip.countryCodes);

  /**
   * Whether the trip has a page at all (TIW-18). An untold trip is left out of
   * `tripStaticParams`, so `tripPath(slug)` would be an immediate 404 — which is
   * why the href below is built inside the branch and not above it.
   */
  const told = hasStory(trip);

  return (
    /*
      No heading of any level. The panel's `<h2>` already carries the trip's
      title and is rendered by the map layer, and a `<h3>` follows this body — so
      a heading emitted here would sit between the two and either repeat the
      title or skip a level. A skipped level is a real navigation defect for a
      reader walking the document by heading, and it is invisible to everyone
      else.
    */
    <div className={styles.body}>
      {/*
        Three facts as a list rather than one sentence, the shape `trip-card.tsx`
        settled on: a screen reader announces three items instead of running
        "Japon 12–26 avril 2024 11 jours" together, and the separators stay a
        border in CSS rather than punctuation someone has to hear. `role="list"`
        for the Safari / VoiceOver reason recorded there — `list-style: none`
        strips the role, and jsdom cannot see it.
      */}
      <ul className={styles.facts} role="list">
        {/* Tested on `countryCodes` and not on the formatted string: an empty
            list formats to `""`, and `"" ? … : null` would work by accident. */}
        {trip.countryCodes.length > 0 ? <li>{countryList}</li> : null}
        <li>{formatDateRange(locale, trip.startDate, trip.endDate)}</li>
        <li>{t("cardDuration", { days: trip.duration.days })}</li>
      </ul>

      {/* Omitted rather than rendered as a bare « Villes : » — a label with
          nothing after it is a colon, not a fact. */}
      {cityNames.length > 0 ? (
        <p className={styles.cities}>{t("panelCities", { cities: cities.format(cityNames) })}</p>
      ) : null}

      {/*
        **Omitted entirely when there is no photograph, and with no stand-in
        sentence.** « Pas encore de photos » promises a delivery nobody has
        committed to, and it would be shown on all thirteen trips of this
        repository — a promise repeated thirteen times is a debt, not an
        interface.

        **`PhotoGallery` is deliberately NOT reused here.** It stamps every link
        with `data-photo-index`, which is a contract with `PhotoLightbox`: the
        number promises a viewer will intercept the click. There is no viewer on
        the home page and the client budget forbids adding one, so the attribute
        would be a promise with nothing behind it. What is reused is the part that
        matters — a real `<a href>` to the file, which is the progressive base
        `photo-gallery.tsx` documents and the whole of what a reader wants from a
        thumbnail.
      */}
      {photos.length > 0 ? (
        <ul
          className={styles.photos}
          role="list"
          aria-label={t("panelPhotosLabel", { title: trip.title })}
        >
          {photos.map((photo) => (
            /* `src` and not the index: `TripSchema` refuses two photos sharing a
               source, so it is the content's own primary key for a photo. */
            <li key={photo.src} className={styles.photoItem}>
              <a className={styles.photoLink} href={photo.src}>
                <PhotoFigure
                  photo={photo}
                  sizes={PANEL_PHOTO_SIZES}
                  className={styles.photoImage}
                />
                {/*
                  The link's purpose, as a real text node rather than an
                  `aria-label`. Without it the link is named by the photo's `alt`
                  alone, which describes the picture and says nothing about what
                  activating it does (WCAG 2.4.4).
                */}
                <span className={styles.visuallyHidden}>{tPhotos("openFullSize")}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {told ? (
        /*
          A real `<a>` here, where `trip-card.tsx` renders an `aria-hidden`
          `<span>`. The card can do that because its own title is the link and
          `.link::after` makes the whole card the target; a panel body has no such
          overlay and no linked title above it — the `<h2>` the map renders is
          plain text — so this is the trip's only way to its page.
        */
        <a className={styles.action} href={localePathname({ href: tripPath(trip.slug), locale })}>
          {t("cardRead")}
        </a>
      ) : (
        <>
          {/*
            The one announced notice of this body, and the exception is the same
            one `trip-card.tsx` makes: everything else here is either a fact or a
            link that says what it does, so a reader would otherwise get four
            facts, three photographs and no explanation of why the trip has no
            page.
          */}
          <p className={styles.pending}>{t("cardStoryToCome")}</p>
          {/*
            **The way out of a dead end**, and it fixes a defect rather than
            adding a feature: an untold trip has no page, so its card renders no
            link at all — and its panel therefore left the reader with four facts
            and nowhere to go. All thirteen trips of this repository are in that
            state today.

            The fragment is the listing's own anchor for this trip, so the reader
            lands on the entry they clicked rather than at the top of a page of
            sixty. Assembled with `tripsPath` + `localePathname` like every other
            internal URL of this project (invariant 2 of `AGENTS.md`);
            `tests/e2e/dead-links.populated.spec.ts` is what holds the fragment to
            an id that really exists.
          */}
          <a
            className={styles.action}
            href={localePathname({ href: `${tripsPath()}#voyage-${trip.slug}`, locale })}
          >
            {t("panelSeeInListing")}
          </a>
        </>
      )}
    </div>
  );
}
