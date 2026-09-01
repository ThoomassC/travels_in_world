import { BLUR_PLACEHOLDER } from "../../domain/fixtures";

/**
 * Photo builders for the photo suite.
 *
 * `BLUR_PLACEHOLDER` comes from the domain fixtures rather than being retyped: it
 * is a real 76-byte WebP that `sharp` produced at 16 px wide, and it is the value
 * `BLUR_DATA_URL_MAX_LENGTH` was measured against. A plausible-looking string
 * here would let a component pass with a placeholder no browser can decode.
 */

export type PhotoInput = {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly blurDataUrl: string;
  readonly placeSlug?: string;
};

/**
 * 1600 px wide by default, so all three rungs of the ladder exist. Tests about a
 * photo *narrower* than the first rung pass `width` explicitly — that is the case
 * where `derivativeSources` returns nothing and no `<source>` may be emitted.
 */
export function photo(overrides: Partial<PhotoInput> = {}): PhotoInput {
  return {
    src: "/photos/japon-2024/tokyo.jpg",
    alt: "Une ruelle de Shinjuku sous la pluie",
    width: 1600,
    height: 1067,
    blurDataUrl: BLUR_PLACEHOLDER,
    ...overrides,
  };
}

/** `count` photos with distinct sources, so nothing collides on a React key. */
export function photos(count: number, overrides: Partial<PhotoInput> = {}): readonly PhotoInput[] {
  return Array.from({ length: count }, (_unused, index) =>
    photo({
      src: `/photos/japon-2024/photo-${index}.jpg`,
      alt: `Photographie ${index}`,
      ...overrides,
    })
  );
}

/** The same photos, numbered the way `viewerPhotos` numbers them. */
export function indexed(entries: readonly PhotoInput[]): readonly (PhotoInput & {
  readonly index: number;
})[] {
  return entries.map((entry, index) => ({ ...entry, index }));
}
