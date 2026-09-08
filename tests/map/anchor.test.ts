import { describe, expect, it } from "vitest";
import { labelAnchorOf, ringsOfPath } from "@/map/anchor";
import { loadWorldDataset } from "@/map/dataset";

/**
 * Where the map hangs a country's own note.
 *
 * TIW-39 gives four countries a third tint — « à venir » — and an HTML element
 * over each of them carrying the words. That element needs **one point**, and the
 * two obvious answers are both wrong on real shapes:
 *
 * - the **bounding-box centre** of Croatia falls in Bosnia, because Croatia is a
 *   boomerang;
 * - the **centroid** of Portugal falls in the Atlantic, because the 50m dataset
 *   draws the Azores and Madeira and the average is pulled 600 km west.
 *
 * A note anchored outside its own country is worse than no note: it labels a
 * neighbour. So the anchor is the *pole of inaccessibility* — the interior point
 * furthest from any edge — which is what every map-labelling library uses and the
 * only definition that is inside the shape **by construction**.
 *
 * The cases below are in two halves. The first half is arithmetic on shapes small
 * enough to check by hand, including the two degenerate ones the parser can meet.
 * The second half runs the real basemap and asserts the one property that
 * matters: the answer is inside the country it names.
 */

/** A ring, as this module writes them, for a readable expectation. */
const ring = (...pairs: readonly (readonly [number, number])[]): string =>
  `M${pairs.map(([x, y]) => `${x},${y}`).join("L")}Z`;

describe("reading the rings out of a projected path", () => {
  it("reads a single closed ring", () => {
    expect(
      ringsOfPath(
        ring([0, 0], [10, 0], [10, 10], [0, 10])
      )
    ).toEqual([
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    ]);
  });

  it("reads several rings, which is what a country with islands is", () => {
    const path = `${ring([0, 0], [4, 0], [4, 4], [0, 4])}${ring([10, 10], [12, 10], [12, 12])}`;

    expect(ringsOfPath(path).map((entry) => entry.length)).toEqual([4, 3]);
  });

  it("reads negative and fractional coordinates, which the projection produces", () => {
    expect(ringsOfPath("M-1.5,2.5L3,-0.5L4,4Z")).toEqual([
      [
        { x: -1.5, y: 2.5 },
        { x: 3, y: -0.5 },
        { x: 4, y: 4 },
      ],
    ]);
  });

  /**
   * The refusal, and it is deliberate rather than defensive. `src/map/dataset.ts`
   * writes every country through `createRoundingPathContext`, whose whole
   * vocabulary is `M`, `L` and `Z`. A path carrying anything else did not come
   * from there — so guessing at it would produce an anchor for a shape this module
   * never read.
   */
  it("answers nothing for a path it cannot read in full", () => {
    expect(ringsOfPath("M0,0A5,5 0 0,1 10,10Z")).toEqual([]);
    expect(ringsOfPath("")).toEqual([]);
  });
});

