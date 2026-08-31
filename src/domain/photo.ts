/**
 * The photo pipeline's shared arithmetic: which derivatives exist for a photo,
 * and what they are called.
 *
 * **Why this is in the domain and not next to the command that writes the
 * files.** Three consumers have to agree on it to the byte, and they live in
 * three layers that cannot import one another:
 *
 * - `src/content/index-photos.ts` **writes** `tokyo-960.avif`;
 * - `src/content/validate.ts` **checks it exists** on disk, so a page never
 *   emits a `srcset` entry pointing at nothing;
 * - `src/components/photos/**` **emits its name** into the document.
 *
 * A second copy of the ladder in any of the three is a broken image on a page
 * that validated green — the exact failure mode the repository's two other
 * shared constants (`TRANSPORT_MODES`, `CoordinatesSchema`) are centralised to
 * avoid. Pure TypeScript, no `fs`, no `sharp`: the guard on `src/domain/**`
 * refuses all of it, and nothing here needs any of it.
 */

/**
 * The widths a photo is converted to, ascending.
 *
 * Derived from the two layouts that render a photo, not chosen round:
 *
 * - the gallery grid is `minmax(min(100%, 14rem), 1fr)`, so an item is 224 to
 *   ~360 CSS px — 480 covers it at 1× and the smaller half at 2×;
 * - the cover and the timeline sit inside the 68ch reading column, ~640 CSS px
 *   at the default font size — 960 covers it comfortably, 1440 covers it at 2×;
 * - the viewer is full-viewport, where 1440 is the last rung that pays for
 *   itself. Past it the `<img>` fallback — the original, full size — is what a
 *   very wide screen gets, and that is deliberate.
 *
 * **The ladder stops at three rungs because the repository's weight is a
 * budget.** Measured with `sharp` on four realistic photographs: a fourth rung
 * at 1920 costs 119 KB of AVIF per photo, which is 24 MB across 200 photos —
 * and 200 photos of 400 KB are already the 80 MB the ticket's 150 MB alert
 * threshold is set against. Three rungs cost ~136 KB per photo, 27 MB across
 * 200, for a total of 107 MB. Adding a rung is therefore a decision about the
 * alert threshold, which is why the arithmetic is written here.
 */
export const DERIVATIVE_LADDER = [480, 960, 1440] as const;

/**
 * One modern format, and no second tier.
 *
 * The usual AVIF + WebP + original triple is not needed here, because the
 * `<img>` inside the `<picture>` carries **the original file**: a browser
 * without AVIF support falls through to it and gets a working photograph. A
 * WebP tier would therefore double the repository's weight to serve the
 * handful of browsers that have WebP but not AVIF — and those bytes come out of
 * the same 150 MB budget the ladder above is trimmed for.
 */
export const DERIVATIVE_FORMAT = "avif";

/**
 * The longest edge past which an original is resized, and the file size past
 * which it is too — the two thresholds the ticket names.
 *
 * They are `OR`, not `AND`: a 2 MB photograph at 2000 px is as much dead weight
 * in a git history as a 4032 px one, and either alone is enough to act on.
 */
export const MAX_PHOTO_EDGE = 3000;
export const MAX_PHOTO_BYTES = 1_500_000;

/**
 * How long a `blurDataUrl` may be.
 *
 * Measured on a real photograph, 16 px wide, WebP quality 45: 76 bytes of image,
 * 127 characters of `data:` URI, 114 bytes brotli once inside the document. The
 * cap is four times that — generous room for a busier picture — and it is a cap
 * rather than nothing because this field goes **into the HTML of every page that
 * shows the photo**. Two hundred photos on one page at 512 characters would be
 * ~100 KB of document, which is the entire HTML budget
 * (`tests/build/prerender.test.ts`), spent on placeholders.
 */
export const BLUR_DATA_URL_MAX_LENGTH = 512;

/**
 * The `data:` URI a placeholder must be.
 *
 * WebP and nothing else, because that is what `index-photos` writes and because
 * it is what won the measurement by a factor of four: at 16 px wide a WebP is
 * 76 bytes where AVIF and JPEG are ~300, almost all of it container overhead
 * that a thumbnail this small cannot amortise.
 *
 * The character class is the base64 alphabet, so a URI carrying anything else —
 * a quote, a `<`, a newline — is refused before it reaches an inline `style`
 * attribute in the document.
 */
export const BLUR_DATA_URL_PATTERN = /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Where the extension of a path begins, or the end of the path when it has
 * none.
 *
 * Counted from the last **segment** and not from the whole string, which was a
 * real bug: `/photos/v1.2/a` has a dot in its directory, and cutting at the last
 * dot of the string moved the derivative into a folder that does not exist.
 */
function extensionIndex(src: string): number {
  const lastSlash = src.lastIndexOf("/");
  const dot = src.lastIndexOf(".");

  return dot > lastSlash ? dot : src.length;
}

/**
 * The rungs that exist for a photo of this width, ascending.
 *
 * `rung <= width` and never `<`: a rung *equal* to the original's width still
 * changes the format, and an AVIF at 480 px is a real saving over a JPEG at
 * 480 px. What is refused is upscaling — a 1440 px AVIF made from a 1000 px
 * original is a bigger file with no extra detail in it, and the browser would
 * pick it on a wide screen precisely because it looks like the best answer.
 */
export function derivativeWidthsFor(width: number): readonly number[] {
  return DERIVATIVE_LADDER.filter((rung) => rung <= width);
}

/** The file a given rung of a given photo is written to. */
export function derivativeSrc(src: string, width: number): string {
  return `${src.slice(0, extensionIndex(src))}-${width}.${DERIVATIVE_FORMAT}`;
}

export type DerivativeSource = { readonly width: number; readonly src: string };

/**
 * Every derivative a photo has, in ascending width — the list a `srcset` is
 * built from and the list `validate:content` looks for on disk.
 */
export function derivativeSources(photo: {
  readonly src: string;
  readonly width: number;
}): readonly DerivativeSource[] {
  return derivativeWidthsFor(photo.width).map((width) => ({
    width,
    src: derivativeSrc(photo.src, width),
  }));
}

/**
 * Whether a path has the shape this pipeline gives its own output: the original's
 * name, a hyphen, and **one of the ladder's own widths**.
 *
 * The collision it exists to refuse is not hypothetical. An author who drops
 * `tokyo-960.jpg` next to `tokyo.jpg` owns a file whose name is exactly where
 * the 960 px derivative of `tokyo.jpg` goes. Whichever is written last wins, and
 * the loser is either the author's original or a page serving a JPEG under an
 * `.avif` name. So a declared photo may not have this shape, and the refusal
 * happens in the schema where every other content rule lives.
 *
 * **It matches the ladder's widths and not `-\d+` in general**, which is the
 * whole subtlety and was a measured false positive: `2024-04-12.jpg` — a date,
 * the single most likely way to name a photograph — ends in `-12` and was
 * refused by the general pattern. No rung is 12, so no collision was possible
 * and the refusal was pure damage.
 *
 * The consequence, stated rather than discovered later: adding a rung to
 * {@link DERIVATIVE_LADDER} makes previously valid content invalid, because a
 * file already named `tokyo-1920.jpg` would become a name the pipeline writes.
 * That is a real cost of changing the ladder, and `validate:content` says it in
 * a sentence naming the file.
 */
export function isDerivativeName(src: string): boolean {
  const name = src.slice(src.lastIndexOf("/") + 1, extensionIndex(src));
  const suffix = /-(\d+)$/.exec(name)?.[1];

  return suffix !== undefined && DERIVATIVE_LADDER.some((rung) => String(rung) === suffix);
}
