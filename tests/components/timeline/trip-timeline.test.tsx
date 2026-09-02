import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/i18n/messages/fr.json";
import { defaultLocale } from "@/i18n/routing";
import { TripTimeline } from "@/components/timeline/trip-timeline";
import type { TimelineMove, TimelineStay, TimelineStep } from "@/components/timeline/steps";
import type { Place } from "@/domain/schema";

/**
 * **A step that carries no text still renders as a step** — the fourth acceptance
 * criterion of TIW-18, and the one this ticket found already met.
 *
 * Met by construction, and in the strongest possible way: `StaySchema` is
 * `z.strictObject({ kind, placeSlug, startDate, endDate })`, so there is no prose
 * field to be empty and no way for an author to write one. The criterion asks that
 * such a step "appears in the timeline with its place, its dates and its transport
 * mode, with no empty text block", and today *every* step is such a step.
 *
 * **So why a test file at all**, when the schema makes the state unreachable. Two
 * reasons, and neither is "for completeness".
 *
 * The first: the timeline had **no component test of any kind**. Everything under
 * `tests/timeline/` covers the pure functions behind it — `steps.ts`, `dates.ts`,
 * `anchors.ts` — and the rendering was covered only end to end, on a fixture where
 * the assertion is a screenshot's worth of text. A criterion nothing exercises is a
 * criterion nobody can defend.
 *
 * The second, and it is the one that decided the arbitration recorded in this
 * ticket's report: the day step prose arrives — a schema change, a validator rule,
 * a scaffold line and a renderer, i.e. a ticket of its own — the *absent* case
 * becomes reachable, and it becomes reachable for a field that is optional. These
 * cases are what will be red on that day if the empty branch is rendered as an
 * empty `<p>`. Pinning the absence now is the cheap half of that ticket, paid
 * before the expensive half is designed.
 *
 * This ticket therefore **does not open prose**. It states that the absence is
 * already clean and leaves a guard behind so it stays clean.
 */

const place = (slug: string, name: string): Place => ({
  slug,
  name,
  countryCode: "JP",
  // Real coordinates: `Place` is the domain's own type, and the timeline reads
  // only `name` and `slug`. Nothing here projects them.
  coordinates: { lat: 35.6762, lon: 139.6503 },
});

const TOKYO = place("tokyo", "Tokyo");
const KYOTO = place("kyoto", "Kyoto");

/** A stay as `timelineSteps` builds one: no prose field exists to omit. */
const stay = (overrides: Partial<TimelineStay> = {}): TimelineStay => ({
  kind: "stay",
  anchor: "etape-2024-04-12-tokyo",
  place: TOKYO,
  startDate: "2024-04-12",
  endDate: "2024-04-15",
  nights: 3,
  photos: [],
  ...overrides,
});

const move = (overrides: Partial<TimelineMove> = {}): TimelineMove => ({
  kind: "move",
  anchor: "etape-2024-04-15-tokyo-kyoto",
  from: TOKYO,
  to: KYOTO,
  mode: "train",
  date: "2024-04-15",
  ...overrides,
});

const STOPS = new Map([
  ["tokyo", 1],
  ["kyoto", 2],
]);

function renderTimeline(steps: readonly TimelineStep[]) {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
      <TripTimeline steps={steps} stopNumbers={STOPS} />
    </NextIntlClientProvider>
  );
}

/**
 * Every element that renders to nothing a reader could perceive.
 *
 * This is the oracle the criterion actually needs, and it is deliberately not a
 * list of expected selectors: "no empty text block" is a property of the whole
 * subtree, so an implementation that added a new empty wrapper would have to be
 * caught without anybody having predicted its class name.
 *
 * `<img>`, `<svg>` and their contents are exempt because they are graphics rather
 * than text; `<br>` and `<hr>` are void by definition. Everything else with no
 * text in it is a block a reader meets as a gap.
 */
