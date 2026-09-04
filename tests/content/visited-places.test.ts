import { chmodSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listTripSummaries, listVisitedPlaces, tripStaticParams } from "@/content/loader";
import { placesYaml, temporaryContent, tripYaml } from "./support";
import type { PlaceSource, TemporaryContent } from "./support";

/**
 * **The fifth door of the content façade** (TIW-36), and the invariants that make
 * it a door rather than a hole.
 *
 * TIW-18 split the four existing doors into two pairs: `listTripSummaries` and
 * `loadTrips` *render*, `tripStaticParams` and `findTrip` *refuse*. That pairing
 * is what makes "no link to a page that does not exist" a property of the build.
 *
 * `listVisitedPlaces` joins the first pair and has **no counterpart in the
 * second**, deliberately: nothing in this codebase can produce an address for a
 * visited place, so no code path — not even a route added next year — can link to
 * one. The first `describe` below is what holds that, and it is the reason this
 * file exists rather than three more cases in `loader.test.ts`.
 *
 * The other half is the one objection `docs/lieux-visites.md` had to answer: a
 * second collection of places is a second place for the same city to live. The
 * answer is that the divergence is *refusable*, and the refusal is what the last
 * `describe` measures.
 *
 * Environment discipline is `loader.test.ts`'s, for its reasons: every test
 * points the façade at a fresh throwaway root through `vi.stubEnv`, and both
 * variables are restored afterwards — leaking either poisons the rest of the
 * suite, which reads the repository's real content.
 */

const temporaries: TemporaryContent[] = [];

