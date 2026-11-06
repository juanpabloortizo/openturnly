import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

const mail = vi.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  connections: [] as Record<string, unknown>[],
  loginFails: false,
  sendError: null as null | { code?: string; responseCode?: number; message: string },
}));

// Stands in for the mail server: what matters here is what's handed to it.
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (settings: Record<string, unknown>) => {
      mail.connections.push(settings);
      return {
        verify: async () => {
          if (mail.loginFails) throw Object.assign(new Error("535"), { code: "EAUTH" });
          return true;
        },
        sendMail: async (message: Record<string, unknown>) => {
          if (mail.sendError)
            throw Object.assign(new Error(mail.sendError.message), mail.sendError);
          mail.sent.push(message);
          return { response: "250 OK" };
        },
        close: () => {},
      };
    },
  },
}));

const INSTALL_ACCOUNT = {
  host: "smtp.shared.test",
  port: 465,
  username: "shared",
  password: "shared-password",
  fromEmail: "citas@mail.example.com",
  footer: "Enviado con OpenTurnly",
};

const OWN_ACCOUNT = {
  provider: "other",
  host: "smtp.example.com",
  port: 587,
  username: "own",
  password: "own-password",
  fromEmail: "citas@barberia.example.com",
};

function nextSaturday(): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== 6) date = addDays(date, 1);
  return date;
}

beforeEach(() => {
  mail.sent.length = 0;
  mail.connections.length = 0;
  mail.loginFails = false;
  mail.sendError = null;
});
afterEach(() => vi.restoreAllMocks());

