import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

/**
 * Resolves the locale and its message catalogue for every server render.
 *
 * `requestLocale` is undefined outside the `[locale]` segment (the global
 * `not-found.tsx`, for instance), hence the fallback to the default locale —
 * without it those pages would have no messages at all.
 *
 * **The import below needed no widening for `en` and `es`, and that is the point
 * of its shape.** A template literal in a dynamic `import()` makes the bundler
 * resolve the whole directory, so every `./messages/*.json` is reachable and the
 * locale list is the only place that decides which ones are asked for. Two
 * consequences worth knowing: a locale declared in `./routing` with no catalogue
 * on disk throws while prerendering that locale's pages (`Cannot find module`),
 * which is a loud failure and the one we want; and a stray JSON left in the
 * folder is bundled even though nothing asks for it, which is why
 * `tests/smoke.test.tsx` compares the folder with `routing.locales` in both
 * directions rather than only checking that each locale has a file.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
