import { describe, expect, it } from "vitest";
import { writeCoordinates } from "@/content/yaml-edit";

/**
 * Constraint A of TIW-10: writing two numbers into a hand-written file must not
 * reformat it. Thomas's comments, his key order, his quoting style, his blank
 * lines and his indentation are the file — a rewrite that loses them is a
 * failure even when the result is valid YAML.
 *
 * These cases therefore compare **whole file text**, not a parsed value: a
 * semantic comparison is exactly the comparison that cannot see the damage.
 */

/** The reference file: a comment on the first line, one between two keys, one at */
/* the end of a line, a blank line inside a list, and a trailing comment. */
const HAND_WRITTEN = `# Japon, printemps 2024 — écrit à la main, ne pas reformater.
slug: japon-2024
title: "Japon, printemps 2024" # les guillemets sont voulus

# Les lieux, dans l'ordre où je les ai visités.
places:
  - slug: tokyo
    name: Tokyo
    countryCode: JP
    coordinates:
      lat: 35.6762
      lon: 139.6503

  # Kyoto : à géocoder, je n'ai pas les coordonnées.
  - slug: kyoto
    name: Kyoto # l'ancienne capitale
    countryCode: JP

steps:
  - kind: stay
    placeSlug: tokyo
    startDate: 2024-04-12
    endDate: 2024-04-16
# fin du fichier
`;

function edited(
  source: string,
  ...edits: readonly { placeIndex: number; lat: number; lon: number }[]
) {
  const result = writeCoordinates(source, edits);
  if (result.state !== "edited") {
    throw new Error(`Expected an edit, got ${result.state}: ${JSON.stringify(result)}`);
  }
  return result.text;
}

describe("a hand-written file, after two numbers are added", () => {
  const text = edited(HAND_WRITTEN, { placeIndex: 1, lat: 35.02107, lon: 135.75385 });

  it("is the original file with exactly three lines inserted", () => {
    expect(text).toBe(`# Japon, printemps 2024 — écrit à la main, ne pas reformater.
slug: japon-2024
title: "Japon, printemps 2024" # les guillemets sont voulus

# Les lieux, dans l'ordre où je les ai visités.
places:
  - slug: tokyo
    name: Tokyo
    countryCode: JP
    coordinates:
      lat: 35.6762
      lon: 139.6503

  # Kyoto : à géocoder, je n'ai pas les coordonnées.
  - slug: kyoto
    name: Kyoto # l'ancienne capitale
    countryCode: JP
    coordinates:
      lat: 35.02107
      lon: 135.75385

steps:
  - kind: stay
    placeSlug: tokyo
    startDate: 2024-04-12
    endDate: 2024-04-16
# fin du fichier
`);
  });

  it("adds no line that was not asked for", () => {
    const before = HAND_WRITTEN.split("\n");
    const after = text.split("\n");
    // `    coordinates:` is not in this list: Tokyo already had one, so the line
    // is not new to the file even though it is new to Kyoto.
    const inserted = after.filter((line) => !before.includes(line));

    expect(inserted).toEqual(["      lat: 35.02107", "      lon: 135.75385"]);
  });

  it("loses no line the author wrote", () => {
    const after = text.split("\n");

    for (const line of HAND_WRITTEN.split("\n")) {
      expect(after).toContain(line);
    }
  });
});

describe("the author's own indentation", () => {
  it("is followed rather than normalised to two spaces", () => {
    const source = `places:
    -   slug: tokyo
        name: Tokyo
        countryCode: JP   # aligné à la main
`;

    expect(edited(source, { placeIndex: 0, lat: 35.6895, lon: 139.69171 })).toBe(`places:
    -   slug: tokyo
        name: Tokyo
        countryCode: JP   # aligné à la main
        coordinates:
          lat: 35.6895
          lon: 139.69171
`);
  });
});

