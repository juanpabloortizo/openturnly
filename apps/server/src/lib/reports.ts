import {
  addDays,
  instantToZoned,
  parseTime,
  todayIn,
  weekdayOf,
  zonedTimeToInstant,
} from "@openturnly/core";
import { and, asc, count, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import {
  appointments,
  type Business,
  closures,
  customers,
  holidayOverrides,
  locations,
  resourceLocations,
  resources,
  saleItems,
  sales,
  saleTips,
  weeklyHours,
} from "../db/schema.ts";
import { closedHolidayDates } from "./holidays.ts";
import type { Queryable } from "./schedules.ts";

/** A period of whole days in the business's time zone, both included. */
export type Period = { from: string; to: string };

const instants = (business: Business, period: Period) => ({
  start: new Date(zonedTimeToInstant(period.from, 0, business.timezone)),
  end: new Date(zonedTimeToInstant(addDays(period.to, 1), 0, business.timezone)),
});

/** The period of the same length just before, to compare with. */
export function previousPeriod(period: Period): Period {
  const days =
    (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000 +
    1;
  return { from: addDays(period.from, -days), to: addDays(period.from, -1) };
}

/**
 * Minutes the team could have worked in the period: each professional's hours at each
 * location they work at (or the location's hours when they have none there), less closures
 * and closed holidays. A location without professionals counts its own hours.
 */
async function openMinutes(db: Queryable, business: Business, period: Period, locationId?: string) {
  const places = (
    await db
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.businessId, business.id),
          eq(locations.active, true),
          locationId ? eq(locations.id, locationId) : undefined,
        ),
      )
  ).map((row) => row.id);
  if (places.length === 0) return 0;
  const [hours, staffed, closed, overrides] = await Promise.all([
    db.select().from(weeklyHours).where(inArray(weeklyHours.locationId, places)),
    db
      .select({
        resourceId: resourceLocations.resourceId,
        locationId: resourceLocations.locationId,
      })
      .from(resourceLocations)
      .innerJoin(resources, eq(resources.id, resourceLocations.resourceId))
      .where(and(inArray(resourceLocations.locationId, places), eq(resources.active, true))),
    db
      .select()
      .from(closures)
      .where(
        and(
          eq(closures.businessId, business.id),
          lte(closures.date, period.to),
          gte(closures.endDate, period.from),
        ),
      ),
    db
      .select({ date: holidayOverrides.date })
      .from(holidayOverrides)
      .where(eq(holidayOverrides.businessId, business.id)),
  ]);
  const holidays = new Set(
    closedHolidayDates(business, new Set(overrides.map((row) => row.date)), period.from, period.to),
  );
  const closedOn = (date: string, place: string, resourceId: string | null) =>
    holidays.has(date) ||
    closed.some(
      (closure) =>
        closure.date <= date &&
        closure.endDate >= date &&
        (closure.resourceId
          ? closure.resourceId === resourceId
          : closure.locationId === null || closure.locationId === place),
    );
  const minutes = (ranges: typeof hours, weekday: number) =>
    ranges
      .filter((range) => range.weekday === weekday)
      .reduce((sum, range) => sum + parseTime(range.end) - parseTime(range.start), 0);

  let total = 0;
  for (let date = period.from; date <= period.to; date = addDays(date, 1)) {
    const weekday = weekdayOf(date);
    for (const place of places) {
      const own = hours.filter((range) => range.locationId === place);
      const placeHours = own.filter((range) => range.resourceId === null);
      const team = staffed.filter((link) => link.locationId === place).map((l) => l.resourceId);
      if (team.length === 0) {
        if (!closedOn(date, place, null)) total += minutes(placeHours, weekday);
        continue;
      }
      for (const person of team) {
        if (closedOn(date, place, person)) continue;
        const theirs = own.filter((range) => range.resourceId === person);
        total += minutes(theirs.length > 0 ? theirs : placeHours, weekday);
      }
    }
  }
  return total;
}

