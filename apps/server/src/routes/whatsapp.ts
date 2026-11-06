import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { whatsappConnections } from "../db/schema.ts";
import { type AppEnv, apiError, type Deps } from "../lib/http.ts";
import {
  sameWhatsappToken,
  validWhatsappSignature,
  whatsappStatusUpdates,
} from "../lib/whatsapp.ts";

/** Where WhatsApp reports what happened to the messages sent from here. */
export function whatsappWebhookRoutes({ db, config, automations, whatsapp }: Deps) {
  /** WhatsApp checks the address when it's saved, and echoes back what it was sent. */
  const handshake = (c: Context<AppEnv>, verifyToken: string | null) => {
    const subscribing = c.req.query("hub.mode") === "subscribe";
    const challenge = c.req.query("hub.challenge");
    if (!subscribing || !challenge) throw apiError(403, "forbidden");
    if (!sameWhatsappToken(c.req.query("hub.verify_token"), verifyToken)) {
      throw apiError(403, "forbidden");
    }
    return c.text(challenge);
  };

  /** Only signed calls count, and only about the number this address belongs to. */
  const receive = async (c: Context<AppEnv>, appSecret: string | null, phoneNumberId: string) => {
    const body = await c.req.text();
    if (!appSecret) throw apiError(403, "forbidden");
    if (!validWhatsappSignature(appSecret, body, c.req.header("x-hub-signature-256"))) {
      throw apiError(401, "invalid_signature");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw apiError(400, "invalid_json");
    }
    const updates = whatsappStatusUpdates(payload).filter(
      (update) => update.phoneNumberId === phoneNumberId,
    );
    await automations.recordWhatsappStatuses(updates);
    return c.text("ok");
  };

  const findConnection = async (id: string) => {
    const [connection] = await db
      .select()
      .from(whatsappConnections)
      .where(eq(whatsappConnections.id, id));
    if (!connection) throw apiError(404, "not_found");
    return connection;
  };

  return new Hono<AppEnv>()
    .get("/webhook", (c) => {
      if (!config.whatsapp) throw apiError(404, "not_found");
      return handshake(c, config.whatsapp.verifyToken);
    })
    .post("/webhook", (c) => {
      if (!config.whatsapp) throw apiError(404, "not_found");
      return receive(c, config.whatsapp.appSecret, config.whatsapp.phoneNumberId);
    })
    .get("/:connectionId/webhook", async (c) => {
      const connection = await findConnection(c.req.param("connectionId"));
      return handshake(c, connection.webhookVerifyToken);
    })
    .post("/:connectionId/webhook", async (c) => {
      const connection = await findConnection(c.req.param("connectionId"));
      const appSecret = whatsapp.readSecret(connection.encryptedAppSecret);
      return receive(c, appSecret, connection.phoneNumberId);
    });
}
