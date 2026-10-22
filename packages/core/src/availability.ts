import { addDays, formatTime, parseTime, todayIn, weekdayOf, zonedTimeToInstant } from "./time.ts";

/** A block of opening hours on a weekday (0 = Sunday), as wall-clock "HH:MM" times. */
export type WeeklyRange = { weekday: number; start: string; end: string };

export type Interval = { start: number; end: number };

/**
 * Everything needed to know when one bookable resource is free.
 * A business without professionals has a single schedule with `resourceId: null`.
 */
export type ResourceSchedule = {
  resourceId: string | null;
  hours: readonly WeeklyRange[];
  /** Dates ("YYYY-MM-DD") when this resource takes no bookings: holidays, days off. */
  closedDates: ReadonlySet<string>;
  /** Existing appointments and other blocked times, as instants. */
  busy: readonly Interval[];
};

export type BookingRules = {
  timeZone: string;
  /** Minutes between possible start times, counted from the start of each opening range. */
  slotIntervalMin: number;
  /** How long before the appointment customers must book. */
  minNoticeMin: number;
  /** How many days ahead customers can book. */
  maxAdvanceDays: number;
};

export type Slot = {
  /** Wall-clock start time in the business's time zone. */
  time: string;
  start: number;
  end: number;
  /** Resources free for the whole slot. */
  resourceIds: (string | null)[];
};

const MINUTE = 60_000;

/** Free start times on one date for a service lasting `durationMin`. */
export function slotsForDate(
  date: string,
  durationMin: number,
  schedules: readonly ResourceSchedule[],
  rules: BookingRules,
  now: number,
): Slot[] {
  const today = todayIn(rules.timeZone, now);
  if (date < today || date > addDays(today, rules.maxAdvanceDays)) return [];

  const earliestStart = now + rules.minNoticeMin * MINUTE;
  const weekday = weekdayOf(date);
  const byTime = new Map<string, Slot>();

  for (const schedule of schedules) {
    if (schedule.closedDates.has(date)) continue;
    for (const range of schedule.hours) {
      if (range.weekday !== weekday) continue;
      const rangeEnd = parseTime(range.end);
      for (
        let minute = parseTime(range.start);
        minute + durationMin <= rangeEnd;
        minute += rules.slotIntervalMin
      ) {
        const start = zonedTimeToInstant(date, minute, rules.timeZone);
        const end = start + durationMin * MINUTE;
        if (start < earliestStart) continue;
        if (schedule.busy.some((busy) => start < busy.end && end > busy.start)) continue;

        const time = formatTime(minute);
        const slot = byTime.get(time) ?? { time, start, end, resourceIds: [] };
        if (!slot.resourceIds.includes(schedule.resourceId)) {
          slot.resourceIds.push(schedule.resourceId);
        }
        byTime.set(time, slot);
      }
    }
  }

  return [...byTime.values()].sort((a, b) => a.start - b.start);
}

/** Free slots for every date in [from, to], keyed by date. Dates without slots are omitted. */
export function slotsBetween(
  from: string,
  to: string,
  durationMin: number,
  schedules: readonly ResourceSchedule[],
  rules: BookingRules,
  now: number,
): Record<string, Slot[]> {
  const result: Record<string, Slot[]> = {};
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const slots = slotsForDate(date, durationMin, schedules, rules, now);
    if (slots.length > 0) result[date] = slots;
  }
  return result;
}

/** Free start times for every date in [from, to], keyed by date. Dates without slots are omitted. */
export function availabilityBetween(
  from: string,
  to: string,
  durationMin: number,
  schedules: readonly ResourceSchedule[],
  rules: BookingRules,
  now: number,
): Record<string, string[]> {
  const slots = slotsBetween(from, to, durationMin, schedules, rules, now);
  return Object.fromEntries(
    Object.entries(slots).map(([date, list]) => [date, list.map((slot) => slot.time)]),
  );
}

/** Checks that ranges are well formed and do not overlap on the same weekday. */
export function hoursProblem(hours: readonly WeeklyRange[]): "end_before_start" | "overlap" | null {
  const byDay = new Map<number, WeeklyRange[]>();
  for (const range of hours) {
    if (parseTime(range.end) <= parseTime(range.start)) return "end_before_start";
    byDay.set(range.weekday, [...(byDay.get(range.weekday) ?? []), range]);
  }
  for (const ranges of byDay.values()) {
    const sorted = [...ranges].sort((a, b) => parseTime(a.start) - parseTime(b.start));
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous && current && parseTime(current.start) < parseTime(previous.end)) {
        return "overlap";
      }
    }
  }
  return null;
}
