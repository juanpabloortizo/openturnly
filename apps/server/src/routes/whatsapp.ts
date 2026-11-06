import {
  AUTOMATION_EVENTS,
  normalizePhone,
  whatsappConnectionSchema,
  whatsappTestSchema,
  whatsappVariables,
} from "@openturnly/core";
import { and, eq, ne } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { type WhatsappConnection, whatsappConnections } from "../db/schema.ts";
import { sampleValues } from "../lib/automations.ts";
import { businessCountry } from "../lib/holidays.ts";
import { type AppEnv, apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { encryptSecret } from "../lib/secrets.ts";
import { createToken } from "../lib/tokens.ts";
import {
  sameWhatsappToken,
  validWhatsappSignature,
  whatsappStatusUpdates,
} from "../lib/whatsapp.ts";

/** Settings → WhatsApp: the number a business's messages go out on (admins only). */
export function whatsappRoutes({ db, config, whatsapp }: Deps) {
  /** The saved connection as the admin sees it: never the token or the app secret. */
  const present = (connection: WhatsappConnection | null) =>
    connection && {
      id: connection.id,
      phoneNumberId: connection.phoneNumberId,
      wabaId: connection.wabaId,
      status: connection.status,
      phoneNumber: connection.phoneNumber,
      displayName: connection.displayName,
      lastError: connection.lastError,
      lastConnectedAt: connection.lastConnectedAt,
      hasAccessToken: Boolean(connection.encryptedAccessToken),
      hasAppSecret: Boolean(connection.encryptedAppSecret),
      webhookUrl: `${config.appUrl}/api/public/whatsapp/${connection.id}/webhook`,
      webhookVerifyToken: connection.webhookVerifyToken,
    };

  const overview = async (businessId: string) => {
    const connection = await whatsapp.findConnection(businessId);
    const sender = await whatsapp.senderFor(businessId);
    return {
      active: sender?.source ?? null,
      default: await whatsapp.defaultProfile(),
      connection: present(connection),
    };
  };

  const requireSender = async (businessId: string) => {
    const sender = await whatsapp.senderFor(businessId);
    if (!sender) throw apiError(409, "whatsapp_not_connected");
    return sender;
  };

  return (
    new Hono<BusinessEnv>()
      .get("/", async (c) => c.json(await overview(c.get("business").id)))

      /** Saves the business's own number; it's used once `connect` verifies it. */
      .put("/", async (c) => {
        const businessId = c.get("business").id;
        const input = await parseBody(c, whatsappConnectionSchema);
        const [taken] = await db
          .select({ id: whatsappConnections.id })
          .from(whatsappConnections)
          .where(
            and(
              eq(whatsappConnections.phoneNumberId, input.phoneNumberId),
              ne(whatsappConnections.businessId, businessId),
            ),
          );
        if (taken) {
          throw apiError(400, "validation_failed", { phoneNumberId: "whatsapp_number_taken" });
        }
        const current = await whatsapp.findConnection(businessId);
        const values = {
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId || null,
          // Blank keeps what's saved, so the form can be sent again without retyping them.
          ...(input.accessToken
            ? { encryptedAccessToken: encryptSecret(config.secret, input.accessToken) }
            : {}),
          ...(input.appSecret
            ? { encryptedAppSecret: encryptSecret(config.secret, input.appSecret) }
            : {}),
        };
        // Other credentials have to prove themselves before anything goes out on them.
        const changed =
          !current ||
          current.phoneNumberId !== input.phoneNumberId ||
          Boolean(input.accessToken) ||
          Boolean(input.appSecret);
        if (current) {
          await db
            .update(whatsappConnections)
            .set({
              ...values,
              ...(changed ? { status: "disconnected" as const, lastError: null } : {}),
              updatedAt: new Date(),
            })
            .where(eq(whatsappConnections.id, current.id));
        } else {
          await db
            .insert(whatsappConnections)
            .values({ ...values, businessId, webhookVerifyToken: createToken() });
        }
        return c.json(await overview(businessId));
      })

      /** Checks the saved credentials with WhatsApp; from then on messages use this number. */
      .post("/connect", async (c) => {
        const businessId = c.get("business").id;
        const connection = await whatsapp.findConnection(businessId);
        if (!connection) throw apiError(404, "whatsapp_not_saved");
        const accessToken = whatsapp.readSecret(connection.encryptedAccessToken);
        if (!accessToken || !whatsapp.readSecret(connection.encryptedAppSecret)) {
          throw apiError(409, "whatsapp_credentials_missing");
        }
        const answer = await whatsapp.verifyNumber(accessToken, connection.phoneNumberId);
        await db
          .update(whatsappConnections)
          .set(
            answer.ok
              ? {
                  status: "connected",
                  phoneNumber: answer.phoneNumber,
                  displayName: answer.displayName,
                  lastError: null,
                  lastConnectedAt: new Date(),
                  updatedAt: new Date(),
                }
              : { status: "error", lastError: answer.error, updatedAt: new Date() },
          )
          .where(eq(whatsappConnections.id, connection.id));
        return c.json(await overview(businessId));
      })

      /** Forgets the business's number: back to the install's, if there is one. */
      .delete("/", async (c) => {
        const businessId = c.get("business").id;
        await db.delete(whatsappConnections).where(eq(whatsappConnections.businessId, businessId));
        return c.json(await overview(businessId));
      })

      /** The templates of the number in use, to pick from in a flow. */
      .get("/templates", async (c) => {
        const sender = await whatsapp.senderFor(c.get("business").id);
        if (!sender) return c.json({ source: null, templates: [], error: null });
        return c.json({ source: sender.source, ...(await whatsapp.templates(sender)) });
      })

      /** Sends the ready-made templates for approval, on the business's own account. */
      .post("/templates", async (c) => {
        const sender = await requireSender(c.get("business").id);
        // The install's account belongs to whoever runs it, not to each business.
        if (sender.source !== "own") throw apiError(403, "forbidden");
        const { created, error } = await whatsapp.createTemplates(sender);
        const { templates } = await whatsapp.templates(sender);
        return c.json({ created, error, templates });
      })

      /** Sends one message now, to see the number working. */
      .post("/test", async (c) => {
        const business = c.get("business");
        const input = await parseBody(c, whatsappTestSchema);
        const phone = normalizePhone(input.phone, businessCountry(business) ?? undefined);
        if (!phone) throw apiError(400, "validation_failed", { phone: "invalid_phone" });
        const sender = await requireSender(business.id);
        const values = sampleValues(business, AUTOMATION_EVENTS.before, config.appUrl);
        const result = await whatsapp.send(sender, {
          to: phone,
          template: input.template,
          language: input.language,
          variables: whatsappVariables(input.variables, values),
        });
        return c.json({ ok: result.ok, error: result.error, messageId: result.messageId });
      })
  );
}

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
