import { paymentConnectionSchema } from "@openturnly/core";
import { Hono } from "hono";
import type { PaymentConnection } from "../db/schema.ts";
import { type AppEnv, apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";

/** Settings → Payments: the business's own Mercado Pago account. */
export function paymentRoutes({ config, payments }: Deps) {
  /** The account as an admin sees it: never the token. */
  const present = (connection: PaymentConnection | null) =>
    connection && {
      accountId: connection.accountId,
      accountName: connection.accountName,
      siteId: connection.siteId,
      testMode: connection.testMode,
      updatedAt: connection.updatedAt,
    };
  const overview = async (businessId: string, connection: PaymentConnection | null) => ({
    connection: present(connection),
    webhookUrl: `${config.appUrl}/api/public/payments/mercadopago`,
    refunds: await payments.refunds(businessId),
  });

  return (
    new Hono<BusinessEnv>()
      // Where a business's money goes is for its people, not for an AI agent's key.
      .use(async (c, next) => {
        if (c.get("access").apiKey) throw apiError(403, "forbidden");
        await next();
      })

      .get("/", async (c) => {
        const { id } = c.get("business");
        return c.json(await overview(id, await payments.findConnection(id)));
      })

      .put("/", async (c) => {
        const { accessToken } = await parseBody(c, paymentConnectionSchema);
        const business = c.get("business");
        return c.json(await overview(business.id, await payments.connect(business, accessToken)));
      })

      .delete("/", async (c) => {
        const { id } = c.get("business");
        await payments.disconnect(id);
        return c.json(await overview(id, null));
      })
  );
}

/** Mercado Pago's notifications. Anyone could call this: it only makes us re-read the order. */
export function paymentWebhookRoutes({ payments }: Deps) {
  return new Hono<AppEnv>().post("/mercadopago", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { data?: { id?: unknown } } | null;
    const orderId = c.req.query("data.id") ?? body?.data?.id;
    if (typeof orderId === "string") {
      await payments
        .notified(orderId)
        .catch((error) => console.error("payments: notification:", (error as Error).message));
    }
    return c.json({ ok: true });
  });
}
