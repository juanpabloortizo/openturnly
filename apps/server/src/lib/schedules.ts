import { addDays, type BookingRules, type ResourceSchedule } from "@openturnly/core";
import { and, eq, gt, gte, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  appointments,
  type Business,
  closures,
  holidayOverrides,
  resourceServices,
  resources,
  weeklyHours,
} from "../db/schema.ts";
import { closedHolidayDates } from "./holidays.ts";

/** Either the database or an open transaction: both run the same queries. */
export type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export function bookingRules(business: Business): BookingRules {
  return {
    timeZone: business.timezone,
    slotIntervalMin: business.slotIntervalMin,
    minNoticeMin: business.minNoticeMin,
    maxAdvanceDays: business.maxAdvanceDays,
  };
}

/**
 * Builds the schedules the availability engine needs for one service between two dates.
 * With `resourceId` null it includes every professional offering the service ("anyone").
 * A business without professionals gets one schedule (`resourceId: null`) on its own hours.
 */
export async function loadSchedules(
  db: Queryable,
  business: Business,
  serviceId: string,
  resourceId: string | null,
  fromDate: string,
  toDate: string,
  /** An appointment being moved: its own time doesn't count as busy. */
  ignoreAppointmentId?: string,
): Promise<ResourceSchedule[]> {
  const activeResources = await db
    .select({ id: resources.id })
    .from(resources)
    .where(and(eq(resources.businessId, business.id), eq(resources.active, true)));

  let candidates: (string | null)[];
  if (activeResources.length === 0) {
    candidates = resourceId === null ? [null] : [];
  } else {
    const offering = (
      await db
        .select({ id: resourceServices.resourceId })
        .from(resourceServices)
        .where(
          and(
            eq(resourceServices.serviceId, serviceId),
            inArray(
              resourceServices.resourceId,
              activeResources.map((resource) => resource.id),
            ),
          ),
        )
    ).map((row) => row.id);
    candidates = resourceId === null ? offering : offering.filter((id) => id === resourceId);
  }
  if (candidates.length === 0) return [];

  const hours = await db.select().from(weeklyHours).where(eq(weeklyHours.businessId, business.id));
  const businessHours = hours.filter((range) => range.resourceId === null);

  const closedRows = (
    await db
      .select({ date: closures.date, endDate: closures.endDate, resourceId: closures.resourceId })
      .from(closures)
      .where(
        and(
          eq(closures.businessId, business.id),
          gte(closures.endDate, fromDate),
          lte(closures.date, toDate),
        ),
      )
  ).flatMap((row) => {
    // One entry per closed day inside the requested window.
    const days: { date: string; resourceId: string | null }[] = [];
    const last = row.endDate < toDate ? row.endDate : toDate;
    for (let day = row.date < fromDate ? fromDate : row.date; day <= last; day = addDays(day, 1)) {
      days.push({ date: day, resourceId: row.resourceId });
    }
    return days;
  });

  const overrides = await db
    .select({ date: holidayOverrides.date })
    .from(holidayOverrides)
    .where(
      and(
        eq(holidayOverrides.businessId, business.id),
        gte(holidayOverrides.date, fromDate),
        lte(holidayOverrides.date, toDate),
      ),
    );
  const holidays = closedHolidayDates(
    business,
    new Set(overrides.map((row) => row.date)),
    fromDate,
    toDate,
  );

  // Wide window on purpose: time zones can shift a date by up to a day either way.
  const windowStart = new Date(`${addDays(fromDate, -1)}T00:00:00Z`);
  const windowEnd = new Date(`${addDays(toDate, 2)}T00:00:00Z`);
  const booked = await db
    .select({
      resourceId: appointments.resourceId,
      start: appointments.startsAt,
      end: appointments.endsAt,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, business.id),
        eq(appointments.status, "confirmed"),
        lt(appointments.startsAt, windowEnd),
        gt(appointments.endsAt, windowStart),
        ignoreAppointmentId ? ne(appointments.id, ignoreAppointmentId) : undefined,
        candidates.includes(null)
          ? undefined
          : or(
              isNull(appointments.resourceId),
              inArray(appointments.resourceId, candidates as string[]),
            ),
      ),
    );

  return candidates.map((candidate) => {
    const own = hours.filter((range) => candidate !== null && range.resourceId === candidate);
    return {
      resourceId: candidate,
      hours: own.length > 0 ? own : businessHours,
      closedDates: new Set([
        ...holidays,
        ...closedRows
          .filter((row) => row.resourceId === null || row.resourceId === candidate)
          .map((row) => row.date),
      ]),
      busy: booked
        .filter((row) => candidate === null || row.resourceId === candidate)
        .map((row) => ({ start: row.start.getTime(), end: row.end.getTime() })),
    };
  });
}

/** For "anyone available", spread the work: the professional with the fewest bookings that day. */
export function pickLeastBusy(
  candidates: (string | null)[],
  schedules: ResourceSchedule[],
  slotStart: number,
): string | null {
  const dayStart = slotStart - 12 * 60 * 60_000;
  const dayEnd = slotStart + 12 * 60 * 60_000;
  let best: string | null = candidates[0] ?? null;
  let bestLoad = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const schedule = schedules.find((s) => s.resourceId === candidate);
    const load =
      schedule?.busy.filter((busy) => busy.start >= dayStart && busy.start < dayEnd).length ?? 0;
    if (load < bestLoad) {
      best = candidate;
      bestLoad = load;
    }
  }
  return best;
}
