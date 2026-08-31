import { describe, expect, it } from "vitest";
import { countWords, tripWordCount } from "@/components/timeline/reading";

describe("countWords", () => {
  it.each([
    { label: "an empty string", text: "", words: 0 },
    { label: "blanks only", text: "   \n\t ", words: 0 },
    { label: "one word", text: "Tokyo", words: 1 },
    { label: "a plain sentence", text: "Japon et Corée, printemps 2024", words: 5 },
    { label: "runs of whitespace", text: "  Tokyo   \n  Kyoto  ", words: 2 },
    { label: "a non-breaking space, which also separates", text: "Saint\u00a0Denis", words: 2 },
  ])("counts $label as $words", ({ text, words }) => {
    expect(countWords(text)).toBe(words);
  });

  /** The count feeds a "roughly N minutes" figure, so a hyphenated compound
   * being one word rather than three is far below the precision claimed. Pinned
   * so the behaviour is a decision rather than an accident. */
  it("treats a hyphenated compound as one word", () => {
    expect(countWords("c'est-à-dire")).toBe(1);
  });
});

describe("tripWordCount", () => {
  it("counts the title and every place name", () => {
    expect(
      tripWordCount({
        title: "Japon et Corée",
        places: [
          { slug: "tokyo", name: "Tokyo", countryCode: "JP", coordinates: { lat: 1, lon: 1 } },
          {
            slug: "lyon-part-dieu",
            name: "Lyon Part-Dieu",
            countryCode: "FR",
            coordinates: { lat: 1, lon: 1 },
          },
        ],
      })
    ).toBe(6);
  });

  it("counts a trip with no places at all", () => {
    expect(tripWordCount({ title: "Un titre", places: [] })).toBe(2);
  });

  /**
   * The documented consequence, asserted rather than left in a comment: with the
   * content model as it stands there is no prose anywhere, so a realistic trip
   * produces a word count far below one minute of reading. The day a step gains
   * a text field this row is expected to go red — and going red is the point.
   */
  it("is starved by a content model that carries no prose", () => {
    const realistic = tripWordCount({
      title: "Japon et Corée, printemps 2024",
      places: [
        { slug: "tokyo", name: "Tokyo", countryCode: "JP", coordinates: { lat: 1, lon: 1 } },
        { slug: "kyoto", name: "Kyoto", countryCode: "JP", coordinates: { lat: 1, lon: 1 } },
        { slug: "osaka", name: "Osaka", countryCode: "JP", coordinates: { lat: 1, lon: 1 } },
        { slug: "seoul", name: "Séoul", countryCode: "KR", coordinates: { lat: 1, lon: 1 } },
      ],
    });

    expect(realistic).toBeLessThan(50);
  });
});
