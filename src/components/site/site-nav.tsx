import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { localePathname } from "@/i18n/pathname";
import { aboutPath, countriesPath, placesPath } from "@/i18n/paths";
import { locales } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import type { SearchEntry } from "@/components/search/entries";
import { SearchIndex, type CountryOutline } from "@/components/search/search-index";
import { SiteSearch } from "@/components/search/site-search";
import { NavBubble } from "./nav-bubble";
import { SiteBrand } from "./site-brand";
import styles from "./site-nav.module.css";

/**
 * The vocabulary the current-page bubble is built on.
 *
 * Each page writes its own mark onto its `<main>` — `data-page="carte"` and so on
 * — and `./site-nav.module.css` reads it backwards through `:has()`. The constant
 * exists so that the four pages and the four `data-nav` attributes below cannot
 * disagree; the stylesheet holds a third copy, which no constant can reach, and
 * the note on that rule says what happens if it drifts (nothing but a missing
 * bubble — it fails open).
 *
 * The keys are the nav's own words for its four destinations; the values are the
 * URL-ish slugs a reader would recognise in the address bar. They are the same
 * strings on purpose, and they are NOT read from `@/i18n/paths`: these are marks
 * in a stylesheet, not routes, and coupling a selector to a path constant would
 * mean a URL rename silently repaints the header.
 *
 * **`trips` still reads `voyages`, and the entry above it now says « Pays ».**
 * The label of that destination changed with the places listing; its URL did not,
 * and this constant follows the URL.
 *
 * **`countries` joined it when the country pages landed, and `trips` stayed.**
 * The « Pays » tab used to point at `/voyages`, which is why its key was `trips`
 * and why the comment above argued against renaming it — one page, one mark. That
 * argument ended the day `/pays` became a page of its own: the tab now leads
 * where its word says, and `/voyages` keeps its own mark because it is still a
 * page, still linked from the home listing, from every city row and from every
 * country page. It simply no longer has a tab, which is what four destinations
 * on a phone allows.
 */
export const PAGE_MARK = {
  map: "carte",
  countries: "pays",
  trips: "voyages",
  places: "villes",
  about: "a-propos",
} as const;

/**
 * The message key naming each language, **in that language**.
 *
 * `satisfies Record<Locale, string>` rather than an annotation: the check has to
 * be exhaustive — activating a fourth locale must fail `npm run typecheck` here,
 * next to the flag it also has no drawing for, rather than render a menu entry
 * with a missing-message error in it.
 */
const LANGUAGE_NAME_KEY = {
  fr: "languageFr",
  en: "languageEn",
  es: "languageEs",
} as const satisfies Readonly<Record<Locale, string>>;

/**
 * **The three flags, and they are the only literal colours in `src/**`.**
 *
 * Everything else in this repository takes its colour from `src/styles/tokens.css`
 * — that is the contract `tests/styles/colour-contract.test.ts` guards. These
 * eight hexadecimals are a deliberate exception, written here rather than
 * anywhere else so that the exception is visible at the point it is taken: a
 * national flag is not a design token. `#ED2939` is the red of the French flag
 * and means nothing else; re-pointing it at `--accent` would produce a teal
 * tricolour, which is not a quieter flag but a wrong one. They are therefore
 * exempt from the theme as well — a flag does not invert at dusk.
 *
 * **SVG and not emoji, and that is a measurement rather than a preference.** The
 * regional-indicator emoji (🇫🇷) have no glyph in any font Windows ships, so
 * Chrome and Edge on Windows render the two letters "FR" in a box — for the
 * majority of desktop visitors, the "flag" would be the country code, badly set.
 * An inline SVG renders identically everywhere and costs no font.
 *
 * `aria-hidden`, all three: the label beside each flag already names the language
 * in that language, and an announced decoration is noise. `focusable="false"` is
 * not redundant with it — old Trident and Edge put SVG elements in the tab order
 * regardless.
 *
 * No `id` anywhere in these drawings, and that is load-bearing: the current
 * locale's flag is rendered twice per document (in the summary and in the panel),
 * so any `<clipPath id>` or `<linearGradient id>` would be a duplicate id in the
 * page. It is also why the Union Jack below is the uncounterchanged rendition —
 * the real flag's offset diagonals need a clip path, and a flag at 22 px does not
 * repay a duplicated id.
 *
 * The `en` flag is the Union Jack, which is a compromise stated rather than
 * hidden: `en` is a language and not a country, and there is no flag of the
 * English language. The alternative — a US flag — would be a different arbitrary
 * choice, and the row's actual label is the word "English".
 */
