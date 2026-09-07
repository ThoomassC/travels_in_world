import { describe, expect, it } from "vitest";
import {
  filterSuggestions,
  foldForSearch,
  type CountrySuggestion,
} from "@/components/trips/country-suggestions";

/**
 * The search box's two pieces of arithmetic, tested where they are cheap.
 *
 * The module they exercise imports nothing at all — that is its whole point, and
 * these cases are the reason it can afford to be: folding and filtering are worth
 * two dozen literals rather than two dozen renders, and the client component the
 * next ticket adds will run the very same functions the server precomputed with.
 */
describe("foldForSearch", () => {
  it("removes the accents a reader does not type", () => {
    // « perou » has to find « Pérou », which is the whole reason this exists.
    expect(foldForSearch("Pérou")).toBe("perou");
  });

  it("lowercases", () => {
    expect(foldForSearch("JAPON")).toBe("japon");
  });

  it("folds every accented letter of the French country names, not just é", () => {
    expect(foldForSearch("Émirats arabes unis")).toBe("emirats arabes unis");
    expect(foldForSearch("Curaçao")).toBe("curacao");
    expect(foldForSearch("Åland")).toBe("aland");
  });

  /**
   * **The apostrophe, and it is a measured defect rather than a nicety.**
   * `Intl.DisplayNames(["fr"], { type: "region" }).of("CI")` answers
   * `"Côte d’Ivoire"` — U+2019, the typographic apostrophe — while a reader
   * types U+0027 off their keyboard. Folding accents alone leaves
   * « cote d'ivoire » matching nothing, on the one country name in the table
   * that has an apostrophe at all.
   */
  it("folds both apostrophes to nothing, so either spelling matches", () => {
    expect(foldForSearch("Côte d’Ivoire")).toBe("cote divoire");
    expect(foldForSearch("cote d'ivoire")).toBe("cote divoire");
  });

  it("leaves a name with nothing to fold alone", () => {
    expect(foldForSearch("japon")).toBe("japon");
  });

  it("answers the empty string for the empty string", () => {
    expect(foldForSearch("")).toBe("");
  });
});

/**
 * In the tally's order, which is the reader's alphabet — `tallyVisitedCountries`
 * collates by localised name and this must not re-sort it. Peru sits after Japan
 * here on purpose: an implementation that sorted its own answer would put it
 * first and pass every other case in this file.
 */
const SUGGESTIONS: readonly CountrySuggestion[] = [
  { code: "CI", name: "Côte d’Ivoire", label: "Côte d’Ivoire, 1 voyage" },
  { code: "JP", name: "Japon", label: "Japon, 2 voyages" },
  { code: "PE", name: "Pérou", label: "Pérou, 1 voyage" },
  { code: "GB", name: "Royaume-Uni", label: "Royaume-Uni, 1 voyage" },
].map((entry, index) => ({
  ...entry,
  href: `/fr/voyages#pays-${entry.code.toLowerCase()}`,
  search: foldForSearch(entry.name),
  // Only so a reordering is visible in a failure message.
  label: `${entry.label} (${index})`,
}));

const codes = (matches: readonly CountrySuggestion[]): readonly string[] =>
  matches.map((match) => match.code);

describe("filterSuggestions", () => {
  it("finds a name through the accents the reader left out", () => {
    expect(codes(filterSuggestions(SUGGESTIONS, "perou"))).toEqual(["PE"]);
  });

  it("ignores the case of the query", () => {
    expect(codes(filterSuggestions(SUGGESTIONS, "JaPoN"))).toEqual(["JP"]);
  });

  /**
   * A substring and not a prefix. « uni » is inside "Royaume-Uni" and nowhere
   * near its front, and a reader who knows the second half of a name should not
   * have to remember the first.
   */
  it("matches inside a name and not only at its start", () => {
    expect(codes(filterSuggestions(SUGGESTIONS, "uni"))).toEqual(["GB"]);
  });

  it("matches a name written with the apostrophe a keyboard produces", () => {
    expect(codes(filterSuggestions(SUGGESTIONS, "cote d'ivoire"))).toEqual(["CI"]);
  });

  it("keeps the tally's order and never its own", () => {
    // "o" is in all four folded names; the answer must be the order it was given.
    expect(codes(filterSuggestions(SUGGESTIONS, "o"))).toEqual(["CI", "JP", "PE", "GB"]);
  });

  /**
   * **An empty query answers nothing, deliberately.** The alternative — every
   * country — turns an untouched search box into a sixty-row panel over the page
   * the reader was reading, and there is no state in which they asked for that.
   */
  it("answers nothing for an empty query", () => {
    expect(filterSuggestions(SUGGESTIONS, "")).toEqual([]);
  });

  it("answers nothing for a query that is only whitespace", () => {
    // A lone space is inside "Côte d’Ivoire"; a reader who pressed the space bar
    // has not asked a question.
    expect(filterSuggestions(SUGGESTIONS, "   ")).toEqual([]);
  });

  it("answers nothing when no name holds the query", () => {
    expect(filterSuggestions(SUGGESTIONS, "zzz")).toEqual([]);
  });

  it("answers nothing when there is nothing to search", () => {
    expect(filterSuggestions([], "japon")).toEqual([]);
  });

  /**
   * The precomputed `search` field is what the filter reads — never `name`. It is
   * computed once by the server for the whole list, so a client typing six
   * characters folds six queries and not six hundred names.
   */
  it("reads the precomputed fold and not the display name", () => {
    const mislabelled: readonly CountrySuggestion[] = [
      {
        code: "JP",
        name: "Japon",
        label: "Japon, 2 voyages",
        href: "/fr/voyages#pays-jp",
        search: "nippon",
      },
    ];

    expect(codes(filterSuggestions(mislabelled, "nippon"))).toEqual(["JP"]);
    expect(filterSuggestions(mislabelled, "japon")).toEqual([]);
  });
});
