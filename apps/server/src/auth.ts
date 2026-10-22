import { PASSWORD_MIN_LENGTH } from "@openturnly/core";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Config } from "./config.ts";
import type { Db } from "./db/client.ts";
import { accounts, sessions, users, verifications } from "./db/schema.ts";
import { CLIENT_IP_HEADER } from "./lib/client-ip.ts";

/**
 * Accounts are created only by OpenTurnly itself (first-run setup and invitations),
 * so the public sign-up endpoint is blocked in app.ts.
 */
export function createAuth({ db, config }: { db: Db; config: Config }) {
  return betterAuth({
    appName: "OpenTurnly",
    baseURL: config.appUrl,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "member", input: false },
      },
    },
    advanced: {
      // Set by app.ts from the socket (or the trusted proxy), never by the client.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionUser = Auth["$Infer"]["Session"]["user"];
