import {
  closureSchema,
  holidayDecisionSchema,
  isDateString,
  todayIn,
  weeklyHoursSchema,
} from "@openturnly/core";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { Hono } from "hono";
import { closures, holidayOverrides, resources, weeklyHours } from "../db/schema.ts";
import { businessCountry, upcomingHolidays } from "../lib/holidays.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";

export function hoursRoutes({ db }: Deps) {
  const assertProfessional = async (businessId: string, resourceId: string | null) => {
    if (resourceId === null) return;
    const found = await db
      .select({ id: resources.id })
      .from(resources)
      .where(and(eq(resources.businessId, businessId), eq(resources.id, resourceId)));
    if (found.length === 0) throw apiError(404, "professional_not_found");
  };

  return (
    new Hono<BusinessEnv>()
      // --- Weekly hours ------------------------------------------------------
      .get("/hours", async (c) => {
        const rows = await db
          .select({
            resourceId: weeklyHours.resourceId,
            weekday: weeklyHours.weekday,
            start: weeklyHours.start,
            end: weeklyHours.end,
          })
          .from(weeklyHours)
          .where(eq(weeklyHours.businessId, c.get("business").id))
          .orderBy(asc(weeklyHours.weekday), asc(weeklyHours.start));
        const professionals: Record<string, { weekday: number; start: string; end: string }[]> = {};
        const business = [];
        for (const { resourceId, ...range } of rows) {
          if (resourceId === null) business.push(range);
          else professionals[resourceId] = [...(professionals[resourceId] ?? []), range];
        }
        return c.json({ business, professionals });
      })

      .put("/hours", async (c) => {
        const businessId = c.get("business").id;
        const { resourceId, hours } = await parseBody(c, weeklyHoursSchema);
        await assertProfessional(businessId, resourceId);
        await db.transaction(async (tx) => {
          await tx
            .delete(weeklyHours)
            .where(
              and(
                eq(weeklyHours.businessId, businessId),
                resourceId === null
                  ? isNull(weeklyHours.resourceId)
                  : eq(weeklyHours.resourceId, resourceId),
              ),
            );
          if (hours.length > 0) {
            await tx
              .insert(weeklyHours)
              .values(hours.map((range) => ({ ...range, businessId, resourceId })));
          }
        });
        return c.json({ hours });
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
        const input = await parseBody(c, closureSchema);
        await assertProfessional(businessId, input.resourceId);
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