/** The headline figures of a period: bookings, occupancy, new customers and sales. */
async function figures(db: Queryable, business: Business, period: Period, locationId?: string) {
  const { start, end } = instants(business, period);
  const booked = and(
    eq(appointments.businessId, business.id),
    eq(appointments.status, "confirmed"),
    gte(appointments.startsAt, start),
    lt(appointments.startsAt, end),
    locationId ? eq(appointments.locationId, locationId) : undefined,
  );
  const [bookings] = await db
    .select({
      total: count(),
      minutes:
        sql<number>`coalesce(sum(extract(epoch from (${appointments.endsAt} - ${appointments.startsAt})) / 60), 0)`.mapWith(
          Number,
        ),
    })
    .from(appointments)
    .where(booked);
  const [newCustomers] = await db
    .select({ total: count() })
    .from(customers)
    .where(
      and(
        eq(customers.businessId, business.id),
        gte(customers.createdAt, start),
        lt(customers.createdAt, end),
      ),
    );
  const [billed] = await db
    .select({ total: sql<number>`coalesce(sum(${sales.total}), 0)`.mapWith(Number) })
    .from(sales)
    .where(
      and(
        eq(sales.businessId, business.id),
        eq(sales.status, "paid"),
        eq(sales.internal, false),
        gte(sales.createdAt, start),
        lt(sales.createdAt, end),
        locationId ? eq(sales.locationId, locationId) : undefined,
      ),
    );
  const open = await openMinutes(db, business, period, locationId);
  return {
    bookings: bookings?.total ?? 0,
    occupancy: open > 0 ? Math.min(1, (bookings?.minutes ?? 0) / open) : null,
    newCustomers: newCustomers?.total ?? 0,
    billed: billed?.total ?? 0,
  };
}

/**
 * The summary report: headline figures against the period before, where bookings came
 * from, what sold most, each professional's work and today's appointments.
 */
