import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { writePhotoFields } from "@/content/yaml-edit";
import { BLUR_PLACEHOLDER } from "../domain/fixtures";

/**
 * `npm run index-photos` writing three fields into a hand-written file, under the
 * same constraint as `npm run geocode`: the author's comments, key order, quoting
 * style, blank lines and indentation **are** the file, and a rewrite that loses
 * them is a failure even when the result parses.
 *
 * Its own spec file rather than more cases in `yaml-edit.test.ts`, because the
 * shapes are different: coordinates are a nested mapping created under a key,
 * these are scalars written directly on the entry. What the two share is the
 * splice engine, and the surest way to know it still serves both is that both
 * suites stay green.
 *
 * Whole-file comparisons, for the reason the coordinates suite gives: a semantic
 * comparison is exactly the one that cannot see this damage.
 */

const HAND_WRITTEN = `# Japon, printemps 2024 — écrit à la main.
slug: japon-2024
title: "Japon, printemps 2024"

photos:
  # La première photo du voyage, celle de couverture.
  - src: /photos/japon-2024/tokyo.jpg
    alt: Une ruelle de Shinjuku sous la pluie # décrite pour un lecteur d'écran
    placeSlug: tokyo

  - src: /photos/japon-2024/kyoto.jpg
    alt: Le chemin des philosophes au petit matin
# fin du fichier
`;

const FIELDS = { width: 1600, height: 1067, blurDataUrl: BLUR_PLACEHOLDER } as const;

function edited(
  source: string,
  ...edits: readonly {
    photoIndex: number;
    width: number;
    height: number;
    blurDataUrl: string;
  }[]
): string {
  const result = writePhotoFields(source, edits);
  if (result.state !== "edited") {
    throw new Error(`Expected an edit, got ${result.state}: ${JSON.stringify(result)}`);
  }
  return result.text;
}

function refusal(
  source: string,
  ...edits: readonly {
    photoIndex: number;
    width: number;
    height: number;
    blurDataUrl: string;
  }[]
): { reason: string; entryIndex?: number } {
  const result = writePhotoFields(source, edits);
  if (result.state !== "unsupported") {
    throw new Error(`Expected a refusal, got ${result.state}`);
  }
  return {
    reason: result.reason,
    ...(result.entryIndex === undefined ? {} : { entryIndex: result.entryIndex }),
  };
}

describe("a hand-written file, after three fields are added", () => {
  const text = edited(HAND_WRITTEN, { photoIndex: 0, ...FIELDS });

  it("is the original file with exactly three lines inserted", () => {
    expect(text).toBe(`# Japon, printemps 2024 — écrit à la main.
slug: japon-2024
title: "Japon, printemps 2024"

photos:
  # La première photo du voyage, celle de couverture.
  - src: /photos/japon-2024/tokyo.jpg
    alt: Une ruelle de Shinjuku sous la pluie # décrite pour un lecteur d'écran
    placeSlug: tokyo
    width: 1600
    height: 1067
    blurDataUrl: ${BLUR_PLACEHOLDER}

  - src: /photos/japon-2024/kyoto.jpg
    alt: Le chemin des philosophes au petit matin
# fin du fichier
`);
  });

  /**
   * The order of the three appended keys, pinned. Two splices at the same offset
   * are applied one after the other and come out reversed — the trap the
   * coordinates writer documents — so `height` above `width` is a real regression
   * this assertion is the only thing that would catch.
   */
  it("appends them in the order they are declared, not reversed", () => {
    const lines = text.split("\n");
    const keys = lines
      .map((line) => /^\s{4}(\w+):/.exec(line)?.[1])
      .filter((key): key is string => key !== undefined);

    expect(keys).toEqual(["alt", "placeSlug", "width", "height", "blurDataUrl", "alt"]);
  });

  it("loses no line the author wrote", () => {
    for (const line of HAND_WRITTEN.split("\n").filter((line) => line.trim() !== "")) {
      expect(text).toContain(line);
    }
  });

  it("re-reads its own output as two numbers and a string", () => {
    const parsed = parse(text) as { photos: { width: unknown; blurDataUrl: unknown }[] };

    expect(parsed.photos[0]?.width).toBe(1600);
    expect(parsed.photos[0]?.blurDataUrl).toBe(BLUR_PLACEHOLDER);
  });
});

describe("the author's own indentation", () => {
  it("is followed rather than normalised to two spaces", () => {
    const source = `photos:
    -   src: /photos/x/a.jpg
        alt: Une image
`;

    expect(edited(source, { photoIndex: 0, ...FIELDS })).toBe(`photos:
    -   src: /photos/x/a.jpg
        alt: Une image
        width: 1600
        height: 1067
        blurDataUrl: ${BLUR_PLACEHOLDER}
`);
  });
});