const FLAG: Readonly<Record<Locale, ReactElement>> = {
  fr: (
    <svg className={styles.flag} viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      <rect width="30" height="20" fill="#ffffff" />
      <rect width="10" height="20" fill="#002395" />
      <rect x="20" width="10" height="20" fill="#ed2939" />
    </svg>
  ),
  en: (
    <svg className={styles.flag} viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      <rect width="30" height="20" fill="#012169" />
      {/* The root `<svg>` clips to its viewBox, which is what keeps the stroked
          diagonals from spilling past the corners they start in. */}
      <path d="M0,0 L30,20 M30,0 L0,20" fill="none" stroke="#ffffff" strokeWidth="4" />
      <path d="M0,0 L30,20 M30,0 L0,20" fill="none" stroke="#c8102e" strokeWidth="2" />
      <path d="M15,0 V20 M0,10 H30" fill="none" stroke="#ffffff" strokeWidth="6.6" />
      <path d="M15,0 V20 M0,10 H30" fill="none" stroke="#c8102e" strokeWidth="4" />
    </svg>
  ),
  es: (
    <svg className={styles.flag} viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      <rect width="30" height="20" fill="#aa151b" />
      <rect y="5" width="30" height="10" fill="#f1bf00" />
    </svg>
  ),
};

/**
 * The site's header: the brand lock-up against the window's left edge, the four
 * main destinations centred, and the language menu on the right.
 *
 * **The shell stays server-rendered, with one small client boundary.** The
 * anchors, `<nav>` and native `<details>` remain in this component; `NavBubble`
 * only owns the navigation list so a client-side click can animate the shared
 * surface before the route changes. The language menu in particular remains a
 * disclosure the browser opens itself — see the note on it below.
 *
 * **Plain anchors, and the hrefs come from `localePathname`.** Not `Link` from
 * `@/i18n/navigation`: every export of that module is built inside one
 * `createNavigation(routing)` call whose module imports a `"use client"`
 * `BaseLink` at the top level, so reaching any of them ships next-intl's client
 * `Link` to the route — measured at 3.8 KB brotli and two chunks on `/fr`, and
 * 12.4 KB on `/_not-found`. This nav renders on **every** page of the site, so
 * that cost would be paid everywhere. Invariant 2 is still satisfied: the URL is
 * assembled inside `src/i18n/**`, which is what the rule asks. See
 * `docs/adr/0005-getpathname-sans-le-link-client.md`.
 *
 * **The locale is a prop, never `useLocale()`.** `src/i18n/paths.ts` states the
 * rule — "the locale arrives as a prop, never as ambient state" — and the type is
 * the reason it is not merely style here: `localePathname` takes a `Locale`, and
 * the layout has already narrowed the URL segment with `hasLocale` before
 * rendering. Reading it back from context would mean widening it to `string` and
 * narrowing it again, in a component that has no business deciding what a valid
 * locale is.
 *
 * **What is deliberately absent, and it is STILL `aria-current="page"`.** The
 * current entry now gets a shared liquid surface, and it would be easy to read
 * that as the marker finally arriving. It is not. The visual state is painted by
 * CSS and the small `NavBubble` client boundary; neither changes the accessibility
 * tree. So a screen reader gets exactly what it got before: four links, none of
 * them marked, on a page whose `<h1>` names it.
 *
 * > **What that trick changed, and what it did not.** The previous version of this
 * > note said there were exactly two ways to know the current page — a client
 * > component or a request read — and that a third road existed only for a nav
 * > rendered by a *page* rather than by the layout. That was wrong: a page can
 * > hand the information to the layout's subtree through the DOM, and CSS can read
 * > it upward. The server-rendered links remain plain and the client boundary is
 * > limited to movement during an in-app navigation. What it does not do is reach
 * > the accessibility tree, which is what `aria-current` is for and why this
 * > paragraph is still here rather than deleted.
 */