describe("coordinates that are already there but wrong", () => {
  it("replaces (0, 0) in place, keeping the comment on the line", () => {
    const source = `places:
  - slug: tokyo
    name: Tokyo
    coordinates:
      lat: 0 # géocodage raté
      lon: 0
`;

    expect(edited(source, { placeIndex: 0, lat: 35.6895, lon: 139.69171 })).toBe(`places:
  - slug: tokyo
    name: Tokyo
    coordinates:
      lat: 35.6895 # géocodage raté
      lon: 139.69171
`);
  });

  it("keeps a flow mapping flow", () => {
    const source = `places:
  - slug: tokyo
    coordinates: { lat: 0, lon: 0 }
`;

    expect(edited(source, { placeIndex: 0, lat: 35.6895, lon: 139.69171 })).toBe(`places:
  - slug: tokyo
    coordinates: { lat: 35.6895, lon: 139.69171 }
`);
  });

  it("fills in the axis that is missing, next to the one that is there", () => {
    const source = `places:
  - slug: tokyo
    coordinates:
      lat: 35.6895
`;

    expect(edited(source, { placeIndex: 0, lat: 35.6895, lon: 139.69171 })).toBe(`places:
  - slug: tokyo
    coordinates:
      lat: 35.6895
      lon: 139.69171
`);
  });

  /**
   * The combination that was broken, and the most natural one to write by hand:
   * an empty `coordinates:` key **with** a comment on it. Measured — the null
   * scalar's range starts *at the `#`*, not after the colon, so the splice ate the
   * `: ` separator and the block landed flush against the comment:
   *
   *     lon: 135.75385# rempli par « npm run geocode japon-2024 »
   *
   * `lon` was then the *string* `"135.75385# rempli par …"`, the comment was
   * absorbed into the scalar and lost for good on the next run, and the command
   * exited 0 announcing the file had been rewritten.
   */
  it("keeps a comment written on an empty « coordinates: » line", () => {
    const source = `places:
  - slug: kyoto
    name: Kyoto
    countryCode: JP
    coordinates: # rempli par « npm run geocode japon-2024 »
`;

    expect(edited(source, { placeIndex: 0, lat: 35.02107, lon: 135.75385 })).toBe(`places:
  - slug: kyoto
    name: Kyoto
    countryCode: JP
    coordinates: # rempli par « npm run geocode japon-2024 »
      lat: 35.02107
      lon: 135.75385
`);
  });

  it("re-reads its own output as two numbers, not as a string", async () => {
    const { parse } = await import("yaml");
    const source = `places:
  - slug: kyoto
    coordinates: # à géocoder
`;
    const parsed = parse(edited(source, { placeIndex: 0, lat: 35.02107, lon: 135.75385 })) as {
      places: { coordinates: unknown }[];
    };

    expect(parsed.places[0]?.coordinates).toEqual({ lat: 35.02107, lon: 135.75385 });
  });

  /**
   * `coordinates: 42` n'est pas des coordonnées, et n'est pas non plus une clé
   * vide : l'auteur a tapé *quelque chose*. Écrire le bloc par-dessus garderait
   * le commentaire et supprimerait le `42` en silence ; l'ajouter en dessous
   * produirait du YAML invalide (`yaml.parse` jette « All mapping items must
   * start at the same column »). La valeur est donc nommée et le fichier laissé
   * intact.
   */
  it("refuses a « coordinates: » holding a value it cannot read, rather than deleting it", () => {
    const source = `places:
  - slug: kyoto
    coordinates: 42 # bizarre, mais c'est le fichier de l'auteur
`;
    const result = writeCoordinates(source, [{ placeIndex: 0, lat: 35.02107, lon: 135.75385 }]);

    expect(result.state).toBe("unsupported");
    if (result.state === "unsupported") {
      expect(result.reason).toContain("42");
    }
  });

  /**
   * This case used to be pinned the other way round — the two keys were appended
   * next to the misspelling, and the file came back with **four** keys, exit 0
   * and "fichier réécrit", after which `validate:content` refused it because
   * `CoordinatesSchema` is strict. Writing a file this command has just declared
   * good is worse than refusing to write it, so the misspelling is now named.
   */
  it("refuses to write beside a misspelled axis rather than leaving four keys", () => {
    const source = `places:
  - slug: tokyo
    coordinates:
      latitude: 35.6
`;
    const result = writeCoordinates(source, [{ placeIndex: 0, lat: 35.6895, lon: 139.69171 }]);

    expect(result.state).toBe("unsupported");
    if (result.state === "unsupported") {
      expect(result.reason).toContain("latitude");
    }
  });

  it("appends the axis that is missing when the mapping is otherwise clean", () => {
    const source = `places:
  - slug: tokyo
    coordinates:
      lat: 35.6
`;

    expect(edited(source, { placeIndex: 0, lat: 35.6895, lon: 139.69171 })).toBe(`places:
  - slug: tokyo
    coordinates:
      lat: 35.6895
      lon: 139.69171
`);
  });

  it("rewrites a flow mapping that is missing an axis as a block", () => {
    const source = `places:
  - slug: tokyo
    coordinates: { lat: 0 }
`;

    expect(edited(source, { placeIndex: 0, lat: 35.6895, lon: 139.69171 })).toBe(`places:
  - slug: tokyo
    coordinates:
      lat: 35.6895
      lon: 139.69171
`);
  });

  it("fills in a « coordinates: » key left empty", () => {
    const source = `places:
  - slug: tokyo
    coordinates:
steps: []
`;

    expect(edited(source, { placeIndex: 0, lat: 35.6895, lon: 139.69171 })).toBe(`places:
  - slug: tokyo
    coordinates:
      lat: 35.6895
      lon: 139.69171
steps: []
`);
  });
});

