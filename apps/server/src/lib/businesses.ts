import { businesses, locations, weeklyHours } from "../db/schema.ts";
import { newBusinessShortId } from "./codes.ts";
import { apiError } from "./http.ts";
import { DEFAULT_HOURS } from "./locations.ts";
import type { Queryable } from "./schedules.ts";

/**
 * Adds a business with its first location, named after it and open on the default hours:
 * every business works from at least one location.
 */
export async function insertBusiness(
  tx: Queryable,
  values: Omit<typeof businesses.$inferInsert, "shortId">,
) {
  const [business] = await tx
    .insert(businesses)
    .values({ ...values, shortId: await newBusinessShortId(tx) })
    .returning();
  if (!business) throw apiError(500, "internal_error");
  const [location] = await tx
    .insert(locations)
    .values({ businessId: business.id, name: business.name })
    .returning();
  if (!location) throw apiError(500, "internal_error");
  await tx.insert(weeklyHours).values(
    DEFAULT_HOURS.map((range) => ({
      ...range,
      businessId: business.id,
      locationId: location.id,
    })),
  );
  return { business, location };
}