describe("fields that are already there", () => {
  it("replaces a stale width in place, keeping the comment on the line", () => {
    const source = `photos:
  - src: /photos/x/a.jpg
    alt: Une image
    width: 800 # mesuré avant recadrage
    height: 533
    blurDataUrl: ${BLUR_PLACEHOLDER}
`;

    expect(edited(source, { photoIndex: 0, ...FIELDS })).toBe(`photos:
  - src: /photos/x/a.jpg
    alt: Une image
    width: 1600 # mesuré avant recadrage
    height: 1067
    blurDataUrl: ${BLUR_PLACEHOLDER}
`);
  });

  it("fills in only the fields that are missing, next to the ones that are there", () => {
    const source = `photos:
  - src: /photos/x/a.jpg
    alt: Une image
    height: 1067
`;

    expect(edited(source, { photoIndex: 0, ...FIELDS })).toBe(`photos:
  - src: /photos/x/a.jpg
    alt: Une image
    height: 1067
    width: 1600
    blurDataUrl: ${BLUR_PLACEHOLDER}
`);
  });

  /**
   * The bug the coordinates writer paid for, in this module's own shape: on
   * `width: # à mesurer` the null scalar's range starts **at the `#`**, so a
   * naive insertion at the value's offset produces `width: 1600# à mesurer` —
   * which YAML then reads as the *string* `"1600# à mesurer"`. The comment is
   * absorbed into the scalar, gone on the next run, and the command exits 0
   * announcing the file was rewritten.
   */
  it("keeps a comment written on an empty « width: » line", () => {
    const source = `photos:
  - src: /photos/x/a.jpg
    alt: Une image
    width: # à mesurer
    height:
`;
    const text = edited(source, { photoIndex: 0, ...FIELDS });

    expect(text).toBe(`photos:
  - src: /photos/x/a.jpg
    alt: Une image
    width: 1600 # à mesurer
    height: 1067
    blurDataUrl: ${BLUR_PLACEHOLDER}
`);
    const parsed = parse(text) as { photos: { width: unknown }[] };
    expect(parsed.photos[0]?.width).toBe(1600);
  });

  /**
   * The tie `Splice.rank` exists for, in the one shape that cannot be walked
   * past: the last key is empty **and** the file ends without a newline, so the
   * value to fill in and the keys to append are the same byte offset. Without the
   * tie-break the appended key landed between `height:` and its value, and the
   * result was `All mapping items must start at the same column`.
   */
  it("fills an empty last key and appends beside it, on a file with no final newline", () => {
    const source = `photos:
  - src: /photos/x/a.jpg
    alt: Une image
    height:`;

    expect(edited(source, { photoIndex: 0, ...FIELDS })).toBe(`photos:
  - src: /photos/x/a.jpg
    alt: Une image
    height: 1067
    width: 1600
    blurDataUrl: ${BLUR_PLACEHOLDER}
`);
  });

  it("replaces an explicit null", () => {
    const source = `photos:
  - src: /photos/x/a.jpg
    alt: Une image
    width: null
    height: null
    blurDataUrl: null
`;

    expect(edited(source, { photoIndex: 0, ...FIELDS })).toBe(`photos:
  - src: /photos/x/a.jpg
    alt: Une image
    width: 1600
    height: 1067
    blurDataUrl: ${BLUR_PLACEHOLDER}
`);
  });

  /**
   * A quoted placeholder is replaced with a plain one, and the point of the case
   * is that the *value* is what changes: the writer emits one spelling, so a file
   * run twice converges instead of oscillating between two forms.
   */
  it("replaces a quoted placeholder with the spelling the writer emits", () => {
    const source = `photos:
  - src: /photos/x/a.jpg
    alt: Une image
    width: 1600
    height: 1067
    blurDataUrl: "data:image/webp;base64,AAAA"
`;

    expect(edited(source, { photoIndex: 0, ...FIELDS })).toContain(
      `blurDataUrl: ${BLUR_PLACEHOLDER}\n`
    );
  });
});

describe("several photos in one pass", () => {
  it("edits them all, each at its own indentation", () => {
    const source = `photos:
  - src: /photos/x/a.jpg
    alt: A
  -   src: /photos/x/b.jpg
      alt: B
`;

    expect(
      edited(
        source,
        { photoIndex: 0, ...FIELDS },
        { photoIndex: 1, width: 800, height: 600, blurDataUrl: BLUR_PLACEHOLDER }
      )
    ).toBe(`photos:
  - src: /photos/x/a.jpg
    alt: A
    width: 1600
    height: 1067
    blurDataUrl: ${BLUR_PLACEHOLDER}
  -   src: /photos/x/b.jpg
      alt: B
      width: 800
      height: 600
      blurDataUrl: ${BLUR_PLACEHOLDER}
`);
  });
});

