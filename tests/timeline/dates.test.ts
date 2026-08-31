import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatDayRange,
  formatDayWithoutYear,
  machineDate,
  yearOf,
} from "@/components/timeline/dates";

/**
 * **Every row here is also a timezone assertion.** A `PlainDate` is a calendar
 * day, and `new Date("2024-04-12")` is midnight *UTC* — so an implementation
 * that formats it in the machine's own zone prints 11 April everywhere west of
 * Greenwich, at build time, into static HTML.
 *
 * That failure is invisible on a European workstation and on a UTC CI runner,
 * which is exactly what makes it worth pinning. These rows must not move when
 * the suite is run as:
 *
 *     TZ=America/Santiago npx vitest run tests/timeline/dates.test.ts
 *     TZ=Pacific/Auckland npx vitest run tests/timeline/dates.test.ts
 *
 * The same guard, and the same two zones, as `durationOf` in
 * `tests/domain/trip.test.ts`.
 */

describe("formatDay", () => {
  it.each([
    { date: "2024-04-12", expected: "12 avril 2024" },
    { date: "2024-01-01", expected: "1 janvier 2024" },
    { date: "2024-12-31", expected: "31 décembre 2024" },
    { date: "2024-02-29", expected: "29 février 2024" },
    { date: "2022-07-01", expected: "1 juillet 2022" },
  ])("formats $date in French", ({ date, expected }) => {
    expect(formatDay(date, "fr")).toBe(expected);
  });

  /**
   * The first day of the month is the sharpest probe there is: a one-day
   * backwards shift moves it into the previous *month*, so a broken
   * implementation prints "31 mars" rather than a neighbouring number.
   */
  it("does not slip into the previous month on the first of the month", () => {
    expect(formatDay("2024-03-01", "fr")).toBe("1 mars 2024");
    expect(formatDay("2024-01-01", "fr")).toContain("2024");
  });
});

describe("formatDayWithoutYear", () => {
  it("drops the year", () => {
    expect(formatDayWithoutYear("2024-04-12", "fr")).toBe("12 avril");
    expect(formatDayWithoutYear("2024-04-12", "fr")).not.toContain("2024");
  });
});

describe("yearOf", () => {
  it.each([
    { date: "2024-04-12", year: "2024" },
    { date: "1999-12-31", year: "1999" },
  ])("reads $year from $date without formatting it", ({ date, year }) => {
    expect(yearOf(date)).toBe(year);
  });
});

describe("formatDayRange", () => {
  /** Within one year the leading year is noise: it is already in the end date,
   * and repeating it makes the two dates harder to compare at a glance. */
  it("elides the year on the first date when both share it", () => {
    expect(formatDayRange("2024-04-12", "2024-04-28", "fr")).toEqual({
      start: "12 avril",
      end: "28 avril 2024",
    });
  });

  /**
   * A trip across New Year keeps both years. Without this, "28 décembre —
   * 3 janvier 2025" reads as a trip that travels backwards in time.
   */
  it("keeps both years when the range crosses one", () => {
    expect(formatDayRange("2024-12-28", "2025-01-03", "fr")).toEqual({
      start: "28 décembre 2024",
      end: "3 janvier 2025",
    });
  });

  it("handles a range of one day", () => {
    expect(formatDayRange("2024-06-01", "2024-06-01", "fr")).toEqual({
      start: "1 juin",
      end: "1 juin 2024",
    });
  });
});

describe("machineDate", () => {
  /**
   * `<time dateTime>` takes the HTML "date" microsyntax, which `PlainDate`
   * already is. The assertion is that nothing is *added* — a formatted string
   * here would make the machine-readable half of every date unparseable.
   */
  it.each(["2024-04-12", "2022-07-01", "2025-12-31"])("passes %s through unchanged", (date) => {
    expect(machineDate(date)).toBe(date);
    expect(machineDate(date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
