import { accountUpdateSchema, passwordChangeSchema, TOURS } from "@openturnly/core";
import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { sessions, users, userTours } from "../db/schema.ts";
import { verifyPassword } from "../lib/accounts.ts";
import { type AppEnv, apiError, type Deps, parseBody, requireUser } from "../lib/http.ts";

/** Wrong current passwords "My account" takes per person before it waits. */
const MAX_WRONG_PASSWORDS = 5;
const WRONG_PASSWORDS_WINDOW_MS = 15 * 60_000;

export function meRoutes({ db, auth, guard }: Deps) {
  // Changing the email or the password asks for the current one. Counting the wrong ones
  // per person keeps a session left open somewhere from being used to guess it; the count
  // lives in memory, like the sign-in limits, and clears after a right one.
  const wrongPasswords = new Map<string, number[]>();
  const checkPassword = async (userId: string, password: string | undefined) => {
    const now = Date.now();
    const recent = (wrongPasswords.get(userId) ?? []).filter(
      (time) => time > now - WRONG_PASSWORDS_WINDOW_MS,
    );
    if (recent.length >= MAX_WRONG_PASSWORDS) throw apiError(429, "too_many_attempts");
    try {
      await verifyPassword(auth, userId, password);
    } catch (error) {
      wrongPasswords.set(userId, [...recent, now]);
      throw error;
    }
    wrongPasswords.delete(userId);
  };

  return (
    new Hono<AppEnv>()
      .get("/", (c) => {
        const { id, name, email, role } = requireUser(c);
        return c.json({ user: { id, name, email, role } });
      })

      /** The person's own name and email ("Mi cuenta"). */
      .patch("/", async (c) => {
        const user = requireUser(c);
        const input = await parseBody(c, accountUpdateSchema);
        const changes: { name: string; email?: string } = { name: input.name };
        if (input.email !== user.email) {
          // The email signs in, so a session left open somewhere is not enough to change it.
          await checkPassword(user.id, input.currentPassword);
          const [taken] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, input.email));
          if (taken) throw apiError(409, "user_already_exists", { email: "user_already_exists" });
          changes.email = input.email;
        }
        const context = await auth.$context;
        const updated = await context.internalAdapter.updateUser(user.id, changes);
        return c.json({
          user: { id: user.id, name: updated.name, email: updated.email, role: user.role },
        });
      })

      /** A new password. Other devices sign in again with it; this one stays signed in. */
      .post("/password", async (c) => {
        const user = requireUser(c);
        const input = await parseBody(c, passwordChangeSchema);
        await checkPassword(user.id, input.currentPassword);
        const context = await auth.$context;
        await context.internalAdapter.updatePassword(
          user.id,
          await context.password.hash(input.newPassword),
        );
        const current = await auth.api.getSession({ headers: c.req.raw.headers });
        await db
          .delete(sessions)
          .where(and(eq(sessions.userId, user.id), ne(sessions.id, current?.session.id ?? "")));
        return c.json({ ok: true });
      })

      /** The guided tours this person has already seen, so each one shows only once. */
      .get("/tours", async (c) => {
        const user = requireUser(c);
        const rows = await db
          .select({ tour: userTours.tour })
          .from(userTours)
          .where(eq(userTours.userId, user.id));
        return c.json({ seen: rows.map((row) => row.tour) });
      })

      /** A tour finished or skipped: it won't show again. */
      .put("/tours/:tour", async (c) => {
        const user = requireUser(c);
        const tour = c.req.param("tour");
        if (!(TOURS as readonly string[]).includes(tour)) throw apiError(404, "not_found");
        await db.insert(userTours).values({ userId: user.id, tour }).onConflictDoNothing();
        return c.json({ ok: true });
      })

      /** "See the tour again": every tour shows once more. */
      .delete("/tours", async (c) => {
        const user = requireUser(c);
        await db.delete(userTours).where(eq(userTours.userId, user.id));
        return c.body(null, 204);
      })

      /** Problems with the install itself, for its owner to fix. */
      .get("/notices", (c) => {
        const user = requireUser(c);
        const notices =
          user.role === "owner" && guard.proxyMisconfigured() ? ["proxy_not_trusted"] : [];
        return c.json({ notices });
      })
  );
}
