import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { JournalNotice } from "@/components/site/journal-notice";
import frMessages from "@/i18n/messages/fr.json";
import { defaultLocale } from "@/i18n/routing";

/**
 * The journal-state notice (TIW-35), queried the way a reader meets it: by role and
 * accessible name.
 *
 * The message catalogue is the **real** one, like every other component test here. A
 * stub would let the component read a key that is absent from `fr.json` and still
 * pass — on a French-only site that defect is invisible any other way, and this
 * component is two keys and no logic.
 *
 * **What no assertion here is about: pixels, and whether the notice appears at
 * all.** jsdom computes no layout, so the first-screen measurement lives in
 * `tests/e2e/journal-notice.spec.ts` against a served build. And *whether* to render
 * is the layout's branch over `holdsNoStory`, asserted in
 * `tests/app/journal-notice-pipeline.test.ts` and end to end — this component takes
 * no props and cannot decide it. Saying so is the point: a unit test that looked
 * like it covered the condition would be worse than none.
 */
function renderNotice(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("the journal-state notice", () => {
  /**
   * Read from the catalogue rather than retyped. A literal here would pass while
   * `fr.json` said something else — and the wording is the whole deliverable of
   * this component, so it is the one thing that must not be asserted twice in two
   * places.
   */
  it("says the récits and the photos are on their way", () => {
    renderNotice(<JournalNotice />);

    expect(screen.getByText(frMessages.trips.noticeBody)).toBeInTheDocument();
  });

  /**
   * A named landmark, which is what makes a banner nobody can dismiss skippable in
   * one gesture. Unnamed, it would be announced as "complementary" on every page of
   * the site with nothing to tell it from the next.
   */
  it("is a complementary landmark, named", () => {
    renderNotice(<JournalNotice />);

    expect(
      screen.getByRole("complementary", { name: frMessages.trips.noticeLabel })
    ).toBeInTheDocument();
  });

  /**
   * **The acceptance criterion, asserted as an absence.** `role="alert"` interrupts
   * a screen reader mid-sentence; this information is permanent and is not an
   * urgency. `role="status"` is refused for a different reason — a live region over
   * bytes frozen at build time never announces anything — and would still put the
   * wrong role in the tree.
   *
   * Queried against the whole document rather than against the notice, so a role
   * moved onto a wrapper somebody adds later is caught too.
   */
  it("is not an alert, and not a live region", () => {
    const { container } = renderNotice(<JournalNotice />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector("[role]")).toBeNull();
  });

  /**
   * **No focusable element, and it is the other half of "not dismissible".** A close
   * affordance — a `:target` anchor or a hidden checkbox — would add one tab stop to
   * every page of the site to buy a dismissal that does not survive the next
   * navigation. This case is what refuses that if somebody tries it later.
   */
  it("adds nothing to the tab order", () => {
    const { container } = renderNotice(<JournalNotice />);

    expect(container.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
  });

  /**
   * No heading, and this is not a stylistic preference: the notice is rendered by
   * the layout, so a heading here — visually hidden or not — would sit *before* the
   * `<h1>` of every page in the document and break the order
   * `tests/e2e/heading-order.populated.spec.ts` guards.
   */
  it("contributes no heading to the page outline", () => {
    renderNotice(<JournalNotice />);

    expect(screen.queryAllByRole("heading")).toHaveLength(0);
  });
});
