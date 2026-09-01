/**
 * Who made this site, and where to find them — the one place in the repository
 * that holds those facts.
 *
 * WHY IT EXISTS AS A MODULE OF ITS OWN. Three of the four links below are facts
 * that belong to a person and not to a codebase: a portfolio, an Instagram
 * account, and an address someone is willing to receive mail at. None of them can
 * be guessed, and a guessed one is not a placeholder — it is a wrong address on a
 * public page under a real name. So they are declared here, explicitly absent
 * (`null`), rather than written into the page as prose that would have to be
 * hunted for later.
 *
 * TO FILL ONE IN: replace the `null` with the value, in the shape the field's
 * comment gives, and run `npm test`. Nothing else in the codebase changes — the
 * page renders whatever is declared, in the order of {@link LINK_ORDER}, and omits
 * the rest.
 *
 * WHAT THIS MODULE REFUSES TO DO, and it is the load-bearing half. A link that is
 * absent is **not rendered at all**: no `href="#"`, no "lien à venir", no anchor
 * that announces itself to a screen reader and then does nothing. And a link that
 * is declared but unusable **throws** rather than shipping — same posture, and for
 * the same reason, as `src/app/site-url.ts`: this function runs during
 * `next build`, so a typo fails the build with the key and the value in the
 * message, instead of publishing `/fr/a-propos/instagram.com/moi` under someone's
 * name. `tests/app/identity.test.ts` holds both halves.
 *
 * It is colocated with the route that reads it — the same arrangement as
 * `withdrawn-notice.tsx` under `voyages/[slug]` — because exactly one page reads
 * it. The URL of that page is NOT here: it lives in `src/i18n/paths.ts`, with
 * every other internal route.
 */

export type IdentityLinkKey = "repository" | "portfolio" | "instagram" | "contact";

export type SiteIdentity = {
  /**
   * The public repository this very site is built from. The only one of the four
   * the repository itself proves, hence the only one not `null` — verified public
   * with `gh repo view`.
   */
  readonly repository: string;
  /** An absolute `https://` URL, or `null` while it is not known. */
  readonly portfolio: string | null;
  /** The account's absolute `https://` URL — not a `@pseudo` — or `null`. */
  readonly instagram: string | null;
  /** A bare address (`personne@exemple.fr`), or `null`. The `mailto:` is added here. */
  readonly contact: string | null;
};

export type IdentityLink = {
  readonly key: IdentityLinkKey;
  /** Ready for an `href`: always `https:` or `mailto:`, never empty and never `#`. */
  readonly href: string;
  /**
   * The destination as a reader sees it — `github.com/ThoomassC/travels_in_world`,
   * or the bare address. Rendered next to the label so that the accessible name of
   * each link says where it goes out of context, which is what someone tabbing
   * through a list of links actually gets.
   */
  readonly target: string;
};

/**
 * The site's own declaration. **Three values are unknown and deliberately absent**
 * — see the header for how to fill one in.
 */
export const SITE_IDENTITY: SiteIdentity = {
  repository: "https://github.com/ThoomassC/travels_in_world",
  // TIW-25 left these three empty on purpose: they are the author's to give, and
  // an invented address on a page carrying a real name is a fault, not a stub.
  portfolio: null,
  instagram: null,
  contact: null,
};

/**
 * The reading order, and it is fixed rather than derived from the object so that
 * declaring a new link never reshuffles the ones already there: the work first
 * (this site, then the rest of it), then the journal in pictures, then how to
 * reach a human.
 */
const LINK_ORDER = ["repository", "portfolio", "instagram", "contact"] as const;

/**
 * Blank is absent. `""` and `"   "` are the shape a half-filled file has, and a
 * blank string is truthy enough to build `href=""` — which resolves to the current
 * page, i.e. a link that silently reloads the page it sits on.
 */
function declared(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

function refuse(key: IdentityLinkKey, value: string, expected: string): never {
  throw new Error(
    `src/app/[locale]/a-propos/identity.ts : « ${key} » ${expected} — reçu « ${value} ». Pour laisser ce lien absent, écris « null ».`
  );
}

/**
 * An outbound web link. `https:` only, and that is not pedantry: an `http://`
 * portfolio linked from an `https://` page is a downgrade this site would be
 * inviting, and every host these fields can name serves TLS.
 *
 * A value with no scheme at all is the important refusal. `instagram.com/moi` is
 * what a person types, and rendered as an `href` it is a **relative** path — the
 * browser resolves it against the current page and lands on
 * `/fr/a-propos/instagram.com/moi`, a 404 on our own site, with nothing anywhere
 * saying so.
 */
function webLink(key: IdentityLinkKey, value: string): IdentityLink {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return refuse(
      key,
      value,
      "doit être une URL absolue en https, par exemple « https://exemple.fr »"
    );
  }

  if (url.protocol !== "https:") {
    return refuse(key, value, "doit être en https");
  }

  // The trailing slash `new URL` adds to a bare origin is noise to a reader, and a
  // bare origin is the spelling most people paste.
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");

  return { key, href: url.href, target: `${url.host}${path}` };
}

/**
 * Deliberately not a full RFC 5322 grammar, which no regular expression gets
 * right: this refuses the two mistakes that actually happen in this field — a
 * social handle (`@moi`) and an address with no dotted domain — and lets a real
 * address through. The address is shown to the reader as well as put in the
 * `href`, so a wrong-but-well-formed one is visible on the page rather than
 * hidden in an attribute.
 */
const ADDRESS = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function mailLink(value: string): IdentityLink {
  // Tolerated because it is what a mail client hands you when you copy an address.
  const address = value.replace(/^mailto:/i, "").trim();

  if (!ADDRESS.test(address)) {
    return refuse(
      "contact",
      value,
      "doit être une adresse e-mail, par exemple « personne@exemple.fr »"
    );
  }

  return { key: "contact", href: `mailto:${address}`, target: address };
}

/**
 * The links the page renders, in order — and only those. Throws on a declared
 * value it cannot turn into a working href.
 */
export function identityLinks(identity: SiteIdentity): readonly IdentityLink[] {
  return LINK_ORDER.flatMap((key) => {
    const value = declared(identity[key]);

    if (value === undefined) {
      /**
       * The repository is the one link that may not go missing: it is what makes
       * the page's own claim checkable, and without it the "Où me trouver" section
       * could render as a heading above nothing — the empty block this project
       * refuses everywhere else.
       */
      if (key === "repository") {
        return refuse(
          key,
          String(identity.repository),
          "est le seul lien obligatoire de cette page"
        );
      }

      return [];
    }

    return [key === "contact" ? mailLink(value) : webLink(key, value)];
  });
}
