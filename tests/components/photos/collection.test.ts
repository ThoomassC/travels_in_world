import { describe, expect, it } from "vitest";
import {
  PANEL_PHOTO_LIMIT,
  panelPhotos,
  photosByPlace,
  unplacedPhotos,
  viewerPhotos,
} from "@/components/photos/collection";
import { photo, photos } from "./fixtures";

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

describe("panelPhotos", () => {
  /**
   * The cover leads, and it is the opposite decision from {@link viewerPhotos}
   * one function above — deliberately, because the two answer different
   * questions. The viewer excludes the cover because the trip page's header has
   * already shown it; a map panel has no header image at all, so leaving it out
   * would hide the one photograph the author picked to stand for the trip.
   */
  it("puts the cover first, then the declaration order", () => {
    const preview = panelPhotos({
      photos: [photo({ src: "/a.jpg" }), photo({ src: "/cover.jpg" }), photo({ src: "/c.jpg" })],
      coverPhotoSrc: "/cover.jpg",
    });

    expect(preview.map((entry) => entry.src)).toEqual(["/cover.jpg", "/a.jpg", "/c.jpg"]);
  });

  /**
   * `TripSchema` requires the cover to be one of `photos[]`, but `panelPhotos`
   * takes a structural shape and the page may narrow it: a `coverPhotoSrc`
   * naming a file that is not in the list must not conjure a photo with no
   * `alt`, no dimensions and no placeholder.
   */
  it("ignores a cover that is not one of the trip's photos", () => {
    const preview = panelPhotos({
      photos: [photo({ src: "/a.jpg" }), photo({ src: "/b.jpg" })],
      coverPhotoSrc: "/elsewhere.jpg",
    });

    expect(preview.map((entry) => entry.src)).toEqual(["/a.jpg", "/b.jpg"]);
  });

  /** The cover is promoted, never duplicated: it is one photograph and a reader
   * meeting it twice in a three-tile strip reads it as a rendering fault. */
  it("never repeats a source", () => {
    const preview = panelPhotos({
      photos: [photo({ src: "/cover.jpg" }), photo({ src: "/b.jpg" })],
      coverPhotoSrc: "/cover.jpg",
    });

    expect(preview.map((entry) => entry.src)).toEqual(["/cover.jpg", "/b.jpg"]);
  });

  /** The document budget is the reason, and it is written on the constant. */
  it("stops at PANEL_PHOTO_LIMIT, cover included", () => {
    const preview = panelPhotos({
      photos: photos(6),
      coverPhotoSrc: "/photos/japon-2024/photo-4.jpg",
    });

    expect(preview).toHaveLength(PANEL_PHOTO_LIMIT);
    expect(preview.map((entry) => entry.src)).toEqual([
      "/photos/japon-2024/photo-4.jpg",
      "/photos/japon-2024/photo-0.jpg",
      "/photos/japon-2024/photo-1.jpg",
    ]);
  });

  /**
   * Field by field and never a spread. `placeSlug` is the field that proves it:
   * it means nothing to a panel, and a spread would carry it — and whatever the
   * content model grows next — into every marker's payload in the prerendered
   * document, on the one page that already spends 203.5 KiB of a 240 KiB budget.
   */
  it("carries the five fields a figure needs, and nothing else", () => {
    const [first] = panelPhotos({ photos: [photo({ placeSlug: "tokyo" })] });

    expect(first === undefined ? [] : Object.keys(first).sort()).toEqual([
      "alt",
      "blurDataUrl",
      "height",
      "src",
      "width",
    ]);
  });

  it("answers nothing for a trip that declares no photo", () => {
    expect(panelPhotos({})).toEqual([]);
    expect(panelPhotos({ photos: [] })).toEqual([]);
    expect(panelPhotos({ photos: [], coverPhotoSrc: "/cover.jpg" })).toEqual([]);
  });
});
