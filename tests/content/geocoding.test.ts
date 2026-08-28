import { describe, expect, it } from "vitest";
import {
  createGeocodingClient,
  GEOCODING_ENDPOINT,
  GeocodingResponseSchema,
  MAX_CANDIDATES,
  REQUEST_TIMEOUT_MS,
} from "@/content/geocoding";
import type { HttpFetch, HttpResponse } from "@/content/geocoding";

/**
 * The boundary with the outside world. Two things are tested here and nothing
 * else: that the response is *parsed* before it is used (criterion 7), and that
 * every way a network call can fail comes back as a value rather than as a
 * throw.
 *
 * Not one case reaches the network (constraint B): `fetch` is a parameter of the
 * client, and every case here passes a function that answers from memory. The
 * one call to the real service made while writing this ticket is recorded in the
 * comment above {@link CAPTURED_KYOTO}.
 */

/**
 * Captured verbatim from a single real call to
 * `https://geocoding-api.open-meteo.com/v1/search?name=Kyoto&count=10&language=fr`.
 * Two properties of the real payload matter and are both here: the Tanzanian
 * homonym carries **no** `population` key at all, and every entry carries fields
 * this repository does not read (`id`, `elevation`, `admin2_id`, …).
 */
const CAPTURED_KYOTO = {
  results: [
    {
      id: 1857910,
      name: "Kyōto",
      latitude: 35.02107,
      longitude: 135.75385,
      elevation: 50,
      feature_code: "PPLA",
      country_code: "JP",
      admin1_id: 1857907,
      timezone: "Asia/Tokyo",
      population: 1463723,
      country_id: 1861060,
      country: "Japon",
      admin1: "Préfecture de Kyoto",
      admin2: "Kyōto Shi",
    },
    {
      id: 156100,
      name: "Kyoto",
      latitude: -2.05,
      longitude: 31.68333,
      elevation: 1314,
      feature_code: "PPL",
      country_code: "TZ",
      timezone: "Africa/Dar_es_Salaam",
      country_id: 149590,
      country: "Tanzanie",
      admin1: "Kagera",
    },
  ],
  generationtime_ms: 0.33438206,
};

function respond(status: number, body: unknown): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

type Call = { readonly url: string };

function stubFetch(handler: (url: string) => Promise<HttpResponse>): {
  readonly fetch: HttpFetch;
  readonly calls: readonly Call[];
} {
  const calls: Call[] = [];

  return {
    calls,
    fetch: async (url) => {
      calls.push({ url });
      return handler(url);
    },
  };
}

describe("the response schema", () => {
  it("accepts the real payload and keeps only the fields that are read", () => {
    const parsed = GeocodingResponseSchema.parse(CAPTURED_KYOTO);
    const [first, second] = parsed.results ?? [];

    expect(first).toEqual({
      name: "Kyōto",
      latitude: 35.02107,
      longitude: 135.75385,
      country_code: "JP",
      country: "Japon",
      admin1: "Préfecture de Kyoto",
      feature_code: "PPLA",
      population: 1463723,
    });
    // The homonym has no population at all: the field is optional, not zero.
    expect(second?.population).toBeUndefined();
    expect(second?.country_code).toBe("TZ");
  });

  it("accepts a response with no results key, which is what a no-match is", () => {
    expect(GeocodingResponseSchema.parse({ generationtime_ms: 0.2 }).results).toBeUndefined();
  });

  it("refuses an entry with no coordinates rather than reading NaN", () => {
    const broken = { results: [{ name: "Kyoto", country_code: "JP" }] };

    expect(GeocodingResponseSchema.safeParse(broken).success).toBe(false);
  });

  it("refuses coordinates sent as strings", () => {
    const broken = {
      results: [{ name: "Kyoto", country_code: "JP", latitude: "35.0", longitude: "135.7" }],
    };

    expect(GeocodingResponseSchema.safeParse(broken).success).toBe(false);
  });
});

