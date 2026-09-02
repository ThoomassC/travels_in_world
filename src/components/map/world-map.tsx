import { Fragment, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { frameAround, type WorldBox } from "./frame";
import { MapViewport, type MapViewportZone } from "./map-viewport";
import { placeMarks, spreadCoincident, type TripMark } from "./marks";
import { worldPointOf, zonesOf } from "./zones";
import styles from "./world-map.module.css";

/**
 * The world map: 177 country shapes rendered once at build time, with one marker
 * per published trip laid over them.
 *
 * **Still no `'use client'` here, and that is the point of the split.** Everything
 * this component does — crop, tint, place, group, count — is arithmetic over data
 * the build already has, so all of it ships as HTML and CSS. TIW-14 added an
 * interaction layer *over* this output rather than inside it: `./map-viewport.tsx`
 * is the one client component, it receives the 177 `<path>` elements and the
 * marker list as already-rendered React nodes, and it writes exactly five values
 * — the `<svg>`'s `viewBox` and four custom properties. So a zoom moves the frame
 * and sixty markers without a single path, a single country name or a single
 * marker node entering the client bundle. The measured cost is in that file's
 * header and in the ticket's report.
 *
 * **What a reader without JavaScript still gets, unchanged:** this whole
 * component. The `<svg>` is rendered with the frame `frameAround` chose, every
 * marker is a real `<a href>` to its trip, and `VisitedCountries` lists the
 * destinations beside it. The criterion "the map stays shown in a frozen version
 * and the list of destinations stays usable" was already met before this ticket;
 * nothing here is a fallback built for the occasion.
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
   * **This component no longer reads it**, and the field stays because the type
   * is the narrowing of `@/map`'s `CountryShape` that the joining page checks
   * against — and because `VisitedCountries`, the textual equivalent beside this
   * drawing, reads exactly this field.
   *
   * Until TIW-15 the name was rendered here, as a visually hidden enumeration
   * inside the `<figcaption>`: without it, which countries hold a trip was
   * carried by the tint alone — a distinction measured at 1.16:1 — so a screen
   * reader learnt "7 pays" and never which seven (WCAG 1.1.1). That enumeration
   * is gone because `VisitedCountries` supersedes it on every count: the names
   * are visible rather than hidden, each carries the number of trips that reach
   * it, and each is a link into the listing that holds them. It rendered under
   * exactly the same condition (`visited.length > 0`), so no state loses a
   * channel. Removing it also stops piling forty country names into the
   * `<figure>`'s accessible *name*, which is a label and not a description.
   *
   * The drawing itself has never read this field; a `<path>` inside an
   * `aria-hidden` SVG has nothing to say.
   */
  readonly name: string;
};

export type WorldMapProps = {
  /** The 177 geometries, background layer, in dataset order. */
  readonly countries: readonly MapCountry[];
  /**
   * The tinted subset: countries holding at least one trip **whose récit is
   * written**.
   *
   * Disjoint from `untold` below, and the partition is upstream on purpose. The
   * alternative — `visited` holding every tinted country and `untold` painting
   * over a subset of it — looks tidier and does not work: the dashed stroke's
   * gaps would show the solid stroke underneath, and the two states would render
   * identically. Two lists, no overlap, one paint each.
   */
  readonly visited: readonly MapCountry[];
  /**
   * The countries every one of whose trips is untold (TIW-18) — the third tint.
   *
   * Selected by the page from `untoldOnlyCountryCodes`, which is why this arrives
   * as shapes rather than as a set of codes: the page already holds the geometry
   * façade's tinted subset and is the one place that can partition it. `@/map` is
   * untouched, and the world is projected once.
   *
   * Optional, because a journal where every récit is written is the ordinary case
   * — and the ordinary case must emit no empty `<g>`.
   */
  readonly untold?: readonly MapCountry[];
  /** One marker per published trip, already projected and already sorted upstream. */
  readonly marks: readonly TripMark[];
  /** The projected world box — `{ width: 960, height: 500 }` in production. */
  readonly world: WorldBox;
  /**
   * The body of a trip's row in the selection panel, keyed by slug and **rendered
   * by the page** — a `TripCard` with its cover, its dates and its duration.
   *
   * A `ReactNode` and not trip data, which is the decision that keeps this layer
   * where `docs/adr/0003-carte-svg-inerte-et-balises-html.md` put it. A card needs
   * `Intl` date formatting, the `trips` message namespace and a locale-prefixed
   * href; receiving it already rendered means `src/components/map/**` still
   * imports neither façade, still renders under jsdom from a seven-shape fixture,
   * and still has no second definition of what a trip looks like. It also means
   * the cards travel in the flight payload as markup rather than as code: the
   * client component displays one, and never builds one.
   *
   * Optional, because a map with no panel is a valid map — the component test
   * renders it that way, and a marker then keeps its plain navigation.
   */
  readonly tripCards?: ReadonlyMap<string, ReactNode>;
};

