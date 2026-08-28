import { z } from "zod";

/**
 * The boundary with the one external service this repository talks to:
 * Open-Meteo's geocoder. Everything that crosses it is parsed before it is used,
 * and nothing that goes wrong out there is allowed to throw in here.
 *
 * **No credential exists to leak.** `https://geocoding-api.open-meteo.com/v1/search`
 * takes no API key, no token and no `Authorization` header — verified against the
 * live service while writing TIW-10, and pinned by a test that asserts the query
 * string carries nothing of the sort. So there is no secret to inject, none to
 * commit by accident, and none to redact from a log line.
 *
 * **`fetch` is a parameter, not a global.** That is what lets the whole suite run
 * offline (constraint B of TIW-10) and what keeps a free public service from
 * being hammered by a test loop.
 */

/** The documented search endpoint. No key, no quota, no account. */
export const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

/**
 * How long one search may take before it is abandoned. A hand-run command that
 * hangs is worse than one that fails: the author cannot tell it apart from a slow
 * network and waits.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/** How many homonyms to ask for. Enough to see the trap, few enough to read. */
export const CANDIDATE_COUNT = 10;

/**
 * How many homonyms are kept, whatever the answer contains. Twice what
 * {@link CANDIDATE_COUNT} asks for, so a provider that over-delivers a little
 * never sees its answer truncated, while a redirected `TIW_GEOCODING_URL` — the
 * only way to exceed `count` — cannot make the command validate and print tens of
 * thousands of entries.
 */
export const MAX_CANDIDATES = 2 * CANDIDATE_COUNT;

/**
 * One entry of the service's answer.
 *
 * `z.object` and **not** `z.strictObject`, which is the opposite of the rule
 * `src/domain/schema.ts` follows — and for the opposite reason. A content file is
 * ours: an unknown key there is a typo, and silence would hide it. This payload
 * is somebody else's: it already carries eight fields this repository never reads
 * (`id`, `elevation`, `admin1_id`, `country_id`, …) and the provider may add a
 * ninth any morning. Strictness here would mean the day Open-Meteo adds a field,
 * `npm run geocode` stops working — so unknown keys are dropped, and the fields
 * that *are* read are checked.
 *
 * The names stay in the provider's `snake_case`: the type below is inferred from
 * this schema, so renaming them here would be declaring the shape twice.
 */
const GeocodingCandidateSchema = z.object({
  name: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  /** ISO 3166-1 alpha-2, and the value the country cross-check compares. */
  country_code: z.string(),
  country: z.string().optional(),
  /** First administrative level — « Préfecture de Kyoto », « Kagera ». */
  admin1: z.string().optional(),
  /**
   * Optional, and this is the field that proves the schema earns its place: the
   * Tanzanian Kyoto comes back with **no** `population` key at all. Reading it
   * as a number would have printed `NaN habitants` next to the homonym that is
   * 8 000 km off.
   */
  population: z.number().optional(),
  /** GeoNames feature code: `PPLC` a capital, `AIRH` a heliport. */
  feature_code: z.string().optional(),
});

/**
 * The envelope. `results` is **absent**, not empty, when nothing matches —
 * measured against the live service, which answers `{"generationtime_ms":0.2}`.
 */
export const GeocodingResponseSchema = z.object({
  /**
   * Cut to {@link MAX_CANDIDATES} **before** the entries are validated, not
   * after: bounding the work is the point, so a flooded answer costs twenty
   * `safeParse` of an object rather than twenty thousand. A non-array is left
   * untouched and fails the array below, which is what keeps
   * `{ results: "Kyoto" }` a malformed response.
   */
  results: z
    .preprocess(
      (value) => (Array.isArray(value) ? value.slice(0, MAX_CANDIDATES) : value),
      z.array(GeocodingCandidateSchema)
    )
    .optional(),
});

export type GeocodingCandidate = z.infer<typeof GeocodingCandidateSchema>;

/* --------------------------------------------------------------- the transport -- */