afterEach(() => {
  for (const created of temporaries.splice(0)) {
    created.cleanup();
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * Points the façade at a fresh throwaway root holding the given trips and the
 * given places file.
 *
 * A *fresh* root every time, which the memo makes load-bearing: `mkdtempSync`
 * hands out a path no earlier test used, so no test is ever served another test's
 * memoised collection.
 */
function useContent(trips: Readonly<Record<string, string>>, places?: string): TemporaryContent {
  const created = temporaryContent(trips, [], places);
  temporaries.push(created);
  vi.stubEnv("TIW_CONTENT_DIR", created.contentDir);
  vi.stubEnv("TIW_PLACES_FILE", created.placesFile);

  return created;
}

const ROUEN: PlaceSource = {
  slug: "rouen",
  name: "Rouen",
  countryCode: "FR",
  coordinates: { lat: 49.4432, lon: 1.0999 },
};

const GAND: PlaceSource = {
  slug: "gand",
  name: "Gand",
  countryCode: "BE",
  coordinates: { lat: 51.0536, lon: 3.7253 },
};

describe("a visited place has no address, and that is structural", () => {
  /**
   * The whole point, stated as the property rather than as a list of call sites:
   * the module exports no function that could answer "which place slugs get a
   * page". `tripStaticParams` is the only door that decides addresses, and a
   * place is not in it — not because it is filtered out, but because it never
   * enters.
   */
  it("exports no static-params door for places, so no build can produce one", async () => {
    const module = await import("@/content/loader");
    const doors = Object.keys(module).sort();

    expect(doors).toEqual([
      "findTrip",
      "listTripSummaries",
      "listVisitedPlaces",
      "loadTrips",
      "tripStaticParams",
    ]);
  });

  it("leaves the prerendered address list untouched, whatever the places file holds", async () => {
    useContent({}, placesYaml([ROUEN, GAND]));

    expect(await tripStaticParams()).toEqual([]);
    expect(await listTripSummaries()).toEqual([]);
    expect(await listVisitedPlaces()).toHaveLength(2);
  });
});

describe("listVisitedPlaces", () => {
  it("reads the places of the file, with their coordinates", async () => {
    useContent({}, placesYaml([ROUEN]));

    expect(await listVisitedPlaces()).toEqual([
      {
        slug: "rouen",
        name: "Rouen",
        countryCode: "FR",
        coordinates: { lat: 49.4432, lon: 1.0999 },
      },
    ]);
  });

  /**
   * **No file at all is an empty list and never a throw**, which is the one
   * decision here that had to go the lenient way. Every other refusal in this
   * layer is loud, because a trip vanishing in silence is the defect the whole
   * pipeline exists to prevent. But a journal with no dateless place is not a
   * broken journal: it is what this repository was before TIW-36 and what it
   * becomes again once every place has been promoted into a trip. Making the
   * absence an error would make the ordinary end state a build failure.
   */
  it("answers an empty list when there is no places file", async () => {
    useContent({});

    expect(await listVisitedPlaces()).toEqual([]);
  });

  it("answers an empty list for an emptied file, which is the state after the last promotion", async () => {
    useContent({}, "places: []\n");

    expect(await listVisitedPlaces()).toEqual([]);
  });

  /**
   * **Alphabetical by name, and stated as the contract rather than left to the
   * file.** A visited place carries no date — that is the whole reason it exists
   * — so there is no chronological order to take, and the order a marker's DOM
   * position and a list's rows come out in must not be "whatever was typed". The
   * localised collation belongs to the presentation layer; this is the stable,
   * locale-independent order the façade guarantees underneath it.
   */
  it("orders places by name, so the file's own order decides nothing", async () => {
    useContent(
      {},
      placesYaml([
        { ...GAND, slug: "valence", name: "Valence", countryCode: "ES" },
        ROUEN,
        { ...GAND, slug: "annecy", name: "Annecy", countryCode: "FR" },
      ])
    );

    expect((await listVisitedPlaces()).map((place) => place.name)).toEqual([
      "Annecy",
      "Rouen",
      "Valence",
    ]);
  });

  /** A `Trip` is parsed before it circulates, and so is a place — ADR 0001. */
  it("refuses a place the schema rejects, naming the file and the command", async () => {
    useContent({}, placesYaml([{ ...ROUEN, coordinates: { lat: 0, lon: 0 } }]));

    await expect(listVisitedPlaces()).rejects.toThrow(/places\.yaml/);
    await expect(listVisitedPlaces()).rejects.toThrow(/npm run validate:content/);
  });

  it("refuses a malformed file rather than reading past it", async () => {
    const created = useContent({});
    writeFileSync(created.placesFile, "places:\n\t- slug: rouen\n", "utf8");

    await expect(listVisitedPlaces()).rejects.toThrow(/places\.yaml/);
  });

  /**
   * A file that is there and cannot be opened is **not** an absent file, and the
   * distinction is the one `readYamlFile` keeps: answering "no places" for an
   * `EACCES` is how a deployment quietly ships an empty map.
   */
  it("refuses a file it cannot open, rather than calling it absent", async () => {
    const created = useContent({}, placesYaml([ROUEN]));
    chmodSync(created.placesFile, 0o000);

    try {
      await expect(listVisitedPlaces()).rejects.toThrow(/n'est pas lisible/);
    } finally {
      chmodSync(created.placesFile, 0o644);
    }
  });

  /**
   * The near-miss on the name, which is the difference between "write this file"
   * and "rename the one you already wrote". macOS finds `Places.yaml` and the CI
   * does not, so the file that works locally is the file that is missing online.
   */
  it("names a file that differs only by case, instead of reporting nothing", async () => {
    const created = useContent({});
    writeFileSync(created.placesFile.replace("places.yaml", "Places.yaml"), placesYaml([ROUEN]));

    await expect(listVisitedPlaces()).rejects.toThrow(/Places\.yaml/);
  });

  /**
   * `__proto__` never becomes an own property, so `z.strictObject` cannot see it
   * — the hole `loader.ts` closes on trips from the YAML document itself. The
   * same hole exists here, and closing it in one collection and not the other
   * would be the worse of the two outcomes: a reader would reasonably believe it
   * closed everywhere.
   */
  it("refuses a __proto__ key, which no schema can see", async () => {
    const created = useContent({});
    writeFileSync(
      created.placesFile,
      "places:\n  - slug: rouen\n    name: Rouen\n    countryCode: FR\n    coordinates:\n      lat: 49.4432\n      lon: 1.0999\n__proto__:\n  polluted: yes\n",
      "utf8"
    );

    await expect(listVisitedPlaces()).rejects.toThrow(/__proto__/);
  });
});

describe("the two collections are disjoint, and the refusal is what makes them one source", () => {
  /**
   * **The objection to a separate collection, answered.** `docs/lieux-visites.md`
   * accepts that two sources of places is the real cost of this design, and rests
   * the answer on this: a city declared in both is *refused*, so promoting a
   * place into a trip cannot half-happen. Until the four lines are removed from
   * the places file, the build fails naming both files.
   *
   * This is also the measurement that decided the design. The alternative — a
   * third `story` state — has the same duplication and **cannot** refuse it: a
   * trip slug and a place slug never clash, so the same city would exist twice
   * with a green build.
   */
  it("refuses a place slug a trip already declares, naming both files", async () => {
    useContent({ "japon-2024": tripYaml() }, placesYaml([{ ...ROUEN, slug: "tokyo" }]));

    const failure = listVisitedPlaces();

    await expect(failure).rejects.toThrow(/tokyo/);
    await expect(failure).rejects.toThrow(/japon-2024/);
    await expect(failure).rejects.toThrow(/places\.yaml/);
  });

  /**
   * And it refuses from **either** door, not only from the one that reads the
   * places. A collection whose two halves contradict each other must not be
   * half-servable: a build that renders the trip listing and fails only on the
   * map would ship a page that says the city was never visited.
   */
  it("refuses from the trips door too, so no page can render half the truth", async () => {
    useContent({ "japon-2024": tripYaml() }, placesYaml([{ ...ROUEN, slug: "kyoto" }]));

    await expect(listTripSummaries()).rejects.toThrow(/kyoto/);
  });

  /**
   * A place slug matching a *trip* slug is not the same fault and is not refused.
   * The two live in different namespaces — `/voyages/<slug>` against
   * `#lieu-<slug>` — and a journal holding a récit called « annecy » plus a
   * dateless stop in Annecy is a perfectly coherent statement while the récit is
   * about something else. Refusing it would be this layer inventing a rule.
   */
  it("accepts a place whose slug matches a trip's own slug, which is a different namespace", async () => {
    useContent({ "japon-2024": tripYaml() }, placesYaml([{ ...ROUEN, slug: "japon-2024" }]));

    expect(await listVisitedPlaces()).toHaveLength(1);
  });

  /**
   * The draft case, and it goes the strict way on purpose. A draft's places are
   * not published, so a reader would never see the duplicate — but the promotion
   * that this rule exists to make loud happens *in* a draft: that is the shape
   * `content/README.md` calls the ordinary return from a journey. A rule that
   * only bit once the trip was published would be silent exactly while the author
   * is doing the work it guards.
   */
  it("refuses the clash even when the trip is a draft, which is when promotion happens", async () => {
    useContent(
      { "japon-2024": tripYaml({ draft: "draft: true" }) },
      placesYaml([{ ...ROUEN, slug: "tokyo" }])
    );

    await expect(listVisitedPlaces()).rejects.toThrow(/tokyo/);
  });
});