describe("shapes this edit refuses rather than mangles", () => {
  const withValue = (value: string): string => `photos:
  - src: /photos/x/a.jpg
    alt: Une image
    width: ${value}
`;

  /**
   * A mapping or a list under `width:` is text the author typed, and there is no
   * acceptable way to write a number next to it: replacing it deletes his value
   * silently, and appending beside it produces invalid YAML. Same posture as the
   * coordinates writer's refusal, for the same two reasons.
   */
  it("refuses a width holding a mapping, and names what it found", () => {
    const result = refusal(withValue("\n      px: 1600"), { photoIndex: 0, ...FIELDS });

    expect(result.reason).toContain("width");
    expect(result.entryIndex).toBe(0);
  });

  it("refuses a width holding a list", () => {
    expect(refusal(withValue("\n      - 1600"), { photoIndex: 0, ...FIELDS }).entryIndex).toBe(0);
  });

  it("refuses a photo written as a flow mapping", () => {
    const source = `photos:
  - { src: /photos/x/a.jpg, alt: A }
`;
    const result = refusal(source, { photoIndex: 0, ...FIELDS });

    expect(result.reason).toContain("flow");
    expect(result.entryIndex).toBe(0);
  });

  it("refuses an index that is not a photo", () => {
    const source = `photos:
  - /photos/x/a.jpg
`;

    expect(refusal(source, { photoIndex: 0, ...FIELDS }).entryIndex).toBe(0);
  });

  /**
   * A refusal about the document as a whole carries **no** index, which is what
   * lets the caller tell "drop this photo and write the rest" from "no subset
   * would fare better". `writableSubset` in `index-photos.ts` reads exactly that.
   */
  it("leaves the index out of a refusal about the document itself", () => {
    const result = refusal(`photos: pas une liste\n`, { photoIndex: 0, ...FIELDS });

    expect(result.reason).toContain("photos");
    expect(result.entryIndex).toBeUndefined();
  });

  it("refuses a file that does not parse at all", () => {
    expect(
      refusal("photos:\n\t- src: a\n", { photoIndex: 0, ...FIELDS }).entryIndex
    ).toBeUndefined();
  });
});

describe("an empty edit list", () => {
  it("returns the source untouched, byte for byte", () => {
    const result = writePhotoFields(HAND_WRITTEN, []);

    expect(result).toEqual({ state: "edited", text: HAND_WRITTEN });
  });
});

describe("the line endings the author's editor uses", () => {
  it("are followed rather than mixed", () => {
    const source = "photos:\r\n  - src: /photos/x/a.jpg\r\n    alt: A\r\n";
    const text = edited(source, { photoIndex: 0, ...FIELDS });

    expect(text).toBe(
      `photos:\r\n  - src: /photos/x/a.jpg\r\n    alt: A\r\n    width: 1600\r\n    height: 1067\r\n    blurDataUrl: ${BLUR_PLACEHOLDER}\r\n`
    );
    expect(text.split("\n").every((line) => line === "" || line.endsWith("\r"))).toBe(true);
  });
});

/**
 * The guard on this module's own offset arithmetic. Parsing the result proves it
 * is *a* document, not the right one: a splice landing one entry early writes the
 * three fields onto the **previous** photo, which re-reads perfectly and is
 * wrong. So the values are read back at the index they were asked for.
 */
describe("the guard on the module's own offset arithmetic", () => {
  it("checks the fields it claims to have written, at the index it was given", () => {
    const source = `photos:
  - src: /photos/x/a.jpg
    alt: A
  - src: /photos/x/b.jpg
    alt: B
`;
    const text = edited(source, { photoIndex: 1, ...FIELDS });
    const parsed = parse(text) as { photos: { width?: unknown }[] };

    expect(parsed.photos[0]?.width).toBeUndefined();
    expect(parsed.photos[1]?.width).toBe(1600);
  });
});

/**
 * A placeholder is base64 and therefore safe as a YAML plain scalar — but the
 * writer must not *depend* on its caller having validated that. A value carrying
 * a `#`, a colon-space or a leading indicator has to come back out of the file as
 * the same string, or not be written at all.
 */
describe("a value that would break out of a plain scalar", () => {
  it.each([
    "data:image/webp;base64,AA # commentaire",
    "data: image/webp",
    "*alias",
    "@reserved",
    "",
  ])("survives the round trip when written as %o", (blurDataUrl) => {
    const source = `photos:
  - src: /photos/x/a.jpg
    alt: A
`;
    const result = writePhotoFields(source, [
      { photoIndex: 0, width: 1600, height: 1067, blurDataUrl },
    ]);

    // Either it is refused, or it comes back byte-identical. Silently writing a
    // different string is the one outcome that is not allowed.
    if (result.state === "edited") {
      const parsed = parse(result.text) as { photos: { blurDataUrl: unknown }[] };
      expect(parsed.photos[0]?.blurDataUrl).toBe(blurDataUrl);
    }
  });
});
