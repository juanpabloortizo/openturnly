import { acceptInvitationSchema } from "@openturnly/core";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { businesses, businessMembers, invitations, users } from "../db/schema.ts";
import { createAccountAndSignIn } from "../lib/accounts.ts";
import { type AppEnv, apiError, type Deps, parseBody } from "../lib/http.ts";
import { hashToken } from "../lib/tokens.ts";

export function invitationRoutes({ db, auth }: Deps) {
  const findOpenInvitation = async (token: string) => {
    const [found] = await db
      .select({ invitation: invitations, businessName: businesses.name })
      .from(invitations)
      .innerJoin(businesses, eq(businesses.id, invitations.businessId))
      .where(
        and(
          eq(invitations.tokenHash, hashToken(token)),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      );
    return found;
  };

  const addMember = (businessId: string, userId: string) =>
    db.insert(businessMembers).values({ businessId, userId }).onConflictDoNothing();

  return new Hono<AppEnv>()
    .get("/:token", async (c) => {
      const found = await findOpenInvitation(c.req.param("token"));
      if (!found) throw apiError(404, "invitation_invalid");
      return c.json({ email: found.invitation.email, businessName: found.businessName });
    })

    .post("/:token/accept", async (c) => {
      const input = await parseBody(c, acceptInvitationSchema);
      const found = await findOpenInvitation(c.req.param("token"));
      if (!found) throw apiError(404, "invitation_invalid");
      const { invitation } = found;

      // Claim the invitation first so the same link cannot be used twice.
      const claimed = await db
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt)))
        .returning({ id: invitations.id });
      if (claimed.length === 0) throw apiError(404, "invitation_invalid");

      // Someone created an account with this email after the invitation was sent.
      const [existing] = await db.select().from(users).where(eq(users.email, invitation.email));
      if (existing) {
        await addMember(invitation.businessId, existing.id);
        throw apiError(409, "account_exists");
      }

      const { userId, response } = await createAccountAndSignIn(c, auth, {
        name: input.name,
        email: invitation.email,
        password: input.password,
      });
      if (userId) {
        await addMember(invitation.businessId, userId);
      } else {
        await db
          .update(invitations)
          .set({ acceptedAt: null })
          .where(eq(invitations.id, invitation.id));
      }
      return response;
    });
}
