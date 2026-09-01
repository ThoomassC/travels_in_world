import { describe, expect, it } from "vitest";
import {
  BLUR_DATA_URL_MAX_LENGTH,
  DERIVATIVE_FORMAT,
  DERIVATIVE_LADDER,
  derivativeSources,
  derivativeSrc,
  derivativeWidthsFor,
  isDerivativeName,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_EDGE,
} from "@/domain/photo";

/**
 * The derivative ladder is shared by three consumers that must agree to the
 * byte: `npm run index-photos` writes the files, `npm run validate:content`
 * checks they exist, and the page emits their names in a `srcset`. A disagreement
 * between any two of them is a broken image on a page that validated green — so
 * the ladder lives in the domain and this is what pins it.
 */

describe("the ladder itself", () => {
  it("is the three rungs the two layouts actually ask for, in ascending order", () => {
    expect(DERIVATIVE_LADDER).toEqual([480, 960, 1440]);
  });

  it("converts to one modern format and no second tier", () => {
    // The fallback is the original file in the `<img>`, not a WebP tier: a
    // browser without AVIF takes it, so a second ladder would double the
    // repository's weight to serve nobody.
    expect(DERIVATIVE_FORMAT).toBe("avif");
  });

  it("names the two thresholds beyond which an original is resized", () => {
    expect(MAX_PHOTO_EDGE).toBe(3000);
    expect(MAX_PHOTO_BYTES).toBe(1_500_000);
  });
});

describe("derivativeWidthsFor", () => {
  it("offers every rung up to the original's own width", () => {
    expect(derivativeWidthsFor(1600)).toEqual([480, 960, 1440]);
  });

  /**
   * No upscaling, ever: a 1440 px AVIF made from a 1000 px original is bigger
   * than the original and carries no extra detail. The browser would happily
   * pick it on a wide screen, so the rung must simply not be offered.
   */
  it("drops the rungs wider than the original", () => {
    expect(derivativeWidthsFor(1000)).toEqual([480, 960]);
    expect(derivativeWidthsFor(700)).toEqual([480]);
  });

  /**
   * The exact boundary, both sides. A rung equal to the original's width is
   * kept: the pixels are the same but the format is not, and an AVIF at 480 px
   * is a real saving over a JPEG at 480 px.
   */
  it("keeps a rung that equals the original's width, and drops the one past it", () => {
    expect(derivativeWidthsFor(480)).toEqual([480]);
    expect(derivativeWidthsFor(479)).toEqual([]);
    expect(derivativeWidthsFor(960)).toEqual([480, 960]);
    expect(derivativeWidthsFor(959)).toEqual([480]);
  });

  it("offers nothing for a photo narrower than the first rung", () => {
    expect(derivativeWidthsFor(120)).toEqual([]);
    expect(derivativeWidthsFor(1)).toEqual([]);
  });
});

describe("derivativeSrc", () => {
  it("puts the width and the format beside the original, in the same folder", () => {
    expect(derivativeSrc("/photos/japon-2024/tokyo.jpg", 960)).toBe(
      "/photos/japon-2024/tokyo-960.avif"
    );
  });

  it("replaces the extension whatever it was, including an upper-case one", () => {
    expect(derivativeSrc("/photos/x/a.JPEG", 480)).toBe("/photos/x/a-480.avif");
    expect(derivativeSrc("/photos/x/a.png", 480)).toBe("/photos/x/a-480.avif");
  });

  /**
   * A name with no extension at all. Appending rather than replacing is the only
   * answer that keeps the derivative next to its original — and the alternative,
   * refusing, would be a refusal the page cannot act on at render time.
   */
  it("appends to a name that carries no extension", () => {
    expect(derivativeSrc("/photos/x/a", 480)).toBe("/photos/x/a-480.avif");
  });

  /**
   * A dot in a *directory* is not an extension. Measured as a real bug in the
   * first version: `path.replace(/\.[^.]*$/, …)` on `/photos/v1.2/a` produced
   * `/photos/v1-480.avif`, which points at a file in another folder.
   */
  it("does not mistake a dot in a directory for the file's extension", () => {
    expect(derivativeSrc("/photos/v1.2/a", 480)).toBe("/photos/v1.2/a-480.avif");
  });
});

describe("derivativeSources", () => {
  it("pairs every offered rung with the file the page will ask for", () => {
    expect(derivativeSources({ src: "/photos/japon-2024/tokyo.jpg", width: 1000 })).toEqual([
      { width: 480, src: "/photos/japon-2024/tokyo-480.avif" },
      { width: 960, src: "/photos/japon-2024/tokyo-960.avif" },
    ]);
  });

  it("is empty for a photo too small to derive, so the page emits no source", () => {
    expect(derivativeSources({ src: "/photos/x/thumb.jpg", width: 200 })).toEqual([]);
  });
});

/**
 * The collision this predicate exists for, and it is not hypothetical: an author
 * who drops `tokyo-960.jpg` in beside `tokyo.jpg` owns a file whose name is
 * exactly the one `index-photos` writes its 960 px derivative to. Whichever runs
 * last wins, and the loser is either a lost original or a page serving a JPEG
 * with an `.avif` name.
 */
describe("isDerivativeName", () => {
  it.each([
    "/photos/japon-2024/tokyo-960.avif",
    "/photos/japon-2024/tokyo-480.jpg",
    "/photos/japon-2024/tokyo-1440.png",
    "/photos/x/a-960",
  ])("recognises %s as a name the pipeline produces", (src) => {
    expect(isDerivativeName(src)).toBe(true);
  });

  /**
   * `2024-04-12.jpg` is the row this table exists for. A date is the most likely
   * way there is to name a photograph, it ends in `-12`, and a general `-\d+$`
   * pattern refused it — for a collision that cannot happen, since no rung is 12.
   * `tokyo-1920.jpg` is the same point from the other side: it is only safe as
   * long as 1920 is not a rung, and adding one is what would change that.
   */
  it.each([
    "/photos/japon-2024/tokyo.jpg",
    "/photos/japon-2024/tokyo-tour.jpg",
    "/photos/japon-2024/2024-04-12.jpg",
    "/photos/japon-2024/tokyo-1920.jpg",
    "/photos/japon-2024/tokyo-96.jpg",
    "/photos/japon-2024/tokyo-960b.jpg",
    "/photos/v1-2/tokyo.jpg",
  ])("leaves %s alone", (src) => {
    expect(isDerivativeName(src)).toBe(false);
  });
});

describe("the blur placeholder's length cap", () => {
  /**
   * Measured on a real photograph: a 16 px-wide WebP at quality 45 is 76 bytes,
   * so 127 characters of `data:` URI and 114 bytes brotli inside the document.
   * The cap is generous headroom over that and still bounded — 200 photos on one
   * page at the cap would be 100 KB of HTML, which is the whole document budget,
   * so an uncapped field is a way to blow it silently.
   */
  it("leaves room for a real placeholder and refuses an unbounded one", () => {
    expect(BLUR_DATA_URL_MAX_LENGTH).toBe(512);
  });
});
