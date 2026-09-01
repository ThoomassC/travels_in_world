import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { PhotoView } from "./photo-figure";
import { PhotoLightbox } from "./photo-lightbox";

/**
 * The viewer's server shell: it reads the catalogue and hands the client
 * component plain strings.
 *
 * **This file exists because of a measurement, and it is worth the number.** The
 * obvious shape was to call `useTranslations("photos")` inside `PhotoLightbox`
 * itself — next-intl's hook works in a client component, the provider is already
 * in the `[locale]` layout, and the runtime looks like something the route
 * already carries. It is not. Measured on two production builds of the same
 * content (Next 16.3.1, next-intl 4.13.7, the `home-map` fixture), the same viewer
 * rendered identically both ways — re-measured after TIW-14 merged, since a
 * before/after across two different socles compares nothing:
 *
 *                                 labels from the hook     labels as props
 *     /fr                         125.0 KB / 8 chunks      123.2 KB / 7
 *     /fr/voyages                 121.8 KB / 7             120.0 KB / 6
 *     /fr/voyages/japon-2024      123.4 KB / 8             121.5 KB / 7
 *
 * **1.8 KB and one whole chunk on EVERY route of the site**, including the two
 * that render no viewer at all.
 * The extra chunk is next-intl's client `IntlProvider`, and the growth in the
 * shared one is `useTranslations` with the slice of `MessageFormat` and the
 * formatters it needs. The cause is the same shape as TIW-28's: the `[locale]`
 * layout already renders `NextIntlClientProvider`, and until this ticket nothing
 * under it was a client component, so the provider's client runtime was never
 * reachable and never shipped. The first client consumer of the hook makes it
 * reachable — for every route under that layout, not only the one that uses it.
 *
 * That is exactly the defect `docs/adr/0005-getpathname-sans-le-link-client.md`
 * refuses, at half the size: bytes shipped to a page for a feature it does not
 * have. TIW-14 hit the identical wall in the same week and resolved it the same
 * way — 1.9 KB on `/fr` and 1.8 KB with a whole chunk on a route carrying no map.
 * Two tickets, one cause, so the shape is worth naming rather than rediscovering:
 * the first client consumer of `useTranslations` under the `[locale]` layout pays
 * for every route beneath it. So the hook stays on the server side of the frontier, and what crosses is
 * six strings.
 *
 * The message keys stay in this folder rather than moving into the page: there is
 * one caller, and a page that had to know `photos.viewerHeading` would be a page
 * to edit every time the viewer gains a label.
 *
 * `useTranslations` and not `getTranslations`, so this stays a *synchronous*
 * Server Component — which is what lets Testing Library render the whole chain
 * under a `NextIntlClientProvider`, the same reasoning as `world-map.tsx`.
 */

export type PhotoViewerProps = {
  readonly photos: readonly PhotoView[];
  readonly scopeId: string;
};

export function PhotoViewer({ photos, scopeId }: PhotoViewerProps): ReactElement {
  const t = useTranslations("photos");

  return (
    <PhotoLightbox
      photos={photos}
      scopeId={scopeId}
      labels={{
        heading: t("viewerHeading"),
        close: t("close"),
        previous: t("previous"),
        next: t("next"),
        /**
         * One formatted line per photo, resolved here rather than a template
         * interpolated on the client — which would need the ICU runtime this
         * whole file exists to keep out of the bundle. The cost is the payload:
         * ~14 characters per photo, so ~170 bytes for a twelve-photo trip against
         * a 100 KB document budget. Cheaper than the formatter by an order of
         * magnitude, and it stays a real translated message rather than a string
         * this repository concatenates by hand.
         */
        positions: photos.map((_photo, index) =>
          t("position", { index: index + 1, total: photos.length })
        ),
      }}
    />
  );
}
