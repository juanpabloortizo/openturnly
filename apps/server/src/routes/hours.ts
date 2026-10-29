import {
  closureSchema,
  holidayDecisionSchema,
  isDateString,
  todayIn,
  weeklyHoursSchema,
} from "@openturnly/core";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { Hono } from "hono";
import {
  closures,
  holidayOverrides,
  resourceLocations,
  resources,
  weeklyHours,
} from "../db/schema.ts";
import { businessCountry, upcomingHolidays } from "../lib/holidays.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { resolveLocation } from "../lib/locations.ts";

export function hoursRoutes({ db }: Deps) {
  const assertProfessional = async (businessId: string, resourceId: string | null) => {
    if (resourceId === null) return;
    const found = await db
      .select({ id: resources.id })
      .from(resources)
      .where(and(eq(resources.businessId, businessId), eq(resources.id, resourceId)));
    if (found.length === 0) throw apiError(404, "professional_not_found");
  };

  /** Own hours are kept per location, so the professional must work there. */
  const assertWorksAt = async (resourceId: string | null, locationId: string) => {
    if (resourceId === null) return;
    const [link] = await db
      .select({ id: resourceLocations.resourceId })
      .from(resourceLocations)
      .where(
        and(
          eq(resourceLocations.resourceId, resourceId),
          eq(resourceLocations.locationId, locationId),
        ),
      );
    if (!link) throw apiError(409, "not_at_location");
  };

  return (
    new Hono<BusinessEnv>()
      // --- Weekly hours ------------------------------------------------------
      /**
       * A location's hours (`business`, as before locations existed) and the own hours of
       * each professional there. Without ?locationId, the first location.
       */
      .get("/hours", async (c) => {
        const location = await resolveLocation(
          db,
          c.get("business").id,
          c.req.query("locationId"),
          { forBooking: false },
        );
        const rows = await db
          .select({
            resourceId: weeklyHours.resourceId,
            weekday: weeklyHours.weekday,
            start: weeklyHours.start,
            end: weeklyHours.end,
          })
          .from(weeklyHours)
          .where(
            and(
              eq(weeklyHours.businessId, c.get("business").id),
              eq(weeklyHours.locationId, location.id),
            ),
          )
          .orderBy(asc(weeklyHours.weekday), asc(weeklyHours.start));
        const professionals: Record<string, { weekday: number; start: string; end: string }[]> = {};
        const business = [];
        for (const { resourceId, ...range } of rows) {
          if (resourceId === null) business.push(range);
          else professionals[resourceId] = [...(professionals[resourceId] ?? []), range];
        }
        return c.json({ locationId: location.id, business, professionals });
      })

      .put("/hours", async (c) => {
        const businessId = c.get("business").id;
        const { locationId, resourceId, hours } = await parseBody(c, weeklyHoursSchema);
        await assertProfessional(businessId, resourceId);
        const location = await resolveLocation(db, businessId, locationId, { forBooking: false });
        await assertWorksAt(resourceId, location.id);
        await db.transaction(async (tx) => {
          await tx
            .delete(weeklyHours)
            .where(
              and(
                eq(weeklyHours.businessId, businessId),
                eq(weeklyHours.locationId, location.id),
                resourceId === null
                  ? isNull(weeklyHours.resourceId)
                  : eq(weeklyHours.resourceId, resourceId),
              ),
            );
          if (hours.length > 0) {
            await tx.insert(weeklyHours).values(
              hours.map((range) => ({
                ...range,
                businessId,
                locationId: location.id,
                resourceId,
              })),
            );
          }
        });
        return c.json({ locationId: location.id, hours });
      })

      // --- Public holidays ---------------------------------------------------
      /** The next 12 months of holidays, whether the business is closed on each. */
      .get("/holidays", async (c) => {
        const business = c.get("business");
        const language = c.req.query("lang") === "en" ? "en" : "es";
        const country = businessCountry(business);
        const overrides = new Set(
          (
            await db
              .select({ date: holidayOverrides.date })
              .from(holidayOverrides)
              .where(eq(holidayOverrides.businessId, business.id))
          ).map((row) => row.date),
        );
        const holidays = country
          ? upcomingHolidays(country, todayIn(business.timezone), language).map((holiday) => ({
              ...holiday,
              closed: business.closedOnHolidays !== overrides.has(holiday.date),
            }))
          : [];
        return c.json({ country, closedOnHolidays: business.closedOnHolidays, holidays });
      })

      /** Opens or closes one holiday, stored as an exception to closedOnHolidays. */
      .put("/holidays/:date", async (c) => {
        const business = c.get("business");
        const date = c.req.param("date");
        if (!isDateString(date)) throw apiError(400, "invalid_date");
        const { closed } = await parseBody(c, holidayDecisionSchema);
        if (closed === business.closedOnHolidays) {
          await db
            .delete(holidayOverrides)
            .where(
              and(eq(holidayOverrides.businessId, business.id), eq(holidayOverrides.date, date)),
            );
        } else {
          await db
            .insert(holidayOverrides)
            .values({ businessId: business.id, date })
            .onConflictDoNothing();
        }
        return c.json({ date, closed });
      })

      // --- Closed days -------------------------------------------------------
      .get("/closures", async (c) => {
        const business = c.get("business");
        const rows = await db
          .select()
          .from(closures)
          .where(
            and(
              eq(closures.businessId, business.id),
              gte(closures.endDate, todayIn(business.timezone)),
            ),
          )
          .orderBy(asc(closures.date));
        return c.json({ closures: rows });
      })

      .post("/closures", async (c) => {
        const businessId = c.get("business").id;
        const parsed = await parseBody(c, closureSchema);
        await assertProfessional(businessId, parsed.resourceId);
        // A professional's days off apply wherever they work.
        const input = { ...parsed, locationId: parsed.resourceId ? null : parsed.locationId };
        if (input.locationId) {
          await resolveLocation(db, businessId, input.locationId, { forBooking: false });
        }
        // Overlapping closures for the same people would only make the list confusing.
        const existing = await db
          .select({ id: closures.id })
          .from(closures)
          .where(
            and(
              eq(closures.businessId, businessId),
              lte(closures.date, input.endDate),
              gte(closures.endDate, input.date),
              input.resourceId === null
                ? isNull(closures.resourceId)
                : eq(closures.resourceId, input.resourceId),
              input.locationId === null
                ? isNull(closures.locationId)
                : eq(closures.locationId, input.locationId),
            ),
          );
        if (existing.length > 0) throw apiError(409, "closure_exists", { date: "closure_exists" });
        const [closure] = await db
          .insert(closures)
          .values({ ...input, businessId })
          .returning();
        return c.json({ closure }, 201);
      })

      .delete("/closures/:closureId", async (c) => {
        await db
          .delete(closures)
          .where(
            and(
              eq(closures.businessId, c.get("business").id),
              eq(closures.id, c.req.param("closureId")),
            ),
          );
        return c.body(null, 204);
      })
  );
}
