import type { ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
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
function headingText(
  step: TimelineStep,
  t: ReturnType<typeof useTranslations<"trip">>
): string {
  return step.kind === "stay"
    ? t("stayHeading", { place: step.place.name })
    : t("moveHeading", { from: step.from.name, to: step.to.name });
}

function StayBody({ step, locale }: { step: TimelineStay; locale: string }): ReactElement {
  const t = useTranslations("trip");
  const range = formatDayRange(step.startDate, step.endDate, locale);

  return (
    <p className={styles.meta}>
      {t.rich("stayMeta", {
        start: range.start,
        end: range.end,
        nights: step.nights,
        from: (chunks) => <time dateTime={machineDate(step.startDate)}>{chunks}</time>,
        to: (chunks) => <time dateTime={machineDate(step.endDate)}>{chunks}</time>,
      })}
    </p>
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
        {/* "Transport : " read aloud before the mode, so a screen reader hears a
            labelled value rather than a bare noun floating after a date. Hidden
            visually because the icon already carries that meaning for anyone who
            can see it. */}
        <span className={styles.visuallyHidden}>{t("transportTerm")} : </span>
        <span className={styles.transportLabel}>{t(`transport.${step.mode}`)}</span>
      </p>
    </>
  );
}

export function TripTimeline({ steps, stopNumbers }: TripTimelineProps): ReactElement {
  const t = useTranslations("trip");
  const locale = useLocale();

  return (
    <ol className={styles.list}>
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