function emptyElements(root: HTMLElement): readonly string[] {
  const graphical = new Set(["IMG", "SVG", "BR", "HR", "INPUT"]);

  return [...root.querySelectorAll<HTMLElement>("*")]
    .filter((element) => {
      if (graphical.has(element.tagName) || element.closest("svg") !== null) {
        return false;
      }
      // A wrapper whose children carry the text is not empty; only a leaf with
      // nothing in it is.
      return element.children.length === 0 && (element.textContent ?? "").trim() === "";
    })
    .map((element) => `<${element.tagName.toLowerCase()} class="${element.className}">`);
}

describe("TripTimeline — a stay, which carries no prose", () => {
  it("renders its place, its dates and its stop number", () => {
    renderTimeline([stay()]);

    /**
     * The three facts the criterion names for a stay. The heading is the place —
     * `stayHeading` is `"{place}"` — and the dates are a real `<time>` pair, which
     * is what makes them a fact rather than a decoration.
     */
    expect(screen.getByRole("heading", { level: 3, name: /Tokyo/ })).toBeInTheDocument();
    /**
     * Read off the whole item rather than matched as one text node: `stayMeta` is
     * a `t.rich` message wrapping each day in its own `<time>`, so the sentence a
     * reader hears is assembled from three nodes and `getByText` sees none of them
     * whole. The `<time datetime>` pair is asserted separately below, which is the
     * half a machine reads.
     */
    const item = screen.getByRole("listitem");

    expect(item.textContent).toContain("du 12 avril au 15 avril 2024");
    expect(item.textContent).toContain("3 nuits");
    expect(within(item).getByText("1")).toBeInTheDocument();
    expect([...item.querySelectorAll("time")].map((time) => time.dateTime)).toEqual([
      "2024-04-12",
      "2024-04-15",
    ]);
  });

  it("renders no empty block, which is the criterion itself", () => {
    const { container } = renderTimeline([stay()]);

    /**
     * The one assertion this file exists for. A stay is a heading, an anchor link
     * and one line of dates — there is nothing else, and there must be no
     * placeholder standing in for the text the model cannot hold.
     *
     * The `.marker` gutter is the exception that is not one: it holds the stop
     * number, so it is not empty. A photoless stay renders no photo grid at all,
     * which is the other half — asserted below.
     */
    expect(emptyElements(container)).toEqual([]);
  });

  /**
   * **The oracle above has to be able to fail**, or every case using it is a case
   * that cannot go red — the failure mode `tests/lint/*` exists to refuse for the
   * ESLint boundaries, applied here to a helper.
   *
   * The lever is real rather than invented: `trip-timeline.tsx` renders the stop
   * badge as `{stop ?? ""}`, so a stay whose place is missing from `stopNumbers`
   * produces an empty `<span>` — a visible gap in the gutter where every other
   * step has a number. It is unreachable through the page, which builds the map
   * from `visitedPlaces(trip)` and therefore numbers every referenced place; this
   * is what makes it a good lever and a bad bug.
   */
  it("would report an empty block if one were rendered", () => {
    const { container } = render(
      <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
        <TripTimeline steps={[stay()]} stopNumbers={new Map()} />
      </NextIntlClientProvider>
    );

    expect(emptyElements(container)).toHaveLength(1);
    expect(emptyElements(container)[0]).toContain("span");
  });

  it("renders no photo grid for a stay with no photograph", () => {
    const { container } = renderTimeline([stay({ photos: [] })]);

    /**
     * Omitted and not rendered empty: most stays have none, and an empty grid
     * would add a "liste, 0 élément" announcement to every one of them. Asserted
     * on the element rather than on a class, since the grid is a `<ul>` and the
     * timeline's own list is an `<ol>`.
     */
    expect(container.querySelectorAll("ul")).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("gives a zero-night stay a sentence rather than a blank", () => {
    /**
     * The degenerate case the model *does* allow — a day spent somewhere without
     * sleeping there — and the one where a naive `{nights} nuits` renders "0
     * nuits". The catalogue has an ICU `=0` branch for it, and this is what keeps
     * the two in step.
     */
    renderTimeline([stay({ nights: 0, endDate: "2024-04-12" })]);

    expect(screen.getByRole("listitem").textContent).toContain("sur place dans la journée");
    expect(screen.queryByText(/0 nuit/)).toBeNull();
  });
});

describe("TripTimeline — a move, which carries no prose either", () => {
  it("renders its two places, its date and its transport mode in words", () => {
    renderTimeline([move()]);

    expect(screen.getByRole("heading", { level: 3, name: /De Tokyo à Kyoto/ })).toBeInTheDocument();

    // Same reason as the stay's: `moveMeta` wraps its day in a `<time>`, so the
    // sentence is not one text node.
    const item = screen.getByRole("listitem");

    expect(item.textContent).toContain("le 15 avril 2024");
    expect([...item.querySelectorAll("time")].map((time) => time.dateTime)).toEqual(["2024-04-15"]);

    /**
     * **The mode is never an icon alone**, which the criterion names explicitly.
     * The pictogram is `aria-hidden` and the mode's name is a real text node
     * beside it — announced once, through `transportAnnounce`, and printed once as
     * the visible pill.
     */
    expect(screen.getByText("Transport : Train")).toBeInTheDocument();
    expect(screen.getByText("Train")).toBeInTheDocument();
  });

  it("renders no empty block either", () => {
    const { container } = renderTimeline([move()]);

    // The transport icon is an `<svg>`, exempted by `emptyElements`: it is a
    // graphic, and the mode is spelled out beside it.
    expect(emptyElements(container)).toEqual([]);
  });

  it.each(["plane", "train", "bus", "car", "boat", "bike", "foot"] as const)(
    "names the %s mode rather than leaving its icon to speak",
    (mode) => {
      /**
       * Every mode of the closed list, because the schema's own comment says an
       * unknown mode "has no rendering at all" — so the day one is added, this is
       * where the missing catalogue entry shows up rather than as a raw key in the
       * page.
       */
      renderTimeline([move({ mode })]);

      const expected = frMessages.trip.transport[mode];

      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(screen.getByText(`Transport : ${expected}`)).toBeInTheDocument();
    }
  );
});

describe("TripTimeline — the itinerary as a whole", () => {
  it("renders one item per step, in the order it was given", () => {
    const { container } = renderTimeline([
      stay(),
      move(),
      stay({ anchor: "etape-2", place: KYOTO }),
    ]);

    const items = container.querySelectorAll("ol > li");

    /**
     * Order is taken and never computed — `TripSchema` already refuses a trip
     * whose steps run backwards, so re-sorting here would hide a content fault the
     * validator exists to shout about.
     */
    expect(items).toHaveLength(3);
    expect([...items].map((item) => item.getAttribute("data-step-kind"))).toEqual([
      "stay",
      "move",
      "stay",
    ]);
  });

  it("renders no empty block across a mixed itinerary", () => {
    const { container } = renderTimeline([
      stay(),
      move(),
      stay({ anchor: "etape-2", place: KYOTO }),
    ]);

    expect(emptyElements(container)).toEqual([]);
  });

  it("gives every step a copyable anchor whose link has a real name", () => {
    renderTimeline([stay(), move()]);

    /**
     * A real `<a href="#…">` with a text node inside it, never an `aria-label` on
     * a `#` glyph. Asserted here because it is the one link a step carries, and a
     * step with no prose is a step whose only affordance this is.
     */
    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "#etape-2024-04-12-tokyo");
    expect(links[0]).toHaveAccessibleName(frMessages.trip.stepLinkLabel.replace("{step}", "Tokyo"));
  });

  it("puts the id on the heading, so the fragment lands on it", () => {
    const { container } = renderTimeline([stay()]);

    // Not on the `<li>`: the fragment names the thing a reader would say they
    // linked to, and a container's padding edge is not that.
    const target = container.querySelector("#etape-2024-04-12-tokyo");

    expect(target?.tagName).toBe("H3");
  });

  /**
   * The empty timeline has no rendering and needs none: `TripSchema` requires
   * `steps: z.array(...).min(1)`, so a trip with no step cannot be loaded at all —
   * which the trip page's own comment records. Asserted as the honest degenerate
   * output rather than as an empty state, because an empty state here would be
   * dead code pretending to be a feature.
   */
  it("renders an empty list for no steps, and no empty-state block", () => {
    const { container } = renderTimeline([]);

    expect(container.querySelectorAll("ol > li")).toHaveLength(0);
    expect(container.textContent).toBe("");
  });
});