async function shop(options: { account?: boolean; allowPrivate?: boolean } = {}) {
  const app = await createTestApp({
    email: options.account ? INSTALL_ACCOUNT : null,
    allowPrivateWebhooks: options.allowPrivate ?? true,
  });
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
  await owner.patch(base, { email: "hola@barberia.example.com", phone: "+573000000000" });
  const haircut = (
    await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 25_000 })
  ).body.service;
  const book = (customer: Record<string, unknown> = {}) =>
    app.client().post("/api/public/businesses/fte-barber/bookings", {
      serviceId: haircut.id,
      resourceId: null,
      date: nextSaturday(),
      time: "10:00",
      customer: {
        firstName: "Ana",
        lastName: "Pérez",
        phone: "+57 300 123 4567",
        email: "ana@example.com",
        ...customer,
      },
    });
  const emailOnBooking = (rest: Record<string, unknown> = {}) =>
    owner.post(`${base}/automations`, {
      name: "Aviso",
      trigger: "created",
      actions: [
        {
          id: "mail",
          type: "email",
          template: "appointment_confirmation",
          language: "es",
          ...rest,
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
    emailOnBooking,
    deliveries,
    engine: app.app.automations,
  };
}

describe("email", () => {
  it("sends the ready-made text on the shared account, in the business's name", async () => {
    const { book, emailOnBooking, engine, deliveries } = await shop({ account: true });
    const { automation } = (await emailOnBooking()).body;
    await book();
    await engine.deliverDue();

    const [message] = mail.sent;
    expect(message).toMatchObject({
      to: "ana@example.com",
      from: { name: "FTE Barber Studio", address: INSTALL_ACCOUNT.fromEmail },
      replyTo: "hola@barberia.example.com",
      subject: "Cita confirmada en FTE Barber Studio",
    });
    expect(message?.text).toContain("Hola Ana, tu cita en FTE Barber Studio ya está agendada.");
    expect(message?.text).toContain("Enviado con OpenTurnly");
    expect((await deliveries(automation.id))[0]).toMatchObject({ status: "sent" });
  });

  it("leaves out a line whose data is missing", async () => {
    const { book, emailOnBooking, engine } = await shop({ account: true });
    await emailOnBooking();
    await book();
    await engine.deliverDue();
    expect(mail.sent[0]?.text).not.toContain("Dirección:");
  });

  it("only lets its own account send its own words", async () => {
    const shared = await shop({ account: true });
    await shared.emailOnBooking({ subject: "Oferta", body: "Compra ya" });
    await shared.book();
    await shared.engine.deliverDue();
    expect(mail.sent[0]?.subject).toBe("Cita confirmada en FTE Barber Studio");
    expect(mail.sent[0]?.text).not.toContain("Compra ya");

    mail.sent.length = 0;
    const own = await shop({ account: true });
    await own.owner.put("/api/channels/email", OWN_ACCOUNT);
    await own.owner.post("/api/channels/email/connect");
    await own.emailOnBooking({ subject: "Tu cita", body: "Hola {{customer.first_name}}" });
    await own.book();
    await own.engine.deliverDue();
    expect(mail.sent[0]).toMatchObject({
      subject: "Tu cita",
      text: "Hola Ana",
      from: { address: OWN_ACCOUNT.fromEmail },
    });
  });

  it("takes over only once the server accepts the login, and never returns the password", async () => {
    const { owner } = await shop({ account: true });
    const saved = await owner.put("/api/channels/email", OWN_ACCOUNT);
    expect(saved.body.active).toBe("default");
    expect(JSON.stringify(saved.body)).not.toContain(OWN_ACCOUNT.password);

    mail.loginFails = true;
    const refused = await owner.post("/api/channels/email/connect");
    expect(refused.body.connection).toMatchObject({ status: "error", lastError: "email_login" });
    expect(refused.body.active).toBe("default");

    mail.loginFails = false;
    const connected = await owner.post("/api/channels/email/connect");
    expect(connected.body).toMatchObject({ active: "own", connection: { status: "connected" } });

    const removed = await owner.delete("/api/channels/email");
    expect(removed.body).toMatchObject({ active: "default", connection: null });
  });

  it("keeps the saved password when the form is sent again without it", async () => {
    const { owner } = await shop();
    await owner.put("/api/channels/email", OWN_ACCOUNT);
    await owner.put("/api/channels/email", { ...OWN_ACCOUNT, password: "" });
    const { body } = await owner.post("/api/channels/email/connect");
    expect(body.connection.status).toBe("connected");
    expect(mail.connections.at(-1)).toMatchObject({ auth: { pass: OWN_ACCOUNT.password } });
  });

  it("refuses a server inside the install's network", async () => {
    const { owner } = await shop({ allowPrivate: false });
    await owner.put("/api/channels/email", { ...OWN_ACCOUNT, host: "127.0.0.1" });
    const { body } = await owner.post("/api/channels/email/connect");
    expect(body.connection).toMatchObject({ status: "error", lastError: "internal_address" });
    expect(mail.connections).toHaveLength(0);
  });

  it("refuses ports that aren't for mail", async () => {
    const { owner } = await shop();
    const { status, body } = await owner.put("/api/channels/email", { ...OWN_ACCOUNT, port: 5432 });
    expect(status).toBe(400);
    expect(body.error.fields).toEqual({ port: "invalid_email_port" });
  });

  it("says why when there's nowhere to send", async () => {
    const noAccount = await shop();
    const flow = (await noAccount.emailOnBooking()).body.automation;
    await noAccount.book();
    await noAccount.engine.deliverDue();
    expect((await noAccount.deliveries(flow.id))[0]).toMatchObject({
      status: "failed",
      error: "email_not_connected",
    });

    const noAddress = await shop({ account: true });
    const other = (await noAddress.emailOnBooking()).body.automation;
    await noAddress.book({ email: undefined });
    await noAddress.engine.deliverDue();
    expect((await noAddress.deliveries(other.id))[0]).toMatchObject({
      status: "failed",
      error: "email_no_address",
    });
  });

  it("retries a passing failure and not a final no", async () => {
    const final = await shop({ account: true });
    const flow = (await final.emailOnBooking()).body.automation;
    mail.sendError = { responseCode: 550, message: "Mailbox not found" };
    await final.book();
    await final.engine.deliverDue();
    expect((await final.deliveries(flow.id))[0]).toMatchObject({ status: "failed", attempts: 1 });

    const passing = await shop({ account: true });
    const other = (await passing.emailOnBooking()).body.automation;
    mail.sendError = { code: "ESOCKET", message: "connection lost" };
    await passing.book();
    await passing.engine.deliverDue();
    expect((await passing.deliveries(other.id))[0]).toMatchObject({
      status: "pending",
      attempts: 1,
    });
  });

  it("never emails example data in a test", async () => {
    const { owner, base } = await shop({ account: true });
    const { body } = await owner.post(`${base}/automations/test`, {
      automation: {
        name: "Prueba",
        trigger: "created",
        actions: [{ id: "mail", type: "email", template: "appointment_reminder", language: "es" }],
      },
    });
    expect(mail.sent).toHaveLength(0);
    expect(body.results[0]).toMatchObject({ ok: false, error: "whatsapp_needs_appointment" });
  });

  it("sends a test to the address asked for", async () => {
    const { owner } = await shop({ account: true });
    const { body } = await owner.post("/api/channels/email/test", {
      to: "pruebas@example.com",
      template: "appointment_reminder",
      language: "es",
    });
    expect(body).toEqual({ ok: true, error: null });
    expect(mail.sent[0]).toMatchObject({
      to: "pruebas@example.com",
      subject: "Recordatorio de tu cita en FTE Barber Studio",
    });
  });
});
