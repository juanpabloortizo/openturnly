import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { addDays, todayIn, weekdayOf, zonedTimeToInstant } from "@openturnly/core";
import { afterEach, describe, expect, it } from "vitest";
import { signDelivery } from "../src/lib/automations.ts";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

/** The next Saturday at least two days ahead, in Bogotá (default hours: 9–13). */
function nextSaturday(): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== 6) date = addDays(date, 1);
  return date;
}

type Received = {
  method: string | undefined;
  path: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
  json: Record<string, unknown>;
};
const servers: { close: () => void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** A local endpoint that records what it receives, like any receiving system would. */
async function receiver(initialStatus = 200) {
  const received: Received[] = [];
  let status = initialStatus;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({
        method: req.method,
        path: req.url,
        headers: req.headers,
        body,
        json: JSON.parse(body),
      });
      res.writeHead(status);
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    setStatus: (code: number) => {
      status = code;
    },
  };
}

let step = 0;
/** One webhook step of a flow. */
const webhook = (url: string, rest: Record<string, unknown> = {}) => ({
  id: `step-${++step}`,
  type: "webhook",
  url,
  fields: ["appointment.code"],
  ...rest,
});

async function shop(options: Parameters<typeof createTestApp>[0] = {}) {
  const app = await createTestApp(options);
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
  const haircut = (
    await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 25_000 })
  ).body.service;
  const saturday = nextSaturday();
  const book = (time: string, phone = "+57 300 123 4567") =>
    app.client().post("/api/public/businesses/fte-barber/bookings", {
      serviceId: haircut.id,
      resourceId: null,
      date: saturday,
      time,
      customer: { firstName: "Ana", lastName: "Pérez", phone },
    });
  const engine = app.app.automations;
  return { app, owner, base, haircut, saturday, book, engine };
}

