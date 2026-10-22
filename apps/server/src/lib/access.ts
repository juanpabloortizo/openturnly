import type { BusinessRole } from "@openturnly/core";
import { and, eq } from "drizzle-orm";
import type { SessionUser } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { type Business, businesses, businessMembers } from "../db/schema.ts";
import { findApiKey } from "./api-keys.ts";
import { apiError } from "./http.ts";

/**
 * How a user works in one business. The instance "owner" can do everything everywhere;
 * an "admin" everything in that business; a "professional" only their own appointments.
 */
export type BusinessAccess = {
  role: "owner" | BusinessRole;
  resourceId: string | null;
  /** Set when an AI agent calls with an admin access key instead of a signed-in user. */
  apiKey?: { id: string; name: string };
};

/**
 * The business and the user's access to it. Returns 404 (not 403) when they have none,
 * so the business's existence is not leaked.
 */
export async function findBusinessWithAccess(
  db: Db,
  user: SessionUser,
  businessId: string,
): Promise<{ business: Business; access: BusinessAccess }> {
  if (user.role === "owner") {
    const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
    if (!business) throw apiError(404, "business_not_found");
    return { business, access: { role: "owner", resourceId: null } };
  }
  const [row] = await db
    .select({
      business: businesses,
      role: businessMembers.role,
      resourceId: businessMembers.resourceId,
    })
    .from(businesses)
    .innerJoin(businessMembers, eq(businessMembers.businessId, businesses.id))
    .where(and(eq(businesses.id, businessId), eq(businessMembers.userId, user.id)));
  if (!row) throw apiError(404, "business_not_found");
  return { business: row.business, access: { role: row.role, resourceId: row.resourceId } };
}

/** The business, if the user may see it at all (any role). */
export async function findAccessibleBusiness(db: Db, user: SessionUser, businessId: string) {
  return (await findBusinessWithAccess(db, user, businessId)).business;
}

/** The business, if the user manages it: the instance owner or one of its admins. */
export async function findManagedBusiness(db: Db, user: SessionUser, businessId: string) {
  const { business, access } = await findBusinessWithAccess(db, user, businessId);
  if (access.role === "professional") throw apiError(403, "forbidden");
  return business;
}

/**
 * The business an admin access key belongs to, acting as one of its admins. Keys of other
 * businesses get 401 like unknown ones; agent keys can't reach the admin API.
 */
export async function findBusinessForKey(
  db: Db,
  token: string,
  businessId: string,
): Promise<{ business: Business; access: BusinessAccess }> {
  const key = await findApiKey(db, token);
  if (!key || key.businessId !== businessId) throw apiError(401, "invalid_key");
  if (key.kind !== "admin") throw apiError(403, "forbidden");
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business) throw apiError(404, "business_not_found");
  return {
    business,
    access: { role: "admin", resourceId: null, apiKey: { id: key.id, name: key.name } },
  };
}
