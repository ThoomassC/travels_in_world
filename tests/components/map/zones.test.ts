import { describe, expect, it } from "vitest";
import { frameAround } from "@/components/map/frame";
import { placeMarks, spreadCoincident, type TripMark } from "@/components/map/marks";
import { ZONE_RADIUS_PERCENT, worldPointOf, zonesOf } from "@/components/map/zones";

/**
 * Which markers a reader would take for one place, and what the panel therefore
 * has to list — the arithmetic behind the acceptance criterion "several trips in
 * the zone: sorted by date descending, all reachable".
 *
 * Pure, for the reason the rest of this folder is pure: the answer depends on
 * distances and on a sort, both of which are worth many cases and none of which
 * needs a browser.
 */

const WORLD = { width: 960, height: 500 };

const mark = (slug: string, startDate: string, x: number, y: number): TripMark => ({
  slug,
  title: slug,
  placeName: slug,
  startDate,
  href: `/fr/voyages/${slug}`,
  story: "written",
  point: { x, y },
});

/** The frame the whole world produces, so a percentage is a world unit / 9.6. */
const WHOLE = frameAround([], WORLD);

const place = (marks: readonly TripMark[], frame = WHOLE) =>
  spreadCoincident(placeMarks(marks, frame), frame);

/**
 * Indexed access, without the non-null assertion this repository's sources do
 * not use. A missing entry is a defect of the test's own setup, so it fails here
 * with the reason rather than three assertions later with `undefined`.
 */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`No entry at index ${index} of a list of ${list.length}.`);
  }
  return value;
}

describe("worldPointOf", () => {
  it("is the inverse of placeMarks, so a marker lands back on its own point", () => {
    const marks = [mark("a", "2024-01-01", 137.4, 92.6), mark("b", "2023-01-01", 812.9, 407.1)];
    const placed = placeMarks(marks, WHOLE);

    expect(worldPointOf(at(placed, 0), WHOLE).x).toBeCloseTo(137.4, 1);
    expect(worldPointOf(at(placed, 0), WHOLE).y).toBeCloseTo(92.6, 1);
    expect(worldPointOf(at(placed, 1), WHOLE).x).toBeCloseTo(812.9, 1);
    expect(worldPointOf(at(placed, 1), WHOLE).y).toBeCloseTo(407.1, 1);
  });

  it("survives a cropped frame, where a percentage is not a world unit", () => {
    const frame = frameAround(
      [
        { x: 300, y: 120 },
        { x: 700, y: 300 },
      ],
      WORLD
    );
    const placed = placeMarks([mark("a", "2024-01-01", 512.5, 210.25)], frame);

    expect(worldPointOf(at(placed, 0), frame).x).toBeCloseTo(512.5, 1);
    expect(worldPointOf(at(placed, 0), frame).y).toBeCloseTo(210.25, 1);
  });

  it("carries the coincidence spread into world units, which is what lets zoom separate it", () => {
    /**
     * The property this function exists for. Two trips leaving the same city are
     * nudged apart by `spreadCoincident` in *percent of the frame*; expressed
     * back in world units, that nudge becomes a fixed distance on the map, so
     * zooming in grows it on screen and the two markers genuinely separate.
     * Had the component kept the percentages, the pair would have stayed exactly
     * as overlapped at every zoom level — the defect
     * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` assigns to this ticket.
     */
    const same = { x: 500, y: 250 };
    const placed = place([
      mark("a", "2024-01-01", same.x, same.y),
      mark("b", "2023-01-01", same.x, same.y),
    ]);

    const first = worldPointOf(at(placed, 0), WHOLE);
    const second = worldPointOf(at(placed, 1), WHOLE);

    expect(first).not.toEqual(second);
    // Both still name the same city: the nudge is small in world units.
    for (const point of [first, second]) {
      expect(Math.hypot(point.x - same.x, point.y - same.y)).toBeLessThan(20);
    }
  });
});

