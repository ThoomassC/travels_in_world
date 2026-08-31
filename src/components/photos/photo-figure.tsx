import type { CSSProperties, ReactElement } from "react";
import { DERIVATIVE_FORMAT, derivativeSources } from "@/domain/photo";
import styles from "./photo-figure.module.css";

/**
 * One photograph, in the only markup this site serves images with.
 *
 * **A `<picture>` and a plain `<img>`, never `next/image`.** The optimiser is a
 * client component and this page ships its JavaScript budget elsewhere; the
 * derivatives it would compute at request time are already on disk, written by
 * `npm run index-photos` from the ladder in `@/domain/photo`. So the whole thing
 * is HTML: 0 byte of JavaScript, and the same component renders inside the
 * viewer, which is the only client boundary that touches it.
 *
 * **The `<img>` inside a `<picture>` is the AVIF fallback, and it is the ONLY
 * fallback there is.** A `<picture>` *commits* to the `<source>` whose media and
 * type match: if the AVIF 404s the browser paints a broken image and never falls
 * back to the `<img>`. That is why `npm run validate:content` checks every
 * derivative's existence on disk (`src/content/validate.ts`, "The derivative
 * files, and the reason this check is not optional") and why the `<source>` is
 * omitted entirely when the ladder yields nothing — see below.
 *
 * **The placeholder is a background, not a second image.** `blurDataUrl` is
 * painted under the `<img>`; the photograph is opaque, so it covers its own
 * background the moment the bytes arrive. No `onLoad`, no state, no JavaScript —
 * which is what lets this stay a Server Component.
 */

export type PhotoView = {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly blurDataUrl: string;
};

export type PhotoFigureProps = {
  readonly photo: PhotoView;
  /**
   * The `sizes` attribute, required rather than defaulted: the gallery renders a
   * photo at ~17 rem and the cover at ~34 rem, and a wrong `sizes` makes the
   * browser pick the wrong rung of the ladder — the one failure of a `srcset`
   * that costs bytes instead of showing a bug.
   */
  readonly sizes: string;
  /** The layout's own class for the image box (aspect ratio, cap, radius). */
  readonly className?: string;
  readonly loading?: "eager" | "lazy";
  readonly fetchPriority?: "high" | "low" | "auto";
};

export function PhotoFigure({
  photo,
  sizes,
  className,
  /**
   * Lazy and auto by default, eager and high for the cover: the acceptance
   * criterion is "deferred loading below the fold", and every photo this
   * component renders is below it except the one the header shows first.
   */
  loading = "lazy",
  fetchPriority = "auto",
}: PhotoFigureProps): ReactElement {
  const sources = derivativeSources(photo);

  /**
   * Inline, and every one of the four declarations inline — not just the URL.
   *
   * The URL has to be: it is a build-time value, and a custom property would put
   * the same string in the same attribute for one more indirection. The other
   * three are inline because the layout classes that arrive through `className`
   * set the `background` *shorthand* (`.cover` and `.photo` both do, for the
   * placeholder colour), which resets `background-size` and `background-position`
   * to their initial values. Two class selectors of equal specificity are then
   * ordered by whichever CSS Module the bundler emitted last — a coin toss that
   * decides whether the blur is stretched or tiled. The inline origin wins over
   * both, so it cannot be lost.
   *
   * Precedent and its consequence: `src/components/map/world-map.tsx` already
   * carries a build-time number into CSS this way, and `README.md` records what
   * a future CSP without `style-src 'unsafe-inline'` costs — there, every marker
   * stacks in the corner; here, the placeholder simply does not paint, which is
   * a degradation with no broken state in it.
   *
   * `PhotoSchema` pins `blurDataUrl` to base64 WebP and caps its length, so no
   * quote, no `<` and no `javascript:` can reach this attribute.
   */
  const placeholder: CSSProperties = {
    backgroundImage: `url("${photo.blurDataUrl}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };

  return (
    /*
      `display: contents` on the `<picture>` — see the module. It is a selection
      mechanism, not a box, and giving it one would change the layout of every
      caller that styles the `<img>` as a flex item today.
    */
    <picture className={styles.picture}>
      {/*
        No `<source>` at all when the ladder yields nothing, which is the case for
        a photo narrower than its first rung (480 px). `derivativeSources` returns
        `[]` for it and `index-photos` writes no file, so an empty `srcset` — or
        worse, one built from the ladder regardless — would point the browser at a
        file that does not exist, and a `<picture>` that has committed to a
        `<source>` does not come back to the `<img>`.
      */}
      {sources.length > 0 ? (
        <source
          type={`image/${DERIVATIVE_FORMAT}`}
          srcSet={sources.map((source) => `${source.src} ${source.width}w`).join(", ")}
          sizes={sizes}
        />
      ) : null}
      <img
        className={className}
        src={photo.src}
        alt={photo.alt}
        /* Mandatory in `PhotoSchema`, so the box is reserved before the bytes
           arrive and nothing shifts under the reader. */
        width={photo.width}
        height={photo.height}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
        style={placeholder}
      />
    </picture>
  );
}