describe("several places in one pass", () => {
  it("edits them all, and each at its own indentation", () => {
    const source = `places:
  - slug: tokyo
    name: Tokyo
  - slug: kyoto
    name: Kyoto
steps: []
`;

    expect(
      edited(
        source,
        { placeIndex: 0, lat: 35.6895, lon: 139.69171 },
        { placeIndex: 1, lat: 35.02107, lon: 135.75385 }
      )
    ).toBe(`places:
  - slug: tokyo
    name: Tokyo
    coordinates:
      lat: 35.6895
      lon: 139.69171
  - slug: kyoto
    name: Kyoto
    coordinates:
      lat: 35.02107
      lon: 135.75385
steps: []
`);
  });
});

describe("numbers are written as decimals, never in exponent notation", () => {
  it("keeps a very small longitude readable", () => {
    const source = `places:
  - slug: null-ile
    name: Ile
`;
    // `String(1e-7)` is "1e-7"; YAML reads it, a human reading a diff does not.
    expect(edited(source, { placeIndex: 0, lat: 51.5, lon: 1e-7 })).toContain("lon: 0.0000001");
  });

  it("does not print trailing zeros", () => {
    const source = `places:
  - slug: a
    name: A
`;
    expect(edited(source, { placeIndex: 0, lat: -33.5, lon: 0 })).toContain("lat: -33.5\n");
    expect(edited(source, { placeIndex: 0, lat: -33.5, lon: 0 })).toContain("lon: 0\n");
  });
});

describe("shapes this edit refuses rather than mangles", () => {
  it("refuses a place written as a flow mapping", () => {
    const source = `places:
  - { slug: tokyo, name: Tokyo }
`;
    const result = writeCoordinates(source, [{ placeIndex: 0, lat: 35.6, lon: 139.7 }]);

    expect(result.state).toBe("unsupported");
    if (result.state === "unsupported") {
      expect(result.reason).toContain("flow");
    }
  });

  it("refuses an index that is not a place", () => {
    const source = `places:
  - slug: tokyo
    name: Tokyo
`;
    expect(writeCoordinates(source, [{ placeIndex: 4, lat: 1, lon: 2 }]).state).toBe("unsupported");
  });

  it("refuses a document whose places[] is not a list", () => {
    expect(writeCoordinates("places: tokyo\n", [{ placeIndex: 0, lat: 1, lon: 2 }]).state).toBe(
      "unsupported"
    );
  });
});

