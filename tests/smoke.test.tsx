import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import frMessages from "@/i18n/messages/fr.json";
import { defaultLocale, locales } from "@/i18n/routing";

/**
 * Smoke test for the toolchain itself, not for a feature: it fails if the JSX
 * transform, jsdom, Testing Library, jest-dom matchers, the `@/` alias or the
 * next-intl message pipeline are misconfigured. Keep it until real component
 * tests cover the same ground.
 */
/**
 * The catalogue folder. `import.meta.dirname` and NOT
 * `new URL("…", import.meta.url)`: under jsdom `import.meta.url` is not a `file:`
 * URL, and `readdirSync` rejects it with "The URL must be of scheme file".
 * Measured here; `tests/styles/colour-contract.test.ts` locates the stylesheet
 * the same way, in the same suite.
 */
const MESSAGES_DIRECTORY = path.resolve(import.meta.dirname, "../src/i18n/messages");

/** The `<locale>.json` files really on disk, in no particular order. */
function catalogueFiles(): readonly string[] {
  return readdirSync(MESSAGES_DIRECTORY).filter((file) => file.endsWith(".json"));
}

/**
 * Every message key of a catalogue, dotted and sorted — `home.title`,
 * `trips.allHeading`. Flattened because a namespace present but empty is exactly
 * the shape a half-translated catalogue takes, and comparing top-level names
 * would call it complete.
 */
function messageKeys(catalogue: Record<string, unknown>, prefix = ""): readonly string[] {
  return Object.entries(catalogue)
    .flatMap(([key, value]) =>
      typeof value === "object" && value !== null
        ? messageKeys(value as Record<string, unknown>, `${prefix}${key}.`)
        : [`${prefix}${key}`]
    )
    .sort();
}

function Placeholder() {
  const t = useTranslations("home");

  return (
    <section>
      <h1>{t("title")}</h1>
      <p>{t("latestHeading")}</p>
    </section>
  );
}

describe("toolchain smoke", () => {
  it("renders a component through the next-intl message catalogue", () => {
    render(
      <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
        <Placeholder />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole("heading", { level: 1, name: frMessages.home.title })).toBeVisible();
    expect(screen.getByText(frMessages.home.latestHeading)).toBeInTheDocument();
  });

  it("keeps a usable localStorage despite Node 25's native global (see tests/setup.ts)", () => {
    expect(typeof window.localStorage.setItem).toBe("function");

    window.localStorage.setItem("tiw-probe", "1");

    expect(window.localStorage.getItem("tiw-probe")).toBe("1");
    expect(window.localStorage.length).toBe(1);
  });

  /**
   * The active-locale set, and it is a decision recorded rather than a count.
   * This assertion used to read `toEqual(["fr"])` and to carry the alarm for the
   * day a second locale arrived. That day has come — `fr`, `en`, `es` — and the
   * two things the alarm named were handled by deciding them, not by fixing them:
   *
   * - `src/app/not-found.tsx` is the single global 404 and still resolves
   *   `routing.defaultLocale`, so `/en/page-inexistante` serves a French 404
   *   announced `lang="fr"`. A `[locale]/not-found.tsx` does NOT change that —
   *   measured: an unmatched URL goes to the global boundary, never the
   *   segment's — and the `[locale]/[...rest]` catch-all that would, costs a
   *   dynamic `ƒ` route and therefore invariant 1. Accepted, and written down in
   *   `src/i18n/routing.ts` and the README ("Rendu statique").
   * - the `/de` E2E expectation ("an unknown locale prefix 404s where it
   *   stands") still describes an *inactive* prefix, and `de` is still inactive.
   *   `en` and `es` are prerendered pages, which that spec does not touch.
   *
   * What this case is FOR, now: the order and the membership are load-bearing
   * elsewhere. `locales[0]` is not, but `defaultLocale` is — it is what the 404,
   * the feed and `x-default` resolve to — and the set is what
   * `generateStaticParams`, the sitemap and `alternates.languages` iterate. A
   * locale added here without its catalogue is caught by the next case.
   */
  it("declares the three active locales, French being the default", () => {
    expect(locales).toEqual(["fr", "en", "es"]);
    expect(defaultLocale).toBe("fr");
    expect(locales).toContain(defaultLocale);
  });

  /**
   * The pairing `src/i18n/routing.ts` states: a declared locale has a catalogue,
   * and a catalogue belongs to a declared locale.
   *
   * It matters in both directions and neither fails loudly on its own. A locale
   * declared with no file makes `src/i18n/request.ts` throw while prerendering
   * *that locale's* pages — loud, but only once someone builds. A file left in
   * the folder for a locale nobody declares is bundled by the template-literal
   * `import()` and served to nobody: dead weight in every document, silently.
   *
   * The folder is READ, not listed here, so adding a fourth locale needs no diff
   * — and so this case cannot go on asserting something about `fr` and `en` while
   * `es` rots. `readdirSync` rather than `import.meta.glob`: the glob is a Vite
   * transform whose types need `vite/client`, which this project does not put in
   * `compilerOptions.types` (see `vitest.config.ts` on `globals`, same trap), so
   * it typechecks under Vitest and breaks `npm run typecheck`. Measured.
   */
  it("has one message catalogue per declared locale, and no orphan file", () => {
    const present = catalogueFiles()
      .map((file) => file.replace(/\.json$/, ""))
      .sort();

    expect(present).toEqual([...locales].sort());
  });

  /**
   * Every catalogue carries every key, French being the reference.
   *
   * A missing key does not fail a build: next-intl logs an `IntlError` and
   * renders the key path, so `/es/voyages` would ship with `trips.allHeading`
   * where a heading belongs — visible only to whoever opens that page. This is
   * the guard `src/i18n/routing.ts` names when it says a locale and its catalogue
   * move together.
   *
   * Keys only, never values: a translation that is still the French sentence is a
   * translator's judgement, not a defect this suite can see.
   */
  it("gives every locale the whole of the French key set", () => {
    const reference = messageKeys(frMessages as Record<string, unknown>);

    for (const file of catalogueFiles()) {
      const catalogue: unknown = JSON.parse(
        readFileSync(path.join(MESSAGES_DIRECTORY, file), "utf8")
      );

      expect(
        messageKeys(catalogue as Record<string, unknown>),
        `src/i18n/messages/${file} does not carry the French key set`
      ).toEqual(reference);
    }
  });

  it("has a namespace for every part of the site that reads one", () => {
    expect(Object.keys(frMessages)).toEqual(
      expect.arrayContaining(["metadata", "home", "trips", "map", "notFound", "about"])
    );
    expect(frMessages.home.title).not.toBe("");
    expect(frMessages.trips.allHeading).not.toBe("");
    expect(frMessages.about.heading).not.toBe("");
  });
});
