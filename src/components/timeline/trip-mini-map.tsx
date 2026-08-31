import type { CSSProperties, ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { miniMapFrame } from "./mini-map-frame";
import styles from "./trip-mini-map.module.css";

/**
 * The map of **one** trip, framed on that trip.
 *
 * **Why this is not `<WorldMap>`.** Three reasons, in increasing order of how
 * much they cost to work around.
 *
 * 1. Its caption is the world map's caption. `t("map.summary")` renders
 *    "Carte du monde : 4 voyages, 2 pays" — and on this page those four things
 *    are *places in one trip*, not four trips. Same for `map.markListLabel`
 *    ("Voyages sur la carte, du plus récent au plus ancien"). Both are read
 *    aloud. A mini-map borrowing them states a falsehood to precisely the reader
 *    who cannot check it against the picture.
 * 2. Its markers are anonymous dots, because on the world map each one is a
 *    different trip. Here they are the stops of a single itinerary, so they are
 *    numbered and joined by the route line drawn below — which is the whole
 *    reason a per-trip map is worth having.
 * 3. Fixing either would mean editing `src/components/map/**`, which this ticket
 *    does not own.
 *
 * **A separate, duller obstacle, recorded because it is a repository defect
 * rather than a design choice:** `@/components/map/world-map` cannot be imported
 * from anywhere today. The ESLint pattern sealing the map geometry façade is
 * `["@/map/*", "**\/map/*"]`, and `**\/map/*` matches `@/components/map/frame`
 * exactly as it matches `@/map/world`. Nothing had imported the map component
 * yet, so nobody had hit it. It is reported rather than patched here.
 *
 * Zero bytes of JavaScript, like the world map, and by the same construction:
 * the `<svg>` is inert — `aria-hidden`, no `tabindex`, no `:hover`,
 * `pointer-events: none` — and every interactive thing on it is an HTML `<a>` in
 * a layer above, positioned in percentages. See
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md`.
 */

/** Declared structurally rather than imported from `@/map`: that module carries
 * `import "server-only"`, which throws under Vitest. `CountryShape` is
 * assignable to this, so the page passes its geometry straight through. */
export type MiniMapCountry = {
  readonly code: string | null;
  readonly path: string;
  readonly name: string;
};

export type MiniMapMark = {
  readonly placeSlug: string;
  readonly placeName: string;
  /** Where this marker leads: the world map, framed on this trip. */
  readonly href: string;
  readonly point: { readonly x: number; readonly y: number };
};

export type TripMiniMapProps = {
  readonly countries: readonly MiniMapCountry[];
  readonly visited: readonly MiniMapCountry[];
  readonly marks: readonly MiniMapMark[];
  /**
   * Place slug → its 1-based position in the itinerary, the **same map** the
   * timeline is given.
   *
   * Passed in rather than taken from the index of `marks`, and the difference is
   * not theoretical: `marks` has already been filtered by `projectPoint`, so a
   * place with no projection shortens it. The badge would then read 1, 2 while
   * the timeline beside it reads 1, 3 — two numberings for one itinerary, on the
   * same screen. Unreachable today (Natural Earth I clips nothing), which is
   * exactly why it would have been found the hard way.
   */
  readonly stopNumbers: ReadonlyMap<string, number>;
  readonly world: { readonly width: number; readonly height: number };
};

type MarkStyle = CSSProperties & Record<"--mark-left" | "--mark-top", string>;
type CanvasStyle = CSSProperties & Record<"--frame-aspect", string>;

const DECIMALS = 2;
const round = (value: number): number => Number(value.toFixed(DECIMALS));

const shapeKey = (country: MiniMapCountry, index: number): string =>
  `${country.code ?? "unassigned"}-${index}`;

/**
 * The itinerary as one polyline, in the order the trip travels.
 *
 * Decorative: it lives inside the `aria-hidden` SVG, and the ordered meaning it
 * draws is carried in text by the numbered list of markers above it. Drawing a
 * line between two markers is the one thing that turns four dots into a journey,
 * and it is exactly what the world map must *not* do — there, consecutive
 * markers are unrelated trips.
 */
function routePath(marks: readonly MiniMapMark[], worldWidth: number): string | null {
  if (marks.length < 2) {
    return null;
  }

  /**
   * **Nothing is drawn when a leg crosses the antimeridian**, and refusing to
   * draw is the honest answer rather than a missing feature.
   *
   * An equirectangular projection cuts the world at ±180°, so two points either
   * side of it are at opposite edges of the canvas. Measured with Auckland
   * (174.76°E) and the Chatham Islands (176.56°W) — 800 km apart, **the same
   * country**, so entirely plausible content: the markers land at 95.3 % and
   * 5.6 % of the width, and a straight line between them crossed Australia,
   * Africa and the Atlantic. The reader was shown a westward flight that never
   * happened. Fiji↔Samoa and Chukotka↔Alaska do the same.
   *
   * A wrapped polyline — two segments leaving opposite edges — is the real fix
   * and it belongs with the framing, which has the same limitation and is where
   * the wrap would have to be decided. Until then the order is not lost: the
   * numbered list of markers carries it in text, which is the channel that
   * matters, and this line is decorative inside an `aria-hidden` SVG.
   *
   * Half the world is the threshold because a shorter route is never ambiguous:
   * the shortest path between two points less than 180° apart does not cross the
   * cut.
   */
  const crossesTheCut = marks.some((mark, index) => {
    if (index === 0) {
      return false;
    }

    const previous = marks[index - 1];

    return previous !== undefined && Math.abs(mark.point.x - previous.point.x) > worldWidth / 2;
  });

  if (crossesTheCut) {
    return null;
  }

  return marks
    .map(({ point }, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
}

export function TripMiniMap({
  countries,
  visited,
  marks,
  stopNumbers,
  world,
}: TripMiniMapProps): ReactElement {
  const t = useTranslations("trip");
  const locale = useLocale();

  const frame = miniMapFrame(
    marks.map((mark) => mark.point),
    world
  );

  const placed = marks
    .filter(({ point }) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((mark) => ({
      mark,
      leftPercent: round(((mark.point.x - frame.x) / frame.width) * 100),
      topPercent: round(((mark.point.y - frame.y) / frame.height) * 100),
    }));

  const route = routePath(marks, world.width);

  /**
   * The container's aspect ratio must equal the `viewBox`'s, exactly, or
   * `preserveAspectRatio` letterboxes the SVG and every percentage-positioned
   * marker drifts off the place it names. This is the one inline `style` of the
   * layer and it is irreducible: a number computed at build time has no other
   * route into a CSS declaration without JavaScript.
   */
  const canvasStyle: CanvasStyle = {
    "--frame-aspect": `${frame.width} / ${frame.height}`,
  };

  return (
    <figure className={styles.figure}>
      <div className={styles.canvas} style={canvasStyle}>
        <svg className={styles.map} viewBox={frame.viewBox} aria-hidden="true" focusable="false">
          <g className={styles.land}>
            {countries.map((country, index) => (
              <path key={shapeKey(country, index)} d={country.path} />
            ))}
          </g>
          {/* Drawn again on top rather than tinted in place — the second pass is
              what stops a visited border being overpainted by a neighbour. */}
          <g className={styles.visited}>
            {visited.map((country, index) => (
              <path key={shapeKey(country, index)} d={country.path} />
            ))}
          </g>
          {route === null ? null : <path className={styles.route} d={route} />}
        </svg>

        {placed.length > 0 ? (
          <ol
            className={styles.marks}
            aria-label={t("mapMarkListLabel")}
            /* `list-style: none` strips the list role in Safari with VoiceOver,
               and a list that loses its role loses the label above and its item
               count with it. jsdom keeps the role either way, so no unit test
               here can see this. */
            role="list"
          >
            {placed.map(({ mark, leftPercent, topPercent }) => {
              const markStyle: MarkStyle = {
                "--mark-left": `${leftPercent}%`,
                "--mark-top": `${topPercent}%`,
              };

              return (
                <li
                  key={mark.placeSlug}
                  className={styles.mark}
                  style={markStyle}
                  /* The seam TIW-14 needs. The same `data-place` is on the
                     matching timeline step, so highlighting "the point for the
                     step being read" is a query rather than a new data
                     structure — and it is in the DOM today, with no JavaScript
                     to make it true. */
                  data-place={mark.placeSlug}
                >
                  <a className={styles.link} href={mark.href}>
                    {/* The order of the stop, visible. Anonymous dots are right
                        for the world map, where neighbours are unrelated trips;
                        here they are stops 1 to n of one itinerary. */}
                    <span className={styles.badge} aria-hidden="true">
                      {stopNumbers.get(mark.placeSlug)}
                    </span>
                    {/* Real text, visually hidden — not an `aria-label` on an
                        empty link. An attribute is a string no translator sees
                        in context and no tool finds in the DOM. Hidden with
                        `clip-path`, never `display: none`, which would take it
                        out of the accessibility tree and leave the link
                        unnamed. */}
                    <span className={styles.visuallyHidden}>
                      {t("mapMarkLabel", { place: mark.placeName })}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      {/* Counted from what the page published, not from `placed`: a marker the
          frame could not position must not quietly shrink the number the reader
          is given. `Intl.ListFormat` and not `join(", ")` — the separator and
          the final conjunction are properties of the language. */}
      <figcaption className={styles.caption}>
        {t("mapCaption", {
          places: marks.length,
          countries: visited.length,
          names: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
            visited.map((country) => country.name)
          ),
        })}
      </figcaption>
    </figure>
  );
}
