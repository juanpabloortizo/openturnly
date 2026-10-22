import { addDays } from "@openturnly/core";
import Holidays from "date-holidays";
import type { Business } from "../db/schema.ts";

/**
 * Public holidays come from the date-holidays library (data: CC-BY-3.0), computed on the
 * fly for any year, so nothing has to be imported or refreshed.
 */

let countryByTimeZone: Map<string, string> | null = null;

/** "America/Bogota" → "CO". Built once from the library's own time zone data. */
export function countryForTimeZone(timeZone: string): string | null {
  if (!countryByTimeZone) {
    countryByTimeZone = new Map();
    for (const code of Object.keys(new Holidays().getCountries())) {
      for (const zone of new Holidays(code).getTimezones() ?? []) {
        if (!countryByTimeZone.has(zone)) countryByTimeZone.set(zone, code);
      }
    }
  }
  return countryByTimeZone.get(timeZone) ?? null;
}

/**
 * The business's country always follows its time zone, so the holidays can never belong
 * to a different place than the appointment times. Null for zones like "UTC".
 */
export function businessCountry(business: Pick<Business, "timezone">): string | null {
  return countryForTimeZone(business.timezone);
}

/** Every time zone that belongs to a country, for the time zone picker. */
export function timeZoneCountries(): Record<string, string> {
  countryForTimeZone("UTC");
  return Object.fromEntries(countryByTimeZone ?? []);
}

export type Holiday = { date: string; name: string };

/** Public (non-optional) holidays between two dates, inclusive, one per date. */
export function holidaysBetween(
  country: string,
  from: string,
  to: string,
  language = "en",
): Holiday[] {
  const calendar = new Holidays(country, { types: ["public"] });
  const byDate = new Map<string, string>();
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    for (const holiday of calendar.getHolidays(year, language) ?? []) {
      const date = holiday.date.slice(0, 10);
      if (holiday.type === "public" && date >= from && date <= to && !byDate.has(date)) {
        byDate.set(date, holiday.name);
      }
    }
  }
  return [...byDate]
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Holiday dates the business is closed on: every public holiday when `closedOnHolidays`
 * is on, minus the ones it decided to open (and the reverse when it is off).
 */
export function closedHolidayDates(
  business: Business,
  overrides: ReadonlySet<string>,
  from: string,
  to: string,
): string[] {
  const country = businessCountry(business);
  if (!country) return [];
  return holidaysBetween(country, from, to)
    .map((holiday) => holiday.date)
    .filter((date) => business.closedOnHolidays !== overrides.has(date));
}

/** One year of holidays starting today, for the settings screen. */
export function upcomingHolidays(country: string, today: string, language: string) {
  return holidaysBetween(country, today, addDays(today, 365), language);
}
