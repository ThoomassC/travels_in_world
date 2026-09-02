import { describe, expect, it } from "vitest";
import { SITE_IDENTITY, identityLinks, type SiteIdentity } from "@/app/[locale]/a-propos/identity";

/**
 * The outbound links of the "À propos" page, and above all the ones that are NOT
 * there.
 *
 * WHY THIS FILE IS THE INTERESTING HALF OF TIW-25. Three of the four links —
 * the portfolio, Instagram, and a contact address — are facts that belong to the
 * author and were not known when the page was built. The page therefore has to be
 * right in a state nobody will ever look at on purpose: half filled in. The two
 * failure shapes it must refuse are `href="#"` (an anchor that does nothing, and
 * that a screen reader still announces as a link) and a placeholder — "lien à
 * venir" — shipped to a recruiter. Both render fine and neither fails a build.
 *
 * So the rule is: a link nobody declared is not rendered at all, and a link
 * declared WRONG throws instead of shipping. The second half is the one that
 * protects the day the file gets filled in — `identityLinks` runs during
 * `next build`, so a bad value fails the build with the key and the value in the
 * message, exactly like `src/app/site-url.ts` does for the origin.
 */

/** Nothing declared but the one fact the repository itself proves. */
const bare: SiteIdentity = {
  repository: "https://github.com/ThoomassC/travels_in_world",
  portfolio: null,
  instagram: null,
  contact: null,
};

const full: SiteIdentity = {
  repository: "https://github.com/ThoomassC/travels_in_world",
  portfolio: "https://exemple.fr/portfolio",
  instagram: "https://www.instagram.com/exemple",
  contact: "personne@exemple.fr",
};

describe("a link nobody declared is not rendered at all", () => {
  it("keeps only the repository when the three unknowns are null", () => {
    expect(identityLinks(bare)).toEqual([
      {
        key: "repository",
        href: "https://github.com/ThoomassC/travels_in_world",
        target: "github.com/ThoomassC/travels_in_world",
      },
    ]);
  });

  it("treats a blank value as absent, because that is the shape a half-filled file has", () => {
    /**
     * `""` and `"   "` are what someone leaves behind when they mean "I will paste
     * it later". Same reading as `declared()` in `src/app/site-url.ts`, and the
     * reason it is not a detail: a blank string is truthy enough to build
     * `href=""`, which resolves to the current page — a link that silently reloads
     * the page it is on.
     */
    const halfFilled: SiteIdentity = {
      ...bare,
      portfolio: "",
      instagram: "   ",
      contact: "\t\n",
    };

    expect(identityLinks(halfFilled).map((link) => link.key)).toEqual(["repository"]);
  });

  it("never produces an empty href, a fragment or a script URL", () => {
    for (const identity of [bare, full]) {
      for (const link of identityLinks(identity)) {
        expect(link.href).not.toBe("");
        expect(link.href).not.toBe("#");
        expect(link.href.startsWith("#")).toBe(false);
        expect(link.href).toMatch(/^(https:|mailto:)/);
      }
    }
  });
});

describe("a declared link", () => {
  it("comes out in a fixed order, so the page does not reshuffle when one is added", () => {
    expect(identityLinks(full).map((link) => link.key)).toEqual([
      "repository",
      "portfolio",
      "instagram",
      "contact",
    ]);
  });

  it("shows the destination without its scheme, so the link text says where it goes", () => {
    /**
     * The accessible name of each link is its label PLUS this string. "Mon
     * portfolio" alone is a label that only makes sense next to the others; "Mon
     * portfolio exemple.fr/portfolio" says the destination out of context, which
     * is what a reader tabbing through a list of links gets.
     */
    const byKey = new Map(identityLinks(full).map((link) => [link.key, link.target]));

    expect(byKey.get("portfolio")).toBe("exemple.fr/portfolio");
    expect(byKey.get("instagram")).toBe("www.instagram.com/exemple");
  });

  it("drops the trailing slash a bare origin picks up", () => {
    // `new URL("https://exemple.fr").href` is `https://exemple.fr/`. Printing that
    // slash to a reader is noise, and it is the spelling most people paste.
    const [, portfolio] = identityLinks({ ...bare, portfolio: "https://exemple.fr" });

    expect(portfolio?.target).toBe("exemple.fr");
    expect(portfolio?.href).toBe("https://exemple.fr/");
  });

  it("turns a bare address into a mailto and shows the address itself", () => {
    const [, contact] = identityLinks({ ...bare, contact: "personne@exemple.fr" });

    expect(contact).toEqual({
      key: "contact",
      href: "mailto:personne@exemple.fr",
      target: "personne@exemple.fr",
    });
  });

  it("tolerates the address already spelled as a mailto", () => {
    // The natural thing to paste out of a mail client. Refusing it would fail a
    // build over a prefix we can simply drop.
    const [, contact] = identityLinks({ ...bare, contact: "MAILTO:personne@exemple.fr" });

    expect(contact?.href).toBe("mailto:personne@exemple.fr");
    expect(contact?.target).toBe("personne@exemple.fr");
  });
});

describe("a link declared WRONG fails the build instead of shipping", () => {
  it("refuses a URL with no scheme, and names the key and the value", () => {
    // `instagram.com/moi` is what a person types. Rendered as an href it is a
    // *relative* path: `/fr/a-propos/instagram.com/moi`, a 404 on our own site.
    expect(() => identityLinks({ ...bare, instagram: "instagram.com/moi" })).toThrowError(
      /instagram.*instagram\.com\/moi/s
    );
  });

  it("refuses http, so no outbound link of this site invites a downgrade", () => {
    expect(() => identityLinks({ ...bare, portfolio: "http://exemple.fr" })).toThrowError(
      /portfolio/
    );
  });

  it("refuses something that is not an address in the contact field", () => {
    expect(() => identityLinks({ ...bare, contact: "@monpseudo" })).toThrowError(/contact/);
    expect(() => identityLinks({ ...bare, contact: "personne@exemple" })).toThrowError(/contact/);
  });

  it("refuses a blank repository rather than rendering a section with no link in it", () => {
    /**
     * The repository is the one link this page can always show, because the
     * repository is what proves it. If it could go absent, the "Où me trouver"
     * section could render as a heading above nothing — the empty block this
     * project refuses everywhere else.
     */
    expect(() => identityLinks({ ...bare, repository: "  " })).toThrowError(/repository/);
  });
});

describe("the identity this site really ships", () => {
  it("is usable as it stands, whatever has been filled in", () => {
    // The guard for the day someone edits `identity.ts` and does not run the page:
    // this call is the same one `page.tsx` makes during `next build`.
    expect(() => identityLinks(SITE_IDENTITY)).not.toThrow();
  });

  it("always offers the repository, so the page is never a heading above nothing", () => {
    expect(identityLinks(SITE_IDENTITY)[0]?.key).toBe("repository");
  });

  it("points at the public repository this site is built from", () => {
    /**
     * Verified with `gh repo view`: the repository is public. It is the only one of
     * the four links the repository itself can prove, which is why it is the only
     * one written down rather than left `null`.
     */
    expect(SITE_IDENTITY.repository).toBe("https://github.com/ThoomassC/travels_in_world");
  });
});
