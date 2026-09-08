import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { TripCatalogue } from "@/components/trips/trip-catalogue";
import { tripEntry, tripIn } from "./fixtures";
import { defaultLocale, renderWithMessages } from "./support";

/**
 * The full listing, and the one property of it TIW-18 depends on: **every entry
 * is addressable by a fragment.**
 *
 * The grouping, the ordering and their three boundary states are `buildCatalogue`'s
 * and are covered case by case in `./catalogue.test.ts` — a pure function over
 * plain data, which is why this file is short and does not re-assert any of it.
 *
 * What only a rendering can answer is the anchor. The map's marker for a trip whose
 * récit is not written points at `/fr/voyages#voyage-<slug>`, because that trip has
 * no page of its own and this listing is where its dates, its countries and
 * « Récit à venir » are written. A fragment naming nothing leaves the reader
 * silently at the top of a sixty-entry page — which is not a hypothetical here:
 * `tests/e2e/dead-links.populated.spec.ts` records measuring exactly that failure on a production
 * build, with `#pays-bo`, and it is why the target is asserted rather than assumed.
 */

const catalogue = (props: Partial<Parameters<typeof TripCatalogue>[0]> = {}) =>
  renderWithMessages(<TripCatalogue trips={[tripEntry()]} locale={defaultLocale} {...props} />);

describe("TripCatalogue — every entry is an anchor target", () => {
  it("gives each entry the id the map's markers point at", () => {
    const { container } = catalogue();

    /**
     * `voyage-<slug>` and not a scheme of this file's own: the same spelling
     * `world-map.tsx` puts on the home page's markers, so one form of address
     * identifies a trip's entry on whichever page holds one. `SlugSchema` forbids
     * `--` inside a slug, which is what keeps the trip-page variant
     * (`voyage-japon-2024--tokyo`) unambiguous against this one.
     */
    expect(container.querySelector("#voyage-japon-2024")).not.toBeNull();
  });

  it("puts the id on the entry and not on the card, so the fragment lands on the trip", () => {
    const { container } = catalogue();
    const target = container.querySelector("#voyage-japon-2024");

    // The `<li>`: a fragment resolving to something *inside* the card would
    // scroll past the entry's own top edge.
    expect(target?.tagName).toBe("LI");
    expect(target?.querySelector("article")).not.toBeNull();
  });

  it("gives sixty trips sixty distinct ids", () => {
    const trips = Array.from({ length: 60 }, (_, index) => tripIn("FR", index));
    const { container } = catalogue({ trips });

    const ids = [...container.querySelectorAll("li[id]")].map((entry) => entry.id);

    /**
     * Uniqueness is a property of the slug — the content façade's primary key,
     * one entry per trip — and a duplicate `id` makes every fragment after the
     * first resolve to the wrong entry. Asserted as a set so a failure names a
     * count and not a boolean.
     */
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
  });

  it("keeps the id on a trip whose récit is not written, which is what needs it", () => {
    const { container } = catalogue({
      trips: [tripEntry({ slug: "maroc-2026", story: "unwritten" })],
    });

    // The one entry the map cannot link to any other way. Its card carries no
    // link of its own, so the fragment is the whole of the address.
    expect(container.querySelector("#voyage-maroc-2026")).not.toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  /**
   * The home page renders `LatestTrips` *and* the map, whose markers already use
   * `id="voyage-<slug>"` on their `<li>`. Two elements sharing an `id` in one
   * document is invalid HTML and makes the fragment resolve to whichever comes
   * first — so the anchor belongs to this page's listing and to no other.
   */
  it("is the listing's own scheme: LatestTrips carries no such id", async () => {
    const { LatestTrips } = await import("@/components/trips/latest-trips");
    const { container } = renderWithMessages(
      <LatestTrips trips={[tripEntry()]} locale={defaultLocale} />
    );

    expect(container.querySelector("#voyage-japon-2024")).toBeNull();
  });
});

/**
 * **What the filter needs from the listing, and nothing more.**
 *
 * The catalogue does no filtering: it marks its entries and its groups, and
 * `src/components/filters/facet-stylesheet.ts` writes the rules that read those
 * marks. The split is what keeps the filter out of this component's job — a trip
 * is filed under its first arrival here whether or not a page filters it — and it
 * is what lets `/villes` wear the same filter over a completely different list.
 */
describe("TripCatalogue — the marks the filter reads", () => {
  const tokens = new Map([
    ["voyage-jp-0", "all country-JP year-2024"],
    ["voyage-fr-1", "all country-FR year-2023"],
  ]);

  const twoContinents = () =>
    catalogue({ trips: [tripIn("JP", 0), tripIn("FR", 1)], facetTokens: tokens });

  it("puts each entry's tokens on the element that carries its id", () => {
    const { container } = twoContinents();

    expect(container.querySelector("#voyage-voyage-jp-0")).toHaveAttribute(
      "data-facets",
      "all country-JP year-2024"
    );
  });

  /**
   * A country section holding no matching card, and the continent chapter above
   * it, must go with the cards — a heading standing over nothing is the empty
   * block the acceptance criteria refuse. The mark says "this box is a group";
   * the generated rule is what decides it is empty.
   */
  it("marks both levels of grouping, so neither is left standing over nothing", () => {
    const { container } = twoContinents();

    const groups = [...container.querySelectorAll("[data-facet-group]")];

    // Two continents and two countries, one trip each.
    expect(groups).toHaveLength(4);
    expect(container.querySelector("#pays-JP")).toHaveAttribute("data-facet-group", "country");
  });

  /**
   * The count beside a continent chapter counts the whole chapter, which stops
   * being true the moment a choice hides half of it. It is marked so the filter's
   * own sheet can drop it, and the count line under the control — the number the
   * reader has just changed — is what answers instead.
   */
  it("marks the count that a filter would make untrue", () => {
    const { container } = twoContinents();

    expect(container.querySelectorAll("[data-facet-total]")).toHaveLength(2);
  });

  /** Unfiltered pages exist: the marks are absent rather than empty. */
  it("marks nothing when no tokens are supplied", () => {
    const { container } = catalogue({ trips: [tripIn("JP", 0), tripIn("FR", 1)] });

    expect(container.querySelector("[data-facets]")).toBeNull();
    expect(container.querySelector("[data-facet-group]")).toBeNull();
  });
});
