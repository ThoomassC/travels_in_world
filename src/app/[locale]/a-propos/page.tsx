import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localePathname } from "@/i18n/pathname";
import { aboutPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { shareMetadata } from "../../share";
import { MAIN_CONTENT_ID } from "../main-content";
import { SITE_IDENTITY, identityLinks } from "./identity";
import { IdentityLinks } from "./identity-links";
import styles from "./page.module.css";

type LocaleParams = { locale: string };

/**
 * The colophon: who writes this journal, how the site is built, and where to find
 * the author.
 *
 * **This page is the one the ticket says is not the deliverable.** TIW-25's own
 * note is that a recruiter judges the loading time of the map and the behaviour on
 * a phone, not this text — so the page is deliberately the cheapest thing on the
 * site. No `'use client'`, no dependency, no component that did not already exist:
 * a `<main>`, three headings, two lists of prose, and the anchors of
 * `./identity-links.tsx`. The milestone's two client boundaries belong to the map's
 * interaction (TIW-14) and the photo viewer (TIW-17), and this page spends none of
 * that budget. `tests/build/prerender.test.ts` derives its route list from the
 * build manifest, so this route arrives already weighed with no diff there.
 *
 * **The technical vocabulary stops at this URL.** The other half of the criterion
 * is that the trip pages stay a travel journal: nothing here is imported by them,
 * the only thing that crosses is one navigation entry, and the entry says
 * "À propos" and not what is behind it.
 *
 * **Three of the four outbound links are unknown facts, not missing features.**
 * `./identity.ts` holds them and records at length why an absent one is rendered as
 * nothing at all rather than as a placeholder.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  /**
   * `getTranslations({ locale, namespace })` and never the implicit
   * `getTranslations(namespace)`. Inside `[locale]` the implicit form is safe once
   * `setRequestLocale` has run — but `generateMetadata` runs *before* the
   * component, so there is no request locale set yet, and next-intl would read the
   * request headers to find one. A single such read turns the whole route tree
   * dynamic with `next build` still exiting 0, which is invariant 1 breaking in
   * silence. Same reasoning, at length, in `src/app/not-found.tsx`.
   */
  const t = await getTranslations({ locale, namespace: "about" });
  const site = await getTranslations({ locale, namespace: "metadata" });

  /**
   * `shareMetadata`, and the canonical is the point: the locale layout's canonical
   * is the *home page's*, so a page that declared none would ask a crawler to drop
   * it in favour of `/fr`. `tests/build/durable-urls.test.ts` refuses exactly that,
   * and it is also what keeps `aboutPath()` agreeing with this folder's name.
   *
   * No share image of its own: the only pictures this project holds are the trips'
   * photographs, and putting one of them on the colophon's card would promote a
   * single trip. `shareMetadata` falls back to the site's brand image.
   */
  return shareMetadata({
    locale,
    path: localePathname({ href: aboutPath(), locale }),
    title: t("metaTitle"),
    description: t("metaDescription"),
    siteName: site("title"),
    type: "website",
  });
}

export default async function AboutPage({ params }: { params: Promise<LocaleParams> }) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const t = await getTranslations("about");

  /**
   * Called during the build, which is what makes `identityLinks` a guard rather
   * than a formatter: a value someone fills in wrongly fails `next build` with the
   * key and the value in the message, instead of publishing a broken href under a
   * real name. Same posture as `siteUrlFrom` in `src/app/site-url.ts`.
   */
  const links = identityLinks(SITE_IDENTITY);

  return (
    /*
      The landing point of the layout's skip link — the same `id` and the same
      `tabIndex={-1}` as every other page, from the same constant. See
      `../layout.tsx` for why the attribute is needed and why the `id` cannot live
      in the layout.
    */
    <main id={MAIN_CONTENT_ID} tabIndex={-1}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("heading")}</h1>
        <p className={styles.intro}>{t("intro")}</p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("madeHeading")}</h2>
        <p className={styles.lead}>{t("madeIntro")}</p>

        {/*
          A real `<ul>` with its markers, and not a styled `<div>` stack: these are
          five separate claims and a screen reader announcing "5 éléments" is what
          tells the reader how many are coming. The markers are kept, so no
          `role="list"` is needed here — `list-style: none` is what strips the role
          in Safari, and this list does not use it.

          Every figure below is checkable in the repository this page links to:
          the two ceilings are the constants of `tests/build/prerender.test.ts` and
          `tests/map/world.test.ts`. No *measurement* is quoted, deliberately —
          `docs/adr/0009` records that the measured numbers written into this
          project's prose have already gone stale twice, and a public page is the
          worst place for the third time. A ceiling is a policy and cannot rot.
        */}
        <ul className={styles.choices}>
          <li>{t("choicePrerender")}</li>
          <li>{t("choiceMap")}</li>
          <li>{t("choiceBudget")}</li>
          <li>{t("choiceBoundaries")}</li>
          <li>{t("choiceAdr")}</li>
        </ul>

        <p className={styles.lead}>{t("stack")}</p>
        <p className={styles.aside}>{t("stackAbsent")}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("linksHeading")}</h2>
        {/*
          Never empty: the repository is the one link `identityLinks` refuses to
          let go missing, so this heading always has something under it. That is
          asserted in `tests/app/identity.test.ts` rather than defended by an
          empty state nobody could reach.
        */}
        <IdentityLinks links={links} />
      </section>
    </main>
  );
}
