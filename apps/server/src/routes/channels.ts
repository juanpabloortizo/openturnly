import {
  AUTOMATION_EVENTS,
  emailConnectionSchema,
  emailTemplate,
  emailTestSchema,
  normalizePhone,
  renderEmailText,
  whatsappConnectionSchema,
  whatsappTestSchema,
  whatsappVariables,
} from "@openturnly/core";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  businesses,
  type EmailConnection,
  emailConnections,
  type WhatsappConnection,
  whatsappConnections,
} from "../db/schema.ts";
import { sampleValues } from "../lib/automations.ts";
import { businessCountry } from "../lib/holidays.ts";
import {
  type AppEnv,
  apiError,
  type BusinessEnv,
  type Deps,
  parseBody,
  requireOwner,
} from "../lib/http.ts";
import { encryptSecret } from "../lib/secrets.ts";
import { createToken } from "../lib/tokens.ts";

/**
 * My account → Channels: how the install reaches customers. It belongs to whoever runs the
 * install, not to one business: every business sends through what's set here.
 */
export function channelRoutes({ db, config, whatsapp, email }: Deps) {
  /** A test needs a business's name and data to fill the message with. */
  const anyBusiness = async () => {
    const [business] = await db.select().from(businesses).limit(1);
    if (!business) throw apiError(409, "no_business");
    return business;
  };

  /** The saved connection as the owner sees it: never the token or the app secret. */
  const presentWhatsapp = (connection: WhatsappConnection | null) =>
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

  const whatsappOverview = async () => {
    const sender = await whatsapp.sender();
    return {
      active: sender?.source ?? null,
      default: await whatsapp.defaultProfile(),
      connection: presentWhatsapp(await whatsapp.findConnection()),
    };
  };

  /** The saved account as the owner sees it: never the password. */
  const presentEmail = (connection: EmailConnection | null) =>
    connection && {
      id: connection.id,
      provider: connection.provider,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      fromEmail: connection.fromEmail,
      status: connection.status,
      lastError: connection.lastError,
      lastConnectedAt: connection.lastConnectedAt,
      hasPassword: Boolean(connection.encryptedPassword),
    };

  const emailOverview = async () => {
    const sender = await email.sender();
    return {
      active: sender?.source ?? null,
      default: email.defaultAddress(),
      connection: presentEmail(await email.findConnection()),
    };
  };

  return (
    new Hono<AppEnv>()
      .use(async (c, next) => {
        requireOwner(c);
        await next();
      })

      .get("/whatsapp", async (c) => c.json(await whatsappOverview()))

      /** Saves the install's number; it's used once `connect` verifies it. */
      .put("/whatsapp", async (c) => {
        const input = await parseBody(c, whatsappConnectionSchema);
        const current = await whatsapp.findConnection();
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
            .values({ ...values, webhookVerifyToken: createToken() });
        }
        return c.json(await whatsappOverview());
      })

      /** Checks the saved credentials with WhatsApp; from then on messages use this number. */
      .post("/whatsapp/connect", async (c) => {
        const connection = await whatsapp.findConnection();
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
        return c.json(await whatsappOverview());
      })

      /** Forgets the install's number: back to the environment's, if there is one. */
      .delete("/whatsapp", async (c) => {
        await db.delete(whatsappConnections);
        return c.json(await whatsappOverview());
      })

      .get("/whatsapp/templates", async (c) => {
        const sender = await whatsapp.sender();
        if (!sender) return c.json({ source: null, templates: [], error: null });
        return c.json({ source: sender.source, ...(await whatsapp.templates(sender)) });
      })

      /** Sends the ready-made templates for approval, on the number connected here. */
      .post("/whatsapp/templates", async (c) => {
        const sender = await whatsapp.sender();
        if (!sender) throw apiError(409, "whatsapp_not_connected");
        // The environment's account is managed outside the panel.
        if (sender.source !== "own") throw apiError(403, "forbidden");
        const { created, error } = await whatsapp.createTemplates(sender);
        const { templates } = await whatsapp.templates(sender);
        return c.json({ created, error, templates });
      })

      /** Sends one message now, to see the number working. */
      .post("/whatsapp/test", async (c) => {
        const input = await parseBody(c, whatsappTestSchema);
        const business = await anyBusiness();
        const phone = normalizePhone(input.phone, businessCountry(business) ?? undefined);
        if (!phone) throw apiError(400, "validation_failed", { phone: "invalid_phone" });
        const sender = await whatsapp.sender();
        if (!sender) throw apiError(409, "whatsapp_not_connected");
        const values = sampleValues(business, AUTOMATION_EVENTS.before, config.appUrl);
        const result = await whatsapp.send(sender, {
          to: phone,
          template: input.template,
          language: input.language,
          variables: whatsappVariables(input.variables, values),
        });
        return c.json({ ok: result.ok, error: result.error, messageId: result.messageId });
      })

      .get("/email", async (c) => c.json(await emailOverview()))

      /** Saves the install's account; it's used once `connect` logs in with it. */
      .put("/email", async (c) => {
        const input = await parseBody(c, emailConnectionSchema);
        const current = await email.findConnection();
        const { password, ...settings } = input;
        const values = {
          ...settings,
          // Blank keeps what's saved, so the form can be sent again without retyping it.
          ...(password ? { encryptedPassword: encryptSecret(config.secret, password) } : {}),
        };
        // Other details have to prove themselves before anything goes out with them.
        const changed =
          !current ||
          Boolean(password) ||
          current.host !== input.host ||
          current.port !== input.port ||
          current.username !== input.username ||
          current.fromEmail !== input.fromEmail;
        if (current) {
          await db
            .update(emailConnections)
            .set({
              ...values,
              ...(changed ? { status: "disconnected" as const, lastError: null } : {}),
              updatedAt: new Date(),
            })
            .where(eq(emailConnections.id, current.id));
        } else {
          await db.insert(emailConnections).values(values);
        }
        return c.json(await emailOverview());
      })

      /** Logs in with the saved details; from then on emails use this account. */
      .post("/email/connect", async (c) => {
        const connection = await email.findConnection();
        if (!connection) throw apiError(404, "email_not_saved");
        const password = email.readSecret(connection.encryptedPassword);
        if (!password) throw apiError(409, "email_credentials_missing");
        const answer = await email.verify({
          source: "own",
          host: connection.host,
          port: connection.port,
          username: connection.username,
          password,
          fromEmail: connection.fromEmail,
          footer: null,
        });
        await db
          .update(emailConnections)
          .set(
            answer.ok
              ? {
                  status: "connected",
                  lastError: null,
                  lastConnectedAt: new Date(),
                  updatedAt: new Date(),
                }
              : { status: "error", lastError: answer.error, updatedAt: new Date() },
          )
          .where(eq(emailConnections.id, connection.id));
        return c.json(await emailOverview());
      })

      /** Forgets the install's account: back to the environment's, if there is one. */
      .delete("/email", async (c) => {
        await db.delete(emailConnections);
        return c.json(await emailOverview());
      })

      /** Sends one email now, with example data, to see the account working. */
      .post("/email/test", async (c) => {
        const input = await parseBody(c, emailTestSchema);
        const business = await anyBusiness();
        const sender = await email.sender();
        if (!sender) throw apiError(409, "email_not_connected");
        const ready = emailTemplate(input.template);
        if (!ready) throw apiError(404, "not_found");
        const values = sampleValues(business, AUTOMATION_EVENTS.before, config.appUrl);
        const result = await email.send(sender, {
          to: input.to,
          fromName: business.name,
          replyTo: business.email,
          subject: renderEmailText(ready.subject[input.language], values),
          body: renderEmailText(ready.body[input.language], values),
        });
        return c.json({ ok: result.ok, error: result.error });
      })
  );
}

/** What a business's admins need to build a flow: what's connected, and its templates. */
export function businessChannelRoutes({ whatsapp, email }: Deps) {
  return new Hono<BusinessEnv>()
    .get("/", async (c) => {
      const [whatsappSender, emailSender] = await Promise.all([whatsapp.sender(), email.sender()]);
      return c.json({
        whatsapp: whatsappSender?.source ?? null,
        email: emailSender?.source ?? null,
      });
    })
    .get("/whatsapp-templates", async (c) => {
      const sender = await whatsapp.sender();
      if (!sender) return c.json({ source: null, templates: [], error: null });
      return c.json({ source: sender.source, ...(await whatsapp.templates(sender)) });
    });
}
