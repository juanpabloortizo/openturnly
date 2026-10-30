import { serviceSchema } from "@openturnly/core";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { Hono } from "hono";
import { locationServices, resourceServices, resources, services } from "../db/schema.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { allLocationIds, setServiceLocations } from "../lib/locations.ts";

export function serviceRoutes({ db }: Deps) {
  const findService = async (businessId: string, serviceId: string) => {
    const [service] = await db
      .select()
      .from(services)
      .where(and(eq(services.businessId, businessId), eq(services.id, serviceId)));
    if (!service) throw apiError(404, "service_not_found");
    return service;
  };

  return new Hono<BusinessEnv>()
    .get("/", async (c) => {
      const rows = await db
        .select()
        .from(services)
        .where(eq(services.businessId, c.get("business").id))
        .orderBy(asc(services.position), asc(services.name));
      const places =
        rows.length > 0
          ? await db
              .select()
              .from(locationServices)
              .where(
                inArray(
                  locationServices.serviceId,
                  rows.map((service) => service.id),
                ),
              )
          : [];
      return c.json({
        services: rows.map((service) => ({
          ...service,
          locationIds: places
            .filter((place) => place.serviceId === service.id)
            .map((place) => place.locationId),
        })),
      });
    })

    .post("/", async (c) => {
      const business = c.get("business");
      const { locationIds, ...input } = await parseBody(c, serviceSchema);
      const service = await db.transaction(async (tx) => {
        const [last] = await tx
          .select({ position: max(services.position) })
          .from(services)
          .where(eq(services.businessId, business.id));
        const [created] = await tx
          .insert(services)
          .values({ ...input, businessId: business.id, position: (last?.position ?? -1) + 1 })
          .returning();
        if (!created) throw apiError(500, "internal_error");
        // New services are offered by every professional; each can be unticked later.
        const team = await tx
          .select({ id: resources.id })
          .from(resources)
          .where(eq(resources.businessId, business.id));
        if (team.length > 0) {
          await tx
            .insert(resourceServices)
            .values(team.map((resource) => ({ resourceId: resource.id, serviceId: created.id })));
        }
        await setServiceLocations(
          tx,
          business.id,
          created.id,
          locationIds ?? (await allLocationIds(tx, business.id)),
        );
        return created;
      });
      return c.json({ service }, 201);
    })

    .patch("/:serviceId", async (c) => {
      const businessId = c.get("business").id;
      const current = await findService(businessId, c.req.param("serviceId"));
      const { locationIds, ...input } = await parseBody(c, serviceSchema.partial());
      const service = await db.transaction(async (tx) => {
        const [updated] =
          Object.keys(input).length > 0
            ? await tx.update(services).set(input).where(eq(services.id, current.id)).returning()
            : [current];
        if (locationIds) await setServiceLocations(tx, businessId, current.id, locationIds);
        return updated;
      });
      return c.json({ service });
    })

    .delete("/:serviceId", async (c) => {
      const service = await findService(c.get("business").id, c.req.param("serviceId"));
      // Past appointments keep the service name they were booked with.
      await db.delete(services).where(eq(services.id, service.id));
      return c.body(null, 204);
    });
}
