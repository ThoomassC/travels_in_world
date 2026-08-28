import type { GeoContext } from "d3-geo";

/**
 * An SVG path builder that rounds as it writes, for `geoPath(projection, this)`.
 *
 * **Why a context and not a regular expression over the finished `d`.** The
 * whole point of rounding is weight, and the `d` attribute of the 177 countries
 * is the single largest thing the page ships: measured at 45.5 KB brotli at d3's
 * default 3 decimals against 30.1 KB at 1. A post-pass over the string would
 * have to re-parse SVG path syntax to find the numbers — every command letter,
 * implicit repeats, exponent notation — and getting that wrong corrupts geometry
 * silently. Rounding at the point where the number is still a number cannot
 * mis-parse anything.
 *
 * **Why not `geoPath().digits(1)`.** d3 does have that knob, and it does exactly
 * this rounding — but only for its *internal* string builder, the one used when
 * the context is `null`. Reading d3's `path/index.js` confirms it: `digits` is
 * consulted only in the `context == null` branch, so setting a context silently
 * makes it a no-op. Owning the builder is also what makes the rounding testable
 * on its own, without a projection or a dataset in the way.
 *
 * The two are nonetheless cross-checked, which is worth knowing if this ever
 * looks suspicious: the whole 110m dataset through this context and the same
 * dataset through `geoPath(projection).digits(1)` compress to the same 30.1 KB.
 */

/**
 * One decimal, and the unit it is a decimal *of* is a viewBox unit — not a metre
 * and not a pixel. Measured: the projected world spans 947.5 units for 360° of
 * longitude, so one unit is ~42 km at the equator and the rounding step is
 * **~4.2 km**. That sounds enormous and is not, for two reasons worth writing
 * down before someone "fixes" it upwards:
 *
 * - On screen the step is a tenth of a viewBox unit, which at the natural 960 px
 *   width is a tenth of a pixel. Nothing is visible, at any zoom the milestone 1
 *   map offers.
 * - The 110m dataset is itself a 1:110 000 000 generalisation: its own vertices
 *   are displaced by far more than 4 km. Rounding below the precision the source
 *   never had costs nothing and buys 15 KB brotli.
 *
 * An earlier version of this comment claimed ~10 cm, which is wrong by more than
 * four orders of magnitude. It survived review because it sounded reassuring.
 */
const PATH_DECIMALS = 1;

const PATH_SCALE = 10 ** PATH_DECIMALS;

const TAU = Math.PI * 2;

/**
 * A coordinate as it is written into a path.
 *
 * `Math.round(v * 10) / 10` rather than `v.toFixed(1)`: `toFixed` returns a
 * *string* and keeps a trailing zero, so `123` would be written `"123.0"` — two
 * wasted bytes on every whole coordinate, which is not a rounding error but is
 * the reason this rounding exists.
 *
 * The `+ 0` is not decoration. Rounding a small negative number lands on `-0`
 * (`Math.round(-0.04 * 10) / 10` is `-0`), and while `String(-0)` happens to be
 * `"0"` — so no path would carry the sign — `Object.is(-0, 0)` is `false`, which
 * makes `-0` leak out of any direct assertion on this function. `-0 + 0` is `0`.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * PATH_SCALE) / PATH_SCALE + 0;
}

/**
 * The `GeoContext` subset d3 actually drives, plus a way to read the result.
 *
 * `geoPath(projection, context)` returns whatever `context.result()` returns
 * through its own wrapper, and d3's wrapper for a foreign context defines
 * `result` as a no-op — so the finished path is read from here, not from the
 * call. `result()` also clears the buffer, mirroring d3's own `PathString`, so
 * one context can be reused for all 177 countries without leaking the previous
 * one into the next.
 */
export type RoundingPathContext = GeoContext & {
  /** The path written since the last `result()`; `""` when nothing was drawn. */
  result(): string;
};

export function createRoundingPathContext(): RoundingPathContext {
  let path = "";

  const write = (command: string, x: number, y: number): void => {
    path += `${command}${roundCoordinate(x)},${roundCoordinate(y)}`;
  };

  return {
    /**
     * d3's `PathContext` never calls this — it relies on the caller having
     * cleared the canvas — so the reset lives in `result()` instead, and this
     * stays honest for a caller that does drive it.
     */
    beginPath(): void {
      path = "";
    },

    moveTo(x: number, y: number): void {
      write("M", x, y);
    },

    lineTo(x: number, y: number): void {
      write("L", x, y);
    },

    closePath(): void {
      path += "Z";
    },

    /**
     * Only reachable through a `Point`/`MultiPoint` geometry, which d3 renders
     * as a circle of `pointRadius`; countries are polygons, so nothing in this
     * module reaches it today. It is implemented rather than stubbed because a
     * silent no-op here would drop geometry, and `arc` is part of the interface
     * this object claims to satisfy.
     *
     * Canvas semantics, which are not SVG's: the sweep runs from `startAngle`
     * towards `endAngle` in the requested direction, and a delta of a full turn
     * or more is a whole circle. A single SVG `A` command cannot express a full
     * turn — start and end points coincide and the arc degenerates — so it is
     * split in halves.
     */
    arc(
      x: number,
      y: number,
      radius: number,
      startAngle: number,
      endAngle: number,
      anticlockwise = false
    ): void {
      const raw = endAngle - startAngle;
      const delta = anticlockwise
        ? Math.max(raw > 0 ? (raw % TAU) - TAU : raw, -TAU)
        : Math.min(raw < 0 ? (raw % TAU) + TAU : raw, TAU);

      const pointAt = (angle: number): { x: number; y: number } => ({
        x: x + radius * Math.cos(angle),
        y: y + radius * Math.sin(angle),
      });
      const sweepFlag = delta > 0 ? 1 : 0;
      const radii = `${roundCoordinate(radius)},${roundCoordinate(radius)}`;

      const arcTo = (angle: number, largeArc: 0 | 1): void => {
        const point = pointAt(angle);
        path += `A${radii} 0 ${largeArc},${sweepFlag} ${roundCoordinate(point.x)},${roundCoordinate(point.y)}`;
      };

      if (Math.abs(delta) >= TAU) {
        arcTo(startAngle + delta / 2, 1);
        arcTo(startAngle + delta, 1);
        return;
      }

      arcTo(startAngle + delta, Math.abs(delta) > Math.PI ? 1 : 0);
    },

    result(): string {
      const written = path;
      path = "";
      return written;
    },
  };
}
