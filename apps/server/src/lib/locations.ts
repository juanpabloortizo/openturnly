import { and, asc, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import {
  type Location,
  locationServices,
  locations,
  resourceLocations,
  resources,
  services,
  weeklyHours,
} from "../db/schema.ts";
import { apiError } from "./http.ts";
import type { Queryable } from "./schedules.ts";

/** The business's locations in the order its people arranged them. */
export function listLocations(db: Queryable, businessId: string) {
  return db
    .select()
    .from(locations)
    .where(eq(locations.businessId, businessId))
    .orderBy(asc(locations.position), asc(locations.name));
}

/**
 * The location a request is about. With an id, that location of the business. Without
 * one, the only location that can take it: the single active location for bookings, or
 * the first location for the business's own screens. A business with several active
 * locations must say which one a booking is for.
 */
export async function resolveLocation(
  db: Queryable,
  businessId: string,
  locationId: string | null | undefined,
  { forBooking }: { forBooking: boolean },
): Promise<Location> {
  if (locationId) {
    const [location] = await db
      .select()
      .from(locations)
      .where(and(eq(locations.businessId, businessId), eq(locations.id, locationId)));
    if (!location || (forBooking && !location.active)) throw apiError(404, "location_not_found");
    return location;
  }
  const all = await listLocations(db, businessId);
  if (!forBooking) {
    const first = all[0];
    if (!first) throw apiError(404, "location_not_found");
    return first;
  }
  const active = all.filter((location) => location.active);
  if (active.length > 1) throw apiError(400, "location_required");
  const only = active[0];
  if (!only) throw apiError(404, "location_not_found");
  return only;
}

/** New locations start open Monday to Friday 9–18 and Saturday 9–13; easy to change. */
export const DEFAULT_HOURS = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "18:00" })),
  { weekday: 6, start: "09:00", end: "13:00" },
];

/** Ids among `ids` that are locations of the business. */
async function ownLocationIds(tx: Queryable, businessId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return (
    await tx
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.businessId, businessId), inArray(locations.id, ids)))
  ).map((row) => row.id);
}

/** Every location of the business, for things that start out offered everywhere. */
export async function allLocationIds(tx: Queryable, businessId: string) {
  return (
    await tx
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.businessId, businessId))
  ).map((row) => row.id);
}

/** Replaces where a service is offered, ignoring ids from other businesses. */
export async function setServiceLocations(
  tx: Queryable,
  businessId: string,
  serviceId: string,
  ids: string[],
) {
  await tx.delete(locationServices).where(eq(locationServices.serviceId, serviceId));
  const valid = await ownLocationIds(tx, businessId, ids);
  if (valid.length === 0) return;
  await tx.insert(locationServices).values(valid.map((locationId) => ({ locationId, serviceId })));
}

/**
 * Replaces where a professional works, ignoring ids from other businesses. Their own hours
 * at the locations they leave go with them.
 */
export async function setResourceLocations(
  tx: Queryable,
  businessId: string,
  resourceId: string,
  ids: string[],
) {
  const valid = await ownLocationIds(tx, businessId, ids);
  await tx.delete(resourceLocations).where(eq(resourceLocations.resourceId, resourceId));
  await tx
    .delete(weeklyHours)
    .where(
      and(
        eq(weeklyHours.resourceId, resourceId),
        valid.length > 0 ? notInArray(weeklyHours.locationId, valid) : undefined,
      ),
    );
  if (valid.length === 0) return;
  await tx
    .insert(resourceLocations)
    .values(valid.map((locationId) => ({ locationId, resourceId })));
}

/** Replaces the services a location offers, ignoring ids from other businesses. */
export async function setLocationServices(
  tx: Queryable,
  businessId: string,
  locationId: string,
  ids: string[],
) {
  await tx.delete(locationServices).where(eq(locationServices.locationId, locationId));
  if (ids.length === 0) return;
  const valid = await tx
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.businessId, businessId), inArray(services.id, ids)));
  if (valid.length === 0) return;
  await tx
    .insert(locationServices)
    .values(valid.map((service) => ({ locationId, serviceId: service.id })));
}

/**
 * Replaces who works at a location, ignoring ids from other businesses. People who leave
 * lose their own hours there.
 */
export async function setLocationResources(
  tx: Queryable,
  businessId: string,
  locationId: string,
  ids: string[],
) {
  const valid =
    ids.length > 0
      ? (
          await tx
            .select({ id: resources.id })
            .from(resources)
            .where(and(eq(resources.businessId, businessId), inArray(resources.id, ids)))
        ).map((row) => row.id)
      : [];
  await tx.delete(resourceLocations).where(eq(resourceLocations.locationId, locationId));
  await tx
    .delete(weeklyHours)
    .where(
      and(
        eq(weeklyHours.locationId, locationId),
        isNotNull(weeklyHours.resourceId),
        valid.length > 0 ? notInArray(weeklyHours.resourceId, valid) : undefined,
      ),
    );
  if (valid.length === 0) return;
  await tx
    .insert(resourceLocations)
    .values(valid.map((resourceId) => ({ locationId, resourceId })));
}
