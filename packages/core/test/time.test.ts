import { describe, expect, it } from "vitest";
import {
  addDays,
  instantToZoned,
  isDateString,
  todayIn,
  weekdayOf,
  zonedTimeToInstant,
} from "../src/time.ts";

describe("calendar dates", () => {
  it("validates real dates only", () => {
    expect(isDateString("2026-02-28")).toBe(true);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026-2-3")).toBe(false);
  });

  it("adds days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows the weekday", () => {
    expect(weekdayOf("2026-10-24")).toBe(6); // Saturday
    expect(weekdayOf("2026-10-25")).toBe(0); // Sunday
  });
});

describe("time zones", () => {
  it("turns wall-clock times into instants", () => {
    // Bogotá is UTC-5 all year.
    expect(new Date(zonedTimeToInstant("2026-10-24", 9 * 60, "America/Bogota")).toISOString()).toBe(
      "2026-10-24T14:00:00.000Z",
    );
  });

  it("handles daylight saving time changes", () => {
    // New York: EDT (UTC-4) before Nov 1 2026, EST (UTC-5) after.
    const before = zonedTimeToInstant("2026-10-31", 10 * 60, "America/New_York");
    const after = zonedTimeToInstant("2026-11-02", 10 * 60, "America/New_York");
    expect(new Date(before).toISOString()).toBe("2026-10-31T14:00:00.000Z");
    expect(new Date(after).toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });

  it("goes back from instants to wall-clock time", () => {
    const instant = Date.parse("2026-10-25T03:30:00Z");
    expect(instantToZoned(instant, "America/Bogota")).toEqual({
      date: "2026-10-24",
      time: "22:30",
    });
    expect(todayIn("America/Bogota", instant)).toBe("2026-10-24");
  });
});

describe("times typed by hand", () => {
  it("accepts the usual shortcuts", async () => {
    const { parseTimeInput } = await import("../src/time.ts");
    expect(parseTimeInput("9")).toBe("09:00");
    expect(parseTimeInput("930")).toBe("09:30");
    expect(parseTimeInput("1730")).toBe("17:30");
    expect(parseTimeInput("17:5")).toBe("17:05");
    expect(parseTimeInput(" 8.15 ")).toBe("08:15");
    expect(parseTimeInput("25:00")).toBeNull();
    expect(parseTimeInput("abc")).toBeNull();
  });
});
