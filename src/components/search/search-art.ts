/**
 * The vignette a trip's suggestion carries — one number and one string, because
 * the drawing itself is not this layer's to hold.
 *
 * **The outline comes from `@/map`.** `src/map/country-tile.ts` projects one
 * country into a 40-unit box, simplifies it for a 40 px rendering, and says where
 * a coordinate lands inside it. That module is server-only — it reads the 50m
 * TopoJSON — and the search's rendering layer is deliberately free of both façades
 * so it can be tested under jsdom from plain fixtures. So the paths arrive as a
 * prop and the box arrives as the constant below.
 *
 * **The box is duplicated on purpose, and one test refuses to let it drift.**
 * `TILE_BOX` in `country-tile.ts` and the one here are the same forty units;
 * importing the first would drag `d3-geo`, `topojson-client` and the world atlas
 * across this boundary to read a number.
 * `tests/components/search/search-art.test.ts` compares them.
 *
 * **A pennant used to fly at the other end of the row** — the map's own marker,
 * filled for a told récit and hollow for one to come. The owner had it removed:
 * *« les icons de ping tu peux les enlever, ils servent à rien »*. Nothing is lost
 * for a reader who sees no colour, and that is the only reason it could go: the
 * row's second line still ends in the words "récit à venir", which was always the
 * channel that mattered — the pennant repeated it.
 */

/**
 * The vignette's box, square and forty units on a side, so **one unit is one CSS
 * pixel** at the 2.5 rem this renders at. Every simplification decision in
 * `src/map/country-tile.ts` is calibrated on that equality.
 */
export const TILE_BOX = 40;

export const TILE_VIEWBOX = `0 0 ${TILE_BOX} ${TILE_BOX}`;

/** The `<symbol>` id a row's `<use>` points at, one per country in the panel. */
export const tileSymbolId = (countryCode: string): string =>
  `tiw-tile-${countryCode.toLowerCase()}`;
