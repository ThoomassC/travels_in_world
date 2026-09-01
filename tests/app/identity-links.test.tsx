import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { IdentityLinks } from "@/app/[locale]/a-propos/identity-links";
import { SITE_IDENTITY, identityLinks } from "@/app/[locale]/a-propos/identity";
import { frMessages, renderWithMessages } from "../components/trips/support";

/**
 * The list of outbound links on "À propos", rendered.
 *
 * `tests/app/identity.test.ts` proves that an undeclared link never becomes an
 * `IdentityLink`; this file proves the other half — that nothing downstream
 * puts it back. A component that rendered a row per *key* rather than per
 * declared link, or that fell back to `href="#"` for a missing one, would pass
 * every assertion in that file and still ship the dead anchor.
 *
 * The real message catalogue, through `renderWithMessages`, for the reason that
 * helper records: a stub would let this component read a key that is not in
 * `fr.json` and still pass, which on a French-only site is invisible otherwise.
 * That matters more here than usual — the labels are looked up through a table
 * keyed by link, so an unlabelled link is a whole missing row of the page.
 */

const declared = identityLinks(SITE_IDENTITY);

const sample = [
  { key: "repository", href: "https://github.com/x/y", target: "github.com/x/y" },
  { key: "contact", href: "mailto:personne@exemple.fr", target: "personne@exemple.fr" },
] as const;

describe("what the reader gets", () => {
  it("renders one link per declared entry, and nothing for the rest", () => {
    renderWithMessages(<IdentityLinks links={sample} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("says the destination in the link text, not only in the href", () => {
    renderWithMessages(<IdentityLinks links={sample} />);

    /**
     * WCAG 2.4.4 read strictly: the name has to make sense to someone tabbing
     * through a list of links with no surrounding prose. "Le code source de ce
     * site, sur GitHub" plus the host is that; "ici" or a bare label would not
     * be.
     *
     * A regexp and not an exact string, for the reason `site-brand.test.tsx`
     * records: `dom-accessibility-api` and real screen readers differ on whether
     * two adjacent inline text nodes are joined with a space. What is asserted is
     * that both halves are there, in that order, and nothing else.
     */
    expect(
      screen.getByRole("link", {
        name: new RegExp(`^${frMessages.about.linkRepository}\\s*github\\.com/x/y$`),
      })
    ).toHaveAttribute("href", "https://github.com/x/y");
    expect(
      screen.getByRole("link", {
        name: new RegExp(`^${frMessages.about.linkContact}\\s*personne@exemple\\.fr$`),
      })
    ).toHaveAttribute("href", "mailto:personne@exemple.fr");
  });

  it("opens nothing in a new tab", () => {
    renderWithMessages(<IdentityLinks links={sample} />);

    /**
     * `target="_blank"` takes the back button away from the reader without
     * asking, and drags `rel="noopener"` in behind it. These are ordinary
     * outbound links; the reader decides how to open them.
     */
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("target");
    }
  });
});

describe("the links this site really ships today", () => {
  it("shows the repository and NOT the three facts nobody has declared", () => {
    /**
     * The criterion of TIW-25, asserted on the state the site is actually in: the
     * portfolio, the Instagram account and the contact address are unknown, so
     * their labels must be nowhere in the document — not greyed out, not "à
     * venir", not an anchor going nowhere.
     *
     * This test is meant to CHANGE the day one of them is filled in, and that is
     * its value: it is the line that makes filling the file in a deliberate act
     * with a visible diff.
     */
    renderWithMessages(<IdentityLinks links={declared} />);

    expect(
      screen.getByRole("link", { name: new RegExp(frMessages.about.linkRepository) })
    ).toBeVisible();

    for (const absent of [
      frMessages.about.linkPortfolio,
      frMessages.about.linkInstagram,
      frMessages.about.linkContact,
    ]) {
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    }
  });

  it("leaves no anchor that goes nowhere", () => {
    const { container } = renderWithMessages(<IdentityLinks links={declared} />);

    for (const anchor of container.querySelectorAll("a")) {
      const href = anchor.getAttribute("href");

      // `href=""` resolves to the current page and `#` to nothing at all; both
      // are announced as links and both are what a placeholder degrades into.
      expect(href).toBeTruthy();
      expect(href).not.toBe("#");
    }
  });

  it("renders a non-empty list, so the section is never a heading above nothing", () => {
    renderWithMessages(<IdentityLinks links={declared} />);

    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});

describe("the message catalogue backs every link the page can render", () => {
  it("carries a label for each of the four keys", () => {
    /**
     * The labels are reached through a table keyed by `IdentityLinkKey`, so a key
     * with no message is a row rendering its own key name to a reader — and it
     * only happens on the day that link is declared, which is the day nobody is
     * looking at this file.
     */
    renderWithMessages(
      <IdentityLinks
        links={[
          { key: "repository", href: "https://a.fr/", target: "a.fr" },
          { key: "portfolio", href: "https://b.fr/", target: "b.fr" },
          { key: "instagram", href: "https://c.fr/", target: "c.fr" },
          { key: "contact", href: "mailto:d@e.fr", target: "d@e.fr" },
        ]}
      />
    );

    expect(screen.getAllByRole("link")).toHaveLength(4);
    for (const label of [
      frMessages.about.linkRepository,
      frMessages.about.linkPortfolio,
      frMessages.about.linkInstagram,
      frMessages.about.linkContact,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(label).not.toBe("");
    }
  });
});
