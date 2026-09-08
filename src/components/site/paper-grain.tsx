import type { ReactElement } from "react";
import styles from "./paper-grain.module.css";

/** The id the stylesheet's `filter` reference and the `<filter>` must agree on. */
const GRAIN_FILTER_ID = "tiw-paper-grain";

/**
 * The paper grain (TIW-38) — the texture `nicoailleurs.com` lays under its map,
 * rebuilt rather than borrowed.
 *
 * **Generated, never a file.** `feTurbulence` is a filter primitive: the browser
 * synthesises the noise, so this costs **zero bytes of image and zero requests**.
 * That is not a nicety here — the e2e harness refuses any off-origin request on
 * load, the repository has a tracked-image budget, and a texture is exactly the
 * kind of asset that arrives at 300 KB and stays.
 *
 * **Zero bytes of JavaScript too.** Inline SVG in a Server Component ships as
 * markup, the same property `brand-art.ts` records for the mark. Nothing here is
 * interactive and nothing hydrates.
 *
 * **Why it is a rendered `<rect>` and not a CSS `background-image`.** A data-URI
 * SVG would have to carry its own colour as a literal, which is the one thing
 * this project's stylesheets may not contain: the colour of the grain has to be a
 * token so it follows the theme. Painted as an element, it inherits `color` from
 * the sheet and the token stays the only source.
 *
 * **What makes it measurable, which is the whole reason it may exist at all.**
 * `tests/styles/colour-contract.test.ts` measures every ink against a flat
 * composed substrate, and a texture has no single colour — that is the objection
 * this component had to answer rather than dodge. It answers it by being
 * *bounded*: the noise is greyscale, and the layer's opacity is a fixed number
 * declared in `./paper-grain.module.css`. The darkest ground a reader can meet is
 * therefore the grain's own ink at exactly that opacity composited over the page
 * token — a colour the contract can compute, and does. Raise the opacity there
 * and the suite goes red until the substrate is re-measured.
 *
 * `aria-hidden` and `focusable="false"`: it is decoration with no equivalent to
 * give, and old Trident put SVG elements in the tab order regardless.
 */
export function PaperGrain(): ReactElement {
  return (
    <svg className={styles.grain} aria-hidden="true" focusable="false">
      <filter id={GRAIN_FILTER_ID}>
        {/*
          `fractalNoise` and not `turbulence`: turbulence is built from absolute
          values, so it clumps into visible dark veins at low frequencies —
          fractal noise stays evenly distributed, which is what reads as paper
          rather than as marble.

          `stitchTiles="stitch"` matters the moment the filter region is tiled or
          the viewport is resized: without it the noise restarts at each tile edge
          and the seams are visible as straight lines across the page.

          Three octaves. Two is visibly regular, four costs a measurable amount of
          paint time on a full-viewport rect for a difference no one can see.
        */}
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.85"
          numOctaves={3}
          stitchTiles="stitch"
        />
        {/*
          Desaturated to grey. Without this the noise is coloured — feTurbulence
          fills the three channels independently — and a rainbow speckle under the
          whole site is neither paper nor within any palette.
        */}
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${GRAIN_FILTER_ID})`} />
    </svg>
  );
}
