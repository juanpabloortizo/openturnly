import { setupSchema } from "@openturnly/core";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { users } from "../db/schema.ts";
import { createAccountAndSignIn } from "../lib/accounts.ts";
import { type AppEnv, apiError, type Deps, parseBody } from "../lib/http.ts";

/**
 * First-run setup: until an owner exists, anyone who opens OpenTurnly can
 * create the owner account. Afterwards this endpoint is closed for good.
 */
export function setupRoutes({ db, auth }: Deps) {
  let inProgress = false;
  const ownerExists = async () =>
    (await db.select({ id: users.id }).from(users).where(eq(users.role, "owner")).limit(1)).length >
    0;

  return new Hono<AppEnv>()
    .get("/", async (c) => c.json({ needsSetup: !(await ownerExists()) }))
    .post("/", async (c) => {
      const input = await parseBody(c, setupSchema);
      // Set the flag before any await so two simultaneous requests can't both pass.
      if (inProgress) throw apiError(409, "already_set_up");
      inProgress = true;
      try {
        if (await ownerExists()) throw apiError(409, "already_set_up");
        const { userId, response } = await createAccountAndSignIn(c, auth, input);
        if (userId) await db.update(users).set({ role: "owner" }).where(eq(users.id, userId));
        return response;
      } finally {
        inProgress = false;
      }
    });
}
