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
function Placeholder() {
  const t = useTranslations("home");

  return (
    <section>
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
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
    expect(screen.getByText(frMessages.home.intro)).toBeInTheDocument();
  });

  it("keeps a usable localStorage despite Node 25's native global (see tests/setup.ts)", () => {
    expect(typeof window.localStorage.setItem).toBe("function");

    window.localStorage.setItem("tiw-probe", "1");

    expect(window.localStorage.getItem("tiw-probe")).toBe("1");
    expect(window.localStorage.length).toBe(1);
  });

  /**
   * Also the project's alarm for activating a second locale. Two things break
   * the day this goes red, and neither shows up anywhere else:
   *
   * - `src/app/not-found.tsx` is the single global 404 and hardcodes
   *   `routing.defaultLocale`, so `/en/page-inexistante` would serve a French
   *   404 announced `lang="fr"`. A `[locale]/not-found.tsx` does NOT fix this —
   *   measured: an unmatched URL goes to the global boundary, never the
   *   segment's — and the `[locale]/[...rest]` catch-all that would, costs a
   *   dynamic `ƒ` route. See README, "Rendu statique".
   * - the `/de` E2E expectation ("an unknown locale prefix 404s where it
   *   stands") describes an *inactive* prefix; an active `en` must not behave
   *   that way.
   *
   * So: do not just widen this assertion. Handle both, then widen it.
   */
  it("declares exactly one active locale, and it is the default one", () => {
    expect(locales).toEqual(["fr"]);
    expect(locales).toContain(defaultLocale);
  });

  it("has a namespace for every part of the site that reads one", () => {
    expect(Object.keys(frMessages)).toEqual(
      expect.arrayContaining(["metadata", "home", "trips", "map", "notFound"])
    );
    expect(frMessages.home.intro).not.toBe("");
    expect(frMessages.trips.allHeading).not.toBe("");
  });
});
