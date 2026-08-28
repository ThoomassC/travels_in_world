import type { CSSProperties, ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { frameAround, type WorldBox } from "./frame";
import { placeMarks, spreadCoincident, type TripMark } from "./marks";
import styles from "./world-map.module.css";

/**
 * The world map: 177 country shapes rendered once at build time, with one marker
 * per published trip laid over them.
 *
 * **No `'use client'`, and the omission is the feature.** Everything this
 * component does — crop, tint, place, count — is arithmetic over data the build
 * already has, so it ships as HTML and CSS and costs 0 byte of JavaScript. The
 * measured budget is 120.2 KB brotli of initial JS against a 150 KB ceiling;
 * this ticket spends none of the remaining 30 KB. Zoom, hover panel and trip
 * selection are TIW-14, which owns the map's single sanctioned client boundary.
 *
 * Translations come from `useTranslations`, not `getTranslations`: the former
 * works in a *synchronous* Server Component, which is what keeps the whole
 * component renderable by Testing Library under a `NextIntlClientProvider`. An
 * `async` component with `getTranslations` would have no component test at all.
 *
 * Nothing server-only is imported — not even a type, today, because `@/map` and
 * `@/content/trips` do not exist yet. Note for whoever reads this later: the
 * reason is *availability*, not the `server-only` guard. A `import type` is
 * erased by TypeScript before any resolution happens, so it never reaches the
 * guard and is perfectly legal from here (measured by the geometry ticket). What
 * must never appear in this file is a **value** import of either façade.
 *
 * Every geometry, every URL and every label arrives as a prop, already projected
 * and already localised. That is a design choice independent of the guard: it is
 * what lets the whole map be rendered under jsdom from a seven-shape fixture.
 */

/**
 * What this component reads of a country, and nothing more: an identifier for
 * the React key, a path to render, and a name to say out loud. `@/map` (TIW-12)
 * produces a richer `CountryShape` — it also carries the numeric ISO id — and
 * structural typing makes it assignable to this without a line of adaptation.
 *
 * Narrowing rather than re-declaring is the point. The type states exactly what
 * is consumed, and `src/app/[locale]/page.tsx`, the one place that holds both
 * this type and the real `CountryShape`, is where a rename upstream fails
 * `npm run typecheck`. There is no second declaration of the contract to drift
 * from the first.
 */
export type MapCountry = {
  /** ISO 3166-1 alpha-2, or `null` for the 3 territories the 110m set leaves unidentified. */
  readonly code: string | null;
  /** The `d` attribute, already projected into the 960 × 500 box. */
  readonly path: string;
  /**
   * Localised name, already resolved upstream by `Intl.DisplayNames`.
   *
   * Read **only** for the visited countries, and only to name them in text under
   * the caption. That is not decoration: without it, which countries hold a trip
   * is carried by the tint alone — a distinction measured at 1.16:1 — so a
   * screen reader learns "7 countries" and never which seven (WCAG 1.1.1), and
   * no reader gets the information without colour (1.4.1). The drawing itself
   * never reads this field; a `<path>` inside an `aria-hidden` SVG has nothing
   * to say.
   */
  readonly name: string;
};

export type WorldMapProps = {
  /** The 177 geometries, background layer, in dataset order. */
  readonly countries: readonly MapCountry[];
  /** The tinted subset: countries holding at least one trip. */
  readonly visited: readonly MapCountry[];
  /** One marker per published trip, already projected and already sorted upstream. */
  readonly marks: readonly TripMark[];
  /** The projected world box — `{ width: 960, height: 500 }` in production. */
  readonly world: WorldBox;
};

/**
 * A custom property is the only channel a build-time number has into CSS, and
 * naming the three of them in the type is what lets the object literal be
 * written without a cast: React's `CSSProperties` is closed (its index signature
 * was removed on purpose), so `style={{ "--mark-left": … }}` alone does not
 * typecheck and the usual workaround is an `as CSSProperties` that silences
 * every other typo in the same literal.
 */
type MarkStyle = CSSProperties & Record<"--mark-left" | "--mark-top" | "--mark-order", string>;

/** Same reasoning, for the one value the container needs. */
type CanvasStyle = CSSProperties & Record<"--frame-aspect", string>;

/**
 * React needs a key per shape, and `code` alone cannot be it: three entries of
 * the 110m set have `code: null`, so they would collide on the same key and
 * React would keep only one of the three paths. `name` is not a contract either
 * — it is a localised string. The index is the honest identity here: `countries`
 * is a build-time constant rendered in dataset order, never filtered, never
 * reordered and never re-rendered on the client, so position *is* stable. The
 * code is prefixed for readability of the DOM, not for uniqueness.
 */
const shapeKey = (country: MapCountry, index: number): string =>
  `${country.code ?? "unassigned"}-${index}`;

export function WorldMap({ countries, visited, marks, world }: WorldMapProps): ReactElement {
  const t = useTranslations("map");
  const locale = useLocale();

  // The frame is derived, not received: the component is the only place that
  // knows both the markers and the world, and a `Frame` in props would let a
  // caller hand over a viewBox that disagrees with the marker percentages.
  const frame = frameAround(
    marks.map((mark) => mark.point),
    world
  );
  /**
   * Two trips leaving from the same city land on the same pixel, and the second
   * `<a>` then buries the first: 44 px of target that answers no click. The
   * spread nudges coincident markers onto a small circle so each keeps some
   * exposed area. It is a mitigation, not a separation — see `spreadCoincident`.
   */
  const placed = spreadCoincident(placeMarks(marks, frame), frame);

  /**
   * The container's aspect ratio must be the frame's, *exactly*. Any other ratio
   * makes `preserveAspectRatio` letterbox the SVG inside its box, and since the
   * markers are positioned in percentages of the box rather than of the drawing,
   * every one of them then drifts off the country it names.
   *
   * `frame.width` and `frame.height` are the very numbers `frame.viewBox` is
   * formatted from — both already rounded to one decimal by `frameAround` — so
   * the two cannot disagree. Using `world` here instead would be the bug.
   */
  const canvasStyle: CanvasStyle = { "--frame-aspect": `${frame.width} / ${frame.height}` };

  return (
    <figure className={styles.figure}>
      <div className={styles.canvas} style={canvasStyle}>
        {/*
          Inert by construction rather than by a list of CSS rules. 177 country
          shapes have nothing to say to a screen reader — the map's textual
          equivalent is TIW-15 — and hiding the whole SVG is what makes the
          acceptance criterion "the other countries are neutral, not focusable
          and have no hover state" true without relying on anyone remembering to
          leave out a `tabindex` or a `:hover`. `pointer-events: none` on the
          element completes it: a tint is information, not an affordance.
        */}
        <svg className={styles.map} viewBox={frame.viewBox} aria-hidden="true" focusable="false">
          <g className={styles.land}>
            {countries.map((country, index) => (
              <path key={shapeKey(country, index)} d={country.path} />
            ))}
          </g>
          {/*
            The visited countries are drawn *again* on top rather than tinted in
            place. Splitting the loop would mean testing `visited` membership per
            shape — a lookup the content façade has already done — and the second
            pass is what keeps a tinted border from being overpainted by a
            neighbour drawn after it.
          */}
          <g className={styles.visited}>
            {visited.map((country, index) => (
              <path key={shapeKey(country, index)} d={country.path} />
            ))}
          </g>
        </svg>

        {/*
          An empty list is worse than no list: a labelled `<ul>` with nothing in
          it announces "trips on the map, list, 0 items" for a map that is simply
          not populated yet. The caption below already states the truth.
        */}
        {placed.length > 0 ? (
          <ul
            className={styles.marks}
            aria-label={t("markListLabel")}
            /*
              `role="list"` is redundant markup that is NOT redundant in practice:
              `list-style: none` strips the list role in Safari with VoiceOver, and
              a list that has lost its role also loses the `aria-label` above and
              its item count — exactly what a reader landing among sixty links
              needs. jsdom keeps the role either way, so no unit test can see this.
            */
            role="list"
          >
            {placed.map(({ mark, leftPercent, topPercent }, index) => {
              /**
               * DOM order is `marks` order — `startDate` descending, then `slug`
               * — so the most recent trip is the first tab stop. `--mark-order`
               * inverts that for painting: absolutely positioned siblings paint
               * in DOM order, which would put the first-tabbed marker *under*
               * every later one. The reader would then click the oldest trip of
               * an overlapping pair while the keyboard reached the newest first.
               */
              const markStyle: MarkStyle = {
                "--mark-left": `${leftPercent}%`,
                "--mark-top": `${topPercent}%`,
                "--mark-order": String(placed.length - index),
              };

              return (
                <li key={mark.slug} className={styles.mark} style={markStyle}>
                  {/*
                    `mark.href` is rendered as-is, in a bare `<a>`. The locale
                    prefix is the page's job (`@/i18n/navigation`); this
                    component builds no URL, which is also why importing
                    `next/link` here would be both banned and pointless.
                  */}
                  <a className={styles.link} href={mark.href}>
                    <span className={styles.dot} aria-hidden="true" />
                    {/*
                      Real text, visually hidden — not an `aria-label` on an
                      empty link. The reason is NOT voice control: the text is
                      not visible either way, so nobody can pronounce what they
                      see. It is that an `aria-label` is an attribute, and an
                      attribute is a string a translator never sees in context
                      and a tool cannot find in the DOM. This stays a text node
                      that comes from the message catalogue.

                      The hiding uses `clip-path`, never `display: none` nor
                      `visibility: hidden`: those two remove the text from the
                      accessibility tree and the link goes back to being unnamed.
                    */}
                    <span className={styles.visuallyHidden}>
                      {t("markLabel", { title: mark.title, place: mark.placeName })}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/*
        `<figcaption>`, not a paragraph next to the map: the counter is the
        map's factual caption, and the association is what lets a screen reader
        announce the figure with its count instead of stranding a bare number.
        Counted from `marks` and `visited` — what the page published — not from
        `placed`, so a marker the frame could not place cannot quietly shrink the
        number the reader is told.
      */}
      <figcaption className={styles.caption}>
        {t("summary", { trips: marks.length, countries: visited.length })}
        {/*
          Which countries, and not just how many.

          Without this line the identity of the visited countries exists nowhere
          but in the tint. The caption gives a *number*; a marker's name gives a
          trip title and the arrival of its first step only — a trip crossing
          three countries tints three and names one. So a screen reader hears
          "7 pays" and never learns which seven (WCAG 1.1.1), and the tinted-land
          distinction, measured at 1.16:1 in the light theme, is not a
          distinction at all for a reader with reduced colour vision (1.4.1).

          Visually hidden rather than printed: the acceptance criterion asks the
          caption for two figures, and forty country names would drown them. The
          non-colour visual channel that 1.4.1 also needs is carried by the
          heavier outline on `.visited path`, not by this text. The map's full
          textual equivalent — trips, steps, itineraries — is TIW-15; an
          enumeration of countries is not that, it is the missing half of a
          counter.

          `Intl.ListFormat` rather than `join(", ")`: the separator and the final
          conjunction are a property of the language, and the list is already
          sorted by localised name upstream.
        */}
        {visited.length > 0 ? (
          <span className={styles.visuallyHidden}>
            {t("visitedCountries", {
              countries: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
                visited.map((country) => country.name)
              ),
            })}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
