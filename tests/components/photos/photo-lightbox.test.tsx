import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { PhotoViewer } from "@/components/photos/photo-viewer";
import { frMessages, renderWithMessages } from "../trips/support";
import { indexed, photos } from "./fixtures";

/**
 * The viewer, exercised through the real gallery it listens to — not through a
 * handful of hand-written `<a data-photo-index>`. The delegated listener and the
 * attribute the gallery writes are the whole contract between a Server Component
 * and this client one, and a fixture that spelled the attribute itself would let
 * the two drift apart with both suites green.
 *
 * Rendered through `PhotoViewer`, the server shell, and not `PhotoLightbox`
 * directly: the shell is what turns catalogue keys into the six strings the client
 * component receives, so driving the pair together is what keeps a renamed message
 * key from passing here and shipping an empty label. Every label asserted below is
 * read from the real `fr.json`.
 *
 * ── WHAT jsdom CANNOT DO, and what is therefore E2E's ──────────────────────────
 *
 * jsdom 30 exposes `HTMLDialogElement` and reflects `open` (a closed `<dialog>`
 * really does compute to `display: none`, so the role queries below are honest),
 * but it implements **neither `showModal()` nor `close()`** — measured: "dialog.
 * showModal is not a function". So both are installed on the prototype for the
 * duration of this file, in the shape the platform gives them: `showModal` sets
 * `open`, `close` clears it and fires a non-bubbling `close` event.
 *
 * What the stub deliberately does NOT simulate, because a stub that pretended to
 * would be worse than nothing:
 *
 * - the **top layer** and `::backdrop`;
 * - the **focus trap** — jsdom has no notion of an inert subtree, so `Tab` inside
 *   the modal cannot be tested here;
 * - **`Escape`**, which is the UA's own behaviour on a modal dialog and involves
 *   no code in this component. What *is* tested is the half that is ours: that a
 *   `close` event, however it arrived, resets the state and hands focus back.
 *
 * Those three are the E2E suite's, and the ticket assigns them there.
 *
 * ── ON `fireEvent` RATHER THAN `userEvent` ─────────────────────────────────────
 *
 * `@testing-library/user-event` is not a dependency of this repository, and
 * `package.json` is not this change's to edit. Every interaction below is a
 * single event with no focus or pointer choreography behind it — a click on a
 * link, a keydown on the dialog, a pointer down/up pair — so `fireEvent` loses
 * nothing here. The moment a case needs a real `Tab` walk it needs `userEvent`,
 * and it also needs a browser: see above.
 */

const GALLERY_PHOTOS = indexed(photos(3));

