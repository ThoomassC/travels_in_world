import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhotoFigure } from "@/components/photos/photo-figure";
import { photo } from "./fixtures";

/**
 * The markup one photograph is served with. No `NextIntlClientProvider` here:
 * this component reads no message — every string in it comes from the content —
 * which is itself worth pinning, since an image whose only text is its `alt` is an
 * image whose `alt` had better come from the author.
 */

const figure = (props: Partial<Parameters<typeof PhotoFigure>[0]> = {}) =>
  render(<PhotoFigure photo={photo()} sizes="100vw" {...props} />);

describe("PhotoFigure", () => {
  it("names the photo with the alt text the author wrote", () => {
    figure();

    expect(
      screen.getByRole("img", { name: "Une ruelle de Shinjuku sous la pluie" })
    ).toBeInTheDocument();
  });

  it("serves the original as the img, so a browser without AVIF gets a photograph", () => {
    figure();

    const image = screen.getByRole("img");

    expect(image).toHaveAttribute("src", "/photos/japon-2024/tokyo.jpg");
    // Mandatory in `PhotoSchema`: the box is reserved before the bytes arrive.
    expect(image).toHaveAttribute("width", "1600");
    expect(image).toHaveAttribute("height", "1067");
  });

  it("offers every derivative of the ladder, in ascending width, as AVIF", () => {
    const { container } = figure();
    const source = container.querySelector("source");

    expect(source).toHaveAttribute("type", "image/avif");
    /**
     * `w` descriptors and not `x`: the browser needs the intrinsic width of each
     * file to combine it with `sizes`, and `x` would pin the choice to the device
     * pixel ratio alone — which is exactly wrong for a grid whose track width
     * changes with the viewport.
     */
    expect(source).toHaveAttribute(
      "srcset",
      "/photos/japon-2024/tokyo-480.avif 480w, /photos/japon-2024/tokyo-960.avif 960w, /photos/japon-2024/tokyo-1440.avif 1440w"
    );
    expect(source).toHaveAttribute("sizes", "100vw");
  });

  /** The rungs above the original's width are not written, and a `srcset` naming
   * them would point at nothing: `<picture>` commits to a `<source>` and does not
   * fall back to the `<img>` on a 404. */
  it("offers only the rungs the photo is wide enough for", () => {
    const { container } = figure({ photo: photo({ width: 700, height: 500 }) });

    expect(container.querySelector("source")).toHaveAttribute(
      "srcset",
      "/photos/japon-2024/tokyo-480.avif 480w"
    );
  });

  /**
   * THE case this component would otherwise fail silently on. A photo narrower
   * than the first rung has no derivative on disk at all, so an empty or
   * ladder-shaped `srcset` would send every AVIF-capable browser — which is all of
   * them — to a file that does not exist, and a committed `<picture>` shows a
   * broken image rather than the `<img>` beside it.
   */
  it("emits no source at all for a photo narrower than the first rung", () => {
    const { container } = figure({ photo: photo({ width: 320, height: 240 }) });

    expect(container.querySelector("source")).toBeNull();
    // …and the photograph is still served.
    expect(screen.getByRole("img")).toHaveAttribute("src", "/photos/japon-2024/tokyo.jpg");
  });

  it("paints the blurred placeholder under the image, as a covering background", () => {
    figure();

    const image = screen.getByRole("img");

    expect(image.style.backgroundImage).toContain("data:image/webp;base64,");
    // `cover` and not the initial `auto`: a 16 px thumbnail tiled across a 1600 px
    // box is a grid of squares, not a blur.
    expect(image.style.backgroundSize).toBe("cover");
    expect(image.style.backgroundRepeat).toBe("no-repeat");
  });

  it("defers loading by default, and only by default", () => {
    figure();

    expect(screen.getByRole("img")).toHaveAttribute("loading", "lazy");
  });

  /** The cover is the LCP candidate and the one photo above the fold, so the
   * page asks for it eagerly and at high priority. */
  it("loads eagerly at high priority when asked", () => {
    figure({ loading: "eager", fetchPriority: "high" });

    const image = screen.getByRole("img");

    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("fetchpriority", "high");
  });

  it("puts the caller's layout class on the image, where the layout is", () => {
    figure({ className: "cover-abc" });

    expect(screen.getByRole("img")).toHaveClass("cover-abc");
  });
});
