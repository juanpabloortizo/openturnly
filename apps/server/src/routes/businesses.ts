import {
  type BusinessCreateInput,
  businessCreateSchema,
  businessUpdateSchema,
  grantAccessSchema,
  memberCreateSchema,
  memberUpdateSchema,
  passwordResetSchema,
} from "@openturnly/core";
import { and, asc, eq, gt, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client.ts";
import {
  type Business,
  businesses,
  businessMembers,
  holidayOverrides,
  invitations,
  locations,
  resources,
  users,
  weeklyHours,
} from "../db/schema.ts";
import { type BusinessAccess, findBusinessWithAccess, findManagedBusiness } from "../lib/access.ts";
import { createAccount, resetPassword } from "../lib/accounts.ts";
import { businessCountry } from "../lib/holidays.ts";
import {
  type AppEnv,
  apiError,
  type Deps,
  parseBody,
  requireOwner,
  requireUser,
} from "../lib/http.ts";
import { logoUrls } from "../lib/images.ts";
import { DEFAULT_HOURS } from "../lib/locations.ts";
import { createToken, hashToken } from "../lib/tokens.ts";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The business as the admin sees it: its country, its logo and the user's access to it. */
function adminView(business: Business, logoUrl: string | null, access?: BusinessAccess) {
  return {
    ...business,
    country: businessCountry(business),
    logoUrl,
    ...(access ? { access } : {}),
  };
}

/** One business for the admin, with its logo looked up. */
async function adminViewOf(db: Db, business: Business, access: BusinessAccess) {
  return adminView(business, (await logoUrls(db, [business])).get(business.id) ?? null, access);
}

export function businessRoutes({ db, config, auth, guard }: Deps) {
  return (
    new Hono<AppEnv>()
      .get("/", async (c) => {
        const user = requireUser(c);
        const rows: { business: Business; access: BusinessAccess }[] =
          user.role === "owner"
            ? (await db.select().from(businesses).orderBy(asc(businesses.name))).map(
                (business) => ({ business, access: { role: "owner", resourceId: null } }),
              )
            : (
                await db
                  .select({
                    business: businesses,
                    role: businessMembers.role,
                    resourceId: businessMembers.resourceId,
                  })
                  .from(businesses)
                  .innerJoin(businessMembers, eq(businessMembers.businessId, businesses.id))
                  .where(eq(businessMembers.userId, user.id))
                  .orderBy(asc(businesses.name))
              ).map((row) => ({
                business: row.business,
                access: { role: row.role, resourceId: row.resourceId },
              }));
        const logos = await logoUrls(
          db,
          rows.map((row) => row.business),
        );
        return c.json({
          businesses: rows.map(({ business, access }) =>
            adminView(business, logos.get(business.id) ?? null, access),
          ),
        });
      })

      .post("/", async (c) => {
        requireOwner(c);
        const input: BusinessCreateInput = await parseBody(c, businessCreateSchema);
        await assertSlugAvailable(db, input.slug);
        const business = await db.transaction(async (tx) => {
          const [created] = await tx.insert(businesses).values(input).returning();
          if (!created) throw apiError(500, "internal_error");
          // Every business works from at least one location, named after it to begin with.
          const [location] = await tx
            .insert(locations)
            .values({ businessId: created.id, name: created.name })
            .returning();
          if (!location) throw apiError(500, "internal_error");
          await tx.insert(weeklyHours).values(
            DEFAULT_HOURS.map((range) => ({
              ...range,
              businessId: created.id,
              locationId: location.id,
            })),
          );
          return created;
        });
        return c.json(
          { business: adminView(business, null, { role: "owner", resourceId: null }) },
          201,
        );
      })

      .get("/:id", async (c) => {
        const { business, access } = await findBusinessWithAccess(
          db,
          requireUser(c),
          c.req.param("id"),
        );
        return c.json({ business: await adminViewOf(db, business, access) });
      })

      .patch("/:id", async (c) => {
        const user = requireUser(c);
        const { business: current, access } = await findBusinessWithAccess(
          db,
          user,
          c.req.param("id"),
        );
        if (access.role === "professional") throw apiError(403, "forbidden");
        const input = await parseBody(c, businessUpdateSchema);
        if (input.slug && input.slug !== current.slug) await assertSlugAvailable(db, input.slug);
        const business = await db.transaction(async (tx) => {
          // Per-holiday exceptions are relative to the global switch, so they reset with it.
          const switchedHolidays =
            input.closedOnHolidays !== undefined &&
            input.closedOnHolidays !== current.closedOnHolidays;
          // Holidays follow the time zone; another country means other holidays.
          const countryChanged =
            input.timezone !== undefined &&
            businessCountry({ timezone: input.timezone }) !== businessCountry(current);
          if (switchedHolidays || countryChanged) {
            await tx.delete(holidayOverrides).where(eq(holidayOverrides.businessId, current.id));
          }
          const [updated] = await tx
            .update(businesses)
            .set(input)
            .where(eq(businesses.id, current.id))
            .returning();
          if (!updated) throw apiError(404, "business_not_found");
          return updated;
        });
        return c.json({ business: await adminViewOf(db, business, access) });
      })

      .delete("/:id", async (c) => {
        requireOwner(c);
        const deleted = await db
          .delete(businesses)
          .where(eq(businesses.id, c.req.param("id")))
          .returning({ id: businesses.id });
        if (deleted.length === 0) throw apiError(404, "business_not_found");
        return c.body(null, 204);
      })

      // --- Who can work in this business (instance owner and its admins) ----

      /** Whether the booking page is under an unusual wave of bookings (possible bots). */
      .get("/:id/protection", async (c) => {
        const business = await findManagedBusiness(db, requireUser(c), c.req.param("id"));
        return c.json({ protection: await guard.surge(business.id) });
      })

      .get("/:id/access", async (c) => {
        const business = await findManagedBusiness(db, requireUser(c), c.req.param("id"));
        const members = await db
          .select({
            userId: users.id,
            name: users.name,
            email: users.email,
            role: businessMembers.role,
            resourceId: businessMembers.resourceId,
            resourceName: resources.name,
          })
          .from(businessMembers)
          .innerJoin(users, eq(users.id, businessMembers.userId))
          .leftJoin(resources, eq(resources.id, businessMembers.resourceId))
          .where(eq(businessMembers.businessId, business.id))
          .orderBy(asc(users.name));
        const pending = await db
          .select({
            id: invitations.id,
            email: invitations.email,
            expiresAt: invitations.expiresAt,
            createdAt: invitations.createdAt,
          })
          .from(invitations)
          .where(
            and(
              eq(invitations.businessId, business.id),
              isNull(invitations.acceptedAt),
              gt(invitations.expiresAt, new Date()),
            ),
          )
          .orderBy(asc(invitations.createdAt));
        return c.json({ members, invitations: pending });
      })

      /**
       * Gives someone access to the business. People who already have an account
       * are added right away; everyone else gets an invitation link to create one.
       */
      .post("/:id/access", async (c) => {
        const owner = requireUser(c);
        const business = await findManagedBusiness(db, owner, c.req.param("id"));
        const { email } = await parseBody(c, grantAccessSchema);

        const [existing] = await db.select().from(users).where(eq(users.email, email));
        if (existing) {
          if (existing.role === "owner") throw apiError(409, "already_has_access");
          await db
            .insert(businessMembers)
            .values({ businessId: business.id, userId: existing.id })
            .onConflictDoNothing();
          return c.json({
            status: "added" as const,
            member: { userId: existing.id, name: existing.name, email: existing.email },
          });
        }

        const token = createToken();
        const invitation = await db.transaction(async (tx) => {
          await tx
            .delete(invitations)
            .where(
              and(
                eq(invitations.businessId, business.id),
                eq(invitations.email, email),
                isNull(invitations.acceptedAt),
              ),
            );
          const [created] = await tx
            .insert(invitations)
            .values({
              businessId: business.id,
              email,
              tokenHash: hashToken(token),
              invitedBy: owner.id,
              expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
            })
            .returning({
              id: invitations.id,
              email: invitations.email,
              expiresAt: invitations.expiresAt,
              createdAt: invitations.createdAt,
            });
          return created;
        });
        return c.json(
          {
            status: "invited" as const,
            invitation,
            // Shown once: only the hash is stored. Emailed too once SMTP is supported.
            inviteUrl: `${config.appUrl}/invite/${token}`,
          },
          201,
        );
      })

      /**
       * Gives someone access with an account created here: email, password and role. People
       * who already have an account keep their password and just get this business too.
       */
      .post("/:id/members", async (c) => {
        const business = await findManagedBusiness(db, requireUser(c), c.req.param("id"));
        const input = await parseBody(c, memberCreateSchema);
        await assertProfileFree(db, business.id, input.resourceId);

        const [existing] = await db.select().from(users).where(eq(users.email, input.email));
        if (existing?.role === "owner") throw apiError(409, "already_has_access");
        if (existing) {
          const [already] = await db
            .select({ userId: businessMembers.userId })
            .from(businessMembers)
            .where(
              and(
                eq(businessMembers.businessId, business.id),
                eq(businessMembers.userId, existing.id),
              ),
            );
          if (already) throw apiError(409, "already_member", { email: "already_member" });
        } else if (!input.password) {
          throw apiError(400, "validation_failed", { password: "required" });
        }

        const userId =
          existing?.id ??
          (await createAccount(auth, {
            name: input.name,
            email: input.email,
            password: input.password ?? "",
          }));
        await db.insert(businessMembers).values({
          businessId: business.id,
          userId,
          role: input.role,
          resourceId: input.role === "professional" ? input.resourceId : null,
        });
        return c.json({ userId, created: !existing }, 201);
      })

      .patch("/:id/members/:userId", async (c) => {
        const user = requireUser(c);
        const business = await findManagedBusiness(db, user, c.req.param("id"));
        const userId = c.req.param("userId");
        const input = await parseBody(c, memberUpdateSchema);
        // An admin demoting themselves would lock themselves out of this screen.
        if (userId === user.id && input.role !== "admin") {
          throw apiError(400, "cannot_change_own_role");
        }
        await assertProfileFree(db, business.id, input.resourceId, userId);
        const updated = await db
          .update(businessMembers)
          .set({
            role: input.role,
            resourceId: input.role === "professional" ? input.resourceId : null,
          })
          .where(
            and(eq(businessMembers.businessId, business.id), eq(businessMembers.userId, userId)),
          )
          .returning({ userId: businessMembers.userId });
        if (updated.length === 0) throw apiError(404, "member_not_found");
        return c.json({ ok: true });
      })

      /**
       * Sets a new password for a member. An admin may only do it for people who work just
       * in businesses they manage, so nobody can take over an account used elsewhere.
       */
      .put("/:id/members/:userId/password", async (c) => {
        const user = requireUser(c);
        const business = await findManagedBusiness(db, user, c.req.param("id"));
        const userId = c.req.param("userId");
        const { password } = await parseBody(c, passwordResetSchema);
        const memberships = await db
          .select({ businessId: businessMembers.businessId })
          .from(businessMembers)
          .where(eq(businessMembers.userId, userId));
        if (!memberships.some((membership) => membership.businessId === business.id)) {
          throw apiError(404, "member_not_found");
        }
        if (user.role !== "owner") {
          const managed = new Set(
            (
              await db
                .select({ businessId: businessMembers.businessId })
                .from(businessMembers)
                .where(and(eq(businessMembers.userId, user.id), eq(businessMembers.role, "admin")))
            ).map((row) => row.businessId),
          );
          if (!memberships.every((membership) => managed.has(membership.businessId))) {
            throw apiError(403, "forbidden");
          }
        }
        await resetPassword(auth, db, userId, password);
        return c.json({ ok: true });
      })

      .delete("/:id/members/:userId", async (c) => {
        const user = requireUser(c);
        const business = await findManagedBusiness(db, user, c.req.param("id"));
        if (c.req.param("userId") === user.id) throw apiError(400, "cannot_remove_self");
        await db
          .delete(businessMembers)
          .where(
            and(
              eq(businessMembers.businessId, business.id),
              eq(businessMembers.userId, c.req.param("userId")),
            ),
          );
        return c.body(null, 204);
      })

      .delete("/:id/invitations/:invitationId", async (c) => {
        const business = await findManagedBusiness(db, requireUser(c), c.req.param("id"));
        await db
          .delete(invitations)
          .where(
            and(
              eq(invitations.businessId, business.id),
              eq(invitations.id, c.req.param("invitationId")),
            ),
          );
        return c.body(null, 204);
      })
  );
}

/** A professional profile can be linked to one person only. */
async function assertProfileFree(
  db: Db,
  businessId: string,
  resourceId: string | null,
  exceptUserId?: string,
) {
  if (!resourceId) return;
  const [resource] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(and(eq(resources.businessId, businessId), eq(resources.id, resourceId)));
  if (!resource) throw apiError(400, "validation_failed", { resourceId: "invalid_value" });
  const [taken] = await db
    .select({ userId: businessMembers.userId })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.resourceId, resourceId),
        exceptUserId ? ne(businessMembers.userId, exceptUserId) : undefined,
      ),
    );
  if (taken) throw apiError(409, "profile_taken", { resourceId: "profile_taken" });
}

async function assertSlugAvailable(db: Db, slug: string) {
  const taken = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);
  if (taken.length > 0) throw apiError(409, "slug_taken", { slug: "slug_taken" });
}
