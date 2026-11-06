import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/lib/secrets.ts";
import { whatsappStatusUpdates } from "../src/lib/whatsapp.ts";
import { addMember, createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

const servers: { close: () => void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

type Sent = { url: string; authorization: string | undefined; json: Record<string, never> };

/** Stands in for WhatsApp's API: answers what the tests set and records what it receives. */
async function fakeWhatsapp() {
  const sent: Sent[] = [];
  const state = {
    sendStatus: 200,
    sendError: null as { code: number; message: string } | null,
    templates: [
      {
        name: "appointment_reminder",
        language: "es",
        status: "APPROVED",
        category: "UTILITY",
        components: [{ type: "BODY", text: "Hola {{1}}, tu cita es el {{2}}." }],
      },
    ] as unknown[],
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const url = req.url ?? "";
      const reply = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (body) {
        sent.push({ url, authorization: req.headers.authorization, json: JSON.parse(body) });
      }
      if (req.headers.authorization === "Bearer bad-token") {
        return reply(401, { error: { code: 190, message: "Invalid token" } });
      }
      if (url.includes("message_templates")) {
        return reply(200, body ? { id: "1", status: "PENDING" } : { data: state.templates });
      }
      if (url.endsWith("/messages")) {
        if (state.sendError) return reply(state.sendStatus, { error: state.sendError });
        return reply(200, { messages: [{ id: `wamid.${sent.length}` }] });
      }
      return reply(200, { display_phone_number: "+1 202-555-0100", verified_name: "Barber" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, sent, state };
}

const INSTALL_NUMBER = {
  phoneNumberId: "111111",
  wabaId: "222222",
  accessToken: "install-token",
  appSecret: "install-secret",
  verifyToken: "install-verify",
};

const signature = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function nextSaturday(): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== 6) date = addDays(date, 1);
  return date;
}

async function shop(options: { installNumber?: boolean } = {}) {
  const whatsapp = await fakeWhatsapp();
  const app = await createTestApp({
    whatsappApiUrl: whatsapp.url,
    whatsapp: options.installNumber ? INSTALL_NUMBER : null,
  });
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
  const haircut = (
    await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 25_000 })
  ).body.service;
  const book = () =>
    app.client().post("/api/public/businesses/fte-barber/bookings", {
      serviceId: haircut.id,
      resourceId: null,
      date: nextSaturday(),
      time: "10:00",
      customer: { firstName: "Ana", lastName: "Pérez", phone: "+57 300 123 4567" },
    });
  /** A flow that messages the customer as soon as an appointment is booked. */
  const messageOnBooking = () =>
    owner.post(`${base}/automations`, {
      name: "Aviso",
      trigger: "created",
      actions: [
        {
          id: "message",
          type: "whatsapp",
          template: "appointment_reminder",
          language: "es",
          variables: [
            { name: "customer_name", value: "{{customer.first_name}}" },
            { name: "business_address", value: "{{business.address}}" },
          ],
        },
      ],
    });
  const deliveries = async (automationId: string) =>
    (await owner.get(`${base}/automations/${automationId}/deliveries`)).body.deliveries;
  return {
    app,
    owner,
    base,
    business,
    book,
    messageOnBooking,
    deliveries,
    whatsapp,
    engine: app.app.automations,
  };
}

const OWN_NUMBER = {
  phoneNumberId: "333333",
  wabaId: "444444",
  accessToken: "own-token",
  appSecret: "own-secret",
};

