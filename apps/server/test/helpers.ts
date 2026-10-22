import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { createApp } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { openEmbeddedPostgres } from "../src/db/client.ts";
import { type BookingGuardSettings, DEFAULT_GUARD_SETTINGS } from "../src/lib/booking-guard.ts";

const APP_URL = "http://localhost:3000";

// biome-ignore lint/suspicious/noExplicitAny: tests inspect JSON bodies ad hoc.
type JsonResponse = { status: number; body: any };

/** Puzzles that solve instantly and limits that ordinary tests never reach. */
export const TEST_GUARD_SETTINGS: BookingGuardSettings = {
  ...DEFAULT_GUARD_SETTINGS,
  cost: 1,
  counter: { normal: [1, 5], protected: [20, 40] },
  minAgeMs: 0,
  limits: {
    perNetworkHour: 1_000,
    perNetworkDay: 1_000,
    perNetworkAllHour: 1_000,
    perNetworkHourInSurge: 1_000,
    perContactHour: 1_000,
    challengesPer10Min: 1_000,
    availabilityPerMinute: 1_000,
  },
};

/** Solves the booking page's anti-bot puzzle, as the browser does. */
export async function solveProof(client: TestClient, slug: string): Promise<string> {
  const { body } = await client.get(`/api/public/businesses/${slug}/challenge`);
  const solution = await solveChallenge({ challenge: body.challenge, deriveKey });
  return Buffer.from(JSON.stringify({ challenge: body.challenge, solution })).toString("base64");
}

/** A fresh app on its own in-memory PostgreSQL (PGlite) for each test. */
export async function createTestApp(
  options: {
    bookingGuard?: Partial<BookingGuardSettings>;
    trustProxy?: boolean;
    allowPrivateWebhooks?: boolean;
  } = {},
) {
  const config: Config = {
    isProduction: false,
    port: 3000,
    appUrl: APP_URL,
    dataDir: "",
    databaseUrl: undefined,
    secret: "test-secret-that-is-long-enough-for-better-auth",
    webDistDir: "/nonexistent",
    trustedOrigins: [APP_URL],
    trustProxy: options.trustProxy ?? false,
    bookingGuard: { ...TEST_GUARD_SETTINGS, ...options.bookingGuard },
    allowPrivateWebhooks: options.allowPrivateWebhooks ?? true,
  };
  const { db } = await openEmbeddedPostgres();
  const auth = createAuth({ db, config });
  const app = createApp({ db, auth, config });

  /** A browser-like client that keeps its own cookies. */
  const client = () => {
    const cookies = new Map<string, string>();

    const request = async (
      method: string,
      path: string,
      body?: unknown,
      extraHeaders: Record<string, string> = {},
    ): Promise<JsonResponse> => {
      // Bookings carry a solved puzzle like the real page, unless the test sends its own.
      const booking = /^\/api\/public\/businesses\/([^/]+)\/bookings$/.exec(path);
      if (
        method === "POST" &&
        booking?.[1] &&
        body &&
        typeof body === "object" &&
        !("proof" in body)
      ) {
        body = { ...body, proof: await solveProof(self, booking[1]) };
      }
      const headers = new Headers({ origin: APP_URL, ...extraHeaders });
      if (body !== undefined) headers.set("content-type", "application/json");
      if (cookies.size > 0) {
        headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
      }
      const res = await app.request(`${APP_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const setCookie of res.headers.getSetCookie()) {
        const pair = setCookie.split(";")[0] ?? "";
        const separator = pair.indexOf("=");
        const name = pair.slice(0, separator);
        const value = pair.slice(separator + 1);
        if (value && !/max-age=0/i.test(setCookie)) cookies.set(name, value);
        else cookies.delete(name);
      }
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };

    /** Sends raw bytes (image uploads) or reads a non-JSON response. */
    const raw = async (method: string, path: string, body?: Uint8Array, type?: string) => {
      const headers = new Headers({ origin: APP_URL });
      if (type) headers.set("content-type", type);
      if (cookies.size > 0) {
        headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
      }
      return app.request(`${APP_URL}${path}`, { method, headers, body });
    };

    const self = {
      raw,
      get: (path: string, headers?: Record<string, string>) =>
        request("GET", path, undefined, headers),
      post: (path: string, body: unknown = {}, headers?: Record<string, string>) =>
        request("POST", path, body, headers),
      patch: (path: string, body: unknown) => request("PATCH", path, body),
      put: (path: string, body: unknown) => request("PUT", path, body),
      delete: (path: string) => request("DELETE", path),
    };
    return self;
  };

  return { app, db, client };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
export type TestClient = ReturnType<TestApp["client"]>;

export const OWNER = { name: "Owner", email: "owner@example.com", password: "owner-password" };

export async function setUpOwner(app: TestApp) {
  const owner = app.client();
  const res = await owner.post("/api/setup", OWNER);
  if (res.status !== 200) throw new Error(`setup failed: ${JSON.stringify(res.body)}`);
  return owner;
}

export function businessInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "FTE Barber Studio",
    slug: "fte-barber",
    timezone: "America/Bogota",
    currency: "COP",
    locale: "es",
    ...overrides,
  };
}

export async function createBusiness(owner: TestClient, overrides: Record<string, unknown> = {}) {
  const res = await owner.post("/api/businesses", businessInput(overrides));
  if (res.status !== 201) throw new Error(`create business failed: ${JSON.stringify(res.body)}`);
  return res.body.business as { id: string; slug: string; name: string };
}

/** Invites `email` to the business and accepts the invitation in a new client. */
export async function addMember(
  app: TestApp,
  owner: TestClient,
  businessId: string,
  email = "client@example.com",
) {
  const invite = await owner.post(`/api/businesses/${businessId}/access`, { email });
  const token = String(invite.body.inviteUrl).split("/invite/")[1];
  const member = app.client();
  const accepted = await member.post(`/api/invitations/${token}/accept`, {
    name: "Client",
    password: "client-password",
  });
  if (accepted.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
  return member;
}
