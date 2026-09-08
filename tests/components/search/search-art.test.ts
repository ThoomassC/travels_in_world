import { describe, expect, it } from "vitest";
import { TILE_BOX as MAP_TILE_BOX } from "@/map/country-tile";
import { TILE_BOX, TILE_VIEWBOX, tileSymbolId } from "@/components/search/search-art";

/**
 * **THE ONLY THING THAT MAKES THE DUPLICATED BOX ACCEPTABLE.**
 *
 * The vignette's outline is projected by `src/map/country-tile.ts` into a
 * forty-unit box; the `<svg>` that draws it declares the same box in
 * `src/components/search/search-art.ts`. The two constants are not one because the
 * first module reads the 50m TopoJSON and pulls `d3-geo` and `topojson-client`
 * with it: importing it from the search's rendering layer would drag the whole
 * geometry stack across a boundary that exists so this layer can be rendered under
 * jsdom from plain fixtures.
 *
 * A duplication is acceptable in this repository only when something refuses to let
 * it drift. This is that thing — and the drift it guards against is silent: a box
 * of 40 drawing a path fitted to 50 renders a country cropped to four fifths of
 * itself, in every document on the site, with every test still green.
 *
 * PROVEN BY DELIBERATE FAILURE:
 *
 *   // src/components/search/search-art.ts
 *   -export const TILE_BOX = 40;
 *   +export const TILE_BOX = 48;
 *
 *   npm test -> 2 failed
 *     expected 48 to be 40
 *     expected '0 0 48 48' to be '0 0 40 40'
 *
 * A test may import the geometry module directly — the ESLint restriction on
 * specifiers with a segment after `map` is scoped to `src/**`.
 */
describe("the vignette's box", () => {
  it("is the box the projection fitted the country to", () => {
    expect(TILE_BOX).toBe(MAP_TILE_BOX);
  });

  it("declares that box as the viewBox both the symbol and the row carry", () => {
    expect(TILE_VIEWBOX).toBe(`0 0 ${MAP_TILE_BOX} ${MAP_TILE_BOX}`);
  });
});

/**
 * The id a row's `<use>` points at. One per country, so nine French trips share one
 * outline — which is the whole reason the panel costs 3.3 KB of geometry and not
 * six thousand bytes of France repeated.
 */
describe("the symbol id", () => {
  it("is stable, lower-cased and free of anything a fragment cannot carry", () => {
    expect(tileSymbolId("FR")).toBe("tiw-tile-fr");
    expect(tileSymbolId("fr")).toBe(tileSymbolId("FR"));
    expect(tileSymbolId("GR")).toMatch(/^[a-z0-9-]+$/);
  });

  it("gives two countries two ids", () => {
    expect(tileSymbolId("FR")).not.toBe(tileSymbolId("GR"));
  });
});
