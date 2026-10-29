import { professionalSchema } from "@openturnly/core";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { Hono } from "hono";
import {
  resourceLocations,
  resourceServices,
  resources,
  services,
  weeklyHours,
} from "../db/schema.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { allLocationIds, setResourceLocations } from "../lib/locations.ts";
import type { Queryable } from "../lib/schedules.ts";

export function professionalRoutes({ db }: Deps) {
  const findProfessional = async (businessId: string, resourceId: string) => {
    const [professional] = await db
      .select()
      .from(resources)
      .where(and(eq(resources.businessId, businessId), eq(resources.id, resourceId)));
    if (!professional) throw apiError(404, "professional_not_found");
    return professional;
  };

  /** Replaces the services a professional offers, ignoring ids from other businesses. */
  const setServices = async (
    tx: Queryable,
    businessId: string,
    resourceId: string,
    ids: string[],
  ) => {
    await tx.delete(resourceServices).where(eq(resourceServices.resourceId, resourceId));
    if (ids.length === 0) return;
    const valid = await tx
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.businessId, businessId), inArray(services.id, ids)));
    if (valid.length === 0) return;
    await tx
      .insert(resourceServices)
      .values(valid.map((service) => ({ resourceId, serviceId: service.id })));
  };

  return new Hono<BusinessEnv>()
    .get("/", async (c) => {
      const businessId = c.get("business").id;
      const team = await db
        .select()
        .from(resources)
        .where(eq(resources.businessId, businessId))
        .orderBy(asc(resources.position), asc(resources.name));
      const ids = team.map((professional) => professional.id);
      const [links, places] =
        ids.length > 0
          ? await Promise.all([
              db.select().from(resourceServices).where(inArray(resourceServices.resourceId, ids)),
              db.select().from(resourceLocations).where(inArray(resourceLocations.resourceId, ids)),
            ])
          : [[], []];
      const withOwnHours = new Set(
        (
          await db
            .select({ id: weeklyHours.resourceId })
            .from(weeklyHours)
            .where(eq(weeklyHours.businessId, businessId))
        ).map((row) => row.id),
      );
      return c.json({
        professionals: team.map((professional) => ({
          ...professional,
          serviceIds: links
            .filter((link) => link.resourceId === professional.id)
            .map((link) => link.serviceId),
          locationIds: places
            .filter((place) => place.resourceId === professional.id)
            .map((place) => place.locationId),
          hasOwnHours: withOwnHours.has(professional.id),
        })),
      });
    })

    .post("/", async (c) => {
      const businessId = c.get("business").id;
      const { serviceIds, locationIds, ...input } = await parseBody(c, professionalSchema);
      const professional = await db.transaction(async (tx) => {
        const [last] = await tx
          .select({ position: max(resources.position) })
          .from(resources)
          .where(eq(resources.businessId, businessId));
        const [created] = await tx
          .insert(resources)
          .values({ ...input, businessId, position: (last?.position ?? -1) + 1 })
          .returning();
        if (!created) throw apiError(500, "internal_error");
        await setServices(tx, businessId, created.id, serviceIds);
        await setResourceLocations(
          tx,
          businessId,
          created.id,
          locationIds ?? (await allLocationIds(tx, businessId)),
        );
        return created;
      });
      return c.json({ professional }, 201);
    })

    .patch("/:resourceId", async (c) => {
      const businessId = c.get("business").id;
      const current = await findProfessional(businessId, c.req.param("resourceId"));
      const { serviceIds, locationIds, ...input } = await parseBody(
        c,
        professionalSchema.partial(),
      );
      const professional = await db.transaction(async (tx) => {
        const [updated] =
          Object.keys(input).length > 0
            ? await tx.update(resources).set(input).where(eq(resources.id, current.id)).returning()
            : [current];
        if (serviceIds) await setServices(tx, businessId, current.id, serviceIds);
        if (locationIds) await setResourceLocations(tx, businessId, current.id, locationIds);
        return updated;
      });
      return c.json({ professional });
    })

    .delete("/:resourceId", async (c) => {
      const professional = await findProfessional(c.get("business").id, c.req.param("resourceId"));
      // Their past appointments keep the professional's name.
      await db.delete(resources).where(eq(resources.id, professional.id));
      return c.body(null, 204);
    });
}
