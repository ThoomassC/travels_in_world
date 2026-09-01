import type { MetadataRoute } from "next";
import { absoluteUrl, SITE_URL } from "./site-url";

/**
 * `/robots.txt`, and its job is to be **coherent with the sitemap** rather than to
 * hide anything: this site has no private area, so there is nothing to `Disallow`
 * on the production deployment.
 *
 * WHAT IT DELIBERATELY DOES NOT DISALLOW: the URL of a withdrawn trip. That looks
 * backwards and it is not — a crawler that is forbidden to fetch a page can never
 * read the `noindex` on it, so the entry would *preserve* the stale listing it was
 * meant to remove. The withdrawn page carries `noindex, follow` and stays
 * crawlable, which is what actually gets it out of an index.
 *
 * **This route is prerendered**, like `sitemap.ts` next to it: a Route Handler that
 * reads no request-time API is cached at build time. Verify in `npm run build`:
 * `○ /robots.txt`, never `ƒ`.
 */

/**
 * A preview deployment must not be crawled, and this is the half of that which
 * lives in the repository.
 *
 * A Vercel preview URL is public and Vercel comments it on the pull request of a
 * public repository (`docs/deploiement.md` says so at length about drafts). Left
 * inviting, a preview competes with the real site for the same content under a
 * `*.vercel.app` host nobody controls the lifetime of. `src/app/site-url.ts` closes
 * the other half by pointing every canonical at the production domain even from a
 * preview.
 *
 * `VERCEL_ENV` is the only name that distinguishes the three deployments, it is set
 * by the platform and not by us, and it is **absent** on a workstation and on the
 * CI runner — where a local production build is inspected and the E2E suite runs,
 * and where refusing crawlers would only make the assertions test the wrong branch.
 * So: absent means "not a deployment, allow"; present and not `production` means
 * "preview, refuse". Same variable, and the same reading of it, as the drafts cap
 * in `src/content/loader.ts`.
 */
function isCrawlableDeployment(): boolean {
  const environment = process.env.VERCEL_ENV;

  return environment === undefined || environment === "production";
}

export default function robots(): MetadataRoute.Robots {
  if (!isCrawlableDeployment()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/" },
    /**
     * Absolute, because `robots.txt` is read by a machine on another host: the
     * standard has no notion of a relative `Sitemap:` line.
     */
    sitemap: absoluteUrl("/sitemap.xml"),
    /**
     * The canonical host, for the crawlers that read it. It repeats what the
     * `<link rel="canonical">` of every page already says, from the same origin —
     * one source, two places that need it.
     */
    host: SITE_URL.host,
  };
}
