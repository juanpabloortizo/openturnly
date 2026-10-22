import { createHash, randomBytes } from "node:crypto";
import type { ApiKeyKind } from "@openturnly/core";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Db } from "../db/client.ts";
import { type ApiKey, apiKeys } from "../db/schema.ts";

/** Keys look like "ot_" + 32 random characters; the prefix makes them easy to spot. */
const PREFIX = "ot_";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createApiKey(
  db: Db,
  input: { businessId: string; name: string; kind: ApiKeyKind; createdBy: string | null },
): Promise<{ key: ApiKey; token: string }> {
  const token = `${PREFIX}${randomBytes(24).toString("base64url")}`;
  const [key] = await db
    .insert(apiKeys)
    .values({ ...input, tokenHash: hashToken(token), hint: token.slice(-4) })
    .returning();
  if (!key) throw new Error("API key insert returned nothing");
  return { key, token };
}

/** The key in an `Authorization: Bearer ot_…` header, if any. */
export function bearerToken(c: Context): string | null {
  const header = c.req.header("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  return token?.startsWith(PREFIX) ? token : null;
}

/** The stored key for a token, recording when it was last used (at most once a minute). */
export async function findApiKey(db: Db, token: string): Promise<ApiKey | null> {
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.tokenHash, hashToken(token)));
  if (!key) return null;
  const now = new Date();
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, key.id));
  }
  return key;
}
