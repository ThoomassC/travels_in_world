import { describe, expect, it } from "vitest";
import { photosByPlace, unplacedPhotos, viewerPhotos } from "@/components/photos/collection";
import { photo } from "./fixtures";

/**
 * The numbering, and the three-way split that hangs off it. Pure functions, so
 * this file is where the rules are pinned rather than in a rendered DOM.
 */

describe("viewerPhotos", () => {
  it("numbers the photos in the order the content declares them", () => {
    const numbered = viewerPhotos({
      photos: [photo({ src: "/a.jpg" }), photo({ src: "/b.jpg" }), photo({ src: "/c.jpg" })],
    });

    expect(numbered.map((entry) => [entry.src, entry.index])).toEqual([
      ["/a.jpg", 0],
      ["/b.jpg", 1],
      ["/c.jpg", 2],
    ]);
  });

  /**
   * The cover is the header's image and is not a viewer trigger, so counting it
   * would make « photo 1 sur 3 » say three when a reader can open two.
   */
  it("leaves the cover out, and closes the gap in the numbering", () => {
    const numbered = viewerPhotos({
      photos: [photo({ src: "/a.jpg" }), photo({ src: "/cover.jpg" }), photo({ src: "/c.jpg" })],
      coverPhotoSrc: "/cover.jpg",
    });

    expect(numbered.map((entry) => [entry.src, entry.index])).toEqual([
      ["/a.jpg", 0],
      ["/c.jpg", 1],
    ]);
  });

  it("answers nothing for a trip that declares no photo", () => {
    expect(viewerPhotos({})).toEqual([]);
    expect(viewerPhotos({ photos: [] })).toEqual([]);
  });

  /** A trip whose only photo *is* its cover: the viewer has nothing to show, and
   * the page must be able to tell, so it can render no dialog at all. */
  it("answers nothing when the only photo is the cover", () => {
    expect(
      viewerPhotos({ photos: [photo({ src: "/cover.jpg" })], coverPhotoSrc: "/cover.jpg" })
    ).toEqual([]);
  });

  it("carries the place slug through, so the partitions below can read it", () => {
    const [first] = viewerPhotos({ photos: [photo({ placeSlug: "tokyo" })] });

    expect(first?.placeSlug).toBe("tokyo");
  });
});

describe("unplacedPhotos", () => {
  it("keeps only the photos attached to no place, indexes untouched", () => {
    const numbered = viewerPhotos({
      photos: [
        photo({ src: "/a.jpg", placeSlug: "tokyo" }),
        photo({ src: "/b.jpg" }),
        photo({ src: "/c.jpg", placeSlug: "kyoto" }),
        photo({ src: "/d.jpg" }),
      ],
    });

    /**
     * The load-bearing assertion of this file. `/d.jpg` keeps index 3 — its
     * position in the *viewer's* array — and does not become 1 because it is the
     * second item of the gallery. Renumbering here is how a reader clicks the
     * second photo of the gallery and the viewer opens the second photo of the
     * trip, which is a different picture.
     */
    expect(unplacedPhotos(numbered).map((entry) => [entry.src, entry.index])).toEqual([
      ["/b.jpg", 1],
      ["/d.jpg", 3],
    ]);
  });
});

describe("photosByPlace", () => {
  it("groups the attached photos by slug, in declaration order", () => {
    const byPlace = photosByPlace(
      viewerPhotos({
        photos: [
          photo({ src: "/a.jpg", placeSlug: "tokyo" }),
          photo({ src: "/b.jpg" }),
          photo({ src: "/c.jpg", placeSlug: "kyoto" }),
          photo({ src: "/d.jpg", placeSlug: "tokyo" }),
        ],
      })
    );

    expect(byPlace.get("tokyo")?.map((entry) => entry.src)).toEqual(["/a.jpg", "/d.jpg"]);
    expect(byPlace.get("kyoto")?.map((entry) => entry.src)).toEqual(["/c.jpg"]);
  });

  /** Absent rather than present-and-empty, so a caller reads `?? []` once
   * instead of testing `length` at every use. */
  it("has no entry for a place with no photo", () => {
    const byPlace = photosByPlace(viewerPhotos({ photos: [photo({ src: "/a.jpg" })] }));

    expect(byPlace.has("tokyo")).toBe(false);
    expect(byPlace.size).toBe(0);
  });
});