describe("WhatsApp", () => {
  it("keeps stored credentials unreadable without the install's secret", () => {
    const stored = encryptSecret("one-secret", "token");
    expect(stored).not.toContain("token");
    expect(decryptSecret("one-secret", stored)).toBe("token");
    expect(() => decryptSecret("another-secret", stored)).toThrow();
  });

  it("sends a template to the customer on the install's number by default", async () => {
    const { book, messageOnBooking, engine, deliveries, whatsapp } = await shop({
      installNumber: true,
    });
    const { automation } = (await messageOnBooking()).body;
    await book();
    await engine.deliverDue();
    expect(whatsapp.sent).toHaveLength(1);
    const [message] = whatsapp.sent;
    expect(message?.url).toBe(`/${INSTALL_NUMBER.phoneNumberId}/messages`);
    expect(message?.authorization).toBe(`Bearer ${INSTALL_NUMBER.accessToken}`);
    expect(message?.json).toMatchObject({
      to: "573001234567",
      type: "template",
      template: {
        name: "appointment_reminder",
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "customer_name", text: "Ana" },
              // An empty value would be refused by WhatsApp.
              { type: "text", parameter_name: "business_address", text: "-" },
            ],
          },
        ],
      },
    });
    const [delivery] = await deliveries(automation.id);
    expect(delivery).toMatchObject({ status: "sent", messageStatus: "sent" });
    expect(delivery.messageId).toBeTruthy();
  });

  it("moves to the number connected in the panel, and back when removed", async () => {
    const { owner, book, messageOnBooking, engine, whatsapp } = await shop({
      installNumber: true,
    });
    await messageOnBooking();

    const saved = await owner.put(`/api/channels/whatsapp`, OWN_NUMBER);
    expect(saved.status).toBe(200);
    // Saved isn't enough: only verified credentials take over.
    expect(saved.body.active).toBe("default");
    expect(JSON.stringify(saved.body)).not.toContain(OWN_NUMBER.accessToken);
    expect(JSON.stringify(saved.body)).not.toContain(OWN_NUMBER.appSecret);

    const connected = await owner.post(`/api/channels/whatsapp/connect`);
    expect(connected.body.active).toBe("own");
    expect(connected.body.connection).toMatchObject({
      status: "connected",
      phoneNumber: "+1 202-555-0100",
      displayName: "Barber",
      hasAccessToken: true,
      hasAppSecret: true,
    });

    await book();
    await engine.deliverDue();
    expect(whatsapp.sent.at(-1)?.url).toBe(`/${OWN_NUMBER.phoneNumberId}/messages`);
    expect(whatsapp.sent.at(-1)?.authorization).toBe(`Bearer ${OWN_NUMBER.accessToken}`);

    const removed = await owner.delete(`/api/channels/whatsapp`);
    expect(removed.body).toMatchObject({ active: "default", connection: null });
  });

  it("keeps saved secrets when the form is sent again without them", async () => {
    const { owner } = await shop();
    await owner.put(`/api/channels/whatsapp`, OWN_NUMBER);
    await owner.put(`/api/channels/whatsapp`, { phoneNumberId: OWN_NUMBER.phoneNumberId });
    const connected = await owner.post(`/api/channels/whatsapp/connect`);
    expect(connected.body.connection.status).toBe("connected");
  });

  it("reports credentials WhatsApp refuses and keeps using the install's number", async () => {
    const { owner } = await shop({ installNumber: true });
    await owner.put(`/api/channels/whatsapp`, { ...OWN_NUMBER, accessToken: "bad-token" });
    const { body } = await owner.post(`/api/channels/whatsapp/connect`);
    expect(body.connection).toMatchObject({ status: "error", lastError: "Invalid token" });
    expect(body.active).toBe("default");
  });

  it("skips nothing silently: without a number the delivery fails and says why", async () => {
    const { book, messageOnBooking, engine, deliveries, whatsapp } = await shop();
    const { automation } = (await messageOnBooking()).body;
    await book();
    await engine.deliverDue();
    expect(whatsapp.sent).toHaveLength(0);
    const [delivery] = await deliveries(automation.id);
    expect(delivery).toMatchObject({ status: "failed", error: "whatsapp_not_connected" });
  });

  it("doesn't retry what can't work, and retries what can", async () => {
    const { book, messageOnBooking, engine, deliveries, whatsapp } = await shop({
      installNumber: true,
    });
    const { automation } = (await messageOnBooking()).body;
    whatsapp.state.sendStatus = 400;
    whatsapp.state.sendError = { code: 132001, message: "Template does not exist" };
    await book();
    await engine.deliverDue();
    expect((await deliveries(automation.id))[0]).toMatchObject({
      status: "failed",
      error: "Template does not exist",
    });

    const another = await shop({ installNumber: true });
    const flow = (await another.messageOnBooking()).body.automation;
    another.whatsapp.state.sendStatus = 400;
    another.whatsapp.state.sendError = { code: 130429, message: "Rate limit hit" };
    await another.book();
    await another.engine.deliverDue();
    expect((await another.deliveries(flow.id))[0]).toMatchObject({
      status: "pending",
      attempts: 1,
    });
  });

  it("never messages example data in a test", async () => {
    const { owner, base, whatsapp } = await shop({ installNumber: true });
    const { body } = await owner.post(`${base}/automations/test`, {
      automation: {
        name: "Prueba",
        trigger: "created",
        actions: [
          { id: "message", type: "whatsapp", template: "appointment_reminder", language: "es" },
        ],
      },
    });
    expect(whatsapp.sent).toHaveLength(0);
    expect(body.results[0]).toMatchObject({ ok: false, error: "whatsapp_needs_appointment" });
  });

  it("only lets a business create templates on its own account", async () => {
    const { owner, whatsapp } = await shop({ installNumber: true });
    expect((await owner.post(`/api/channels/whatsapp/templates`)).status).toBe(403);

    await owner.put(`/api/channels/whatsapp`, OWN_NUMBER);
    await owner.post(`/api/channels/whatsapp/connect`);
    const { body } = await owner.post(`/api/channels/whatsapp/templates`);
    // Four templates in two languages, except the one the account already has.
    expect(body).toMatchObject({ created: 7, error: null });
    expect(whatsapp.sent.map((item) => item.url)).toEqual(
      Array(7).fill(`/${OWN_NUMBER.wabaId}/message_templates`),
    );
    expect(whatsapp.sent[0]?.json).toMatchObject({
      category: "UTILITY",
      parameter_format: "named",
      components: [
        { type: "HEADER", format: "TEXT" },
        {
          type: "BODY",
          example: {
            body_text_named_params: expect.arrayContaining([
              { param_name: "customer_name", example: "Ana" },
            ]),
          },
        },
      ],
    });
  });

  it("keeps numbered variables working for older templates", async () => {
    const { owner, whatsapp } = await shop({ installNumber: true });
    await owner.post(`/api/channels/whatsapp/test`, {
      phone: "+57 300 765 4321",
      template: "older",
      language: "es",
      variables: [{ name: "1", value: "Ana" }],
    });
    expect(whatsapp.sent[0]?.json).toMatchObject({
      template: { components: [{ parameters: [{ type: "text", text: "Ana" }] }] },
    });
    expect(JSON.stringify(whatsapp.sent[0]?.json)).not.toContain("parameter_name");
  });

  it("gives the time as people read it", async () => {
    const { book, owner, base, engine, whatsapp } = await shop({ installNumber: true });
    await owner.post(`${base}/automations`, {
      name: "Hora",
      trigger: "created",
      actions: [
        {
          id: "hour",
          type: "whatsapp",
          template: "appointment_reminder",
          language: "es",
          variables: [{ name: "appointment_time", value: "{{appointment.time_text}}" }],
        },
      ],
    });
    await book();
    await engine.deliverDue();
    expect(JSON.stringify(whatsapp.sent.at(-1)?.json)).toMatch(/10:00\s?a\.\s?m\./);
  });

  it("sends a test message to the number asked for", async () => {
    const { owner, whatsapp } = await shop({ installNumber: true });
    const { body } = await owner.post(`/api/channels/whatsapp/test`, {
      phone: "+57 300 765 4321",
      template: "hello_world",
      language: "en_US",
    });
    expect(body.ok).toBe(true);
    expect(whatsapp.sent[0]?.json).toMatchObject({
      to: "573007654321",
      template: { name: "hello_world" },
    });
  });

  it("is only for whoever runs the install", async () => {
    const { app, owner, base, business } = await shop();
    const key = await owner.post(`${base}/api-keys`, { name: "Bot", kind: "admin" });
    const withKey = await app.app.fetch(
      new Request("http://localhost/api/channels/whatsapp", {
        headers: { authorization: `Bearer ${key.body.token}` },
      }),
    );
    expect(withKey.status).toBe(401);
    expect((await app.client().get("/api/channels/whatsapp")).status).toBe(401);

    const admin = await addMember(app, owner, business.id, "admin@example.com");
    expect((await admin.get("/api/channels/whatsapp")).status).toBe(403);
    expect((await admin.put("/api/channels/whatsapp", OWN_NUMBER)).status).toBe(403);
    // Building a flow only needs to know what's connected.
    expect((await admin.get(`${base}/channels`)).body).toEqual({ whatsapp: null, email: null });
  });

  describe("webhook", () => {
    const update = (messageId: string, status: string, extra: object = {}) => ({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: INSTALL_NUMBER.phoneNumberId },
                statuses: [{ id: messageId, status, ...extra }],
              },
            },
          ],
        },
      ],
    });
    const hook = (app: Awaited<ReturnType<typeof createTestApp>>, secret: string, body: string) =>
      app.app.fetch(
        new Request("http://localhost/api/public/whatsapp/webhook", {
          method: "POST",
          headers: { "x-hub-signature-256": signature(secret, body) },
          body,
        }),
      );

    it("answers WhatsApp's check only with the right token", async () => {
      const { app } = await shop({ installNumber: true });
      const check = (token: string) =>
        app.app.fetch(
          new Request(
            `http://localhost/api/public/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=echo`,
          ),
        );
      const good = await check(INSTALL_NUMBER.verifyToken);
      expect(good.status).toBe(200);
      expect(await good.text()).toBe("echo");
      expect((await check("wrong")).status).toBe(403);
    });

    it("follows a message through delivered and read, never backwards", async () => {
      const { app, book, messageOnBooking, engine, deliveries } = await shop({
        installNumber: true,
      });
      const { automation } = (await messageOnBooking()).body;
      await book();
      await engine.deliverDue();
      const [{ messageId }] = await deliveries(automation.id);
      const send = (status: string) =>
        hook(app, INSTALL_NUMBER.appSecret, JSON.stringify(update(messageId, status)));

      expect((await send("read")).status).toBe(200);
      await send("delivered");
      expect((await deliveries(automation.id))[0]).toMatchObject({
        status: "sent",
        messageStatus: "read",
      });
    });

    it("marks a message WhatsApp couldn't deliver as failed", async () => {
      const { app, book, messageOnBooking, engine, deliveries } = await shop({
        installNumber: true,
      });
      const { automation } = (await messageOnBooking()).body;
      await book();
      await engine.deliverDue();
      const [{ messageId }] = await deliveries(automation.id);
      const body = JSON.stringify(
        update(messageId, "failed", {
          errors: [{ code: 131026, title: "Message undeliverable" }],
        }),
      );
      await hook(app, INSTALL_NUMBER.appSecret, body);
      expect((await deliveries(automation.id))[0]).toMatchObject({
        status: "failed",
        messageStatus: "failed",
        error: "131026: Message undeliverable",
      });
    });

    it("refuses calls that aren't signed with the app secret", async () => {
      const { app, book, messageOnBooking, engine, deliveries } = await shop({
        installNumber: true,
      });
      const { automation } = (await messageOnBooking()).body;
      await book();
      await engine.deliverDue();
      const [{ messageId }] = await deliveries(automation.id);
      const body = JSON.stringify(update(messageId, "read"));
      expect((await hook(app, "wrong-secret", body)).status).toBe(401);
      expect((await deliveries(automation.id))[0].messageStatus).toBe("sent");
    });

    it("ignores updates about another number", async () => {
      const { app, book, messageOnBooking, engine, deliveries } = await shop({
        installNumber: true,
      });
      const { automation } = (await messageOnBooking()).body;
      await book();
      await engine.deliverDue();
      const [{ messageId }] = await deliveries(automation.id);
      const payload = update(messageId, "read");
      const [entry] = payload.entry;
      const value = entry?.changes[0]?.value;
      if (value) value.metadata.phone_number_id = "999999";
      await hook(app, INSTALL_NUMBER.appSecret, JSON.stringify(payload));
      expect((await deliveries(automation.id))[0].messageStatus).toBe("sent");
    });

    it("serves each business's own number at its own address", async () => {
      const { app, owner } = await shop();
      await owner.put(`/api/channels/whatsapp`, OWN_NUMBER);
      const { body } = await owner.get(`/api/channels/whatsapp`);
      const { id, webhookUrl, webhookVerifyToken } = body.connection;
      expect(webhookUrl).toBe(`http://localhost:3000/api/public/whatsapp/${id}/webhook`);

      const path = `/api/public/whatsapp/${id}/webhook`;
      const check = await app.app.fetch(
        new Request(
          `http://localhost${path}?hub.mode=subscribe&hub.verify_token=${webhookVerifyToken}&hub.challenge=echo`,
        ),
      );
      expect(await check.text()).toBe("echo");

      const payload = JSON.stringify({ entry: [] });
      const signed = await app.app.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "x-hub-signature-256": signature(OWN_NUMBER.appSecret, payload) },
          body: payload,
        }),
      );
      expect(signed.status).toBe(200);
    });

    it("reads the callback data sent with the message", () => {
      const [item] = whatsappStatusUpdates(
        update("wamid.1", "sent", { biz_opaque_callback_data: "tag:delivery" }),
      );
      expect(item).toMatchObject({ messageId: "wamid.1", callback: "tag:delivery" });
    });
  });
});
