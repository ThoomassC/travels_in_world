import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import styles from "./project-purpose.module.css";

/**
 * What this carnet is for, and who writes it — the block that closes the home
 * page (TIW-38).
 *
 * **Why it is here and not only on `/a-propos`.** The About page answers the
 * question for a reader who went looking; this answers it for the one who did
 * not, at the moment they have finished looking at the map and the trips and are
 * deciding whether there is a person behind them. The two texts are deliberately
 * different lengths and say different things — a copy of the About page's opening
 * would be a second place for the same sentence to drift.
 *
 * **No `'use client'`, no JavaScript.** A heading, two paragraphs, a link and a
 * `<picture>`; the milestone's two client boundaries belong to the map and the
 * photo viewer, and this is neither.
 *
 * **The portrait is a `<picture>` with an AVIF and a JPEG, both square.** Not
 * `next/image`: this project renders its photographs as plain elements for the
 * reason `photo-figure.tsx` records at length, and one profile picture is not a
 * reason to start a second pipeline. The two files are 480 x 480 — twice the
 * largest size the circle is ever drawn at — cropped from the 900 x 1200 original
 * with `position: "top"`, because a centred square crop of a standing portrait
 * cuts the chin.
 *
 * The intrinsic `width`/`height` are on the `<img>` so the circle's box is
 * reserved before the bytes arrive: without them this block grows by 240 px when
 * the photograph lands, and it is the last thing on the page, which is where a
 * layout shift is most likely to be under the reader's thumb.
 */
export function ProjectPurpose(): ReactElement {
  const t = useTranslations("purpose");

  return (
    <section className={styles.purpose} aria-labelledby="objectif">
      <div className={styles.text}>
        <h2 className={styles.heading} id="objectif">
          {t("heading")}
        </h2>
        <p className={styles.body}>{t("body")}</p>
        <p className={styles.body}>{t("method")}</p>
      </div>

      {/*
        A `<div>` and NOT a `<figure>`, which is what it was for one commit.

        A `<figure>` is self-contained content referred to from the flow, and this
        is a portrait inside the paragraph that is about its subject — there is no
        caption and nothing refers to it. It also stopped being free the moment the
        home page already had one: `getByRole("figure")` is how three e2e cases
        identify the MAP, and a second figure made all three ambiguous. The role
        was costing something and buying nothing.
      */}
      <div className={styles.portrait}>
        <picture>
          <source srcSet="/portrait-thomas-caron.avif" type="image/avif" />
          <img
            className={styles.photo}
            src="/portrait-thomas-caron.jpg"
            width={480}
            height={480}
            /**
             * Descriptive, because this image is NOT beside a name: the heading
             * says what the section is about, not who is in the picture. On the
             * portfolio the same photograph carries an empty alt in the header,
             * where the name is next to it — the same file, two contexts, two
             * alternatives, which is what WCAG 1.1.1 asks for.
             */
            alt={t("portraitAlt")}
            loading="lazy"
            decoding="async"
          />
        </picture>
      </div>
    </section>
  );
}
