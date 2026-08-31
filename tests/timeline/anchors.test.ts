import { describe, expect, it } from "vitest";
import { stepAnchors } from "@/components/timeline/anchors";
import { StepSchema } from "@/domain/schema";
import type { Step } from "@/domain/schema";

/**
 * The anchors the timeline puts on its step headings. The acceptance criterion
 * asks for two properties, and they pull in opposite directions:
 *
 * - **copyable** — a reader right-clicks a step heading, copies the link and
 *   pastes it into a message. So it has to be readable and it has to be a legal
 *   URL fragment without escaping;
 * - **stable** — that pasted link has to still land on the same step next year.
 *
 * Stability is what rules out the obvious implementation. `#etape-3` is derived
 * from the array index, so inserting a forgotten step at the top of the trip
 * silently re-points every link anyone has ever shared. These anchors are built
 * from *content* — the date and the place slugs — so a step keeps its identity
 * however the array around it moves.
 */

function steps(...inputs: readonly Record<string, unknown>[]): readonly Step[] {
  return inputs.map((input) => StepSchema.parse(input));
}

const stay = (placeSlug: string, startDate: string, endDate: string) => ({
  kind: "stay",
  placeSlug,
  startDate,
  endDate,
});

const move = (fromSlug: string, toSlug: string, mode: string, date: string) => ({
  kind: "move",
  fromSlug,
  toSlug,
  mode,
  date,
});

describe("stepAnchors", () => {
  it("names a stay by its start date and its place", () => {
    expect(stepAnchors(steps(stay("tokyo", "2024-04-12", "2024-04-16")))).toEqual([
      "etape-2024-04-12-tokyo",
    ]);
  });

  it("names a move by its date and both its ends", () => {
    expect(stepAnchors(steps(move("tokyo", "kyoto", "train", "2024-04-16")))).toEqual([
      "trajet-2024-04-16-tokyo-kyoto",
    ]);
  });

  /** One anchor per step, index-aligned: the timeline renders them in parallel
   * with the steps, so a shorter or reordered result would mislabel a heading. */
  it("answers one anchor per step, in order", () => {
    const anchors = stepAnchors(
      steps(
        stay("tokyo", "2024-04-12", "2024-04-16"),
        move("tokyo", "kyoto", "train", "2024-04-16"),
        stay("kyoto", "2024-04-16", "2024-04-22")
      )
    );

    expect(anchors).toEqual([
      "etape-2024-04-12-tokyo",
      "trajet-2024-04-16-tokyo-kyoto",
      "etape-2024-04-16-kyoto",
    ]);
  });

  /**
   * The property the whole scheme exists for. Inserting a step at the *front*
   * must not move any other step's anchor — which is exactly what an
   * index-derived `#etape-3` cannot promise.
   */
  it("keeps every other anchor unchanged when a step is inserted before them", () => {
    const original = steps(
      stay("kyoto", "2024-04-16", "2024-04-20"),
      move("kyoto", "bangkok", "plane", "2024-04-20")
    );
    const withPrefix = steps(
      stay("tokyo", "2024-04-12", "2024-04-16"),
      move("tokyo", "kyoto", "train", "2024-04-16"),
      stay("kyoto", "2024-04-16", "2024-04-20"),
      move("kyoto", "bangkok", "plane", "2024-04-20")
    );

    expect(stepAnchors(withPrefix).slice(2)).toEqual(stepAnchors(original));
  });

  /**
   * Two returns to the same city keep separate anchors, because the date is part
   * of the anchor. This is the case that makes `#etape-tokyo` — the other
   * tempting "stable" scheme — unusable.
   */
  it("distinguishes two stays in the same place", () => {
    const anchors = stepAnchors(
      steps(
        stay("tokyo", "2024-04-12", "2024-04-14"),
        move("tokyo", "kyoto", "train", "2024-04-14"),
        stay("kyoto", "2024-04-14", "2024-04-16"),
        move("kyoto", "tokyo", "train", "2024-04-16"),
        stay("tokyo", "2024-04-16", "2024-04-22")
      )
    );

    expect(anchors[0]).toBe("etape-2024-04-12-tokyo");
    expect(anchors[4]).toBe("etape-2024-04-16-tokyo");
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  /**
   * Date-plus-place is very nearly a key, but not quite: nothing in `TripSchema`
   * forbids two identical moves on one day. An `id` repeated in a document makes
   * every duplicate unreachable — the browser jumps to the first — so the
   * collision is broken by a counter rather than left to chance.
   */
  it("breaks a collision with a counter rather than repeating an id", () => {
    const anchors = stepAnchors(
      steps(
        move("tokyo", "kyoto", "train", "2024-04-16"),
        move("tokyo", "kyoto", "train", "2024-04-16"),
        move("tokyo", "kyoto", "bus", "2024-04-16")
      )
    );

    expect(anchors).toEqual([
      "trajet-2024-04-16-tokyo-kyoto",
      "trajet-2024-04-16-tokyo-kyoto-2",
      "trajet-2024-04-16-tokyo-kyoto-3",
    ]);
  });

  /**
   * **The collision the counter itself creates**, and the case that made this
   * function keep a set of what it emitted rather than a count per base.
   *
   * Measured on a production build before the fix, with content `TripSchema` and
   * `npm run validate:content` both accept: the fourth step's disambiguated
   * anchor `etape-2024-04-12-lyon-2` was byte-for-byte the *base* anchor of the
   * first, so the document carried the same `id` twice, the fourth step's `#`
   * link jumped to the first, and React saw a duplicate key.
   *
   * Slugs ending in a digit are ordinary: `lyon-2` is how one names an
   * arrondissement, `paris-2` a second station, `bordeaux-3` a second hotel —
   * and `SlugSchema` admits all three. A general assertion that the anchors are
   * distinct cannot be trusted on lists that have no such pair, which is why
   * this case is written out rather than folded into the one above.
   */
  it("does not let a disambiguating suffix collide with another step's anchor", () => {
    const anchors = stepAnchors(
      steps(
        stay("lyon-2", "2024-04-12", "2024-04-12"),
        move("lyon-2", "lyon", "foot", "2024-04-12"),
        stay("lyon", "2024-04-12", "2024-04-12"),
        stay("lyon", "2024-04-12", "2024-04-14")
      )
    );

    expect(new Set(anchors).size).toBe(anchors.length);
    expect(anchors).toEqual([
      "etape-2024-04-12-lyon-2",
      "trajet-2024-04-12-lyon-2-lyon",
      "etape-2024-04-12-lyon",
      // `-2` is the first spelling tried and it belongs to the first step, so the
      // counter walks past it. Not `…-lyon-2-2`: the suffix is appended to the
      // base, never to a candidate, or a third collision would grow a tail.
      "etape-2024-04-12-lyon-3",
    ]);
  });

  /**
   * A fragment that needs percent-encoding is not copyable in practice: it
   * survives a paste into a browser bar and not into most chat clients. Slugs
   * and `YYYY-MM-DD` are both already restricted to this alphabet, so the
   * guarantee costs nothing — but it is the guarantee the day someone widens
   * `SlugSchema`.
   */
  it("produces fragments that need no escaping", () => {
    const anchors = stepAnchors(
      steps(
        stay("lyon-part-dieu", "2024-04-12", "2024-04-16"),
        move("lyon-part-dieu", "bron", "bus", "2024-04-16")
      )
    );

    for (const anchor of anchors) {
      expect(anchor).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(encodeURIComponent(anchor)).toBe(anchor);
    }
  });

  it("answers nothing for a trip with no steps", () => {
    expect(stepAnchors([])).toEqual([]);
  });
});
