import type { ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { formatDay, formatDayRange, machineDate } from "./dates";
import type { TimelineMove, TimelineStay, TimelineStep } from "./steps";
import { TransportIcon } from "./transport-icon";
import styles from "./trip-timeline.module.css";

/**
 * The body of the page: the steps, in the order the trip travelled them.
 *
 * **Three things this component is careful about.**
 *
 * 1. *Every heading is an anchor target, and the anchor is copyable.* The link
 *    beside each heading is a real `<a href="#…">` with real text in it, not an
 *    `aria-label` on a `#` glyph — see the comment on the link below.
 * 2. *A transport mode is never an icon alone.* The pictogram is `aria-hidden`
 *    and always sits beside the mode's name from the catalogue. A drawing of a
 *    bus means "bus" only to a reader who already knows the convention, and
 *    means nothing at all to a screen reader.
 * 3. *The DOM carries the step ↔ marker correspondence.* Each item is tagged
 *    with the place slugs it involves, and a stay shows the same stop number as
 *    its marker on the mini-map. This is the structural half of the "timeline
 *    and map stay in sync" criterion; the interactive half needs client
 *    JavaScript and belongs to TIW-14, which owns the map's `'use client'`
 *    budget. Nothing here has to change for it to be wired up.
 *
 * **Where a step's prose would go.** Nowhere, today: `StaySchema` is
 * `{ kind, placeSlug, startDate, endDate }` and `strictObject`, so there is no
 * field to render and no way for an author to write one. See the ticket report
 * for the MDX spike this ticket ran and what it concluded.
 */

export type TripTimelineProps = {
  readonly steps: readonly TimelineStep[];
  /**
   * Place slug → its 1-based position in the itinerary, so a stay wears the same
   * number as its marker on the mini-map. Passed in rather than recomputed here:
   * one derivation, used by both components, cannot disagree with itself.
   */
  readonly stopNumbers: ReadonlyMap<string, number>;
};

/** The text of the heading, reused as the anchor link's accessible name so the
 * two never describe different steps. */
function headingText(step: TimelineStep, t: ReturnType<typeof useTranslations<"trip">>): string {
  return step.kind === "stay"
    ? t("stayHeading", { place: step.place.name })
    : t("moveHeading", { from: step.from.name, to: step.to.name });
}

/**
 * The rendered width of a photo inside a step, told to the browser so it picks
 * the right rung of the derivative ladder.
 *
 * Derived, not guessed: the reading column is `68ch` — ~34 rem at the default
 * font size — the marker gutter and its gap take 3 rem of it, and the grid's
 * `minmax(min(100%, 14rem), 1fr)` then fits two tracks of ~15 rem in the 31 rem
 * that are left. Below that the grid collapses to one track the width of the
 * column, which on a phone is the viewport less `main`'s 1.5 rem of padding on
 * each side and the gutter. 480 px covers 15 rem at 1×, 960 px at 2×.
 */
const STAY_PHOTO_SIZES = "(min-width: 37rem) 15rem, calc(100vw - 6rem)";

function StayBody({ step, locale }: { step: TimelineStay; locale: string }): ReactElement {
  const t = useTranslations("trip");
  const range = formatDayRange(step.startDate, step.endDate, locale);

  return (
    <>
      <p className={styles.meta}>
        {t.rich("stayMeta", {
          start: range.start,
          end: range.end,
          nights: step.nights,
          from: (chunks) => <time dateTime={machineDate(step.startDate)}>{chunks}</time>,
          to: (chunks) => <time dateTime={machineDate(step.endDate)}>{chunks}</time>,
        })}
      </p>

      {/*
        The photos taken here, inside the step rather than in the trip's gallery
        at the bottom of the page — which is the whole point of a photo declaring
        a `placeSlug`. Omitted rather than rendered empty: most stays have none,
        and an empty grid would add a `list, 0 items` announcement to every one of
        them.

        Same component as the trip's gallery, and the same numbering: each `<a>`
        carries its index in the page's single viewer, so the arrows walk from a
        step's photo into the gallery's without a seam. See `collection.ts`.
      */}
      {step.photos.length > 0 ? (
        <div className={styles.photos}>
          <PhotoGallery
            /* `anchor` is unique per step by construction (`stepAnchors`), so no
               two grids on the page can share an `id`. */
            id={`${step.anchor}-photos`}
            photos={step.photos}
            sizes={STAY_PHOTO_SIZES}
          />
        </div>
      ) : null}
    </>
  );
}

function MoveBody({ step, locale }: { step: TimelineMove; locale: string }): ReactElement {
  const t = useTranslations("trip");

  return (
    <>
      <p className={styles.meta}>
        {t.rich("moveMeta", {
          date: formatDay(step.date, locale),
          on: (chunks) => <time dateTime={machineDate(step.date)}>{chunks}</time>,
        })}
      </p>
      <p className={styles.transport}>
        <TransportIcon mode={step.mode} className={styles.icon} />
        {/*
          « Transport : Avion » read aloud before the pill, so a screen reader
          hears a labelled value rather than a bare noun floating after a date.
          The whole sentence is one message, and the visible pill is the one that
          steps out of the accessibility tree.

          It used to be a hidden `{t("transportTerm")} : ` beside a read label,
          which put a *language rule* in the JSX: the space before a colon is a
          French typographic convention, and in English the same markup reads
          "Transport : Plane". Interpolating the mode into the message moves the
          punctuation to the one place this project keeps language, and it is why
          the pill becomes `aria-hidden` — otherwise the mode would be announced
          twice, once in the sentence and once on its own.

          What the criterion asks for is untouched: the icon is never alone. The
          mode is still visible text next to it for anyone who can see it, and
          still a real text node — `aria-hidden` hides it from the tree, not from
          the page, and never from `Ctrl+F`.
        */}
        <span className={styles.visuallyHidden}>
          {t("transportAnnounce", { mode: t(`transport.${step.mode}`) })}
        </span>
        <span className={styles.transportLabel} aria-hidden="true">
          {t(`transport.${step.mode}`)}
        </span>
      </p>
    </>
  );
}

export function TripTimeline({ steps, stopNumbers }: TripTimelineProps): ReactElement {
  const t = useTranslations("trip");
  const locale = useLocale();

  return (
    /*
      `role="list"` on an element that already has that role, for the reason
      `tokens.css` and the map's marker list both record: `list-style: none` makes
      Safari drop the list role, and with it "list, 9 items" and the "3 of 9" a
      reader hears at each step. On a twenty-step itinerary that count is the only
      thing telling them where they are.

      This is the list the exception exists for. TIW-16 widened
      `jsx-a11y/no-redundant-roles` from `{ ul: ["list"] }` to include `ol` — and
      then did not use it here, which an audit caught: of the eight lists styled
      `list-style: none` across the two screens, this was the only one missing the
      role. No unit test can see it, jsdom keeps the role either way.
    */
    <ol className={styles.list} role="list">
      {steps.map((step) => {
        const label = headingText(step, t);
        const stop = step.kind === "stay" ? stopNumbers.get(step.place.slug) : undefined;

        return (
          <li
            key={step.anchor}
            className={step.kind === "stay" ? styles.stay : styles.move}
            /* The seam TIW-14 wires the highlighting to. Present in the static
               HTML, so the correspondence is true before any script runs. */
            data-step-anchor={step.anchor}
            data-step-kind={step.kind}
            {...(step.kind === "stay"
              ? { "data-place": step.place.slug }
              : { "data-from": step.from.slug, "data-to": step.to.slug })}
          >
            <span className={styles.marker} aria-hidden="true">
              {step.kind === "stay" ? (
                <span className={styles.badge}>{stop ?? ""}</span>
              ) : (
                <TransportIcon mode={step.mode} className={styles.markerIcon} />
              )}
            </span>

            <div className={styles.body}>
              {/*
               * `id` on the heading itself, so `#etape-2024-04-12-tokyo` scrolls
               * the heading to the top rather than its container's padding edge,
               * and so the fragment names the thing a reader would say they
               * linked to.
               */}
              <h3 className={styles.heading} id={step.anchor}>
                <span className={styles.headingText}>{label}</span>
                {/*
                 * A real link with real text inside it. The visible `#` is
                 * `aria-hidden` and the name comes from a text node, not an
                 * `aria-label` — an attribute is a string no translator ever
                 * sees in context and no tool can find in the DOM. The same
                 * reasoning as the map's markers.
                 */}
                <a className={styles.anchor} href={`#${step.anchor}`}>
                  <span aria-hidden="true">#</span>
                  <span className={styles.visuallyHidden}>
                    {t("stepLinkLabel", { step: label })}
                  </span>
                </a>
              </h3>

              {step.kind === "stay" ? (
                <StayBody step={step} locale={locale} />
              ) : (
                <MoveBody step={step} locale={locale} />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