export async function summaryReport(
  db: Queryable,
  business: Business,
  period: Period,
  locationId?: string,
) {
  const { start, end } = instants(business, period);
  const [current, previous] = await Promise.all([
    figures(db, business, period, locationId),
    figures(db, business, previousPeriod(period), locationId),
  ]);
  const inPeriod = and(
    eq(appointments.businessId, business.id),
    eq(appointments.status, "confirmed"),
    gte(appointments.startsAt, start),
    lt(appointments.startsAt, end),
    locationId ? eq(appointments.locationId, locationId) : undefined,
  );
  const origin = await db
    .select({ source: appointments.source, total: count() })
    .from(appointments)
    .where(inPeriod)
    .groupBy(appointments.source);
  const paidSales = and(
    eq(sales.businessId, business.id),
    eq(sales.status, "paid"),
    gte(sales.createdAt, start),
    lt(sales.createdAt, end),
    locationId ? eq(sales.locationId, locationId) : undefined,
  );
  const topServices = await db
    .select({
      name: saleItems.name,
      quantity: sql<number>`sum(${saleItems.quantity})`.mapWith(Number),
      amount: sql<number>`sum(${saleItems.total})`.mapWith(Number),
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(and(paidSales, ne(saleItems.kind, "gift_card")))
    .groupBy(saleItems.name)
    .orderBy(sql`sum(${saleItems.total}) desc`)
    .limit(8);
  const byProfessional = await db
    .select({
      name: sql<string>`coalesce(${appointments.resourceName}, '')`,
      bookings: count(),
    })
    .from(appointments)
    .where(inPeriod)
    .groupBy(appointments.resourceName)
    .orderBy(sql`count(*) desc`);

  const today = todayIn(business.timezone);
  const todayStart = new Date(zonedTimeToInstant(today, 0, business.timezone));
  const todayEnd = new Date(zonedTimeToInstant(addDays(today, 1), 0, business.timezone));
  const todayRows = await db
    .select({
      id: appointments.id,
      code: appointments.code,
      startsAt: appointments.startsAt,
      serviceName: appointments.serviceName,
      resourceName: appointments.resourceName,
      locationName: locations.name,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .leftJoin(locations, eq(locations.id, appointments.locationId))
    .where(
      and(
        eq(appointments.businessId, business.id),
        eq(appointments.status, "confirmed"),
        gte(appointments.startsAt, todayStart),
        lt(appointments.startsAt, todayEnd),
        locationId ? eq(appointments.locationId, locationId) : undefined,
      ),
    )
    .orderBy(asc(appointments.startsAt));
  const paidToday = new Set(
    todayRows.length > 0
      ? (
          await db
            .select({ id: saleItems.appointmentId })
            .from(saleItems)
            .innerJoin(sales, eq(sales.id, saleItems.saleId))
            .where(
              and(
                inArray(
                  saleItems.appointmentId,
                  todayRows.map((row) => row.id),
                ),
                eq(sales.status, "paid"),
              ),
            )
        ).map((row) => row.id)
      : [],
  );

  return {
    period,
    previous: previousPeriod(period),
    current,
    before: previous,
    origin: Object.fromEntries(origin.map((row) => [row.source, row.total])),
    topServices,
    byProfessional,
    today: todayRows.map((row) => ({
      id: row.id,
      code: row.code,
      time: instantToZoned(row.startsAt.getTime(), business.timezone).time,
      service: row.serviceName,
      professional: row.resourceName,
      location: row.locationName,
      customer: `${row.firstName} ${row.lastName}`,
      paid: paidToday.has(row.id),
    })),
  };
}

/** Tips left in the period, with who got each and the totals per professional. */
export async function tipsReport(
  db: Queryable,
  business: Business,
  period: Period,
  filter: { locationId?: string; resourceId?: string },
) {
  const { start, end } = instants(business, period);
  const rows = await db
    .select({
      id: saleTips.id,
      amount: saleTips.amount,
      resourceId: saleTips.resourceId,
      resourceName: saleTips.resourceName,
      saleId: sales.id,
      number: sales.number,
      createdAt: sales.createdAt,
      locationName: locations.name,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(saleTips)
    .innerJoin(sales, eq(sales.id, saleTips.saleId))
    .leftJoin(locations, eq(locations.id, sales.locationId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(
      and(
        eq(sales.businessId, business.id),
        eq(sales.status, "paid"),
        gte(sales.createdAt, start),
        lt(sales.createdAt, end),
        filter.locationId ? eq(sales.locationId, filter.locationId) : undefined,
        filter.resourceId ? eq(saleTips.resourceId, filter.resourceId) : undefined,
      ),
    )
    .orderBy(sql`${sales.createdAt} desc`);
  const totals = new Map<string, { name: string; amount: number; count: number }>();
  for (const row of rows) {
    const entry = totals.get(row.resourceName) ?? { name: row.resourceName, amount: 0, count: 0 };
    entry.amount += row.amount;
    entry.count += 1;
    totals.set(row.resourceName, entry);
  }
  return {
    tips: rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      sale: { id: row.saleId, number: row.number },
      createdAt: row.createdAt,
      locationName: row.locationName,
      customer: row.firstName ? `${row.firstName} ${row.lastName}` : null,
    })),
    totals: [...totals.values()].sort((a, b) => b.amount - a.amount),
  };
}

/**
 * What each professional earned in the period: their percentage of the services and products
 * they did or sold (after each sale's discount, shared across its lines), plus their tips.
 */
export async function commissionsReport(
  db: Queryable,
  business: Business,
  period: Period,
  locationId?: string,
) {
  const { start, end } = instants(business, period);
  const sold = await db
    .select({
      id: sales.id,
      subtotal: sales.subtotal,
      total: sales.total,
    })
    .from(sales)
    .where(
      and(
        eq(sales.businessId, business.id),
        eq(sales.status, "paid"),
        gte(sales.createdAt, start),
        lt(sales.createdAt, end),
        locationId ? eq(sales.locationId, locationId) : undefined,
      ),
    );
  const ids = sold.map((sale) => sale.id);
  const [lines, tips, team] = await Promise.all([
    ids.length > 0
      ? db
          .select({
            saleId: saleItems.saleId,
            kind: saleItems.kind,
            resourceId: saleItems.resourceId,
            quantity: saleItems.quantity,
            total: saleItems.total,
          })
          .from(saleItems)
          .where(and(inArray(saleItems.saleId, ids), ne(saleItems.kind, "gift_card")))
      : [],
    ids.length > 0
      ? db
          .select({ resourceId: saleTips.resourceId, amount: saleTips.amount })
          .from(saleTips)
          .where(inArray(saleTips.saleId, ids))
      : [],
    db
      .select({
        id: resources.id,
        name: resources.name,
        serviceCommission: resources.serviceCommission,
        productCommission: resources.productCommission,
      })
      .from(resources)
      .where(eq(resources.businessId, business.id))
      .orderBy(asc(resources.position), asc(resources.name)),
  ]);
  // The sale's discount is shared across its lines by their weight.
  const share = new Map(
    sold.map((sale) => [sale.id, sale.subtotal > 0 ? sale.total / sale.subtotal : 0]),
  );
  return {
    professionals: team.map((person) => {
      const theirs = lines.filter((line) => line.resourceId === person.id);
      const base = (kind: string) =>
        Math.round(
          theirs
            .filter((line) => line.kind === kind)
            .reduce((sum, line) => sum + line.total * (share.get(line.saleId) ?? 0), 0),
        );
      const quantity = (kind: string) =>
        theirs.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.quantity, 0);
      const services = base("service");
      const products = base("product");
      const serviceCommission = Math.round((services * person.serviceCommission) / 100);
      const productCommission = Math.round((products * person.productCommission) / 100);
      const tipAmount = tips
        .filter((tip) => tip.resourceId === person.id)
        .reduce((sum, tip) => sum + tip.amount, 0);
      return {
        id: person.id,
        name: person.name,
        serviceRate: person.serviceCommission,
        productRate: person.productCommission,
        servicesCount: quantity("service"),
        services,
        serviceCommission,
        productsCount: quantity("product"),
        products,
        productCommission,
        tips: tipAmount,
        total: serviceCommission + productCommission + tipAmount,
      };
    }),
  };
}
