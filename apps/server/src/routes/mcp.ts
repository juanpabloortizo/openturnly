import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { businesses } from "../db/schema.ts";
import { bearerToken, findApiKey } from "../lib/api-keys.ts";
import type { AppEnv, Deps } from "../lib/http.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { internalCaller, type ToolContext } from "../mcp/helpers.ts";
import { registerTools } from "../mcp/tools.ts";

/** Requests per minute one access key can make. */
const REQUESTS_PER_MINUTE = 240;

function instructions({ business, key }: ToolContext): string {
  const role =
    key.kind === "admin"
      ? "You act for the business itself: you can manage its calendar, customers, services, team and hours."
      : "You help the business's customers: answer questions about it, find free times, and book, move or cancel their appointments.";
  return [
    `This is ${business.name}'s booking system (OpenTurnly). ${role}`,
    `Dates are YYYY-MM-DD and times HH:MM (24 hours), in the business's time zone (${business.timezone}). Prices are in ${business.currency}.`,
    "Start with get_business_info: it gives today's date, the opening hours and what a booking needs.",
    "To book: list_services, then find_available_times (or find_next_available), confirm the details with the person, then book_appointment. Always give the booking code.",
    key.kind === "agent"
      ? "To look up, move or cancel an appointment, ask for the booking code and the phone or email used to book. Never share other people's appointments."
      : "Appointments are identified by their booking code.",
  ].join("\n");
}

/**
 * Each business's MCP server, at /<slug>/mcp (Streamable HTTP, stateless). An access key
 * of that business (Settings → Integrations) is required; the key's kind decides the
 * tools. Tools call OpenTurnly's own API as the key, so they follow the same rules as the
 * booking page and the admin panel.
 */
export function mcpRoutes(deps: Deps, fetchApp: (request: Request) => Promise<Response>) {
  const { db, config } = deps;
  const allow = createRateLimiter({ max: REQUESTS_PER_MINUTE, windowMs: 60_000 });

  const handler = createMcpHandler(
    (context) => {
      const tools = context.authInfo?.extra?.tools as ToolContext;
      const server = new McpServer(
        { name: `openturnly-${tools.business.slug}`, title: tools.business.name, version: "1.0.0" },
        { instructions: instructions(tools) },
      );
      registerTools(server, tools);
      return server;
    },
    { responseMode: "json", onerror: (error) => console.error("MCP:", error.message) },
  );

  return new Hono<AppEnv>().all("/:slug/mcp", async (c) => {
    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.slug, c.req.param("slug").toLowerCase()));
    if (!business) return c.json({ error: { code: "business_not_found" } }, 404);

    const token = bearerToken(c);
    const key = token ? await findApiKey(db, token) : null;
    // A key from another business is treated like no key at all.
    if (!token || !key || key.businessId !== business.id) {
      c.header("WWW-Authenticate", 'Bearer realm="openturnly"');
      return c.json({ error: { code: "invalid_key" } }, 401);
    }
    if (!allow(key.id)) return c.json({ error: { code: "too_many_requests" } }, 429);

    const tools: ToolContext = {
      ...deps,
      business,
      key,
      call: internalCaller(fetchApp, config.appUrl, token),
    };
    return handler.fetch(c.req.raw, {
      authInfo: { token, clientId: key.id, scopes: [key.kind], extra: { tools } },
    });
  });
}