describe("zonesOf", () => {
  it("has no zone when there is no marker", () => {
    // The production state today: `content/trips` is empty until TIW-24.
    expect(zonesOf([], WHOLE)).toEqual([]);
  });

  it("gives a lone marker a zone of its own, named after its trip", () => {
    const zones = zonesOf(place([mark("islande-2022", "2022-09-10", 400, 120)]), WHOLE);

    expect(zones).toHaveLength(1);
    expect(zones[0]?.id).toBe("islande-2022");
    expect(zones[0]?.marks.map((entry) => entry.mark.slug)).toEqual(["islande-2022"]);
  });

  it("puts two far-apart markers in two zones", () => {
    const zones = zonesOf(
      place([mark("a", "2024-01-01", 100, 100), mark("b", "2023-01-01", 800, 400)]),
      WHOLE
    );

    expect(zones).toHaveLength(2);
  });

  it("puts two markers a reader could not tell apart in one zone", () => {
    /**
     * Tokyo and Osaka, the fixture's own case: about 400 km apart, which over a
     * cropped world is a handful of pixels. It is the pair that makes axe's
     * `target-size` fire on the delivered map (see
     * `tests/e2e/map-equivalent.populated.spec.ts`), so it is exactly the pair a
     * zone has to hold — the criterion is "several trips in the zone", and a
     * reader clicking there cannot have meant one of them in particular.
     */
    const zones = zonesOf(
      place([
        mark("japon-2024", "2024-04-12", 830.4, 172.6),
        mark("japon-2025", "2025-03-02", 826.2, 176.1),
      ]),
      WHOLE
    );

    expect(zones).toHaveLength(1);
    expect(zones[0]?.marks).toHaveLength(2);
  });

  it("sorts a zone by date descending, then by slug, whatever order it was given", () => {
    /**
     * Explicit rather than inherited. The content façade already hands markers in
     * that order and `world-map.tsx` never re-sorts them, but "sorted by date
     * descending" is an acceptance criterion of the panel: relying on an upstream
     * sort means the criterion is satisfied by a coincidence nothing here would
     * notice losing.
     */
    const zones = zonesOf(
      place([
        mark("vieux", "2019-01-01", 500, 250),
        mark("neuf", "2025-01-01", 500, 250),
        mark("moyen", "2022-01-01", 500, 250),
      ]),
      WHOLE
    );

    expect(zones).toHaveLength(1);
    expect(zones[0]?.marks.map((entry) => entry.mark.slug)).toEqual(["neuf", "moyen", "vieux"]);
  });

  it("breaks a date tie on the slug, so two builds of the same content agree", () => {
    const zones = zonesOf(
      place([mark("zanzibar", "2024-01-01", 500, 250), mark("albanie", "2024-01-01", 500, 250)]),
      WHOLE
    );

    expect(zones[0]?.marks.map((entry) => entry.mark.slug)).toEqual(["albanie", "zanzibar"]);
  });

  it("names a zone after its most recent trip", () => {
    // So the id is stable, readable in the DOM and in the URL, and derived from
    // the same order the panel lists.
    const zones = zonesOf(
      place([mark("vieux", "2019-01-01", 500, 250), mark("neuf", "2025-01-01", 500, 250)]),
      WHOLE
    );

    expect(zones[0]?.id).toBe("neuf");
  });

  it("chains markers that are individually close but far end to end", () => {
    /**
     * Single linkage, deliberately. Three markers a third of a radius apart form
     * one visual clump even though the outer two are a full radius apart; cutting
     * the chain would open a panel listing two of the three trips a reader can
     * see under their finger. The accepted cost is the other direction — a long
     * enough chain of near-neighbours becomes one large zone — which is a panel
     * with more rows, not a marker that answers nothing.
     */
    const step = (ZONE_RADIUS_PERCENT * WORLD.width) / 100 / 2;
    const zones = zonesOf(
      place([
        mark("a", "2024-01-01", 400, 250),
        mark("b", "2023-01-01", 400 + step, 250),
        mark("c", "2022-01-01", 400 + 2 * step, 250),
      ]),
      WHOLE
    );

    expect(zones).toHaveLength(1);
    expect(zones[0]?.marks).toHaveLength(3);
  });

  it("measures the distance on screen and not in percent of each axis", () => {
    /**
     * A percentage of the height is not the same number of pixels as a
     * percentage of the width — the world's box is 1.92 times wider than it is
     * tall — so an unscaled comparison groups vertical neighbours nearly twice as
     * eagerly as horizontal ones, for no reason a reader could guess. Same
     * correction `spreadCoincident` applies in the other direction.
     *
     * The two pairs below are the same distance apart *on screen*: one
     * horizontally, one vertically. They must fall on the same side of the
     * threshold.
     */
    const gap = (ZONE_RADIUS_PERCENT * 1.4 * WORLD.width) / 100;
    const horizontal = zonesOf(
      place([mark("a", "2024-01-01", 300, 250), mark("b", "2023-01-01", 300 + gap, 250)]),
      WHOLE
    );
    const vertical = zonesOf(
      place([mark("a", "2024-01-01", 300, 100), mark("b", "2023-01-01", 300, 100 + gap)]),
      WHOLE
    );

    expect(horizontal).toHaveLength(2);
    expect(vertical).toHaveLength(2);
  });

  it("keeps the zones in the order their first marker was given", () => {
    // The markers arrive newest first, so the zones do too — which is the order
    // the DOM and the tab ring already use.
    const zones = zonesOf(
      place([mark("neuf", "2025-01-01", 800, 400), mark("vieux", "2019-01-01", 100, 100)]),
      WHOLE
    );

    expect(zones.map((zone) => zone.id)).toEqual(["neuf", "vieux"]);
  });

  it("gives every marker exactly one zone, at any scale", () => {
    /**
     * The invariant a reader depends on: every marker's activation has a panel to
     * open, and no trip is listed twice. Checked over four framings, because the
     * radius is a fraction of the frame and the grouping therefore changes with
     * the crop.
     */
    const marks = Array.from({ length: 40 }, (_, index) =>
      mark(
        `voyage-${String(index).padStart(2, "0")}`,
        `20${10 + (index % 15)}-01-01`,
        20 + ((index * 97) % 920),
        10 + ((index * 53) % 480)
      )
    );

    for (const frame of [
      WHOLE,
      frameAround(
        [
          { x: 300, y: 120 },
          { x: 700, y: 300 },
        ],
        WORLD
      ),
      frameAround([{ x: 500, y: 250 }], WORLD),
      frameAround(
        [
          { x: 10, y: 10 },
          { x: 950, y: 490 },
        ],
        WORLD
      ),
    ]) {
      const placed = place(marks, frame);
      const zones = zonesOf(placed, frame);
      const listed = zones.flatMap((zone) => zone.marks.map((entry) => entry.mark.slug));

      expect(listed).toHaveLength(placed.length);
      expect(new Set(listed).size).toBe(placed.length);
      expect(new Set(zones.map((zone) => zone.id)).size).toBe(zones.length);
      // And every zone id is one of the trips the zone holds.
      for (const zone of zones) {
        expect(zone.marks.map((entry) => entry.mark.slug)).toContain(zone.id);
      }
    }
  });

  it("still answers a zone per marker when the frame has no area", () => {
    // Unreachable through `frameAround`, which throws for a world with none, and
    // through `placeMarks`, which answers nothing for a frame with none. Asserted
    // because the alternative is a marker whose activation opens no panel at all.
    const placed = placeMarks([mark("a", "2024-01-01", 1, 1)], WHOLE);
    const zones = zonesOf(placed, { viewBox: "", x: 0, y: 0, width: 0, height: 0 });

    expect(zones).toHaveLength(1);
    expect(zones[0]?.id).toBe("a");
  });
});
