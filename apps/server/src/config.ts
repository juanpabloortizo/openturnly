import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BookingGuardSettings, DEFAULT_GUARD_SETTINGS } from "./lib/booking-guard.ts";

export type Config = {
  isProduction: boolean;
  port: number;
  /** Public URL without trailing slash, e.g. https://reservas.example.com */
  appUrl: string;
  dataDir: string;
  /** PostgreSQL connection URL. Without it, development uses embedded PGlite in dataDir. */
  databaseUrl: string | undefined;
  secret: string;
  /** Built web app served by the server. Missing in development (Vite serves it). */
  webDistDir: string;
  trustedOrigins: string[];
  /** Behind a reverse proxy: read the client IP from X-Forwarded-For. */
  trustProxy: boolean;
  /** Anti-bot settings for the public booking page. */
  bookingGuard: BookingGuardSettings;
  /**
   * Whether automations may POST to addresses inside the server's network (another
   * container, localhost). Off in production unless WEBHOOKS_ALLOW_PRIVATE=true.
   */
  allowPrivateWebhooks: boolean;
};

const DEFAULT_DATA_DIR = fileURLToPath(new URL("../../../data", import.meta.url));
const WEB_DIST_DIR = fileURLToPath(new URL("../../web/dist", import.meta.url));
const VITE_DEV_ORIGIN = "http://localhost:5173";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env.NODE_ENV === "production";
  const port = Number(env.PORT ?? 3000);
  const appUrl = (env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, "");
  const dataDir = path.resolve(env.DATA_DIR || DEFAULT_DATA_DIR);
  mkdirSync(dataDir, { recursive: true });
  const databaseUrl = env.DATABASE_URL || undefined;
  if (isProduction && !databaseUrl) {
    throw new Error(
      "DATABASE_URL is required, e.g. postgres://openturnly:password@db:5432/openturnly",
    );
  }

  return {
    isProduction,
    port,
    appUrl,
    dataDir,
    databaseUrl,
    secret: env.SECRET || readOrCreateSecret(dataDir),
    webDistDir: WEB_DIST_DIR,
    trustedOrigins: isProduction ? [appUrl] : [appUrl, VITE_DEV_ORIGIN],
    trustProxy: env.TRUST_PROXY === "true",
    bookingGuard: DEFAULT_GUARD_SETTINGS,
    allowPrivateWebhooks: env.WEBHOOKS_ALLOW_PRIVATE
      ? env.WEBHOOKS_ALLOW_PRIVATE === "true"
      : !isProduction,
  };
}

/** Lets `docker compose up` work without asking the user to invent a secret. */
function readOrCreateSecret(dataDir: string): string {
  const file = path.join(dataDir, "secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
