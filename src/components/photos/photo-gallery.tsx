import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { GalleryPhoto } from "./collection";
import { PhotoFigure } from "./photo-figure";
import styles from "./photo-gallery.module.css";

/**
 * A grid of photos, and the progressive base the viewer is grafted onto.
 *
 * **Each item is a real `<a href>` to the file itself.** With no JavaScript —
 * a failed chunk, a blocked script, a text browser — clicking a photo opens it
 * at full size, which is the whole of what a reader wants from a gallery. The
 * viewer (`photo-lightbox.tsx`) then intercepts the click and shows the same
 * photograph in place; the link is what makes the feature degrade instead of
 * disappearing, and it is why `data-photo-index` sits on the `<a>` rather than
 * on a `<button>` that would do nothing without a script.
 *
 * `data-photo-index` is the *only* contract between this component and the
 * viewer: one delegated listener reads it and opens that photo. No shared
 * module, no context, no callback across the server/client frontier — a number
 * in an attribute, present in the prerendered HTML.
 *
 * No `'use client'`: this is HTML and CSS. `useTranslations` rather than
 * `getTranslations`, because the synchronous form is what keeps the component
 * renderable by Testing Library under a `NextIntlClientProvider` — the same
 * reasoning as `world-map.tsx` and `trip-timeline.tsx`.
 */

export type PhotoGalleryProps = {
  /**
   * The grid's own `id`. Passed in rather than derived: the trip page renders
   * several of these — one for the trip's gallery, one inside each stay that has
   * photos — and a duplicated `id` makes every one after the first unaddressable.
   */
  readonly id: string;
  readonly photos: readonly GalleryPhoto[];
  /** Forwarded to every `<picture>`; the grid's track width, not the page's. */
  readonly sizes: string;
};

export function PhotoGallery({ id, photos, sizes }: PhotoGalleryProps): ReactElement {
  const t = useTranslations("photos");

  return (
    /*
      `role="list"` on an element that already has that role, for the reason
      `trip-timeline.tsx` and the map's marker list both record: `list-style:
      none` makes Safari drop the list role, and with it "list, 12 items" and the
      "3 of 12" a reader hears at each photo. jsdom keeps the role either way, so
      no unit test can see this.
    */
    <ul id={id} className={styles.grid} role="list">
      {photos.map((photo) => (
        /* `src` and not the index: `TripSchema` refuses two photos sharing a
           source, so it is the content's own primary key for a photo. */
        <li key={photo.src} className={styles.item}>
          <a className={styles.link} href={photo.src} data-photo-index={photo.index}>
            <PhotoFigure photo={photo} sizes={sizes} className={styles.image} />
            {/*
              The link's purpose, as a real text node rather than an `aria-label`.
              Without it the link is named by the photo's `alt` alone, which
              describes the picture and says nothing about what activating it
              does (WCAG 2.4.4); with it the name reads « Une ruelle de Shinjuku
              sous la pluie — voir en grand ». A text node and not an attribute,
              for the reason the timeline's permalink records: an attribute is a
              string no translator sees in context and no tool finds in the DOM.
            */}
            <span className={styles.visuallyHidden}>{t("openFullSize")}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
