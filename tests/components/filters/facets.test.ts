import { describe, expect, it } from "vitest";
import {
  ALL_FACET,
  buildFacetIndex,
  byLabel,
  byValueDescending,
} from "@/components/filters/facets";

/**
 * The arithmetic behind both filters: which choices exist, how many entries each
 * one keeps, and the token every entry carries so a stylesheet can hide it.
 *
 * Pure, so the cases that matter — a group with one value, an entry belonging to
 * two values of one group, an entry belonging to none — are a dozen assertions
 * rather than a dozen renders. The same posture `tallyVisitedPlaces` and
 * `buildCatalogue` take, and for the same reason.
 */

const compare = (left: string, right: string) => left.localeCompare(right, "fr");

const COUNTRY = { key: "country", legend: "Pays", compare: byLabel(compare) } as const;
const YEAR = { key: "year", legend: "Année", compare: byValueDescending } as const;

function trip(key: string, code: string, year: string) {
  return {
    key,
    facets: [
      { group: "country", value: code, label: code === "FR" ? "France" : "Espagne" },
      { group: "year", value: year, label: year },
    ],
  };
}

describe("buildFacetIndex — the choices a reader is offered", () => {
  it("counts the entries each choice keeps", () => {
    const index = buildFacetIndex(
      [trip("a", "FR", "2024"), trip("b", "FR", "2023"), trip("c", "ES", "2024")],
      [COUNTRY, YEAR]
    );

    const countries = index.groups.find((group) => group.key === "country");

    expect(countries?.facets.map((facet) => [facet.token, facet.count])).toEqual([
      ["country-ES", 1],
      ["country-FR", 2],
    ]);
  });

  it("gives every entry the tokens of its own choices, plus the one that keeps everything", () => {
    const index = buildFacetIndex([trip("a", "FR", "2024")], [COUNTRY, YEAR]);

    expect(index.tokens.get("a")).toBe(`${ALL_FACET} country-FR year-2024`);
  });

  /**
   * A group holding a single value is not a choice — every entry has it, and
   * picking it changes nothing on the page. Offering it is the "filtre dont
   * toutes les valeurs sauf une sont vides" the brief refuses, and it is dropped
   * here rather than in each page so both pages drop it the same way.
   */
  it("drops a group that holds a single value", () => {
    const index = buildFacetIndex(
      [trip("a", "FR", "2024"), trip("b", "FR", "2024")],
      [COUNTRY, YEAR]
    );

    expect(index.groups).toEqual([]);
  });

  it("keeps a group as soon as there are two values to choose between", () => {
    const index = buildFacetIndex(
      [trip("a", "FR", "2024"), trip("b", "ES", "2024")],
      [COUNTRY, YEAR]
    );

    expect(index.groups.map((group) => group.key)).toEqual(["country"]);
  });

  it("orders each group with the comparator its caller supplies", () => {
    const index = buildFacetIndex(
      [trip("a", "FR", "2023"), trip("b", "ES", "2025"), trip("c", "FR", "2024")],
      [COUNTRY, YEAR]
    );

    expect(index.groups.map((group) => group.facets.map((facet) => facet.label))).toEqual([
      ["Espagne", "France"],
      ["2025", "2024", "2023"],
    ]);
  });

  /**
   * Two values of one group on one entry is a legitimate shape — a trip crossing
   * two countries would have it — so the counts of a group may sum above the
   * total. The entry is kept by either choice, which is what a filter means.
   */
  it("lets one entry belong to two values of the same group", () => {
    const index = buildFacetIndex(
      [
        {
          key: "a",
          facets: [
            { group: "country", value: "FR", label: "France" },
            { group: "country", value: "ES", label: "Espagne" },
          ],
        },
        { key: "b", facets: [{ group: "country", value: "FR", label: "France" }] },
      ],
      [COUNTRY]
    );

    expect(index.tokens.get("a")).toBe(`${ALL_FACET} country-FR country-ES`);
    expect(index.groups[0]?.facets.map((facet) => facet.count)).toEqual([1, 2]);
  });

  /**
   * An entry that declares no value of a group — a trip whose `startDate` is not
   * a calendar day — is kept by no choice of that group, and therefore hidden
   * while one is active. That is the honest answer, and it is why the counts of a
   * group may also sum *below* the total.
   */
  it("carries only the keep-everything token for an entry with no choice at all", () => {
    const index = buildFacetIndex(
      [
        { key: "a", facets: [] },
        { key: "b", facets: [{ group: "country", value: "FR", label: "France" }] },
        { key: "c", facets: [{ group: "country", value: "ES", label: "Espagne" }] },
      ],
      [COUNTRY]
    );

    expect(index.tokens.get("a")).toBe(ALL_FACET);
    expect(index.total).toBe(3);
  });

  it("has no group and no choice for an empty collection", () => {
    const index = buildFacetIndex([], [COUNTRY, YEAR]);

    expect(index.groups).toEqual([]);
    expect(index.total).toBe(0);
    expect(index.tokens.size).toBe(0);
  });

  /**
   * The token ends up inside a generated selector, so its alphabet is the whole
   * safety of `facet-stylesheet.ts`. Refused here, at the one place that mints a
   * token, rather than escaped at the place that prints it: a value carrying a
   * quote is a content defect, and failing the build names it.
   */
  it("refuses a value that would not survive being written into a selector", () => {
    const hostile = [{ key: "a", facets: [{ group: "country", value: '"]', label: "x" }] }];

    expect(() => buildFacetIndex(hostile, [COUNTRY])).toThrow(/facet value/i);
  });

  it("refuses two entries sharing one key, which would leave the second unfilterable", () => {
    expect(() =>
      buildFacetIndex([trip("a", "FR", "2024"), trip("a", "ES", "2024")], [COUNTRY])
    ).toThrow(/duplicate/i);
  });
});
