import { describe, expect, it } from "vitest";
import { absoluteUrl, FALLBACK_SITE_URL, SITE_URL, siteUrlFrom } from "@/app/site-url";

/**
 * The site's origin — one place, three sources, and a precedence that has to be
 * right because it is written into every prerendered document at build time and
 * nothing downstream can notice it was wrong.
 */

describe("the origin's precedence", () => {
  it("prefers the explicit override", () => {
    expect(
      siteUrlFrom({
        TIW_SITE_URL: "https://carnet.example",
        VERCEL_PROJECT_PRODUCTION_URL: "travels-in-world.vercel.app",
      }).origin
    ).toBe("https://carnet.example");
  });

  it("takes Vercel's project production domain next", () => {
    /**
     * Handed as a bare host, with no scheme — which is the shape of the variable and
     * the reason `withScheme` exists.
     */
    expect(siteUrlFrom({ VERCEL_PROJECT_PRODUCTION_URL: "carnet.example" }).origin).toBe(
      "https://carnet.example"
    );
  });

  it("falls back to the constant when the environment says nothing", () => {
    expect(siteUrlFrom({}).origin).toBe(new URL(FALLBACK_SITE_URL).origin);
  });

  it("never reads VERCEL_URL", () => {
    /**
     * The variable everyone reaches for first, and the one that must not be used:
     * it is the *deployment's* URL and carries a fresh suffix on every push, so a
     * canonical built from it names an address that will never be linked again.
     */
    expect(siteUrlFrom({ VERCEL_URL: "travels-in-world-9f3a1c-thomas.vercel.app" }).origin).toBe(
      new URL(FALLBACK_SITE_URL).origin
    );
  });

  it("treats blank as absent, both variables", () => {
    // The shape a dashboard form produces when a field is saved empty.
    expect(siteUrlFrom({ TIW_SITE_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "  " }).origin).toBe(
      new URL(FALLBACK_SITE_URL).origin
    );
  });

  it("accepts a value that already carries its scheme", () => {
    expect(siteUrlFrom({ VERCEL_PROJECT_PRODUCTION_URL: "https://carnet.example" }).origin).toBe(
      "https://carnet.example"
    );
    // `http` is honoured rather than upgraded: a local reverse proxy is a real case,
    // and silently rewriting the value would make the canonical disagree with what
    // was configured.
    expect(siteUrlFrom({ TIW_SITE_URL: "http://127.0.0.1:3000" }).origin).toBe(
      "http://127.0.0.1:3000"
    );
  });
});

describe("a value that is present but unusable fails the build", () => {
  /**
   * The throw is the design. Falling back on a malformed override would publish a
   * whole site of canonicals pointing at the wrong host with a green build — the
   * failure shape this repository's guards exist to refuse. `siteUrlFrom` runs during
   * `next build`, so the message carries the value.
   */
  it("names the variable and the value", () => {
    expect(() => siteUrlFrom({ TIW_SITE_URL: "https://" })).toThrowError(
      /TIW_SITE_URL n'est pas une URL absolue/
    );
    expect(() => siteUrlFrom({ VERCEL_PROJECT_PRODUCTION_URL: "http://" })).toThrowError(
      /VERCEL_PROJECT_PRODUCTION_URL n'est pas une URL absolue/
    );
  });

  it("refuses a scheme that is not http(s)", () => {
    // `ftp://x` parses as a URL, so `new URL` alone would accept it and every
    // `og:image` on the site would name a scheme no crawler fetches.
    expect(() => siteUrlFrom({ TIW_SITE_URL: "ftp://carnet.example" })).toThrowError(
      /doit être en http\(s\)/
    );
  });
});

describe("absoluteUrl", () => {
  it("resolves a site-relative pathname against the origin", () => {
    expect(absoluteUrl("/fr/voyages/japon-2024")).toBe(`${SITE_URL.origin}/fr/voyages/japon-2024`);
  });

  it("keeps the root free of a double slash", () => {
    expect(absoluteUrl("/")).toBe(`${SITE_URL.origin}/`);
  });

  it("is what robots.txt and sitemap.xml are built from", () => {
    // Those two are read by a machine on another host: neither format has any
    // notion of a relative URL, which is why this function exists at all while
    // every page's metadata stays relative and lets `metadataBase` resolve it.
    expect(absoluteUrl("/sitemap.xml").startsWith("http")).toBe(true);
  });
});