describe("an empty edit list", () => {
  it("returns the source untouched, byte for byte", () => {
    const result = writeCoordinates(HAND_WRITTEN, []);

    expect(result).toEqual({ state: "edited", text: HAND_WRITTEN });
  });
});

describe("the result is still the document it was", () => {
  it("adds the coordinates and changes nothing else, semantically", async () => {
    const { parse } = await import("yaml");
    const before = parse(HAND_WRITTEN) as Record<string, unknown>;
    const after = parse(
      edited(HAND_WRITTEN, { placeIndex: 1, lat: 35.02107, lon: 135.75385 })
    ) as Record<string, unknown>;

    const places = before["places"] as Record<string, unknown>[];
    const kyoto = places[1];
    if (kyoto === undefined) {
      throw new Error("fixture lost its second place");
    }
    kyoto["coordinates"] = { lat: 35.02107, lon: 135.75385 };

    expect(after).toEqual(before);
  });
});

describe("the line endings the author's editor uses", () => {
  it("are followed rather than mixed", () => {
    const source = "places:\r\n  - slug: tokyo\r\n    name: Tokyo\r\n";
    const text = edited(source, { placeIndex: 0, lat: 35.6895, lon: 139.69171 });

    expect(text).toBe(
      "places:\r\n  - slug: tokyo\r\n    name: Tokyo\r\n" +
        "    coordinates:\r\n      lat: 35.6895\r\n      lon: 139.69171\r\n"
    );
    // Not one bare newline anywhere: a mixed file is a diff on every line.
    expect(/(^|[^\r])\n/.test(text)).toBe(false);
  });

  it("are followed when a comment has to be kept on the key's line too", () => {
    const source = "places:\r\n  - slug: tokyo\r\n    coordinates: # à faire\r\n";

    expect(edited(source, { placeIndex: 0, lat: 35.6895, lon: 139.69171 })).toBe(
      "places:\r\n  - slug: tokyo\r\n    coordinates: # à faire\r\n" +
        "      lat: 35.6895\r\n      lon: 139.69171\r\n"
    );
  });
});

/**
 * A refusal is per-place, and the caller drops that place and retries with the
 * rest — three cities resolved and thrown away because a fourth is written
 * `{ latitude: … }` is three requests spent for nothing. So the index is part of
 * the result, not something the caller has to parse back out of a sentence.
 */
describe("which place a refusal is about", () => {
  const TWO_PLACES = `places:
  - slug: tokyo
    name: Tokyo
  - slug: nara
    name: Nara
    coordinates: { latitude: 34.685, longitude: 135.805 }
`;

  it("names the index it refuses, not just the reason", () => {
    const result = writeCoordinates(TWO_PLACES, [
      { placeIndex: 0, lat: 35.6895, lon: 139.69171 },
      { placeIndex: 1, lat: 34.685, lon: 135.805 },
    ]);

    expect(result.state).toBe("unsupported");
    if (result.state !== "unsupported") return;
    expect(result.entryIndex).toBe(1);
  });

  it("writes the rest once that place is dropped", () => {
    expect(edited(TWO_PLACES, { placeIndex: 0, lat: 35.6895, lon: 139.69171 })).toBe(`places:
  - slug: tokyo
    name: Tokyo
    coordinates:
      lat: 35.6895
      lon: 139.69171
  - slug: nara
    name: Nara
    coordinates: { latitude: 34.685, longitude: 135.805 }
`);
  });

  it("names the index of a place that is not a mapping at all", () => {
    const result = writeCoordinates("places:\n  - tokyo\n", [
      { placeIndex: 0, lat: 35.6, lon: 139.7 },
    ]);

    expect(result.state).toBe("unsupported");
    if (result.state !== "unsupported") return;
    expect(result.entryIndex).toBe(0);
  });

  it("leaves the index out of a refusal about the document itself", () => {
    const result = writeCoordinates("places: tokyo\n", [{ placeIndex: 0, lat: 1, lon: 2 }]);

    expect(result.state).toBe("unsupported");
    if (result.state !== "unsupported") return;
    expect(result.entryIndex).toBeUndefined();
  });
});

