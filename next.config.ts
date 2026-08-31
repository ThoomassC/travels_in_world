import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { routing } from "./src/i18n/routing";
import { readSlugHistory, tripRenameRedirects } from "./src/i18n/slug-history";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Deliberately NOT set here:
 *
 * - `output: "export"` — a static export disables the Image Optimization
 *   pipeline and forbids Route Handlers. The world map is rendered on the
 *   server at build time (TIW-13), which a normal Next build already does;
 *   exporting would only cost us images and the planned API route.
 * - security headers / long-lived asset cache — those live in `vercel.json`,
 *   next to the platform that actually serves them.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * The `/` → `/fr` redirect, and the ONLY thing standing in for the
   * `next-intl` proxy (ex-`src/proxy.ts`, deleted).
   *
   * A proxy/middleware would run in the Node runtime on *every* HTML request —
   * including `/fr`, which is prerendered HTML the CDN can serve on its own. A
   * config-level redirect is handled by the platform's routing layer instead, so
   * no server function is invoked and the `ƒ Proxy (Middleware)` line disappears
   * from the build output.
   *
   * What we give up, knowingly (see README, "Rendu statique") :
   * - `Accept-Language` negotiation and the `NEXT_LOCALE` cookie — both moot
   *   with a single active locale, and the cookie was removed on purpose
   *   (`localeCookie: false` in `src/i18n/routing.ts`);
   * - un-prefixed deep paths (`/voyages/japon-2024`) 404 instead of being
   *   redirected to `/fr/voyages/japon-2024`. Every internal link is generated
   *   with its locale prefix by `@/i18n/navigation`, so this only affects
   *   hand-typed or externally mangled URLs — which land on the 404 page.
   */
  /**
   * …and, since TIW-21, the renamed trip addresses.
   *
   * **Why the aliases are here and not in a page.** They must answer *before* the
   * filesystem, with a status code, on a URL that has no page any more — which is
   * precisely what `redirects()` is and what a prerendered page cannot be. Being
   * config, they are compiled into the platform's routing layer: the old address
   * costs no server function, and `/fr/voyages/<new>` stays `●` in the build
   * column. A proxy could do the same job and would put a Node invocation in front
   * of every HTML request on the site to serve a handful of renames.
   *
   * `readSlugHistory` validates the register and **throws** on an entry that
   * cannot mean what it says, so a bad alias fails `next build` here rather than
   * becoming a redirect that silently matches nothing.
   */
  async redirects() {
    const history = readSlugHistory(process.env);

    return [
      {
        source: "/",
        destination: `/${routing.defaultLocale}`,
        permanent: false,
      },
      ...tripRenameRedirects(history, routing.locales),
    ];
  },
};

export default withNextIntl(nextConfig);
