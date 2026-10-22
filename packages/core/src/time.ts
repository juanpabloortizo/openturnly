/**
 * Date and time helpers that work without a date library.
 *
 * - A calendar date is a "YYYY-MM-DD" string, with no time zone attached.
 * - A time of day is "HH:MM", or minutes since midnight when doing math.
 * - An instant is milliseconds since the epoch (UTC).
 *
 * Opening hours are wall-clock times in the business's IANA time zone; they become
 * instants only when a specific date is known, which keeps daylight-saving changes right.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isTimeString(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/** "09:30" → 570 */
export function parseTime(time: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

/** 570 → "09:30" */
export function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, like Date#getDay. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(instant: number, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

/** How far the zone's wall clock is ahead of UTC at that instant, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallClockAsUtc - (instant - (instant % 1000));
}

/** The instant when the wall clock in `timeZone` shows `date` at `minutes` past midnight. */
export function zonedTimeToInstant(date: string, minutes: number, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const wallClockAsUtc = Date.UTC(year, month - 1, day, 0, minutes);
  const firstGuess = wallClockAsUtc - offsetAt(wallClockAsUtc, timeZone);
  // Re-check with the offset at the guessed instant, in case a DST change sits between.
  return wallClockAsUtc - offsetAt(firstGuess, timeZone);
}

/** Calendar date and time of day that an instant shows in `timeZone`. */
export function instantToZoned(instant: number, timeZone: string) {
  const p = partsIn(instant, timeZone);
  const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { date, time: formatTime(p.hour * 60 + p.minute) };
}

export function todayIn(timeZone: string, now: number = Date.now()): string {
  return instantToZoned(now, timeZone).date;
}

/**
 * "9" → "09:00", "930" → "09:30", "17:5" → "17:05". Null when it can't be a time of day.
 */
export function parseTimeInput(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/[.h]/gi, ":")
    .replace(/[^\d:]/g, "");
  let hours: string;
  let minutes: string;
  if (cleaned.includes(":")) {
    [hours = "", minutes = ""] = cleaned.split(":");
  } else if (cleaned.length <= 2) {
    [hours, minutes] = [cleaned, "0"];
  } else {
    [hours, minutes] = [cleaned.slice(0, -2), cleaned.slice(-2)];
  }
  const h = Number(hours);
  const m = Number(minutes || "0");
  if (hours === "" || !Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
