import { describe, expect, it } from "vitest";
import { PlaceSchema, VisitedPlacesSchema } from "@/domain/schema";
import { attempt, KYOTO, pathsUnder, TOKYO } from "./fixtures";

/**
 * The schema of `content/places.yaml` — a place the client has been to, with no
 * date, no step and no récit (TIW-36).
 *
 * **What this suite is really pinning is that there is no second declaration of
 * what a place is.** `docs/lieux-visites.md` rests the whole promotion story on
 * one sentence: the YAML of a visited place *is* an element of a trip's
 * `places[]`, so promoting it later moves contiguous lines and rewrites neither
 * the slug nor the coordinates. That is only true while both sides read the same
 * `PlaceSchema`, and a copy of the four fields would pass every other test here
 * while quietly making it false. Hence the first `describe`, which compares the
 * two readings on the same inputs rather than trusting the import.
 */

const file = (places: readonly unknown[]): unknown => ({ places });

describe("a visited place is a trip's place, and not a second declaration of one", () => {
  /**
   * The same four inputs through both schemas. Every one of them is a rule
   * `PlaceSchema` already owns — a lower-case country code, an unassigned-looking
   * shape, Null Island, a blank name — and the point is not to re-test them: it
   * is that the answer is the *same*, which is what a shared schema buys and a
   * copied one loses on the first divergence.
   */
  const inputs = [
    { what: "a well-formed place", place: TOKYO, accepted: true },
    { what: "a lower-case country code", place: { ...TOKYO, countryCode: "jp" }, accepted: false },
    {
      what: "the signature of a failed geocoding",
      place: { ...TOKYO, coordinates: { lat: 0, lon: 0 } },
      accepted: false,
    },
    { what: "a blank name", place: { ...TOKYO, name: "   " }, accepted: false },
    {
      what: "a place with no coordinates at all",
      place: { ...TOKYO, coordinates: undefined },
      accepted: false,
    },
  ] as const;

  it.each(inputs)("answers the same as PlaceSchema for $what", ({ place, accepted }) => {
    expect(attempt(PlaceSchema, place).accepted).toBe(accepted);
    expect(attempt(VisitedPlacesSchema, file([place])).accepted).toBe(accepted);
  });

  /**
   * An unknown key is an error here for the reason it is one everywhere in this
   * schema file: `lattitude:` would be dropped in silence and the marker would
   * land in the wrong place with nothing to say so. Stated on the entry rather
   * than on the file, because that is the level an author types at.
   */
  it("refuses a key it does not know, so a typo cannot be dropped in silence", () => {
    const outcome = attempt(VisitedPlacesSchema, file([{ ...TOKYO, startDate: "2024-04-12" }]));

    expect(outcome.accepted).toBe(false);
    expect(pathsUnder(outcome, "places.0").length).toBeGreaterThan(0);
  });

  /**
   * **The three fields a visited place must not be able to carry.** They are the
   * whole reason this entity exists: the client has no dates, and a place that
   * *accepted* a date would be a place somebody eventually writes an invented one
   * into. `z.strictObject` gives this for free — the test is here so that a
   * future widening of the entry has to argue with it.
   */
  it.each(["startDate", "endDate", "publishedAt", "steps", "story", "draft"])(
    "refuses %s, which is a trip's business and not a place's",
    (key) => {
      expect(attempt(VisitedPlacesSchema, file([{ ...TOKYO, [key]: "2024-04-12" }])).accepted).toBe(
        false
      );
    }
  );
});

describe("VisitedPlacesSchema", () => {
  it("accepts a file holding one place", () => {
    const parsed = VisitedPlacesSchema.parse(file([TOKYO]));

    expect(parsed.places).toHaveLength(1);
    expect(parsed.places[0]?.slug).toBe("tokyo");
  });

  it("accepts a file holding several places in different countries", () => {
    const parsed = VisitedPlacesSchema.parse(
      file([TOKYO, { ...KYOTO, countryCode: "FR", slug: "lyon", name: "Lyon" }])
    );

    expect(parsed.places.map((place) => place.slug)).toEqual(["tokyo", "lyon"]);
  });

  /**
   * An empty collection is not the same statement as no file at all, and the
   * difference is which one the *loader* has to answer. A file whose `places:` is
   * empty is a file somebody emptied — the last place was promoted into a trip —
   * and it is a legitimate resting state, so it is accepted here. "No file"
   * belongs to the layer that reads the disk, which is where it is decided.
   */
  it("accepts an emptied file, which is the state after the last promotion", () => {
    expect(VisitedPlacesSchema.parse(file([])).places).toEqual([]);
  });

  it("refuses a file with no places key at all", () => {
    expect(attempt(VisitedPlacesSchema, {}).accepted).toBe(false);
  });

  it("refuses a bare list, which is the likeliest shape to write by hand", () => {
    expect(attempt(VisitedPlacesSchema, [TOKYO]).accepted).toBe(false);
  });

  it("refuses an unknown key on the file itself", () => {
    expect(attempt(VisitedPlacesSchema, { places: [TOKYO], trips: [] }).accepted).toBe(false);
  });

  /**
   * A slug is what a shared link is made of — `#lieu-<slug>` is the fragment the
   * map's marker points at — so two places claiming one make one of the two
   * unreachable and the other's anchor ambiguous. Reported on the *second*
   * declaration, which is the line to delete.
   */
  it("refuses two places sharing a slug, naming the second one", () => {
    const outcome = attempt(VisitedPlacesSchema, file([TOKYO, { ...KYOTO, slug: "tokyo" }]));

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toContain("tokyo");
    expect(pathsUnder(outcome, "places.1")).toContain("places.1.slug");
  });

  /**
   * Two places may share a *name* and a country: « Valence » is a city in Spain
   * and a city in France, and the fourteen this ticket loads hold two Spanish
   * places in the same region. Only the slug is an identity.
   */
  it("accepts two places sharing a name, since only the slug is an identity", () => {
    const outcome = attempt(
      VisitedPlacesSchema,
      file([
        { ...TOKYO, slug: "valence-es", name: "Valence", countryCode: "ES" },
        { ...KYOTO, slug: "valence-fr", name: "Valence", countryCode: "FR" },
      ])
    );

    expect(outcome.accepted).toBe(true);
  });
});
