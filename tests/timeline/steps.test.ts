import { describe, expect, it } from "vitest";
import { timelineSteps } from "@/components/timeline/steps";
import { TripSchema } from "@/domain/schema";
import type { Trip } from "@/domain/schema";
import { BANGKOK, KYOTO, move, stay, TOKYO, tripInput } from "../domain/fixtures";

function parse(input: Record<string, unknown> = {}): Trip {
  return TripSchema.parse(tripInput(input));
}

describe("timelineSteps", () => {
  /**
   * The order is the content's order, not a sort applied here. `TripSchema`
   * already refuses steps that run backwards, so re-ordering in the view would
   * only hide a content fault the validator exists to report.
   */
  it("keeps the steps in the order the content declares", () => {
    const trip = parse();
    const rendered = timelineSteps(trip);

    expect(rendered).toHaveLength(trip.steps.length);
    expect(rendered.map((step) => step.kind)).toEqual(trip.steps.map((step) => step.kind));
  });

  /** …and that order really is chronological for a trip the schema accepted —
   * which is what makes "do not sort" safe rather than merely convenient. */
  it("produces dates that never run backwards", () => {
    const dates = timelineSteps(parse()).map((step) =>
      step.kind === "stay" ? step.startDate : step.date
    );

    expect([...dates].sort()).toEqual(dates);
  });

  it("resolves a stay to its declared place and counts its nights", () => {
    const [first] = timelineSteps(parse());

    expect(first).toMatchObject({
      kind: "stay",
      place: { slug: "tokyo", name: "Tokyo", countryCode: "JP" },
      startDate: "2024-04-12",
      endDate: "2024-04-16",
      nights: 4,
    });
  });

  it("resolves both ends of a move, keeping departure and arrival apart", () => {
    const [, second] = timelineSteps(parse());

    expect(second).toMatchObject({
      kind: "move",
      from: { slug: "tokyo" },
      to: { slug: "kyoto" },
      mode: "train",
      date: "2024-04-16",
    });
  });

  /** A day somewhere without sleeping there is a real step, and the case that
   * makes "nights" and "days" different numbers rather than the same one. */
  it("counts zero nights for a same-day stay", () => {
    const trip = parse({
      places: [TOKYO, KYOTO, BANGKOK],
      steps: [
        stay("tokyo", "2024-04-12", "2024-04-12"),
        move("tokyo", "kyoto", "train", "2024-04-12"),
        stay("kyoto", "2024-04-12", "2024-04-20"),
        move("kyoto", "bangkok", "plane", "2024-04-20"),
        stay("bangkok", "2024-04-20", "2024-04-22"),
      ],
    });

    expect(timelineSteps(trip)[0]).toMatchObject({ kind: "stay", nights: 0 });
  });

  /** Every step carries an anchor, and no two share one — a repeated `id` makes
   * every duplicate after the first unreachable. */
  it("gives every step a distinct anchor", () => {
    const anchors = timelineSteps(parse()).map((step) => step.anchor);

    expect(anchors.every((anchor) => anchor.length > 0)).toBe(true);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  /**
   * A trip that never went through `TripSchema` is a programming error, not a
   * rendering case. Skipping the step would draw an itinerary with a hole in it
   * and nothing to say so.
   */
  it("refuses a step naming a place that is not declared", () => {
    expect(() =>
      timelineSteps({
        places: [TOKYO],
        steps: [
          { kind: "move", fromSlug: "tokyo", toSlug: "atlantide", mode: "boat", date: "2024-04-16" },
        ],
      })
    ).toThrow(/atlantide/);
  });

  it("answers nothing for a trip with no steps", () => {
    expect(timelineSteps({ places: [], steps: [] })).toEqual([]);
  });
});
