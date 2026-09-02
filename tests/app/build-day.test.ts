import { describe, expect, it } from "vitest";
import { buildDayFrom } from "@/app/build-day";

/**
 * The one clock read of the whole render path, and the reason it is a pure
 * function with two arguments rather than a `new Date()` inline.
 *
 * Everything else about freshness is testable because *this* is injectable:
 * `tests/domain/freshness.test.ts` stands on any day it likes because
 * `freshestTrip` takes `today`, and this module is what turns a real build into
 * that value. `docs/fraicheur-au-prerendu.md` records what its granularity costs.
 */

const at = (iso: string) => new Date(iso);

describe("the build day", () => {
  it("is the UTC calendar day of the moment the build ran", () => {
    expect(buildDayFrom({}, at("2026-03-01T12:00:00Z"))).toBe("2026-03-01");
  });

  /**
   * **UTC, and never the build machine's zone.** Both rows below are a day the
   * local calendar disagrees about, in the two directions: at 23:30 UTC it is
   * already the 2nd in Paris and Tokyo, and at 00:30 UTC it is still the 28th in
   * Santiago. A `toLocaleDateString` here would put the build machine's timezone
   * into published HTML — the exact trap `src/components/timeline/dates.ts` and
   * `src/domain/geo.ts` both record, and one that shifts a badge's expiry by a
   * day for a whole hemisphere.
   */
  it.each([
    { instant: "2026-03-01T23:30:00Z", day: "2026-03-01", label: "already tomorrow east of UTC" },
    { instant: "2026-03-01T00:30:00Z", day: "2026-03-01", label: "still yesterday west of it" },
  ])("reads $instant as $day — $label", ({ instant, day }) => {
    expect(buildDayFrom({}, at(instant))).toBe(day);
  });

  /**
   * The override the suites and the E2E configs steer freshness with. Without it
   * every rendered assertion about the badge would be a function of the day the
   * test happens to run, which is the definition of a flaky suite.
   */
  it("prefers an explicit TIW_BUILD_DATE over the clock", () => {
    expect(buildDayFrom({ TIW_BUILD_DATE: "2020-01-02" }, at("2026-03-01T12:00:00Z"))).toBe(
      "2020-01-02"
    );
  });

  /**
   * Blank is absent — the shape a CI form produces, and the same reading
   * `src/app/site-url.ts` and `src/content/loader.ts` already give an empty
   * variable. Without it, `TIW_BUILD_DATE=""` freezes the site's clock on the
   * empty string and nothing is ever fresh again.
   */
  it.each(["", "   "])("treats %o as unset and falls back to the clock", (value) => {
    expect(buildDayFrom({ TIW_BUILD_DATE: value }, at("2026-03-01T12:00:00Z"))).toBe("2026-03-01");
  });

  /**
   * **Throws rather than falling back**, the decision `siteUrlFrom` takes for the
   * same class of value and for the same reason: a mistyped override silently
   * replaced by the real clock is a build whose freshness nobody can reason
   * about, with a green exit code. `new Date()` accepts far too much — `"2026-2"`
   * parses — so the check is `PlainDateSchema`'s own calendar rule, not a parse.
   */
  it.each(["2026-3-1", "01/03/2026", "2026-02-30", "demain", "2026-03-01T12:00:00Z"])(
    "refuses the unusable override %o, naming it",
    (value) => {
      expect(() => buildDayFrom({ TIW_BUILD_DATE: value }, at("2026-03-01T12:00:00Z"))).toThrow(
        /TIW_BUILD_DATE/
      );
      expect(() => buildDayFrom({ TIW_BUILD_DATE: value }, at("2026-03-01T12:00:00Z"))).toThrow(
        new RegExp(value.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"))
      );
    }
  );

  /** A clock that answers `Invalid Date` is a broken build, not a day. */
  it("refuses an unusable clock rather than writing NaN into the page", () => {
    expect(() => buildDayFrom({}, new Date("nope"))).toThrow(/horloge/i);
  });
});