describe("the request", () => {
  it("asks the documented endpoint once, with the name and no credential", async () => {
    const stub = stubFetch(async () => respond(200, CAPTURED_KYOTO));
    const search = createGeocodingClient({ fetch: stub.fetch });

    await search("Kyoto");

    expect(stub.calls).toHaveLength(1);
    const url = new URL(stub.calls[0]?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(GEOCODING_ENDPOINT);
    expect(url.searchParams.get("name")).toBe("Kyoto");
    expect(url.searchParams.get("language")).toBe("fr");
    // No API key exists for this service, so none can leak into a URL or a log.
    expect(url.search).not.toMatch(/key|token|apikey/i);
  });

  it("encodes a name that would otherwise break the query string", async () => {
    const stub = stubFetch(async () => respond(200, CAPTURED_KYOTO));

    await createGeocodingClient({ fetch: stub.fetch })("Saint-Étienne & Cie?x=1");

    expect(new URL(stub.calls[0]?.url ?? "").searchParams.get("name")).toBe(
      "Saint-Étienne & Cie?x=1"
    );
  });

  it("carries an abort signal, so no call can hang for ever", async () => {
    let seen: AbortSignal | undefined;
    const search = createGeocodingClient({
      fetch: async (_url, init) => {
        seen = init.signal;
        return respond(200, CAPTURED_KYOTO);
      },
    });

    await search("Kyoto");

    expect(seen).toBeInstanceOf(AbortSignal);
  });
});

describe("what comes back", () => {
  it("is the candidates, in the order the service ranked them", async () => {
    const stub = stubFetch(async () => respond(200, CAPTURED_KYOTO));
    const result = await createGeocodingClient({ fetch: stub.fetch })("Kyoto");

    expect(result.state).toBe("candidates");
    if (result.state !== "candidates") return;
    expect(result.candidates.map((entry) => entry.country_code)).toEqual(["JP", "TZ"]);
  });

  it("is a no-match when the service answers without a results key", async () => {
    const stub = stubFetch(async () => respond(200, { generationtime_ms: 0.2 }));

    expect((await createGeocodingClient({ fetch: stub.fetch })("zzzq")).state).toBe("no-match");
  });

  it("is a no-match on an empty results list too", async () => {
    const stub = stubFetch(async () => respond(200, { results: [] }));

    expect((await createGeocodingClient({ fetch: stub.fetch })("zzzq")).state).toBe("no-match");
  });
});

describe("every way the network fails", () => {
  it("reports 429 as an http error carrying the status", async () => {
    const stub = stubFetch(async () => respond(429, "Too Many Requests"));
    const result = await createGeocodingClient({ fetch: stub.fetch })("Kyoto");

    expect(result).toEqual({ state: "http-error", status: 429 });
  });

  it("reports 500 the same way", async () => {
    const stub = stubFetch(async () => respond(500, ""));

    expect(await createGeocodingClient({ fetch: stub.fetch })("Kyoto")).toEqual({
      state: "http-error",
      status: 500,
    });
  });

  it("reports a body that is not JSON as malformed", async () => {
    const search = createGeocodingClient({
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      }),
    });
    const result = await search("Kyoto");

    expect(result.state).toBe("malformed");
    if (result.state === "malformed") {
      expect(result.reason).toContain("Unexpected token");
    }
  });

  it("reports JSON of the wrong shape as malformed, not as candidates", async () => {
    const stub = stubFetch(async () => respond(200, { results: "Kyoto" }));

    expect((await createGeocodingClient({ fetch: stub.fetch })("Kyoto")).state).toBe("malformed");
  });

  it("reports an unreachable host without leaking a stack trace", async () => {
    const search = createGeocodingClient({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const result = await search("Kyoto");

    expect(result).toEqual({ state: "unreachable", reason: "fetch failed" });
  });

  it("reports a timeout as a timeout, with the delay it waited", async () => {
    const search = createGeocodingClient({
      fetch: async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
      timeoutMs: 250,
    });

    expect(await search("Kyoto")).toEqual({ state: "timeout", timeoutMs: 250 });
  });

  it("has a default timeout, so a forgotten option cannot mean « for ever »", () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("never throws, whatever the transport does", async () => {
    const search = createGeocodingClient({
      fetch: async () => {
        throw "a string, because a thrown value need not be an Error";
      },
    });

    await expect(search("Kyoto")).resolves.toMatchObject({ state: "unreachable" });
  });
});

describe("a body that stops half way", () => {
  it("is a timeout, not an unreadable response", async () => {
    // The abort signal fires while the body is being read, not while the request
    // is being made. Classifying it as "malformed" gives the one piece of advice
    // this module documents wanting to avoid — "réessaie" instead of "attends".
    const search = createGeocodingClient({
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        },
      }),
      timeoutMs: 500,
    });

    expect(await search("Kyoto")).toEqual({ state: "timeout", timeoutMs: 500 });
  });
});

describe("a response far bigger than what was asked for", () => {
  it("is bounded rather than parsed and printed whole", async () => {
    const one = {
      name: "Nulle-part",
      latitude: 1,
      longitude: 1,
      country_code: "FR",
    };
    const flood = { results: Array.from({ length: 20_002 }, () => one) };
    const search = createGeocodingClient({ fetch: async () => respond(200, flood) });
    const result = await search("Nulle-part");

    expect(result.state).toBe("candidates");
    if (result.state !== "candidates") return;
    expect(result.candidates).toHaveLength(MAX_CANDIDATES);
    // Only reachable through a redirected TIW_GEOCODING_URL: `count=10` is asked.
    expect(MAX_CANDIDATES).toBeLessThanOrEqual(50);
  });
});
