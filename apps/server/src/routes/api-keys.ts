import { apiKeyCreateSchema } from "@openturnly/core";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { apiKeys, users } from "../db/schema.ts";
import { createApiKey } from "../lib/api-keys.ts";
import { apiError, type BusinessEnv, type Deps, parseBody, requireUser } from "../lib/http.ts";

/** Settings → Integrations: the business's MCP access keys (admins only). */
export function apiKeyRoutes({ db }: Deps) {
  return (
    new Hono<BusinessEnv>()
      .get("/", async (c) => {
        const keys = await db
          .select({
            id: apiKeys.id,
            name: apiKeys.name,
            kind: apiKeys.kind,
            hint: apiKeys.hint,
            createdAt: apiKeys.createdAt,
            lastUsedAt: apiKeys.lastUsedAt,
            createdByName: users.name,
          })
          .from(apiKeys)
          .leftJoin(users, eq(users.id, apiKeys.createdBy))
          .where(eq(apiKeys.businessId, c.get("business").id))
          .orderBy(asc(apiKeys.createdAt));
        return c.json({ keys });
      })

      /** The key itself is in this response only; afterwards just its last characters. */
      .post("/", async (c) => {
        const input = await parseBody(c, apiKeyCreateSchema);
        const { key, token } = await createApiKey(db, {
          ...input,
          businessId: c.get("business").id,
          createdBy: requireUser(c).id,
        });
        return c.json(
          {
            key: {
              id: key.id,
              name: key.name,
              kind: key.kind,
              hint: key.hint,
              createdAt: key.createdAt,
            },
            token,
          },
          201,
        );
      })

      .delete("/:keyId", async (c) => {
        const [deleted] = await db
          .delete(apiKeys)
          .where(
            and(eq(apiKeys.businessId, c.get("business").id), eq(apiKeys.id, c.req.param("keyId"))),
          )
          .returning({ id: apiKeys.id });
        if (!deleted) throw apiError(404, "key_not_found");
        return c.body(null, 204);
      })
  );
}