/**
 * The slice of `fetch` this client uses, and nothing more. Narrow on purpose: the
 * real `fetch` satisfies it, and a test can satisfy it with a plain object — no
 * `Response`, no global, no environment that has to provide either.
 */
export type HttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
};

export type HttpFetch = (
  url: string,
  init: { readonly signal: AbortSignal }
) => Promise<HttpResponse>;

/** Why a search produced nothing usable. Each one has its own French sentence. */
export type SearchFailure =
  | { readonly state: "timeout"; readonly timeoutMs: number }
  | { readonly state: "unreachable"; readonly reason: string }
  | { readonly state: "http-error"; readonly status: number }
  | { readonly state: "malformed"; readonly reason: string };

export type SearchResult =
  | { readonly state: "candidates"; readonly candidates: readonly GeocodingCandidate[] }
  | { readonly state: "no-match" }
  | SearchFailure;

/** One city name in, one answer out. Never throws. */
export type GeocodingClient = (name: string) => Promise<SearchResult>;

export type GeocodingClientOptions = {
  readonly fetch: HttpFetch;
  /** Overridden by `TIW_GEOCODING_URL`, which is how the suite stays offline. */
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly count?: number;
  readonly language?: string;
};

/**
 * The `name` of a thrown value, read structurally rather than through
 * `instanceof Error`.
 *
 * Measured: under jsdom a `DOMException` is **not** an `Error`, so
 * `AbortSignal.timeout`'s rejection was classified as an unreachable host — the
 * one failure mode whose advice ("check the network") is wrong for a timeout.
 * Same shape as `errorCode` in `collection.ts`, and safe for a `throw "string"`,
 * which nothing forbids.
 */
function errorName(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "name" in cause) {
    const { name } = cause;

    return typeof name === "string" ? name : "";
  }
  return "";
}

function errorMessage(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const { message } = cause;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(cause);
}

/**
 * `AbortSignal.timeout` rejects with a `TimeoutError`; an explicit abort rejects
 * with an `AbortError`. Both mean "we gave up waiting", and neither is a network
 * error the author can act on differently, so they are one case.
 */
function isTimeout(cause: unknown): boolean {
  const name = errorName(cause);

  return name === "TimeoutError" || name === "AbortError";
}

export function createGeocodingClient(options: GeocodingClientOptions): GeocodingClient {
  const endpoint = options.endpoint ?? GEOCODING_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const count = options.count ?? CANDIDATE_COUNT;
  const language = options.language ?? "fr";

  return async (name) => {
    // `URLSearchParams`, never string concatenation: a city name carrying `&` or
    // `?` would otherwise silently become two parameters.
    const query = new URLSearchParams({
      name,
      count: String(count),
      language,
      format: "json",
    });

    let response: HttpResponse;
    try {
      response = await options.fetch(`${endpoint}?${query.toString()}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      return isTimeout(cause)
        ? { state: "timeout", timeoutMs }
        : { state: "unreachable", reason: errorMessage(cause) };
    }

    // Checked before the body is read: a 429 or a 502 answers HTML, and parsing
    // it would report "the response is unreadable" for a service that told us
    // exactly what was wrong.
    if (!response.ok) {
      return { state: "http-error", status: response.status };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      // The signal can fire *between* the headers and the end of the body: the
      // response started, it never finished. That is still "we gave up waiting",
      // and the advice owed to the author is « attends », not « réessaie » —
      // which is what calling a half-read body malformed would have said.
      return isTimeout(cause)
        ? { state: "timeout", timeoutMs }
        : { state: "malformed", reason: errorMessage(cause) };
    }

    const parsed = GeocodingResponseSchema.safeParse(body);
    if (!parsed.success) {
      return {
        state: "malformed",
        reason: parsed.error.issues[0]?.message ?? "réponse inattendue",
      };
    }

    const candidates = parsed.data.results ?? [];

    return candidates.length === 0 ? { state: "no-match" } : { state: "candidates", candidates };
  };
}
