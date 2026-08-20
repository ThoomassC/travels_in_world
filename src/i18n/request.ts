import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

/**
 * Resolves the locale and its message catalogue for every server render.
 *
 * `requestLocale` is undefined outside the `[locale]` segment (the global
 * `not-found.tsx`, for instance), hence the fallback to the default locale —
 * without it those pages would have no messages at all.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
