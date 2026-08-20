import { describe, expect, it } from "vitest";
import { StepSchema, TripSchema } from "@/domain/schema";
import { drawableMoves } from "@/domain/route";
import { budgetPerPerson } from "@/domain/trip";
import {
  attempt,
  KYOTO_PHOTO,
  LYON,
  minimalTripInput,
  move,
  PARIS,
  pathsUnder,
  stay,
  TOKYO_PHOTO,
  tripInput,
} from "./fixtures";

/**
 * Defects found by an adversarial review of the first implementation, each one
 * pinned here before it was fixed. Nothing in this file duplicates the original
 * contract: these are the cases the 225 tests did not reach, and the reason each
 * one matters is stated where it is not obvious.
 */

describe("TripSchema — a missing move between two stays", () => {
  /**
   * The contributor's most likely edit is deleting a line, and a deleted `move`
   * leaves two stays touching. Every other rule is satisfied: the dates are
   * ordered, both places are declared and referenced, no move is malformed —
   * because there is no move. The trip page then announces two countries, the
   * timeline shows two stays, and the map silently loses its stroke.
   */
  it("rejects two consecutive stays in different places, and names both", () => {
    const outcome = attempt(
      TripSchema,
      minimalTripInput({
        endDate: "2024-06-04",
        places: [LYON, PARIS],
        steps: [
          stay("lyon", "2024-06-01", "2024-06-02"),
          stay("paris", "2024-06-02", "2024-06-04"),
        ],
      })
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("lyon");
    expect(outcome.errors).toContain("paris");
    expect(pathsUnder(outcome, "steps").length).toBeGreaterThan(0);
  });

  /**
   * The boundary of that rule, so it is not read as "never two stays in a row":
   * a stay split in two — a change of hotel, a rewritten note — describes no
   * journey between them, and there is nothing to draw or to tell.
   */
  it("accepts two consecutive stays in the same place, which is a split and not a gap", () => {
    const split = minimalTripInput({
      endDate: "2024-06-04",
      steps: [stay("lyon", "2024-06-01", "2024-06-02"), stay("lyon", "2024-06-02", "2024-06-04")],
    });

    expect(attempt(TripSchema, split).accepted).toBe(true);
  });
});

describe("TripSchema — one mistake, one error", () => {
  /**
   * Zod runs a `superRefine` even when a leaf check on a property has already
   * failed, so a cross-field rule can be handed `"2024-4-1"` and compare it
   * lexicographically against real days. Every comparison then answers nonsense,
   * and the nonsense is reported *on the entries that are fine*: measured, one
   * malformed trip date produced eight issues, six of which pointed away from it
   * — five at healthy steps, one at the end date. `validate:content` prints
   * these paths to a human.
   */
  it("reports a malformed trip date on that date alone, accusing no step", () => {
    const outcome = attempt(TripSchema, tripInput({ startDate: "2024-4-1" }));

    expect(outcome.accepted).toBe(false);
    expect([...new Set(outcome.paths)]).toEqual(["startDate"]);
    expect(outcome.paths.length).toBeLessThanOrEqual(2);
  });

  /** The same abstention one level down: a malformed step date is not also "out of range". */
  it("reports a malformed step date on that date alone", () => {
    const outcome = attempt(
      TripSchema,
      minimalTripInput({ steps: [stay("lyon", "2024-6-1", "2024-06-02")] })
    );

    expect(outcome.accepted).toBe(false);
    expect([...new Set(outcome.paths)]).toEqual(["steps.0.startDate"]);
  });
});

describe("TripSchema — duplicates in the collections", () => {
  it("rejects two identical tags, and names the duplicate", () => {
    const outcome = attempt(TripSchema, tripInput({ tags: ["asie", "train", "asie"] }));

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("asie");
    expect(pathsUnder(outcome, "tags").length).toBeGreaterThan(0);
  });

  /** A duplicated `src` also makes `coverPhotoSrc` ambiguous: it matches two entries. */
  it("rejects two photos sharing the same src, and names it", () => {
    const outcome = attempt(
      TripSchema,
      tripInput({ photos: [TOKYO_PHOTO, { ...KYOTO_PHOTO, src: TOKYO_PHOTO.src }] })
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain(TOKYO_PHOTO.src);
    expect(pathsUnder(outcome, "photos").length).toBeGreaterThan(0);
  });
});

describe("drawableMoves — a coordinate that is not a number", () => {
  /**
   * `NaN < 1` is `false`, so a "shorter than a kilometre" guard written as a
   * comparison lets a non-finite distance straight through and into the SVG,
   * where it becomes `d="M NaN,NaN …"` and the segment disappears without a
   * word. `CoordinatesSchema` rejects `NaN`, so this can only arrive from an
   * unparsed caller — which is exactly what the two lines above it, guarding an
   * unresolved slug, already assume can happen.
   */
  const brokenPlace = {
    slug: "lyon",
    name: "Lyon",
    countryCode: "FR",
    coordinates: { lat: Number.NaN, lon: 4.8357 },
  };

  const soundPlace = { ...brokenPlace, coordinates: { lat: 45.764, lon: 4.8357 } };

  const steps = [StepSchema.parse(move("paris", "lyon", "train", "2024-06-01"))];

  it("draws nothing for a move it cannot measure", () => {
    expect(drawableMoves({ places: [PARIS, brokenPlace], steps })).toEqual([]);
  });

  /** The control: the very same trip with a finite latitude does yield a segment. */
  it("draws the same move once its coordinates are finite", () => {
    expect(drawableMoves({ places: [PARIS, soundPlace], steps })).toHaveLength(1);
  });
});

describe("budgetPerPerson — an empty YAML key", () => {
  /**
   * `budget:` with nothing after it parses as `null`, not `undefined`. A strict
   * `=== undefined` then walks into `null.totalCents`, and the trip page — the
   * one place that renders a budget — is the page that crashes.
   */
  it("returns null for a budget key left empty", () => {
    expect(budgetPerPerson({ budget: null })).toBeNull();
  });
});