describe("automations", () => {
  it("are managed by admins and checked", async () => {
    const { owner, base } = await shop();
    const missingOffset = await owner.post(`${base}/automations`, {
      name: "Recordatorio",
      trigger: "before",
      actions: [webhook("https://example.com/hook")],
    });
    expect(missingOffset.body.error.fields).toEqual({ offsetMin: "offset_required" });
    const badUrl = await owner.post(`${base}/automations`, {
      name: "Mal",
      trigger: "created",
      actions: [webhook("ftp://example.com")],
    });
    expect(badUrl.body.error.fields).toEqual({ "actions.0.url": "invalid_url" });
    // Customer data never crosses the internet unencrypted.
    const plain = await owner.post(`${base}/automations`, {
      name: "Sin cifrar",
      trigger: "created",
      actions: [webhook("http://example.com/hook")],
    });
    expect(plain.body.error.fields).toEqual({ "actions.0.url": "https_required" });
    const noSteps = await owner.post(`${base}/automations`, {
      name: "Vacía",
      trigger: "created",
      actions: [],
    });
    expect(noSteps.body.error.fields).toEqual({ actions: "too_small" });

    const created = await owner.post(`${base}/automations`, {
      name: "Nueva cita",
      trigger: "created",
      actions: [
        webhook("https://example.com/hook", { fields: ["appointment.code", "customer.name"] }),
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.automation.secret).toMatch(/^whsec_/);
    const id = created.body.automation.id;
    expect(
      (await owner.patch(`${base}/automations/${id}`, { active: false })).body.automation.active,
    ).toBe(false);
    expect((await owner.get(`${base}/automations`)).body.automations).toEqual([
      expect.objectContaining({ id, name: "Nueva cita", lastDelivery: null }),
    ]);
    expect((await owner.delete(`${base}/automations/${id}`)).status).toBe(204);
  });

  it("send the chosen fields, signed, when an appointment is booked, moved and cancelled", async () => {
    const { owner, base, book, engine, saturday } = await shop();
    const hook = await receiver();
    const created = await owner.post(`${base}/automations`, {
      name: "Confirmación",
      trigger: "created",
      actions: [
        webhook(hook.url, {
          fields: [
            "event",
            "appointment.code",
            "appointment.date",
            "appointment.time",
            "customer.first_name",
            "customer.phone_digits",
          ],
          headers: [{ name: "Authorization", value: "Bearer abc" }],
          extra: [
            {
              name: "message",
              value: "Hola {{customer.first_name}}, tu cita es a las {{appointment.time}}.",
            },
            { name: "template", value: "confirmacion" },
          ],
        }),
      ],
    });
    await owner.post(`${base}/automations`, {
      name: "Movida",
      trigger: "rescheduled",
      actions: [
        webhook(hook.url, { fields: ["event", "appointment.time", "appointment.previous_time"] }),
      ],
    });
    await owner.post(`${base}/automations`, {
      name: "Cancelada",
      trigger: "cancelled",
      actions: [webhook(hook.url, { fields: ["event", "appointment.status"] })],
    });

    const booking = (await book("09:00")).body.appointment;
    expect(await engine.deliverDue()).toBe(1);
    const [first] = hook.received;
    expect(first?.json).toEqual({
      event: "appointment.created",
      appointment: { code: booking.code, date: saturday, time: "09:00" },
      customer: { first_name: "Ana", phone_digits: "573001234567" },
      message: "Hola Ana, tu cita es a las 09:00.",
      template: "confirmacion",
    });
    expect(first?.headers.authorization).toBe("Bearer abc");
    expect(first?.headers["x-openturnly-event"]).toBe("appointment.created");
    // Receivers can check the signature with the automation's secret.
    const timestamp = Number(first?.headers["x-openturnly-timestamp"]);
    expect(first?.headers["x-openturnly-signature"]).toBe(
      `sha256=${signDelivery(created.body.automation.secret, timestamp, first?.body ?? "")}`,
    );

    await owner.patch(`${base}/appointments/${booking.id}`, {
      serviceId: (await owner.get(`${base}/services`)).body.services[0].id,
      resourceId: null,
      date: saturday,
      time: "11:00",
    });
    await owner.post(`${base}/appointments/${booking.id}/cancel`, {});
    // Cancelling again changes nothing and sends nothing.
    await owner.post(`${base}/appointments/${booking.id}/cancel`, {});
    await engine.deliverDue();
    expect(hook.received.slice(1).map((r) => r.json)).toEqual([
      {
        event: "appointment.rescheduled",
        appointment: { time: "11:00", previous_time: "09:00" },
      },
      { event: "appointment.cancelled", appointment: { status: "cancelled" } },
    ]);
  });

  it("send reminders before and follow-ups after, once per time", async () => {
    const { owner, base, book, engine, saturday } = await shop();
    const hook = await receiver();
    await owner.post(`${base}/automations`, {
      name: "Recordatorio 1 hora",
      trigger: "before",
      offsetMin: 60,
      actions: [webhook(hook.url, { fields: ["event", "appointment.code", "appointment.time"] })],
    });
    await owner.post(`${base}/automations`, {
      name: "Reseña",
      trigger: "after",
      actions: [
        { id: "wait", type: "wait", minutes: 30 },
        webhook(hook.url, { fields: ["event", "appointment.code"] }),
      ],
    });
    const booking = (await book("10:00")).body.appointment;
    await book("11:00", "+57 300 765 4321").then(async (res) => {
      // A cancelled appointment gets no reminder.
      await owner.post(`${base}/appointments/${res.body.appointment.id}/cancel`, {});
    });
    const start = zonedTimeToInstant(saturday, 10 * 60, "America/Bogota");

    await engine.sweep(start - 61 * 60_000);
    expect(await engine.deliverDue(start - 61 * 60_000)).toBe(0);
    const dueAt = start - 59 * 60_000;
    await engine.sweep(dueAt);
    await engine.sweep(dueAt + 30_000);
    expect(await engine.deliverDue(dueAt + 30_000)).toBe(1);
    expect(hook.received.map((r) => r.json)).toEqual([
      { event: "appointment.reminder", appointment: { code: booking.code, time: "10:00" } },
    ]);

    // Moved to 12:00: a new reminder for the new time.
    await owner.patch(`${base}/appointments/${booking.id}`, {
      serviceId: (await owner.get(`${base}/services`)).body.services[0].id,
      resourceId: null,
      date: saturday,
      time: "12:00",
    });
    const moved = zonedTimeToInstant(saturday, 12 * 60, "America/Bogota");
    await engine.sweep(moved - 59 * 60_000);
    await engine.deliverDue(moved - 59 * 60_000);
    expect(hook.received.at(-1)?.json).toMatchObject({ appointment: { time: "12:00" } });

    // It ends at 13:00, then the flow waits 30 minutes: the follow-up.
    const end = moved + 60 * 60_000;
    await engine.sweep(end + 10_000);
    expect(await engine.deliverDue(end + 10_000)).toBe(0);
    await engine.deliverDue(end + 31 * 60_000);
    expect(hook.received.at(-1)?.json).toEqual({
      event: "appointment.followup",
      appointment: { code: booking.code },
    });
    expect(hook.received).toHaveLength(3);
  });

  it("call each system the way it asks: method, authentication, headers and its own JSON", async () => {
    const { owner, base, book, engine } = await shop();
    const hook = await receiver();
    const saved = await owner.post(`${base}/automations`, {
      name: "Todos los sistemas",
      trigger: "created",
      actions: [
        webhook(`${hook.url}/basic`, {
          auth: { type: "basic", username: "agenda", password: "s3cret" },
        }),
        webhook(`${hook.url}/header`, {
          auth: { type: "header", name: "Authorization", value: "Bearer whk_test" },
          headers: [{ name: "X-Account", value: "barberia" }],
        }),
        webhook(`${hook.url}/jwt`, { method: "PUT", auth: { type: "jwt", secret: "jwt-secret" } }),
        webhook(`${hook.url}/json`, {
          method: "PATCH",
          body: "json",
          fields: [],
          json: `{
            "phone": "{{customer.phone_digits}}",
            "variables": { "contact_name": "{{customer.first_name}}" },
            "buttons": ["Confirmar", "", ""],
            "context": "Cita {{appointment.code}} a las {{appointment.time}}",
            "business": {{business}}
          }`,
        }),
      ],
    });
    expect(saved.status).toBe(201);
    const booking = (await book("10:00")).body.appointment;
    await engine.deliverDue();

    const at = (path: string) => hook.received.find((r) => r.path === `/hook/${path}`);
    expect(at("basic")?.headers.authorization).toBe(
      `Basic ${Buffer.from("agenda:s3cret").toString("base64")}`,
    );
    expect(at("header")?.headers).toMatchObject({
      authorization: "Bearer whk_test",
      "x-account": "barberia",
    });
    // A JWT signed with the shared secret, fresh and short-lived.
    const jwt = at("jwt");
    expect(jwt?.method).toBe("PUT");
    const [head, claims, signature] = String(jwt?.headers.authorization)
      .replace("Bearer ", "")
      .split(".");
    expect(createHmac("sha256", "jwt-secret").update(`${head}.${claims}`).digest("base64url")).toBe(
      signature,
    );
    const decoded = JSON.parse(Buffer.from(String(claims), "base64url").toString());
    expect(decoded).toMatchObject({ iss: "openturnly", event: "appointment.created" });
    expect(decoded.exp - decoded.iat).toBe(300);
    // The body exactly in the receiver's own format.
    const json = at("json");
    expect(json?.method).toBe("PATCH");
    expect(json?.json).toEqual({
      phone: "573001234567",
      variables: { contact_name: "Ana" },
      buttons: ["Confirmar", "", ""],
      context: `Cita ${booking.code} a las 10:00`,
      business: expect.objectContaining({ name: "FTE Barber Studio", time_zone: "America/Bogota" }),
    });
    // Every call still carries OpenTurnly's signature.
    expect(hook.received.every((r) => r.headers["x-openturnly-signature"])).toBe(true);

    const invalid = await owner.post(`${base}/automations`, {
      name: "Roto",
      trigger: "created",
      actions: [
        webhook(hook.url, { body: "json", json: '{"phone": "{{customer_phone_digits}}"}' }),
      ],
    });
    expect(invalid.body.error.fields).toEqual({ "actions.0.json": "unknown_field" });
  });

  it("retry failed sends and show them in the history", async () => {
    const { owner, base, book, engine } = await shop();
    const hook = await receiver(500);
    const { automation } = (
      await owner.post(`${base}/automations`, {
        name: "Caído",
        trigger: "created",
        actions: [webhook(hook.url)],
      })
    ).body;
    await book("09:00");
    let now = Date.now();
    await engine.deliverDue(now);
    for (const wait of [60_000, 5 * 60_000, 30 * 60_000]) {
      now += wait + 1_000;
      expect(await engine.deliverDue(now)).toBe(1);
    }
    expect(hook.received).toHaveLength(4);
    expect(await engine.deliverDue(now + 3_600_000)).toBe(0);
    const history = await owner.get(`${base}/automations/${automation.id}/deliveries`);
    expect(history.body.deliveries[0]).toMatchObject({
      status: "failed",
      attempts: 4,
      responseStatus: 500,
    });
  });

  it("wait before telling, and skip it if the appointment was cancelled meanwhile", async () => {
    const { owner, base, book, engine } = await shop();
    const hook = await receiver();
    const { automation } = (
      await owner.post(`${base}/automations`, {
        name: "Diez minutos después",
        trigger: "created",
        offsetMin: 10,
        actions: [webhook(hook.url)],
      })
    ).body;
    const kept = (await book("09:00")).body.appointment;
    const dropped = (await book("10:00", "+57 300 765 4321")).body.appointment;
    await owner.post(`${base}/appointments/${dropped.id}/cancel`, {});

    expect(await engine.deliverDue(Date.now())).toBe(0);
    expect(await engine.deliverDue(Date.now() + 11 * 60_000)).toBe(2);
    expect(hook.received.map((r) => r.json)).toEqual([{ appointment: { code: kept.code } }]);
    const history = await owner.get(`${base}/automations/${automation.id}/deliveries`);
    expect(history.body.deliveries.map((d: { status: string }) => d.status).sort()).toEqual([
      "sent",
      "skipped",
    ]);
  });

  it("hold back the steps after a wait step", async () => {
    const { owner, base, book, engine } = await shop();
    const first = await receiver();
    const second = await receiver();
    await owner.post(`${base}/automations`, {
      name: "En dos tiempos",
      trigger: "created",
      actions: [
        webhook(first.url),
        { id: "pause", type: "wait", minutes: 10 },
        webhook(second.url),
      ],
    });
    const booking = (await book("09:00")).body.appointment;
    expect(await engine.deliverDue(Date.now())).toBe(1);
    expect(first.received).toHaveLength(1);
    expect(second.received).toHaveLength(0);
    expect(await engine.deliverDue(Date.now() + 11 * 60_000)).toBe(1);
    expect(second.received[0]?.json).toEqual({ appointment: { code: booking.code } });

    const onlyWaits = await owner.post(`${base}/automations`, {
      name: "Solo esperas",
      trigger: "created",
      actions: [{ id: "pause", type: "wait", minutes: 10 }],
    });
    expect(onlyWaits.body.error.fields).toEqual({ actions: "webhook_required" });
  });

  it("send to every step, with all the data unless fields are chosen", async () => {
    const { owner, base, book, engine } = await shop();
    const first = await receiver();
    const second = await receiver();
    await owner.post(`${base}/automations`, {
      name: "A dos sistemas",
      trigger: "created",
      actions: [
        webhook(first.url, { fields: null }),
        webhook(second.url, { fields: ["appointment.code", "customer.phone_digits"] }),
      ],
    });
    const booking = (await book("09:00")).body.appointment;
    expect(await engine.deliverDue()).toBe(2);
    const all = first.received[0]?.json as Record<string, Record<string, unknown>>;
    expect(Object.keys(all)).toEqual(["event", "appointment", "customer", "business"]);
    expect(Object.keys(all.appointment ?? {})).toHaveLength(20);
    expect(all.customer).toMatchObject({ name: "Ana Pérez", phone_digits: "573001234567" });
    expect(Object.keys(all.business ?? {})).toEqual([
      "name",
      "phone",
      "address",
      "booking_page",
      "time_zone",
    ]);
    expect(second.received[0]?.json).toEqual({
      appointment: { code: booking.code },
      customer: { phone_digits: "573001234567" },
    });
  });

  it("test a flow right away, saved or not, and show each step's answer", async () => {
    const allowed = await shop();
    const hook = await receiver();
    const flow = {
      name: "Prueba",
      trigger: "before",
      offsetMin: 60,
      actions: [webhook(hook.url, { fields: ["event", "customer.name"] })],
    };
    // A draft, never saved: example data.
    const draft = await allowed.owner.post(`${allowed.base}/automations/test`, {
      automation: flow,
    });
    expect(draft.body.results).toEqual([
      expect.objectContaining({ ok: true, status: 200, response: "ok", error: null }),
    ]);
    expect(hook.received[0]?.json).toEqual({
      event: "appointment.reminder",
      customer: { name: "Ana Pérez" },
      test: true,
    });

    // Saved, with a real appointment: signed with its secret and kept in its history.
    const { automation } = (await allowed.owner.post(`${allowed.base}/automations`, flow)).body;
    const booking = (await allowed.book("09:00")).body.appointment;
    const saved = await allowed.owner.post(`${allowed.base}/automations/test`, {
      automation: flow,
      automationId: automation.id,
      appointmentId: booking.id,
    });
    expect(saved.body.results[0].payload).toMatchObject({ customer: { name: "Ana Pérez" } });
    const sent = hook.received.at(-1);
    expect(sent?.headers["x-openturnly-signature"]).toBe(
      `sha256=${signDelivery(automation.secret, Number(sent?.headers["x-openturnly-timestamp"]), sent?.body ?? "")}`,
    );
    const history = await allowed.owner.get(
      `${allowed.base}/automations/${automation.id}/deliveries`,
    );
    expect(history.body.deliveries[0]).toMatchObject({ status: "sent", responseStatus: 200 });

    const strict = await shop({ allowPrivateWebhooks: false });
    const refused = await strict.owner.post(`${strict.base}/automations/test`, {
      automation: flow,
    });
    expect(refused.body.results[0]).toMatchObject({ ok: false, error: "internal_address" });
    expect(hook.received).toHaveLength(2);
  });
});