/**
 * A custom property is the only channel a build-time number has into CSS, and
 * naming them in the type is what lets the object literal be written without a
 * cast: React's `CSSProperties` is closed (its index signature was removed on
 * purpose), so `style={{ "--mark-x": … }}` alone does not typecheck and the usual
 * workaround is an `as CSSProperties` that silences every other typo in the same
 * literal.
 *
 * **`--mark-x` / `--mark-y` are world units, not percentages, and that is the
 * change TIW-14 made to this layer.** A percentage is a fraction of one
 * particular frame; the reader now chooses the frame, so a marker's position has
 * to be expressed in the space the frame is cut out of, and the stylesheet
 * re-derives the percentage from the four `--frame-*` values the client component
 * writes. `worldPointOf` is the conversion, and it is applied *after* the
 * coincidence spread — so the nudge that separates two trips leaving the same
 * city becomes a fixed distance on the map and grows as the reader zooms in,
 * which is the real fix the ADR assigned to this ticket.
 */
type MarkStyle = CSSProperties & Record<"--mark-x" | "--mark-y" | "--mark-order", string>;

/** Same reasoning, for the ratio the figure's height cap is derived from. */
type FigureStyle = CSSProperties & Record<"--world-aspect", string>;

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

export function WorldMap({
  countries,
  visited,
  untold = [],
  marks,
  world,
  tripCards,
}: WorldMapProps): ReactElement {
  const t = useTranslations("map");

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
   * Which markers a reader would take for one place, and therefore which trips
   * one activation has to offer. Computed here, at build time, on the frame the
   * server rendered — `zonesOf` records why it is not re-clustered as the reader
   * zooms, and what that buys.
   */
  const zones = zonesOf(placed, frame);
  const zoneOfTrip = new Map(
    zones.flatMap((zone) => zone.marks.map((entry) => [entry.mark.slug, zone.id] as const))
  );

  /**
   * The figure's height cap, which used to live in `src/app/[locale]/page.tsx`'s
   * stylesheet as `.mapFrame`.
   *
   * It moved here for a structural reason and not for tidiness: the panel and the
   * zoom controls are part of the map, so the map is now the thing that owns its
   * own box. `world.width / world.height` is the ratio the cap needs — the *frame's*
   * ratio belongs to the canvas, and the client component writes it — and the page
   * no longer has to pass a number it computed for a stylesheet it does not own.
   */
  const figureStyle: FigureStyle = { "--world-aspect": String(world.width / world.height) };

  /**
   * **Whether there is a drawing at all**, and the one state that would render an
   * empty frame if it were not asked.
   *
   * With no geometry the `<svg>` is a ratio-locked box containing nothing: a
   * bordered rectangle of sea, sized by the frame's ratio, with a counter under
   * it. No error, nothing in the console — `buildWorldGeometry` throwing would at
   * least fail the build, but an empty `countries` array is a perfectly valid
   * value that renders as a blank plate. "Never an empty frame" is an acceptance
   * criterion of TIW-15, so the box is not rendered at all in that case and a
   * sentence takes its place, with the visited countries listed beside it.
   *
   * `visited` is deliberately NOT part of this test: zero visited countries is
   * the normal state of a journal before its first trip, not a failure, and the
   * world is worth drawing on its own.
   */
  const drawable = countries.length > 0;

  /**
   * **Does the caption still get to say "the world"?**
   *
   * `frameAround` floors a frame at 30 % of the world's width
   * (`MIN_FRAME_WIDTH_FRACTION`), which is the legibility rule for a single trip:
   * its extent is a *point*, so an unfloored fit zooms into a flat wash of one
   * country's interior. The consequence nobody had joined up: with one published
   * trip — the state of production the day after the first récit — the drawing
   * shows about a continent while the caption read "Carte du monde : 1 voyage,
   * 1 pays". A label read aloud, describing a picture it does not match.
   *
   * The frame is already computed here, so this needs no new prop and no change
   * to `frameAround`'s signature. Compared against the world rather than against
   * the floor, because a frame reaches the world's size through step 7 of the
   * framing rule (capping) as well as through having no extent at all, and both
   * of those really do show the world.
   */
  const showsWholeWorld = frame.width >= world.width && frame.height >= world.height;

  /**
   * The marker overlay, **rendered here and handed to the client component as a
   * node**. Sixty `<a href>` elements with their accessible names, their dot and
   * their world coordinates, in the flight payload rather than in the bundle;
   * the interaction is one delegated listener on the canvas above them.
   */
  const overlay =
    placed.length > 0 ? (
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
        {placed.map((entry, index) => {
          const { mark } = entry;
          /**
           * DOM order is `marks` order — `startDate` descending, then `slug` — so
           * the most recent trip is the first tab stop. `--mark-order` inverts
           * that for painting: absolutely positioned siblings paint in DOM order,
           * which would put the first-tabbed marker *under* every later one. The
           * reader would then click the oldest trip of an overlapping pair while
           * the keyboard reached the newest first.
           *
           * `--mark-x` / `--mark-y` are **world** units. See the note on
           * `MarkStyle`: the reader now chooses the frame, so a percentage of one
           * frame is no longer a position, and the stylesheet re-derives the
           * percentage from the live `--frame-*` values.
           */
          const point = worldPointOf(entry, frame);
          const markStyle: MarkStyle = {
            "--mark-x": String(point.x),
            "--mark-y": String(point.y),
            "--mark-order": String(placed.length - index),
          };

          return (
            /*
              `id="voyage-<slug>"` is the fragment the trip page already links
              back to. Before it existed, `/fr/#voyage-japon-2024` — verified in
              the served HTML — matched nothing and the reader landed at the top
              of the home page: a promise the URL made and the document did not
              keep. It is also why TIW-14 put its own state in the **query
              string** and not in the fragment: one syntax, one meaning.

              On the `<li>` and not on the `<a>`, so the browser's sequential
              navigation starting point lands on the marker rather than past it:
              after following the fragment, the next Tab reaches this trip's own
              link. Uniqueness comes from `mark.slug`, which is the content
              façade's primary key for a trip — one marker per trip, so no
              duplicate `id` is possible.
            */
            <li
              key={mark.slug}
              id={`voyage-${mark.slug}`}
              className={styles.mark}
              style={markStyle}
            >
              {/*
                `mark.href` is rendered as-is, in a bare `<a>`, and **it stays a
                link**. That is the decision TIW-14 had to take and not dodge:
                with no JavaScript this navigates to the trip, and with the
                interaction layer running a plain activation opens the panel
                instead — whose own card carries this very href. A modified click
                is never intercepted, so "open in a new tab" still works.

                `data-trip` and `data-zone` are the whole interface between this
                server-rendered list and the client component: one delegated
                listener reads them from `event.target.closest("a[data-trip]")`,
                so no marker needs a React node, a handler or a byte of bundle.
                `aria-haspopup` is added on mount and never rendered here — a
                reader without the script must not be told about a dialog that
                cannot open.
              */}
              <a
                className={styles.link}
                href={mark.href}
                data-trip={mark.slug}
                data-zone={zoneOfTrip.get(mark.slug)}
                /*
                  TIW-19's badge on the map. An attribute and not a second class
                  name, so the halo below is one CSS rule keyed on it and the
                  client component's `closest("a[data-trip]")` reading is
                  untouched — it never looks at classes.
                */
                data-new={mark.isNew === true ? "" : undefined}
                /*
                  TIW-18's third state. An attribute and not a class name, the
                  same reasoning as `data-new`: `map-viewport.tsx` reads markers
                  through `closest("a[data-trip]")` and never looks at classes, so
                  the interaction layer is untouched by this. What it drives is a
                  hollow dot — a difference of shape, so the state survives for a
                  reader who cannot separate the hues.

                  Note what is NOT here: no change to `href`, and no
                  `aria-disabled`. The marker is a working link to something that
                  exists (the trip's entry in the listing), and a disabled-looking
                  link that still navigates is worse than either.
                */
                data-story={mark.story === "unwritten" ? "unwritten" : undefined}
              >
                <span className={styles.dot} aria-hidden="true" />
                {/*
                  The halo, and **only** the halo: it is decoration on top of a
                  distinction the accessible name below already carries in words.
                  A separate element rather than a `::after` on `.dot`, because
                  the dot already animates its own `transform` on hover and focus
                  — two animations on one element would mean one of them winning.

                  It is rendered for every marker and lit by `[data-new]` in CSS,
                  which costs one empty span per trip and buys the guarantee that
                  the fresh marker's box is identical to its neighbours': a halo
                  that only existed on one marker would have to size itself, and
                  a 44 px target that changes size is a target that moves.
                */}
                <span className={styles.halo} aria-hidden="true" />
                {/*
                  Real text, and **one** text node doing two jobs: it is the
                  link's accessible name, and it is the tooltip the acceptance
                  criterion asks for on hover *and* on keyboard focus. Not an
                  `aria-label`, for the reason TIW-13 recorded — an attribute is a
                  string a translator never sees in context and no tool finds in
                  the DOM.

                  It is hidden by `opacity: 0` rather than by `clip-path` now, and
                  the change is deliberate: `clip-path`, `display: none` and
                  `visibility: hidden` all make the text unusable as a bubble
                  (the last two remove it from the accessibility tree outright),
                  while a transparent, absolutely positioned, pointer-transparent
                  element is invisible, costs no layout, and stays a text node in
                  the accessibility tree. So there is no second copy of the label
                  to keep in step, which is what a separate tooltip span would
                  have cost.
                */}
                <span className={styles.label}>
                  {/*
                    The newest récit says so **in this very string** (TIW-19),
                    and not in an extra `aria-label`, an `aria-describedby` or a
                    visually hidden twin. This text node is already doing two
                    jobs — the link's accessible name and the hover/focus bubble
                    — so extending it is the only spelling in which the halo's
                    meaning reaches a screen reader, a mouse and a keyboard at
                    once, with nothing to keep in step.
                  */}
                  {/*
                    Three wordings, one text node, and the order of the tests is
                    the argument: **untold wins over new**. The pair is
                    unreachable through the real pipeline — `freshestTrip` skips
                    untold trips before it compares — but `isNew` is a prop, and a
                    marker announcing "nouveau récit" for a story that is not
                    written is the map promising something it also says does not
                    exist. Of the two, "récit à venir" is the one a reader needs.
                  */}
                  {mark.story === "unwritten"
                    ? t("markLabelToCome", { title: mark.title, place: mark.placeName })
                    : mark.isNew === true
                      ? t("markLabelNew", { title: mark.title, place: mark.placeName })
                      : t("markLabel", { title: mark.title, place: mark.placeName })}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    ) : null;

  /**
   * One panel per zone, its cards already rendered by the page. A zone with no
   * card at all — the state a caller that passes no `tripCards` produces — is
   * dropped, so the client component finds no zone for that marker and leaves its
   * link alone rather than swallowing the activation.
   */
  const panelZones: readonly MapViewportZone[] =
    tripCards === undefined
      ? []
      : zones.flatMap((zone) => {
          const cards = zone.marks.flatMap((entry) => {
            const card = tripCards.get(entry.mark.slug);

            return card === undefined ? [] : [<Fragment key={entry.mark.slug}>{card}</Fragment>];
          });

          return cards.length === 0
            ? []
            : [
                {
                  id: zone.id,
                  // Resolved here, on the server, ICU plural included: the client
                  // component takes no translator — see `MapViewportLabels`.
                  heading: t("panelHeading", { count: cards.length }),
                  body: cards,
                },
              ];
        });

  return (
    <figure className={styles.figure} style={figureStyle}>
      {drawable ? (
        /*
          The client boundary, and the only one this map has. Everything below is
          rendered here, on the server, and travels as nodes: `children` is the
          drawing, `overlay` is the marker list, and each zone's `body` is a stack
          of trip cards. `MapViewport` adds the `<svg>` tag whose `viewBox` it
          owns, four custom properties, three buttons and a panel shell — see its
          header for why that is the whole of the client's job.
        */
        <MapViewport
          initialFrame={frame}
          world={world}
          overlay={overlay}
          zones={panelZones}
          labels={{
            zoomIn: t("zoomIn"),
            zoomOut: t("zoomOut"),
            zoomReset: t("zoomReset"),
            wheelHint: t("wheelHint"),
            panelClose: t("panelClose"),
          }}
        >
          {/*
            Inert by construction rather than by a list of CSS rules. 177 country
            shapes have nothing to say to a screen reader — the names live in
            `VisitedCountries`, next to this figure — and hiding the whole SVG is
            what makes the acceptance criterion "the other countries are neutral,
            not focusable and have no hover state" true without relying on anyone
            remembering to leave out a `tabindex` or a `:hover`.
            `pointer-events: none` on the element completes it: a tint is
            information, not an affordance. Zooming changed none of that: the
            client writes the `viewBox` attribute and nothing else about the
            drawing.
          */}
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
          {/*
            The third tint (TIW-18): countries every one of whose trips is untold.

            **Rendered conditionally, and the guard is not cosmetic.** An empty
            `<g>` in every document of a journal where every récit is written is a
            layer that exists to say nothing — and `layersOf` in the suite counts
            these, so "two layers when nothing is untold" is asserted rather than
            assumed.

            Last in paint order, above the told layer, for the reason the told
            layer is above the background: a tinted border must not be overpainted
            by a neighbour drawn after it. The two lists are disjoint, so nothing
            here is drawn twice.
          */}
          {untold.length > 0 ? (
            <g className={styles.untold}>
              {untold.map((country, index) => (
                <path key={shapeKey(country, index)} d={country.path} />
              ))}
            </g>
          ) : null}
        </MapViewport>
      ) : (
        /*
          The failed-drawing branch, and the whole of what "never an empty frame"
          costs. Visible text rather than a hidden note: a reader who can see the
          page must be told that the missing picture is missing, and a reader who
          cannot was never getting the picture anyway. The sentence points at the
          country list beside it, which is the equivalent that survives the
          failure — so the figure is never a bordered rectangle of nothing.
        */
        <p className={styles.unavailable}>{t("unavailable")}</p>
      )}

      {/*
        `<figcaption>`, not a paragraph next to the map: the counter is the
        map's factual caption, and the association is what lets a screen reader
        announce the figure with its count instead of stranding a bare number.
        Counted from `marks` and `visited` — what the page published — not from
        `placed`, so a marker the frame could not place cannot quietly shrink the
        number the reader is told.

        A `<figcaption>` is also the `<figure>`'s accessible *name* (HTML-AAM),
        which is why the enumeration of visited countries that used to hang here
        as hidden text is gone. `VisitedCountries` carries the names now —
        visible, counted and linked — and a label made of forty country names was
        never a label.
      */}
      <figcaption className={styles.caption}>
        {/*
          `visited.length + untold.length`, and the sum is the honest count: the
          caption answers *where has he been*, and a country visited without being
          written about has still been visited. Counting only `visited` would make
          the caption disagree with `VisitedCountries` beside it, which tallies
          trips per country over the whole collection — and would quietly shrink
          the number the day a récit went unwritten.
        */}
        {showsWholeWorld
          ? t("summary", { trips: marks.length, countries: visited.length + untold.length })
          : t("summaryCropped", { trips: marks.length, countries: visited.length + untold.length })}
      </figcaption>
    </figure>
  );
}
