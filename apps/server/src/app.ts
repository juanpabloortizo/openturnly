import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { createAutomations } from "./lib/automations.ts";
import { createBookingGuard } from "./lib/booking-guard.ts";
import { hasProxyHeaders, withClientIp } from "./lib/client-ip.ts";
import type { AppEnv, Deps } from "./lib/http.ts";
import { businessRoutes } from "./routes/businesses.ts";
import { invitationRoutes } from "./routes/invitations.ts";
import { mcpRoutes } from "./routes/mcp.ts";
import { meRoutes } from "./routes/me.ts";
import { metaRoutes } from "./routes/meta.ts";
import { publicRoutes } from "./routes/public.ts";
import { businessScopedRoutes } from "./routes/scoped.ts";
import { setupRoutes } from "./routes/setup.ts";

export function createApp({ db, auth, config }: Pick<Deps, "db" | "auth" | "config">) {
  const guard = createBookingGuard({ db, secret: config.secret, settings: config.bookingGuard });
  const automations = createAutomations({ db, config });
  const deps: Deps = { db, auth, config, guard, automations };
  const app = new Hono<AppEnv>();

  if (!config.isProduction && process.env.NODE_ENV !== "test") app.use(logger());
  app.use(secureHeaders());

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: { code: "internal_error" } }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Accounts are only created through /api/setup and invitations.
  app.all("/api/auth/sign-up/*", (c) => c.json({ error: { code: "signup_disabled" } }, 403));
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(withClientIp(c, config.trustProxy)));

  // Changes made with the session cookie must come from this install's own pages, so another
  // site can't act for someone signed in here (CSRF), even a neighbour on the same domain
  // that the cookie's SameSite lets through. Requests without the cookie (access keys, the
  // public booking API) prove nothing by their origin and are left alone.
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    const writes = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
    if (
      writes &&
      origin &&
      c.req.header("cookie") &&
      !c.req.path.startsWith("/api/public/") &&
      !config.trustedOrigins.includes(origin)
    ) {
      return c.json({ error: { code: "forbidden_origin" } }, 403);
    }
    await next();
  });

  app.use("/api/*", async (c, next) => {
    if (!config.trustProxy && hasProxyHeaders(c)) guard.noteProxyHeaders();
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", session?.user ?? null);
    await next();
  });

  app.route("/api/setup", setupRoutes(deps));
  app.route("/api/me", meRoutes(deps));
  app.route("/api/meta", metaRoutes());
  app.route("/api/businesses", businessRoutes(deps));
  app.route("/api/businesses/:businessId", businessScopedRoutes(deps));
  app.route("/api/invitations", invitationRoutes(deps));
  app.route("/api/public", publicRoutes(deps));
  app.all("/api/*", (c) => c.json({ error: { code: "not_found" } }, 404));
  // Each business's MCP server for AI agents; its tools call this same app.
  app.route(
    "/",
    mcpRoutes(deps, (request) => Promise.resolve(app.fetch(request))),
  );

  serveWebApp(app, config.webDistDir);
  // The server starts the automations loop; tests drive it step by step.
  return Object.assign(app, { automations });
}

/** Serves the built React app. Any unknown path gets index.html so client routing works. */
function serveWebApp(app: Hono<AppEnv>, distDir: string) {
  const indexFile = path.join(distDir, "index.html");
  if (!existsSync(indexFile)) return;
  const indexHtml = readFileSync(indexFile, "utf8");

  app.use(
    "/assets/*",
    serveStatic({
      root: distDir,
      onFound: (_path, c) => c.header("Cache-Control", "public, max-age=31536000, immutable"),
    }),
  );
  app.use("*", serveStatic({ root: distDir }));
  app.get("*", (c) => c.html(indexHtml));
}
