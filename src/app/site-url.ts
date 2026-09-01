/**
 * The site's own origin — the one place in the repository that knows where this
 * site lives.
 *
 * WHY IT EXISTS. Three things need an absolute URL and none of them can guess
 * one: `<link rel="canonical">`, `sitemap.xml`, and the `og:image` /
 * `twitter:image` a messaging app fetches from another host entirely. Everything
 * else in this project builds *relative* paths through `@/i18n/pathname`, which
 * is the right default and is why this module is small and alone.
 *
 * WHY IT IS RESOLVED AT BUILD TIME AND NOT PER REQUEST. Invariant 1 of AGENTS.md:
 * every route is prerendered, so the canonical URL and the sitemap are bytes
 * written to disk during `next build`. Reading the request's `Host` header would
 * be the "correct" answer for a multi-domain site and is exactly the read that
 * de-statifies the tree. So the origin is a build input, and a build input has
 * to come from somewhere that is not a request.
 *
 * THE ORDER, and what each entry is for:
 *
 * 1. `TIW_SITE_URL` — an explicit override. What the test suite sets, and the
 *    escape hatch for a domain the platform does not know about (a domain served
 *    through a proxy, a staging host, a local production build being inspected).
 * 2. `VERCEL_PROJECT_PRODUCTION_URL` — set by Vercel on every build, and it is
 *    the *project's* production domain, not the deployment's. This is the entry
 *    that answers "one place to change the day the domain changes" with **zero**
 *    places: the day a real domain is added in Settings → Domains, Vercel starts
 *    handing that domain here and the canonicals follow on the next build, with
 *    no commit.
 * 3. {@link FALLBACK_SITE_URL} — the constant below, for a build that has neither.
 *
 * WHY NOT `VERCEL_URL`, which is the variable everyone reaches for first: it is
 * the *deployment's* URL and it carries a fresh random suffix on every push
 * (`travels-in-world-9f3a1c-thomas.vercel.app`). A canonical built from it names
 * a URL that will never be linked again, and a sitemap built from it advertises
 * a host that stops being the site tomorrow. It is deliberately not read here.
 *
 * WHAT HAPPENS ON A PREVIEW DEPLOYMENT, since entry 2 is the production domain on
 * every environment: a preview's canonicals point at production. That is the
 * correct answer rather than a shortcut — a preview must not compete with the
 * real page in an index — and `src/app/robots.ts` closes the other half by
 * refusing crawlers outright anywhere but production.
 */

/**
 * The origin used when nothing in the environment supplies one — a local
 * production build, and any build before the Vercel project exists.
 *
 * It is a *plausible* production URL and not `http://localhost:3000`, and that
 * choice is the load-bearing one. Something absolute has to be written into
 * every prerendered document; a localhost canonical shipped by accident tells a
 * crawler that the real page is on a machine it cannot reach, which is worse
 * than naming the wrong public host. `travels-in-world` is the project's name in
 * `package.json`, so this is also the default domain Vercel will assign.
 *
 * THE DAY THE DOMAIN CHANGES: nothing to do here if the project is on Vercel —
 * entry 2 above wins. Off Vercel, this line is the single place to edit.
 */
export const FALLBACK_SITE_URL = "https://travels-in-world.vercel.app";

/**
 * The environment this module reads — `TIW_SITE_URL` and
 * `VERCEL_PROJECT_PRODUCTION_URL`, in that order.
 *
 * An index signature rather than the two named optional properties, which is what
 * this was and which does not typecheck: a type whose every property is optional
 * has no overlap with `NodeJS.ProcessEnv`, and TypeScript rejects the call
 * (`TS2559`) instead of narrowing it. The names live in the doc comments and in
 * {@link siteUrlFrom}; what this type buys is a literal in the test.
 */
export type SiteUrlEnvironment = Readonly<Record<string, string | undefined>>;

/** Blank is absent: an environment variable set to `""` is the shape a CI form produces. */
function declared(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

/**
 * Vercel hands `VERCEL_PROJECT_PRODUCTION_URL` as a bare host — no scheme — while
 * `TIW_SITE_URL` is written by a human who will usually include one. Both spellings
 * resolve to the same origin rather than one of them throwing.
 *
 * `https` and not `http`: every host this can name is served over TLS, and a
 * canonical announcing `http` invites a redirect chain on the one URL that must
 * not have one.
 *
 * The test is "does it carry ANY scheme", not "does it carry http(s)", and the
 * difference was a real hole caught by `tests/app/site-url.test.ts`. Prepending
 * `https://` to `ftp://carnet.example` builds `https://ftp://carnet.example`, which
 * `new URL` happily parses as the host `ftp` — so the protocol check below never
 * fired and the whole site would have carried canonicals on `https://ftp`. Leaving a
 * declared scheme alone lets the check see it and refuse it.
 */
function withScheme(host: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(host) ? host : `https://${host}`;
}

/**
 * Resolves the origin, and **throws** rather than falling back when a value is
 * present but unusable.
 *
 * The throw is the point. A malformed `TIW_SITE_URL` silently replaced by the
 * fallback would publish a whole site of canonicals pointing at the wrong host,
 * with a green build — the failure shape invariant 1 exists to refuse. `new URL`
 * runs during `next build`, so a typo fails the build with the value in the
 * message.
 */
export function siteUrlFrom(environment: SiteUrlEnvironment): URL {
  const configured = declared(environment.TIW_SITE_URL);
  const platform = declared(environment.VERCEL_PROJECT_PRODUCTION_URL);
  const source =
    configured !== undefined
      ? { name: "TIW_SITE_URL", value: configured }
      : platform !== undefined
        ? { name: "VERCEL_PROJECT_PRODUCTION_URL", value: platform }
        : { name: "FALLBACK_SITE_URL", value: FALLBACK_SITE_URL };

  let url: URL;
  try {
    url = new URL(withScheme(source.value));
  } catch {
    throw new Error(
      `${source.name} n'est pas une URL absolue : « ${source.value} ». Attendu par exemple « https://travels-in-world.vercel.app ».`
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `${source.name} doit être en http(s) : « ${source.value} » utilise le schéma « ${url.protocol} ».`
    );
  }

  return url;
}

/**
 * The resolved origin, computed once at module load — which is build time on every
 * route of this project.
 *
 * A constant and not a function call at each site: `metadataBase` wants a `URL`
 * and the sitemap wants the same one, and two calls would be two chances to read a
 * different environment.
 */
export const SITE_URL: URL = siteUrlFrom(process.env);

/**
 * A site-relative pathname turned absolute — `/fr/voyages/japon-2024` becomes
 * `https://…/fr/voyages/japon-2024`.
 *
 * For `sitemap.xml` and `robots.txt`, which are files read by a machine on another
 * host and therefore cannot carry a relative URL. The page metadata does **not**
 * use this: `metadataBase` lets `generateMetadata` hand Next a relative path and
 * have it resolved once, which keeps the resolution in one implementation instead
 * of two.
 */
export function absoluteUrl(pathname: string): string {
  return new URL(pathname, SITE_URL).href;
}
