import { locationSchema } from "@openturnly/core";
import { and, count, eq, inArray, isNull, max } from "drizzle-orm";
import { Hono } from "hono";
import {
  appointments,
  locationServices,
  locations,
  resourceLocations,
  sales,
  stockMovements,
  weeklyHours,
} from "../db/schema.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import {
  DEFAULT_HOURS,
  listLocations,
  setLocationResources,
  setLocationServices,
} from "../lib/locations.ts";

/** The places the business works from, with the services each offers and who works there. */
export function locationRoutes({ db }: Deps) {
  const findLocation = async (businessId: string, locationId: string) => {
    const [location] = await db
      .select()
      .from(locations)
      .where(and(eq(locations.businessId, businessId), eq(locations.id, locationId)));
    if (!location) throw apiError(404, "location_not_found");
    return location;
  };

  /** A business keeps at least one location taking bookings. */
  const assertAnotherActive = async (businessId: string, locationId: string) => {
    const others = (await listLocations(db, businessId)).filter(
      (location) => location.active && location.id !== locationId,
    );
    if (others.length === 0) throw apiError(409, "last_active_location");
  };

  return new Hono<BusinessEnv>()
    .get("/", async (c) => {
      const all = await listLocations(db, c.get("business").id);
      const ids = all.map((location) => location.id);
      const [offered, staffed, used] =
        ids.length > 0
          ? await Promise.all([
              db.select().from(locationServices).where(inArray(locationServices.locationId, ids)),
              db.select().from(resourceLocations).where(inArray(resourceLocations.locationId, ids)),
              db
                .select({ id: appointments.locationId, total: count() })
                .from(appointments)
                .where(inArray(appointments.locationId, ids))
                .groupBy(appointments.locationId),
            ])
          : [[], [], []];
      return c.json({
        locations: all.map((location) => ({
          ...location,
          serviceIds: offered
            .filter((link) => link.locationId === location.id)
            .map((link) => link.serviceId),
          resourceIds: staffed
            .filter((link) => link.locationId === location.id)
            .map((link) => link.resourceId),
          appointmentCount: used.find((row) => row.id === location.id)?.total ?? 0,
        })),
      });
    })

    .post("/", async (c) => {
      const businessId = c.get("business").id;
      const { serviceIds, resourceIds, ...input } = await parseBody(c, locationSchema);
      const location = await db.transaction(async (tx) => {
        const existing = await listLocations(tx, businessId);
        const [last] = await tx
          .select({ position: max(locations.position) })
          .from(locations)
          .where(eq(locations.businessId, businessId));
        const [created] = await tx
          .insert(locations)
          .values({ ...input, businessId, position: (last?.position ?? -1) + 1 })
          .returning();
        if (!created) throw apiError(500, "internal_error");
        // A new branch usually keeps the same opening hours as the first one.
        const template = existing[0]
          ? await tx
              .select({
                weekday: weeklyHours.weekday,
                start: weeklyHours.start,
                end: weeklyHours.end,
              })
              .from(weeklyHours)
              .where(
                and(eq(weeklyHours.locationId, existing[0].id), isNull(weeklyHours.resourceId)),
              )
          : [];
        const hours = template.length > 0 ? template : DEFAULT_HOURS;
        await tx
          .insert(weeklyHours)
          .values(hours.map((range) => ({ ...range, businessId, locationId: created.id })));
        await setLocationServices(tx, businessId, created.id, serviceIds);
        await setLocationResources(tx, businessId, created.id, resourceIds);
        return created;
      });
      return c.json({ location }, 201);
    })

    .patch("/:locationId", async (c) => {
      const businessId = c.get("business").id;
      const current = await findLocation(businessId, c.req.param("locationId"));
      const { serviceIds, resourceIds, ...input } = await parseBody(c, locationSchema.partial());
      if (input.active === false && current.active)
        await assertAnotherActive(businessId, current.id);
      const location = await db.transaction(async (tx) => {
        const [updated] =
          Object.keys(input).length > 0
            ? await tx.update(locations).set(input).where(eq(locations.id, current.id)).returning()
            : [current];
        if (serviceIds) await setLocationServices(tx, businessId, current.id, serviceIds);
        if (resourceIds) await setLocationResources(tx, businessId, current.id, resourceIds);
        return updated;
      });
      return c.json({ location });
    })

    .delete("/:locationId", async (c) => {
      const businessId = c.get("business").id;
      const location = await findLocation(businessId, c.req.param("locationId"));
      if (location.active) await assertAnotherActive(businessId, location.id);
      // Its appointments and sales are part of the history and the reports: keep the
      // location, inactive.
      const [booked] = await db
        .select({ total: count() })
        .from(appointments)
        .where(eq(appointments.locationId, location.id));
      const [sold] = await db
        .select({ total: count() })
        .from(sales)
        .where(eq(sales.locationId, location.id));
      const [moved] = await db
        .select({ total: count() })
        .from(stockMovements)
        .where(eq(stockMovements.locationId, location.id));
      if ((booked?.total ?? 0) + (sold?.total ?? 0) + (moved?.total ?? 0) > 0) {
        throw apiError(409, "location_in_use");
      }
      await db.delete(locations).where(eq(locations.id, location.id));
      return c.body(null, 204);
    });
}