export type SiteNavProps = {
  readonly locale: Locale;
  /**
   * The search index, built by the layout — see its note for why `loadTrips()`.
   *
   * A prop and not a call here: this component is synchronous (`useTranslations`
   * needs it to be, and an `async` component cannot be rendered by Testing
   * Library at all), and the content façade is `async`. The layout is already the
   * place that awaits it.
   */
  readonly searchEntries: readonly SearchEntry[];
  /**
   * One country outline per country the suggestions draw, deduplicated by the
   * layout. Separate from the entries because the geometry comes from `@/map`,
   * which a pure index builder cannot reach.
   */
  readonly searchCountries: readonly CountryOutline[];
};

export function SiteNav({ locale, searchEntries, searchCountries }: SiteNavProps): ReactElement {
  const t = useTranslations("trips");
  const s = useTranslations("search");

  return (
    /*
      TIW-38: the header is a full-bleed bar, so it has two boxes and not one.
      `.bar` paints edge to edge and is what sticks; `.inner` is the measure, and
      it is the box that used to be `.header`. A single element cannot do both —
      a `max-width` that centres the content also stops the background.

      The two are SIBLINGS and no longer nested: the lock-up has to reach the
      window's left edge while the nav keeps the page's measure, and the sheet
      lays them over one another in a single grid cell to get both without
      computing a viewport width. `./site-nav.module.css` records why `100vw` is
      not available for that.
    */
    <header className={styles.bar}>
      {/*
        The lock-up lives here rather than in the layout so that "the chrome" is
        one component with one stylesheet deciding how its parts share a line. It
        is the link home from every page — `SiteBrand` records why it is a plain
        anchor and why the SVG is inline.

        OUTSIDE the `<nav>`, deliberately. A logo that is also a link home is not
        a navigation *entry*: putting it in the list would make a screen reader
        announce "4 éléments" and offer the reader a fourth destination that is the
        same page as the first one ("Carte" is `/fr`). The landmark stays a
        three-entry menu, and the way home stays where every site puts it.

        FIRST in the document, ahead of the nav it visually overlaps, because that
        is the reading order — the grid decides where the two are painted and must
        not decide what is announced first.
      */}
      <div className={styles.brandZone}>
        <SiteBrand locale={locale} />
      </div>
      <div className={styles.inner}>
        {/*
          Labelled, because `<nav>` is a landmark and an unlabelled one is
          announced as "navigation" with nothing to tell it from the next. There is
          only one today; naming it costs a message key and survives the second.
        */}
        <nav aria-label={t("navLabel")}>
          {/*
            `role="list"` is redundant markup that is NOT redundant in practice:
            `list-style: none` strips the list role in Safari with VoiceOver, and a
            nav that has lost it also loses its item count. The same note is on the
            marker list in `src/components/map/world-map.module.css`; jsdom keeps
            the role either way, so no unit test can see this.
          */}
          <NavBubble>
            {/*
              `data-nav` identifies the destination for both the stylesheet and
              `NavBubble`'s click delegation. It carries no state to assistive
              technology; see the header's last paragraph.
            */}
            <li>
              <a
                className={styles.link}
                data-nav={PAGE_MARK.map}
                href={localePathname({ href: "/", locale })}
              >
                {t("navMap")}
              </a>
            </li>
            {/*
              « Pays », and it now leads to countries: `/pays`, an index of the
              countries the journal has reached, each row opening that country's
              own page. It used to lead to `/voyages`, the full catalogue grouped
              by country — one page wearing three names, the tab saying « Pays »,
              the heading « Voyages par pays » and the address `/voyages`.

              **Renaming the tab was the other way out, and it was measured and
              refused.** « Voyages » is 36 px wider than « Pays » at
              `--text-sm` upper-cased, and the four labels already fit a 360 px
              phone with 11 px to spare — the wider word puts the row back onto two
              lines on every phone, which is the defect `site-nav.module.css` has
              just spent a media query removing.
            */}
            <li>
              <a
                className={styles.link}
                data-nav={PAGE_MARK.countries}
                href={localePathname({ href: countriesPath(), locale })}
              >
                {t("navCountries")}
              </a>
            </li>
            {/*
              « Villes », the other grain of the same collection. It sits between
              the countries and the colophon because the two listings are peers —
              a reader chooses between them — and because the colophon stays last
              for the reason recorded below it.

              The label is the owner's word and the page's own introduction
              carries the nuance that Corse and Noirmoutier are not cities. See
              the header of `src/app/[locale]/villes/page.tsx`.
            */}
            <li>
              <a
                className={styles.link}
                data-nav={PAGE_MARK.places}
                href={localePathname({ href: placesPath(), locale })}
              >
                {t("navPlaces")}
              </a>
            </li>
            {/*
              The colophon (TIW-25), and it is in the header rather than in a footer
              for one measured reason: there is no footer, and adding one would put a
              second landmark and a second stylesheet on **every** route of the site
              to carry a single link. The criterion asks for "the main navigation OR
              the footer"; the nav is already rendered by the layout, so this entry
              costs one `<li>` and one message key and appears everywhere by
              construction.

              LAST, and that order is the criterion's other half. "Aucun jargon
              technique sur les pages de voyage" — a reader who came for a story meets
              the map and the listing first, and a label that says nothing about what
              is behind it. The technical vocabulary starts on the other side of this
              link and nowhere before it.
            */}
            <li>
              <a
                className={styles.link}
                data-nav={PAGE_MARK.about}
                href={localePathname({ href: aboutPath(), locale })}
              >
                {t("navAbout")}
              </a>
            </li>
          </NavBubble>
        </nav>

        {/*
          **The right-hand end of the bar: the search, then the language menu.**

          One box for the two, and it is not tidiness. `.inner` is a three-column
          grid — `mark | links | language` — whose middle column is what puts the
          nav on the page's centre line; adding a fourth child would have given
          the search a column of its own and moved that centre. Measured before it
          was one box: the panel opened under the *lock-up*, because an unnamed
          grid item takes the next free cell and the first column is empty by
          design.
        */}
        <div className={styles.chromeEnd}>
          {/*
          **The search, and it sits before the language menu.**
          After the nav in the DOM because that is the reading order a reader
          expects: the four destinations first, then the way to find a fifth.

          The panel's rows are rendered HERE, by the server, and handed to the
          client component as children — `./search-index.tsx` and the header of
          `../search/site-search.tsx` say why that is the whole design rather
          than a detail. The consequence to know: the index is in the HTML of
          every document, because the chrome is.

          The three plural forms are resolved on the server, one string each,
          rather than an ICU pattern crossing the boundary. The component
          substitutes `{count}` in the third and does no plural arithmetic of its
          own: plural rules belong to the language, and next-intl already owns
          them here. Same move as the map's `zoomValue`.

          **`s.raw` on the third, and it is the whole point of the design above.**
          `resultsMany` is `"{count} résultats."` — an ICU pattern that is meant to
          reach the browser *unformatted*, because the number is only known once a
          reader has typed. `s(...)` formats it, so next-intl asks for a `count`
          nobody has, raises FORMATTING_ERROR and hands back its fallback: the
          literal string `search.resultsMany`, which is then what a screen reader
          announces. `s.raw(...)` returns the pattern and does not format.

          **It was invisible in production, and that is the part worth keeping.**
          next-intl only validates arguments under the `development` export
          condition; a `next build` resolves the other one, `s("resultsMany")`
          returns the pattern by accident, and the whole end-to-end suite goes
          green over a broken dev server. Measured, same catalogue, same call:

            node --conditions=development  ->  "search.resultsMany"
            node                           ->  "{count} résultats."

          `tests/i18n/message-arguments.test.ts` is what refuses the class now: it
          reads every `t("key")` in `src/**` against every catalogue and fails on
          any whose message carries a placeholder and was not read raw. A runtime
          test could not — under Vitest, next-intl resolves the forgiving half too.
        */}
          <SiteSearch
            labels={{
              field: s("field"),
              placeholder: s("placeholder"),
              listLabel: s("listLabel"),
              resultsNone: s("resultsNone"),
              resultsOne: s("resultsOne"),
              resultsMany: s.raw("resultsMany"),
            }}
          >
            <SearchIndex
              entries={searchEntries}
              countries={searchCountries}
              labels={{
                groups: {
                  trips: s("groupTrips"),
                  places: s("groupPlaces"),
                  countries: s("groupCountries"),
                  pages: s("groupPages"),
                },
              }}
            />
          </SiteSearch>

          {/*
          **The language menu, and it switches for real now** (TIW-38).
          `src/i18n/routing.ts` declares three locales and each has a catalogue, so
          the three entries below are three live routes rather than the one link
          and one `aria-disabled` label this used to be.

          **A native `<details>`, never a client component.** Open on click, open
          on Enter and on Space, an expanded state exposed to screen readers, and
          contents that leave the tab order when it is shut — all of that is what
          `<summary>` already does, in zero byte of JavaScript. Spending the
          milestone's last client boundary on a dropdown would have been spending
          it on something the browser gives away, and it would have shipped a
          React runtime to every route of the site to do it.

          What the native element does NOT give, checked in Chromium rather than
          assumed: it does not close on `Escape`, and it does not close when the
          pointer goes elsewhere. Both would be listeners, and listeners are the
          client component this refuses; `./site-nav.module.css` weighs that.

          **The links all point at the locale's HOME PAGE, not at the current page
          in another language, and that is a real limitation rather than an
          oversight.** This component is rendered by the layout, which receives
          only `params` and therefore does not know which page is being read. The
          `data-page` trick that paints the current nav entry cannot help: it
          travels from the page to the *stylesheet*, and an href has to exist
          before the CSS runs. Reading the pathname would mean either a client
          component (`usePathname`) or a request read, which is invariant 1. So a
          reader on `/fr/voyages/japon-2024` who switches to Spanish lands on
          `/es` and has to navigate back. The way out, the day it is worth it, is a
          prop threaded from each page — not a boundary here.
        */}
          <details className={styles.language}>
            <summary>
              {FLAG[locale]}
              {/*
              The summary's accessible name. Real text rather than an
              `aria-label`, the same argument `SiteBrand` makes for its own hidden
              span: a name that is really in the accessibility tree is one a
              voice-control user can say out loud.
            */}
              <span className={styles.visuallyHidden}>{t("languageMenu")}</span>
              {/* The disclosure's affordance, since the native triangle is hidden.
                `currentColor`, so it dims and brightens with the label it belongs
                to instead of being a second colour decision. */}
              <svg
                className={styles.chevron}
                viewBox="0 0 12 8"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M1,1.5 L6,6.5 L11,1.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </summary>
            <div className={styles.languagePanel}>
              <p className={styles.languageTitle}>{t("languageLabel")}</p>
              {/*
              Anchors in a plain box and NOT an `<li>` list, which is the one place
              this markup gives something up. A list would let a screen reader
              announce "3 éléments" before the choices. It is not one because the
              only list in this header is the navigation landmark, and
              `tests/components/site/site-brand.test.tsx` pins that landmark at
              exactly four items — a count that exists to catch the lock-up being
              tidied into the nav. Three `<li>` here would make that guard red for
              a reason it is not about, and loosening it to make room would be
              trading a real guard for an announcement three links do not need.

              `locales` and not a literal list: `src/i18n/routing.ts` is the single
              declaration of what exists, and the day a fourth is added this loop
              renders it — while `LANGUAGE_NAME_KEY` and `FLAG` above fail the
              typecheck until it has a name and a drawing.
            */}
              {locales.map((code) => (
                <a
                  key={code}
                  className={styles.languageLink}
                  href={localePathname({ href: "/", locale: code })}
                  /*
                  `lang` and `hrefLang` on each entry, and they say two different
                  things. `lang` declares that the label "Español" IS Spanish, so a
                  French screen reader switches voice for those two words instead
                  of reading them with French phonemes. `hrefLang` declares what is
                  at the other end of the link, which is what a crawler reads.
                */
                  lang={code}
                  hrefLang={code}
                  /*
                  This one DOES reach the accessibility tree, unlike the nav's
                  underline: the component knows its own locale, so the state is
                  set in the markup and the stylesheet only paints it.
                  `aria-current="true"` and not `"page"` — the entry is the current
                  *language*, and `/fr` is not the page being read.
                */
                  aria-current={code === locale ? "true" : undefined}
                >
                  {FLAG[code]}
                  <span>{t(LANGUAGE_NAME_KEY[code])}</span>
                </a>
              ))}
              {/*
              What the reader needs BEFORE clicking: the chrome is translated and
              the récits are not. `src/i18n/routing.ts` records that decision; this
              is the one place a visitor is told about it, and telling them after
              the click would be telling them too late.
            */}
              <p className={styles.languageNote}>{t("languageNote")}</p>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
