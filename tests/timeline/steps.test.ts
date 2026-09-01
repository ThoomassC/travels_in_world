import { describe, expect, it } from "vitest";
import { timelineSteps } from "@/components/timeline/steps";
import { TripSchema } from "@/domain/schema";
import type { Trip } from "@/domain/schema";
import {
  BANGKOK,
  KYOTO,
  KYOTO_PHOTO,
  move,
  stay,
  TOKYO,
  TOKYO_PHOTO,
  tripInput,
} from "../domain/fixtures";

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
          {
            kind: "move",
            fromSlug: "tokyo",
            toSlug: "atlantide",
            mode: "boat",
            date: "2024-04-16",
          },
        ],
      })
    ).toThrow(/atlantide/);
  });

  it("answers nothing for a trip with no steps", () => {
    expect(timelineSteps({ places: [], steps: [] })).toEqual([]);
  });
});

/**
 * The photos of a stay (TIW-17). A photo carrying `placeSlug` is shown inside
 * that place's step rather than in the trip's gallery, and the index it carries is
 * the page's single viewer's — see `src/components/photos/collection.ts`.
 */
describe("timelineSteps, photos of a stay", () => {
  /** `[place slug, photo sources]` per stay, in order — what every case below
   * asserts on, so a diff names the step that went wrong. */
  function stayPhotos(trip: Trip): readonly (readonly [string, readonly string[]])[] {
    return timelineSteps(trip).flatMap((step) =>
      step.kind === "stay"
        ? [[step.place.slug, step.photos.map((entry) => entry.src)] as const]
        : []
    );
  }

  it("attaches a photo to the stay of the place it names", () => {
    expect(
      stayPhotos(
        parse({
          photos: [
            { ...TOKYO_PHOTO, placeSlug: "tokyo" },
            { ...KYOTO_PHOTO, placeSlug: "kyoto" },
          ],
          coverPhotoSrc: undefined,
        })
      )
    ).toEqual([
      ["tokyo", [TOKYO_PHOTO.src]],
      ["kyoto", [KYOTO_PHOTO.src]],
      ["bangkok", []],
    ]);
  });

  /** The ordinary case: a photo with no place belongs to the trip's gallery, and
   * no step may claim it — it would then be on the page twice. */
  it("leaves an unattached photo out of every stay", () => {
    expect(stayPhotos(parse({ coverPhotoSrc: undefined })).map(([, sources]) => sources)).toEqual([
      [],
      [],
      [],
    ]);
  });

  /**
   * The cover has already been shown by the header, so it is out of the viewer's
   * array — and therefore out of a step, even when it names a place. This is the
   * one path that could otherwise put the same image on the page twice with the
   * gallery still looking correct.
   */
  it("does not put the cover inside a step, even when it names a place", () => {
    expect(
      stayPhotos(
        parse({
          photos: [{ ...TOKYO_PHOTO, placeSlug: "tokyo" }],
          coverPhotoSrc: TOKYO_PHOTO.src,
        })
      )
    ).toEqual([
      ["tokyo", []],
      ["kyoto", []],
      ["bangkok", []],
    ]);
  });

  /**
   * The index is the position in the viewer's array — cover removed, the gallery's
   * own photos included — and NOT the position inside the step. A step's second
   * photo that thinks it is the viewer's photo 1 opens a different picture.
   */
  it("numbers a step's photos by their position in the viewer, not in the step", () => {
    const rendered = timelineSteps(
      parse({
        photos: [
          { ...TOKYO_PHOTO, src: "/photos/japon-2024/couverture.jpg" },
          { ...TOKYO_PHOTO, src: "/photos/japon-2024/galerie.jpg" },
          { ...TOKYO_PHOTO, src: "/photos/japon-2024/kyoto-a.jpg", placeSlug: "kyoto" },
          { ...TOKYO_PHOTO, src: "/photos/japon-2024/kyoto-b.jpg", placeSlug: "kyoto" },
        ],
        coverPhotoSrc: "/photos/japon-2024/couverture.jpg",
      })
    );
    const kyoto = rendered.find((step) => step.kind === "stay" && step.place.slug === "kyoto");

    // `galerie.jpg` is 0 once the cover is dropped, so the two Kyoto photos are
    // 1 and 2 — never 0 and 1.
    expect(kyoto?.kind === "stay" ? kyoto.photos.map((entry) => entry.index) : null).toEqual([
      1, 2,
    ]);
  });

  /**
   * A split stay — Tokyo, Kyoto, Tokyo again — is valid content: `TripSchema`
   * calls two stays in the same place a split stay and accepts it explicitly. A
   * photo names a *place*, not a date, so nothing in the content says which of the
   * two it belongs to. It goes to the first, once.
   */
  it("gives a split stay's photos to the first visit and not the second", () => {
    expect(
      stayPhotos(
        parse({
          places: [TOKYO, KYOTO],
          steps: [
            stay("tokyo", "2024-04-12", "2024-04-14"),
            move("tokyo", "kyoto", "train", "2024-04-14"),
            stay("kyoto", "2024-04-14", "2024-04-18"),
            move("kyoto", "tokyo", "train", "2024-04-18"),
            stay("tokyo", "2024-04-18", "2024-04-22"),
          ],
          photos: [{ ...TOKYO_PHOTO, placeSlug: "tokyo" }],
          coverPhotoSrc: undefined,
        })
      )
    ).toEqual([
      ["tokyo", [TOKYO_PHOTO.src]],
      ["kyoto", []],
      ["tokyo", []],
    ]);
  });

  /** Every stay carries the field, empty or not, so `trip-timeline.tsx` reads
   * `step.photos.length` without a null check. */
  it("gives every stay a photos array", () => {
    const rendered = timelineSteps(parse({ photos: [], coverPhotoSrc: undefined }));

    expect(rendered.every((step) => step.kind === "move" || Array.isArray(step.photos))).toBe(true);
  });
});
