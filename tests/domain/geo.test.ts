import { describe, expect, it } from "vitest";
import { CoordinatesSchema, CountryCodeSchema, PlainDateSchema, SlugSchema } from "@/domain/geo";
import { attempt } from "./fixtures";

/**
 * The primitives every other schema is built on. Each block below pins one
 * decision that has a wrong answer able to ship silently: a slug that produces
 * two different URLs for the same place, a country code that never matches a
 * map feature, a coordinate pair that lands a marker in the Gulf of Guinea, a
 * date that shifts by one day depending on where the build runs.
 */

describe("SlugSchema", () => {
  it.each([
    "Paris",
    "PARIS",
    "paris_france",
    "café",
    "saint-étienne",
    "paris--france",
    "-paris",
    "paris-",
    "paris france",
    "paris/france",
    "paris.france",
    "",
  ])("rejects %o, which is not a lowercase hyphen-joined slug", (candidate) => {
    expect(attempt(SlugSchema, candidate).accepted).toBe(false);
  });

  it.each(["paris", "lyon-part-dieu", "japon-2024", "sao-tome-et-principe", "a", "2024"])(
    "accepts %o",
    (candidate) => {
      expect(attempt(SlugSchema, candidate).accepted).toBe(true);
    }
  );

  it.each([42, null, undefined, ["paris"], { slug: "paris" }])(
    "rejects the non-string %o rather than coercing it",
    (candidate) => {
      expect(attempt(SlugSchema, candidate).accepted).toBe(false);
    }
  );
});

describe("CountryCodeSchema", () => {
  it.each(["fr", "Fr", "fR", "FRA", "F", "F1", "12", "FR ", " FR", "", "FR-BFC"])(
    "rejects %o, which is not an ISO 3166-1 alpha-2 code",
    (candidate) => {
      expect(attempt(CountryCodeSchema, candidate).accepted).toBe(false);
    }
  );

  it.each(["FR", "JP", "TH", "ST"])("accepts %o", (candidate) => {
    expect(attempt(CountryCodeSchema, candidate).accepted).toBe(true);
  });
});

describe("CoordinatesSchema", () => {
  it.each([
    { label: "latitude 91", value: { lat: 91, lon: 0 } },
    { label: "latitude -91", value: { lat: -91, lon: 0 } },
    { label: "longitude 181", value: { lat: 0, lon: 181 } },
    { label: "longitude -181", value: { lat: 0, lon: -181 } },
    { label: "both out of range", value: { lat: 91, lon: -181 } },
  ])("rejects $label", ({ value }) => {
    expect(attempt(CoordinatesSchema, value).accepted).toBe(false);
  });

  it.each([
    { label: "the north pole", value: { lat: 90, lon: 0 } },
    { label: "the south pole", value: { lat: -90, lon: 0 } },
    { label: "the antimeridian, east side", value: { lat: 0, lon: 180 } },
    { label: "the antimeridian, west side", value: { lat: 0, lon: -180 } },
  ])("accepts $label, exactly on the boundary", ({ value }) => {
    expect(attempt(CoordinatesSchema, value).accepted).toBe(true);
  });

  /**
   * Null Island. (0, 0) is what a failed geocoding returns, not a place — every
   * "0" in the pipeline (a missing YAML key, a parsed empty string, a provider
   * returning no match) collapses there, and the only visible symptom is a
   * marker floating off the coast of Ghana.
   */
  it("rejects exactly (0, 0), and says why", () => {
    const outcome = attempt(CoordinatesSchema, { lat: 0, lon: 0 });

    expect(outcome.accepted).toBe(false);
    expect(outcome.errors).toMatch(/geocod/i);
  });

  /**
   * The other half of the same invariant, and the one that catches a guard
   * written with `||`: São Tomé, a point on the equator, and a point on the
   * prime meridian are all real places.
   */
  it.each([
    { label: "São Tomé", value: { lat: 0.5, lon: 6.6 } },
    { label: "a point on the equator", value: { lat: 0, lon: 6.6 } },
    { label: "a point on the prime meridian", value: { lat: 0.5, lon: 0 } },
    { label: "a point just south-west of the origin", value: { lat: -0.1, lon: -0.1 } },
  ])("accepts $label, close to the origin but not on it", ({ value }) => {
    expect(attempt(CoordinatesSchema, value).accepted).toBe(true);
  });

  it.each([
    { label: "NaN latitude", value: { lat: Number.NaN, lon: 2.3522 } },
    { label: "infinite longitude", value: { lat: 48.8566, lon: Number.POSITIVE_INFINITY } },
    { label: "negative infinite latitude", value: { lat: Number.NEGATIVE_INFINITY, lon: 2.3522 } },
  ])("rejects $label", ({ value }) => {
    expect(attempt(CoordinatesSchema, value).accepted).toBe(false);
  });

  /**
   * A YAML scalar quoted by accident (`lat: "48.8566"`) must be an error, not a
   * silent coercion: coercion would make the same content file valid with two
   * different meanings depending on the quoting.
   */
  it("rejects numeric strings instead of coercing them", () => {
    expect(attempt(CoordinatesSchema, { lat: "48.8566", lon: "2.3522" }).accepted).toBe(false);
  });

  it.each([
    { label: "a missing longitude", value: { lat: 48.8566 } },
    { label: "a missing latitude", value: { lon: 2.3522 } },
    { label: "an empty object", value: {} },
    { label: "a [lat, lon] tuple", value: [48.8566, 2.3522] },
  ])("rejects $label", ({ value }) => {
    expect(attempt(CoordinatesSchema, value).accepted).toBe(false);
  });
});

describe("PlainDateSchema", () => {
  /**
   * Deliberate refusal, and the reason the type is called a *plain* date. A
   * `Date` is an instant, not a calendar day: `new Date("2024-04-12")` is
   * midnight UTC, which is 2024-04-11 at 21:00 in São Paulo, so any local-time
   * formatting of it prints the day before. The domain never holds one.
   */
  it("rejects a JavaScript Date, whose day depends on the reader's timezone", () => {
    expect(attempt(PlainDateSchema, new Date("2024-04-12")).accepted).toBe(false);
    expect(attempt(PlainDateSchema, new Date(2024, 3, 12)).accepted).toBe(false);
  });

  it.each([
    "2024-4-12",
    "2024-04-2",
    "12/04/2024",
    "04-12-2024",
    "20240412",
    "2024-04-12T00:00:00Z",
    "2024-04-12 ",
    " 2024-04-12",
    "2024-04",
    "",
    "aujourd'hui",
  ])("rejects %o, which is not an AAAA-MM-JJ string", (candidate) => {
    expect(attempt(PlainDateSchema, candidate).accepted).toBe(false);
  });

  /**
   * Well-formed and still impossible. A regex-only check accepts every one of
   * these, and the error surfaces months later as a duration off by a few days.
   */
  it.each(["2024-02-30", "2025-13-01", "2024-00-10", "2024-04-31", "2023-02-29", "2024-06-00"])(
    "rejects %o, which is not a date on the calendar",
    (candidate) => {
      expect(attempt(PlainDateSchema, candidate).accepted).toBe(false);
    }
  );

  it.each(["2024-04-12", "2024-02-29", "2000-02-29", "2024-12-31", "2024-01-01", "1970-01-01"])(
    "accepts %o",
    (candidate) => {
      expect(attempt(PlainDateSchema, candidate).accepted).toBe(true);
    }
  );

  it.each([20240412, null, undefined, { year: 2024 }])("rejects the non-string %o", (candidate) => {
    expect(attempt(PlainDateSchema, candidate).accepted).toBe(false);
  });
});