/**
 * Criterion 4 forbids (0, 0), and the file only ever holds seven decimals: a
 * candidate at `1e-8, -1e-8` is not (0, 0) to the domain and *is* (0, 0) once
 * written. The guard therefore has to run on the rounded pair — the read-back
 * check cannot see it, since it compares against the rounded value too.
 */
describe("coordinates that only become (0, 0) on the way to the file", () => {
  const SOURCE = `places:
  - slug: tiny
    name: Tiny
`;

  it("refuses the pair that would be written rather than the one it was handed", () => {
    const result = writeCoordinates(SOURCE, [{ placeIndex: 0, lat: 1e-8, lon: -1e-8 }]);

    expect(result.state).toBe("unsupported");
    if (result.state !== "unsupported") return;
    expect(result.reason).toContain("(0, 0)");
    expect(result.entryIndex).toBe(0);
  });

  it("still accepts a single axis that rounds to zero", () => {
    expect(edited(SOURCE, { placeIndex: 0, lat: 51.5, lon: 1e-9 })).toContain("lon: 0\n");
  });
});

/**
 * These sentences quote two things that come from the author's file: a key name
 * and a slice of the source. Both are printed to a terminal, so both are
 * neutralised **here**, where they are interpolated — not at the caller. A
 * report that stops bounding its inputs must not be able to reopen the hole
 * `finding.ts` was written to close.
 */
describe("a hostile key name in a refusal", () => {
  it("comes back escaped, not as a live escape sequence", () => {
    const source = `places:
  - slug: tokyo
    coordinates:
      "lo\\e[2J\\e[31mPWNED": 1
`;
    const result = writeCoordinates(source, [{ placeIndex: 0, lat: 35.6895, lon: 139.69171 }]);

    expect(result.state).toBe("unsupported");
    if (result.state !== "unsupported") return;
    expect(result.reason).not.toContain("\u001b");
    expect(result.reason).toContain("\\e[2J");
  });

  it("comes back bounded, so one key cannot drown the transcript", () => {
    const source = `places:
  - slug: tokyo
    coordinates:
      ${"lo".repeat(150)}: 1
`;
    const result = writeCoordinates(source, [{ placeIndex: 0, lat: 35.6895, lon: 139.69171 }]);

    expect(result.state).toBe("unsupported");
    if (result.state !== "unsupported") return;
    expect(result.reason).toContain("…");
    expect(result.reason.length).toBeLessThan(200);
  });
});

describe("the wording of a refusal", () => {
  it("does not repeat the « places[N] » the caller already prints", () => {
    const source = `places:
  - slug: tokyo
    coordinates:
      latitude: 35.6
`;
    const result = writeCoordinates(source, [{ placeIndex: 0, lat: 35.6895, lon: 139.69171 }]);

    expect(result.state).toBe("unsupported");
    if (result.state !== "unsupported") return;
    expect(result.reason).not.toContain("places[");
  });
});

describe("the guard on the module's own offset arithmetic", () => {
  it("checks the coordinates it claims to have written, at the index it was given", () => {
    // Two places, one edit: the verification must look at places[1] and not be
    // satisfied by the healthy coordinates sitting at places[0].
    const source = `places:
  - slug: tokyo
    coordinates:
      lat: 35.6895
      lon: 139.69171
  - slug: kyoto
    coordinates: # à géocoder
`;

    expect(edited(source, { placeIndex: 1, lat: 35.02107, lon: 135.75385 })).toContain(
      "    coordinates: # à géocoder\n      lat: 35.02107\n      lon: 135.75385\n"
    );
  });
});