describe("the anchor of a shape", () => {
  it("is the centre of a square", () => {
    expect(labelAnchorOf(ring([0, 0], [20, 0], [20, 20], [0, 20]))).toEqual({ x: 10, y: 10 });
  });

  /**
   * The Croatia case, in miniature: an L whose bounding-box centre and whose
   * centroid both fall in the notch. Only an interior point can be right, and the
   * furthest-from-an-edge one lands in the thick end of the L.
   */
  it("stays inside an L-shaped country whose box centre is outside it", () => {
    const shape = "M0,0L40,0L40,10L10,10L10,40L0,40Z";
    const anchor = labelAnchorOf(shape);

    expect(anchor).not.toBeNull();
    // The box centre (20, 20) is in the notch; the answer must not be.
    expect(anchor?.x === 20 && anchor?.y === 20).toBe(false);
    expect(insideRings(ringsOfPath(shape), anchor)).toBe(true);
  });

  /**
   * The Portugal case, in miniature: a mainland and two far islands. The centroid
   * of everything sits in the water between them; the anchor must sit in the
   * mainland, which is the largest ring.
   */
  it("ignores the islands and lands in the mainland", () => {
    const mainland = ring([0, 0], [20, 0], [20, 60], [0, 60]);
    const islet = ring([190, 30], [194, 30], [194, 34], [190, 34]);
    const anchor = labelAnchorOf(`${mainland}${islet}`);

    expect(anchor?.x).toBeLessThan(20);
    expect(anchor?.y).toBeGreaterThan(0);
  });

  /**
   * A hole is a ring wound the other way, and `src/map/dataset.ts` merges every
   * ring of a country into one `d`. Lesotho inside South Africa is the real case;
   * an anchor that ignored holes could name a country by pointing at the one
   * enclave that is not it.
   */
  it("never lands in a hole", () => {
    const outer = ring([0, 0], [60, 0], [60, 60], [0, 60]);
    // A hole covering the middle, leaving a thick frame around it.
    const hole = ring([12, 12], [12, 48], [48, 48], [48, 12]);
    const anchor = labelAnchorOf(`${outer}${hole}`);

    expect(anchor).not.toBeNull();
    expect(insideRings(ringsOfPath(`${outer}${hole}`), anchor)).toBe(true);
  });

  it("answers nothing rather than a guess for a path with no area", () => {
    expect(labelAnchorOf("")).toBeNull();
    // A degenerate ring: three collinear points enclose nothing.
    expect(labelAnchorOf("M0,0L10,0L20,0Z")).toBeNull();
  });

  it("rounds like a path coordinate does, so two builds agree to the byte", () => {
    const anchor = labelAnchorOf(ring([0, 0], [7, 0], [7, 7], [0, 7]));

    expect(anchor).not.toBeNull();
    for (const value of [anchor?.x ?? 0, anchor?.y ?? 0]) {
      expect(Math.round(value * 10) / 10).toBe(value);
    }
  });
});

/**
 * **The half that would have caught the two wrong answers.** It runs the shipped
 * basemap rather than a fixture, and asks the only question a reader cares about:
 * is the note drawn on the country it names?
 */
describe("the anchor of a real country, on the shipped basemap", () => {
  const dataset = loadWorldDataset();
  const pathOf = (numeric: string): string => {
    const geometry = dataset.geometries.find((entry) => entry.id === numeric);
    if (geometry === undefined) {
      throw new Error(`the 50m basemap has no geometry with the ISO numeric ${numeric}.`);
    }

    return geometry.path;
  };

  /** The four TIW-39 asks for, plus the two whose easy answers are wrong. */
  it.each([
    ["Croatie", "191"],
    ["Italie", "380"],
    ["Monténégro", "499"],
    ["Portugal", "620"],
    ["Afrique du Sud, qui enferme le Lesotho", "710"],
    ["Norvège, longue et découpée", "578"],
  ])("falls inside %s", (_label, numeric) => {
    const path = pathOf(numeric);
    const anchor = labelAnchorOf(path);

    expect(anchor).not.toBeNull();
    expect(insideRings(ringsOfPath(path), anchor)).toBe(true);
  });
});

/**
 * Even-odd containment, written here and not imported, so the assertion is not
 * the implementation checking itself. Deliberately the naive ray cast: this is a
 * test, and clarity is worth more than the edge cases a shared helper would
 * handle identically in both places.
 */
function insideRings(
  rings: readonly (readonly { readonly x: number; readonly y: number }[])[],
  point: { readonly x: number; readonly y: number } | null | undefined
): boolean {
  if (point === null || point === undefined) {
    return false;
  }

  let crossings = 0;
  for (const shape of rings) {
    for (let index = 0; index < shape.length; index += 1) {
      const a = shape[index];
      const b = shape[(index + 1) % shape.length];
      if (a === undefined || b === undefined) {
        continue;
      }
      if (a.y > point.y !== b.y > point.y) {
        const crossX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (crossX > point.x) {
          crossings += 1;
        }
      }
    }
  }

  return crossings % 2 === 1;
}
