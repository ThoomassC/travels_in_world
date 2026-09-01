import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { frMessages, renderWithMessages } from "../trips/support";
import { indexed, photos } from "./fixtures";

/**
 * The grid, and the progressive base under the viewer. `renderWithMessages` is
 * the listing suite's helper, reused rather than copied: it renders through the
 * real `fr.json`, so a component reading a key that does not exist fails here
 * instead of shipping an empty string to a French-only site.
 */

const gallery = (props: Partial<Parameters<typeof PhotoGallery>[0]> = {}) =>
  renderWithMessages(
    <PhotoGallery id="galerie" photos={indexed(photos(3))} sizes="17rem" {...props} />
  );

describe("PhotoGallery", () => {
  /**
   * The decision this pins, and the whole reason the viewer can be grafted on
   * later: with no JavaScript at all, a photo is a link to the file. A `<button>`
   * would be a control that does nothing until a chunk arrives.
   */
  it("makes every photo a link to the file itself", () => {
    gallery();

    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", "/photos/japon-2024/photo-0.jpg");
    expect(links[2]).toHaveAttribute("href", "/photos/japon-2024/photo-2.jpg");
  });

  /** WCAG 2.4.4: the photo's `alt` describes the picture and says nothing about
   * what activating the link does. Both, from text nodes — never an `aria-label`. */
  it("names each link by the photo and by what activating it does", () => {
    gallery();

    expect(
      screen.getByRole("link", {
        name: `Photographie 1 ${frMessages.photos.openFullSize}`,
      })
    ).toBeInTheDocument();
  });

  /**
   * The only contract between this Server Component and the client viewer: a
   * number in an attribute, present in the prerendered HTML. And it is the index
   * the photo *arrived with*, never its position in this list — see
   * `collection.test.ts` for why that distinction is the load-bearing one.
   */
  it("carries each photo's viewer index on its link", () => {
    gallery({ photos: [...indexed(photos(2))].map((entry, at) => ({ ...entry, index: at + 7 })) });

    const links = screen.getAllByRole("link");

    expect(links[0]).toHaveAttribute("data-photo-index", "7");
    expect(links[1]).toHaveAttribute("data-photo-index", "8");
  });

  it("is a list, and says so even where list-style strips the role", () => {
    gallery();

    // jsdom keeps the role either way, so this asserts the attribute is written —
    // the Safari + VoiceOver bug it exists for is invisible to any unit test.
    expect(screen.getByRole("list")).toHaveAttribute("role", "list");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("takes its id from the caller, because a page renders several grids", () => {
    gallery({ id: "etape-2024-04-12-tokyo-photos" });

    expect(screen.getByRole("list")).toHaveAttribute("id", "etape-2024-04-12-tokyo-photos");
  });

  it("forwards the rendered width to every picture, not the page's", () => {
    const { container } = gallery({ sizes: "(min-width: 37rem) 17rem, calc(100vw - 3rem)" });

    for (const source of container.querySelectorAll("source")) {
      expect(source).toHaveAttribute("sizes", "(min-width: 37rem) 17rem, calc(100vw - 3rem)");
    }
  });

  /** An empty grid is not rendered by any caller — both check `length` first —
   * but it must not invent a row or an announcement if one ever does. */
  it("renders an empty list rather than anything else for no photos", () => {
    gallery({ photos: [] });

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
