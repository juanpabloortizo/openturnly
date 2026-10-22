import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { Auth, SessionUser } from "../auth.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import type { Business } from "../db/schema.ts";
import type { BusinessAccess } from "./access.ts";
import type { Automations } from "./automations.ts";
import type { BookingGuard } from "./booking-guard.ts";

export type Deps = {
  db: Db;
  auth: Auth;
  config: Config;
  guard: BookingGuard;
  automations: Automations;
};
export type AppEnv = { Variables: { user: SessionUser | null } };
/** Routes under /api/businesses/:businessId, after access was checked. */
export type BusinessEnv = {
  Variables: AppEnv["Variables"] & { business: Business; access: BusinessAccess };
};

export type ApiErrorBody = { error: { code: string; fields?: Record<string, string> } };

/**
 * Errors carry a stable `code` (e.g. "slug_taken") that the web app translates.
 * Field errors map an input name to a code.
 */
export function apiError(
  status: ContentfulStatusCode,
  code: string,
  fields?: Record<string, string>,
): HTTPException {
  const body: ApiErrorBody = { error: fields ? { code, fields } : { code } };
  return new HTTPException(status, { res: Response.json(body, { status }) });
}

export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw apiError(400, "invalid_json");
  }
  return validateWith(schema, body);
}

/** Parses `value`, or answers 400 with one error code per field. */
export function validateWith<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.code === "custom" ? issue.message : issue.code;
  }
  throw apiError(400, "validation_failed", fields);
}

export function requireUser<E extends AppEnv>(c: Context<E>): SessionUser {
  const user = c.get("user");
  if (!user) throw apiError(401, "unauthorized");
  return user;
}

export function requireOwner<E extends AppEnv>(c: Context<E>): SessionUser {
  const user = requireUser(c);
  if (user.role !== "owner") throw apiError(403, "forbidden");
  return user;
}
