import { Hono } from "hono";
import { findBusinessForKey, findBusinessWithAccess } from "../lib/access.ts";
import { bearerToken } from "../lib/api-keys.ts";
import { apiError, type BusinessEnv, type Deps, requireUser } from "../lib/http.ts";
import { apiKeyRoutes } from "./api-keys.ts";
import { appointmentRoutes } from "./appointments.ts";
import { automationRoutes } from "./automations.ts";
import { customerRoutes } from "./customers.ts";
import { hoursRoutes } from "./hours.ts";
import { imageRoutes } from "./images.ts";
import { professionalRoutes } from "./professionals.ts";
import { serviceRoutes } from "./services.ts";

/**
 * What a professional may call: their own agenda (the appointment routes narrow it to
 * them), plus the reads it needs. Everything else is for the business's admins.
 */
const PROFESSIONAL_ROUTES: [string, RegExp][] = [
  ["GET", /^\/appointments$/],
  ["POST", /^\/appointments$/],
  ["GET", /^\/appointments\/slots$/],
  ["GET", /^\/appointments\/[^/]+\/slots$/],
  ["PATCH", /^\/appointments\/[^/]+$/],
  ["GET", /^\/customers$/],
  ["GET", /^\/services$/],
  ["GET", /^\/professionals$/],
  ["GET", /^\/hours$/],
];

/**
 * Everything under /api/businesses/:businessId/… that the business's own people manage.
 * The middleware checks access once and hands the business and the user's role to every
 * route.
 */
export function businessScopedRoutes(deps: Deps) {
  return new Hono<BusinessEnv>()
    .use(async (c, next) => {
      const businessId = c.req.param("businessId") ?? "";
      // An AI agent's admin key works like an admin, except for managing keys themselves.
      const token = bearerToken(c);
      const { business, access } = token
        ? await findBusinessForKey(deps.db, token, businessId)
        : await findBusinessWithAccess(deps.db, requireUser(c), businessId);
      if (access.apiKey && /^\/api\/businesses\/[^/]+\/api-keys/.test(c.req.path)) {
        throw apiError(403, "forbidden");
      }
      if (access.role === "professional") {
        const path = c.req.path.replace(/^\/api\/businesses\/[^/]+/, "");
        const allowed = PROFESSIONAL_ROUTES.some(
          ([method, pattern]) => method === c.req.method && pattern.test(path),
        );
        if (!allowed) throw apiError(403, "forbidden");
      }
      c.set("business", business);
      c.set("access", access);
      await next();
    })
    .route("/services", serviceRoutes(deps))
    .route("/professionals", professionalRoutes(deps))
    .route("/appointments", appointmentRoutes(deps))
    .route("/customers", customerRoutes(deps))
    .route("/images", imageRoutes(deps))
    .route("/api-keys", apiKeyRoutes(deps))
    .route("/automations", automationRoutes(deps))
    .route("/", hoursRoutes(deps));
}