function installDialogStub(): void {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    // Idempotent, like the platform's: closing a closed dialog fires nothing.
    if (!this.hasAttribute("open")) {
      return;
    }
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

function removeDialogStub(): void {
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
}

beforeEach(installDialogStub);
afterEach(removeDialogStub);

/**
 * The page's shape in miniature: a `<main>` holding the grid and the viewer, with
 * the viewer watching the `<main>` by `id` — which is what the trip page does,
 * because its photo triggers live in two sections.
 */
function renderViewer(entries: typeof GALLERY_PHOTOS = GALLERY_PHOTOS) {
  return renderWithMessages(
    <main id="contenu">
      <PhotoGallery id="galerie" photos={entries} sizes="17rem" />
      <PhotoViewer photos={entries} scopeId="contenu" />
    </main>
  );
}

/** The gallery's link for a photo, by the name a reader would read. */
const trigger = (position: number): HTMLElement =>
  screen.getByRole("link", {
    name: `Photographie ${position} ${frMessages.photos.openFullSize}`,
  });

const openAt = (position: number): HTMLElement => {
  const link = trigger(position);
  fireEvent.click(link);

  return link;
};

/**
 * Clicks a trigger and reports whether the viewer LEFT the click to the browser.
 *
 * The reading is taken from a probe registered on the element the viewer
 * delegates from, so it runs after the viewer's own listener in the same bubbling
 * phase and sees the decision already made. It then calls `preventDefault` itself
 * — not to change the outcome, which has been recorded, but to stop jsdom
 * attempting a real navigation to the JPEG, which it answers with a
 * "Not implemented: navigation to another Document" on stderr. A suite that
 * prints that on five passing cases teaches everyone to ignore its output.
 */
function clickAndReportFollowed(link: HTMLElement, init: Record<string, unknown> = {}): boolean {
  const scope = document.getElementById("contenu");
  if (scope === null) {
    throw new Error("The rendered page has no #contenu for the viewer to delegate from.");
  }

  let followed = true;
  const probe = (event: Event): void => {
    followed = !event.defaultPrevented;
    event.preventDefault();
  };

  scope.addEventListener("click", probe);
  fireEvent.click(link, init);
  scope.removeEventListener("click", probe);

  return followed;
}

const position = (): string | null =>
  screen.getByRole("dialog").querySelector("p")?.textContent ?? null;

describe("PhotoLightbox", () => {
  /**
   * The HTML budget argument, asserted rather than asserted-in-a-comment: the
   * dialog ships as an empty element. Twelve `<picture>` blocks with their
   * placeholders would be kilobytes of document for markup nobody asked to see.
   */
  it("puts no photo in the document until one is opened", () => {
    const { container } = renderViewer();
    const dialog = container.querySelector("dialog");

    expect(dialog).not.toBeNull();
    expect(dialog?.hasAttribute("open")).toBe(false);
    expect(dialog?.children).toHaveLength(0);
    // Only the gallery's three, none from the viewer.
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("opens on the photo that was clicked, and does not follow the link", () => {
    renderViewer();

    // `false` means the viewer called `preventDefault`, which is what stops the
    // browser navigating away from the page to the JPEG.
    expect(clickAndReportFollowed(trigger(1))).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("img")?.getAttribute("src")).toBe(
      "/photos/japon-2024/photo-1.jpg"
    );
  });

  it("says where the reader is, counting from one", () => {
    renderViewer();
    openAt(0);

    expect(position()).toBe("Photo 1 sur 3");
  });

  it("names itself with a real heading rather than an attribute", () => {
    renderViewer();
    openAt(0);

    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveAccessibleName(frMessages.photos.viewerHeading);
    // A text node, findable in the DOM and translatable in context — the reason
    // `trip-header.tsx` and the map's markers do the same.
    expect(
      screen.getByRole("heading", { name: frMessages.photos.viewerHeading })
    ).toBeInTheDocument();
  });

  /**
   * A modified click is one of four working ways to get the photo at full size,
   * all of them free because the trigger is a real `<a href>`. Hijacking them
   * would trade four browser features for one modal.
   */
  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["middle button", { button: 1 }],
  ])("leaves a %s click to the browser", (_name, modifier) => {
    renderViewer();

    expect(clickAndReportFollowed(trigger(1), modifier)).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("walking the photos", () => {
    it("moves with the arrow keys", () => {
      renderViewer();
      openAt(0);

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
      expect(position()).toBe("Photo 2 sur 3");

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
      expect(position()).toBe("Photo 1 sur 3");
    });

    /** A keyboard shortcut with no visible equivalent is a feature only its
     * author knows about. */
    it("moves with the visible buttons too", () => {
      renderViewer();
      openAt(0);

      fireEvent.click(screen.getByRole("button", { name: frMessages.photos.next }));
      expect(position()).toBe("Photo 2 sur 3");

      fireEvent.click(screen.getByRole("button", { name: frMessages.photos.previous }));
      expect(position()).toBe("Photo 1 sur 3");
    });

    /**
     * No wrapping, at either end. A viewer that loops cannot tell a reader they
     * have seen everything: the third photo followed by the first looks exactly
     * like a fourth.
     */
    it("stops at the last photo rather than wrapping to the first", () => {
      renderViewer();
      openAt(2);

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
      fireEvent.click(screen.getByRole("button", { name: frMessages.photos.next }));

      expect(position()).toBe("Photo 3 sur 3");
    });

    it("stops at the first photo rather than wrapping to the last", () => {
      renderViewer();
      openAt(0);

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
      fireEvent.click(screen.getByRole("button", { name: frMessages.photos.previous }));

      expect(position()).toBe("Photo 1 sur 3");
    });

    /**
     * `aria-disabled` and not `disabled`, which is the whole point: a `disabled`
     * button loses focus the instant it is disabled, and inside a modal that
     * focus lands nowhere the reader can see — exactly mid-keyboard-walk. The
     * control stays focusable and announces itself unavailable.
     */
    it("announces the end of the set on the control, without taking focus away", () => {
      renderViewer();
      openAt(0);

      const previous = screen.getByRole("button", { name: frMessages.photos.previous });
      const next = screen.getByRole("button", { name: frMessages.photos.next });

      expect(previous).toHaveAttribute("aria-disabled", "true");
      expect(previous).not.toBeDisabled();
      expect(next).toHaveAttribute("aria-disabled", "false");

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });

      expect(screen.getByRole("button", { name: frMessages.photos.next })).toHaveAttribute(
        "aria-disabled",
        "true"
      );
    });

    /** Two permanently unavailable buttons are two tab stops that never do
     * anything. */
    it("renders no previous/next control for a single photo", () => {
      renderViewer(indexed(photos(1)));
      openAt(0);

      expect(screen.queryByRole("button", { name: frMessages.photos.next })).toBeNull();
      expect(screen.queryByRole("button", { name: frMessages.photos.previous })).toBeNull();
      expect(screen.getByRole("button", { name: frMessages.photos.close })).toBeInTheDocument();
    });
  });

  describe("swiping", () => {
    const swipe = (from: readonly [number, number], to: readonly [number, number]): void => {
      const figure = screen.getByRole("dialog").querySelector("figure");
      if (figure === null) {
        throw new Error("The open viewer has no figure to swipe on.");
      }
      fireEvent.pointerDown(figure, { clientX: from[0], clientY: from[1], isPrimary: true });
      fireEvent.pointerUp(figure, { clientX: to[0], clientY: to[1], isPrimary: true });
    };

    it("moves forward when the gesture drags left, the way a page turns", () => {
      renderViewer();
      openAt(0);

      swipe([300, 200], [200, 210]);

      expect(position()).toBe("Photo 2 sur 3");
    });

    it("moves back when the gesture drags right", () => {
      renderViewer();
      openAt(1);

      swipe([200, 200], [300, 190]);

      expect(position()).toBe("Photo 1 sur 3");
    });

    /** A tap on the photograph must not move the viewer, or looking closely
     * changes the picture. */
    it("ignores a gesture shorter than the threshold", () => {
      renderViewer();
      openAt(0);

      swipe([300, 200], [270, 200]);

      expect(position()).toBe("Photo 1 sur 3");
    });

    /** A mostly-vertical drag is a scroll, and `touch-action: pan-y` leaves it to
     * the browser; stealing it would make the page unscrollable over a photo. */
    it("ignores a gesture that travelled further vertically", () => {
      renderViewer();
      openAt(0);

      swipe([300, 200], [200, 400]);

      expect(position()).toBe("Photo 1 sur 3");
    });

    /** The second finger of a pinch is not a swipe. */
    it("ignores a non-primary pointer", () => {
      renderViewer();
      openAt(0);

      const figure = screen.getByRole("dialog").querySelector("figure");
      fireEvent.pointerDown(figure as HTMLElement, {
        clientX: 300,
        clientY: 200,
        isPrimary: false,
      });
      fireEvent.pointerUp(figure as HTMLElement, { clientX: 100, clientY: 200, isPrimary: true });

      expect(position()).toBe("Photo 1 sur 3");
    });
  });

  describe("closing", () => {
    it("closes on the cross, and takes the photo back out of the document", () => {
      renderViewer();
      openAt(0);

      fireEvent.click(screen.getByRole("button", { name: frMessages.photos.close }));

      expect(screen.queryByRole("dialog")).toBeNull();
      // Only the gallery's three images are left.
      expect(screen.getAllByRole("img")).toHaveLength(3);
    });

    /**
     * The assertion the ticket asks for by name. A browser *should* restore focus
     * when a modal closes, but the element it remembers is not necessarily the one
     * that opened the viewer — a swipe focuses nothing — so this component records
     * the trigger and hands focus back explicitly. Without it the reader's next
     * `Tab` starts from the top of the document (WCAG 2.4.3).
     */
    it("hands focus back to the photo that was clicked", () => {
      renderViewer();
      const link = openAt(1);

      expect(document.activeElement).not.toBe(link);

      fireEvent.click(screen.getByRole("button", { name: frMessages.photos.close }));

      expect(document.activeElement).toBe(link);
    });

    /**
     * `Escape` is the UA's, and jsdom implements none of it — so what is pinned
     * here is the half that is this component's: whichever of the three ways
     * closed the dialog, the `close` event is the single place state is reset.
     */
    it("resets on a close event it did not initiate, and restores focus all the same", () => {
      const { container } = renderViewer();
      const link = openAt(2);

      // What `Escape` and a backdrop click both end in.
      container.querySelector("dialog")?.close();

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(link);
    });

    it("reopens on the photo clicked next, not on the one last seen", () => {
      renderViewer();
      openAt(2);
      fireEvent.click(screen.getByRole("button", { name: frMessages.photos.close }));

      openAt(0);

      expect(position()).toBe("Photo 1 sur 3");
    });
  });
});
