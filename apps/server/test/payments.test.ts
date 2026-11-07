import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { afterEach, describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

type Order = { status: string; status_detail?: string; external_reference?: string };

/** Stands in for Mercado Pago: keeps orders and lets a test change how they stand. */
async function fakeMercadopago() {
  const orders = new Map<string, Order>();
  const created: Record<string, never>[] = [];
  const state = {
    user: {
      id: 987,
      nickname: "BARBER",
      first_name: "Barber",
      last_name: "Shop",
      site_id: "MCO",
      tags: ["normal"],
    },
    failOrders: false,
    failReads: false,
    failCancels: false,
    failRefunds: false,
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
      if (req.headers.authorization === "Bearer bad-token-value") return reply(401, {});
      if (url === "/users/me") return reply(200, state.user);
      if (url === "/v1/orders" && req.method === "POST") {
        if (state.failOrders) return reply(500, {});
        const json = JSON.parse(body);
        created.push(json);
        const id = `ORD${orders.size + 1}`;
        orders.set(id, { status: "created", external_reference: json.external_reference });
        return reply(201, {
          id,
          status: "created",
          checkout_url: `https://checkout.test/${id}`,
        });
      }
      const match = /^\/v1\/orders\/([^/]+)(\/cancel|\/refund)?$/.exec(url);
      const order = orders.get(match?.[1] ?? "");
      if (!order) return reply(404, {});
      if (state.failReads) return reply(500, {});
      if (match?.[2] === "/cancel") {
        if (state.failCancels) return reply(409, {});
        order.status = "canceled";
      }
      if (match?.[2] === "/refund") {
        if (state.failRefunds) return reply(400, {});
        order.status = "refunded";
      }
      return reply(200, { id: match?.[1], ...order });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, orders, created, state };
}

function nextSaturday(): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== 6) date = addDays(date, 1);
  return date;
}

const TOKEN = "APP_USR-a-token-long-enough";
const MINUTE = 60_000;

async function shop(service: Record<string, unknown> = {}, connected = true) {
  const mercadopago = await fakeMercadopago();
  const app = await createTestApp({ mercadopagoApiUrl: mercadopago.url });
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner, { currency: "COP" });
  const base = `/api/businesses/${business.id}`;
  if (connected) await owner.put(`${base}/payments`, { accessToken: TOKEN });
  const created = await owner.post(`${base}/services`, {
    name: "Corte",
    durationMin: 60,
    priceAmount: 50_000,
    ...service,
  });
  const customer = app.client();
  const date = nextSaturday();
  const book = (extra: Record<string, unknown> = {}, time = "10:00") =>
    customer.post("/api/public/businesses/fte-barber/bookings", {
      serviceId: created.body.service.id,
      resourceId: null,
      date,
      time,
      customer: { firstName: "Ana", lastName: "Pérez", phone: "+57 300 123 4567" },
      ...extra,
    });
  const look = (id: string) => customer.get(`/api/public/businesses/fte-barber/payments/${id}`);
  const free = async () => {
    const { body } = await customer.get(
      `/api/public/businesses/fte-barber/availability?serviceId=${created.body.service.id}&from=${date}&to=${date}`,
    );
    return body.days[date] as string[];
  };
  const deposits = async () => (await owner.get(`${base}/deposits`)).body.deposits;
  return {
    app,
    owner,
    base,
    business,
    book,
    look,
    free,
    deposits,
    mercadopago,
    created: created.body.service,
    sweep: (now: number) => app.app.automations.sweep(now),
  };
}

describe("online payments", () => {
  it("checks the account and never shows its token", async () => {
    const { owner, base } = await shop({}, false);
    const { status, body } = await owner.put(`${base}/payments`, { accessToken: TOKEN });
    expect(status).toBe(200);
    expect(body.connection).toMatchObject({
      accountId: "987",
      accountName: "Barber Shop",
      siteId: "MCO",
      testMode: false,
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(JSON.stringify((await owner.get(`${base}/payments`)).body)).not.toContain(TOKEN);
  });

  it("refuses a token Mercado Pago doesn't know", async () => {
    const { owner, base } = await shop({}, false);
    const { status, body } = await owner.put(`${base}/payments`, {
      accessToken: "bad-token-value",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("payment_token_invalid");
  });

  it("refuses an account in another currency", async () => {
    const { owner, base, mercadopago } = await shop({}, false);
    mercadopago.state.user.site_id = "MLA";
    const { status, body } = await owner.put(`${base}/payments`, { accessToken: TOKEN });
    expect(status).toBe(409);
    expect(body.error.code).toBe("payment_currency_mismatch");
  });

  it("marks test accounts", async () => {
    const { owner, base, mercadopago } = await shop({}, false);
    mercadopago.state.user.tags = ["test_user"];
    const { body } = await owner.put(`${base}/payments`, { accessToken: TOKEN });
    expect(body.connection.testMode).toBe(true);
  });

  it("keeps the account away from strangers and from AI agents' keys", async () => {
    const { app, owner, base } = await shop();
    expect((await app.client().get(`${base}/payments`)).status).toBe(401);
    const key = await owner.post(`${base}/api-keys`, { name: "Bot", kind: "admin" });
    const { status } = await app
      .client()
      .get(`${base}/payments`, { authorization: `Bearer ${key.body.token}` });
    expect(status).toBe(403);
  });

  it("refuses a deposit above the price", async () => {
    const { owner, base } = await shop();
    const { status, body } = await owner.post(`${base}/services`, {
      name: "Barba",
      durationMin: 30,
      priceAmount: 10_000,
      paymentMode: "deposit",
      depositAmount: 20_000,
    });
    expect(status).toBe(400);
    expect(body.error.fields.depositAmount).toBe("deposit_too_high");
  });

  it("books as before while the service asks for nothing", async () => {
    const { book, mercadopago } = await shop();
    const { status, body } = await book();
    expect(status).toBe(201);
    expect(body.appointment.status).toBe("confirmed");
    expect(body.payment).toBeNull();
    expect(mercadopago.created).toHaveLength(0);
  });

  it("ignores the payment settings once the account is disconnected", async () => {
    const { owner, base, book } = await shop({ paymentMode: "full" });
    await owner.delete(`${base}/payments`);
    const { body } = await book();
    expect(body.appointment.status).toBe("confirmed");
    expect(body.payment).toBeNull();
  });

  it("holds the time and sends the customer to pay", async () => {
    const { book, free, mercadopago, owner, base } = await shop({
      paymentMode: "deposit",
      depositAmount: 20_000,
    });
    expect(await free()).toContain("10:00");
    const { status, body } = await book();
    expect(status).toBe(201);
    expect(body.appointment.status).toBe("pending_payment");
    expect(body.payment.checkoutUrl).toBe("https://checkout.test/ORD1");
    expect(body.payment.amount).toBe(20_000);
    expect(await free()).not.toContain("10:00");

    expect(mercadopago.created[0]).toMatchObject({
      type: "online",
      processing_mode: "manual",
      external_reference: body.payment.id,
      total_amount: "20000",
      expiration_time: "PT15M",
      items: [{ title: "Corte", unit_price: "20000", quantity: 1 }],
      config: {
        online: {
          success_url: `http://localhost:3000/fte-barber?payment=${body.payment.id}`,
          auto_return: "all",
        },
      },
    });

    // The business can't act on it until it's paid or released.
    const { status: moved, body: refused } = await owner.patch(
      `${base}/appointments/${body.appointment.id}`,
      { serviceId: "any", resourceId: null, date: nextSaturday(), time: "12:00" },
    );
    expect(moved).toBe(409);
    expect(refused.error.code).toBe("appointment_unpaid");
  });

  it("shows a payment still waiting, and where to pay it", async () => {
    const { book, look } = await shop({ paymentMode: "full" });
    const { body } = await book();
    const { body: state } = await look(body.payment.id);
    expect(state.payment.status).toBe("pending");
    expect(state.payment.checkoutUrl).toBe("https://checkout.test/ORD1");
    expect(state.appointment.status).toBe("pending_payment");
  });

  it("asks where paying is optional only if the customer chose to", async () => {
    const { book } = await shop({ paymentMode: "optional" });
    const later = await book({ payNow: false });
    expect(later.body.appointment.status).toBe("confirmed");
    const now = await book({ payNow: true }, "12:00");
    expect(now.body.appointment.status).toBe("pending_payment");
    expect(now.body.payment.amount).toBe(50_000);
  });

  it("doesn't ask an AI agent to pay", async () => {
    const { app, owner, base, created } = await shop({ paymentMode: "full" });
    const key = await owner.post(`${base}/api-keys`, { name: "Bot", kind: "agent" });
    const { status, body } = await app.client().post(
      "/api/public/businesses/fte-barber/bookings",
      {
        serviceId: created.id,
        resourceId: null,
        date: nextSaturday(),
        time: "10:00",
        customer: { firstName: "Ana", lastName: "Pérez", phone: "+57 300 123 4567" },
        proof: "",
      },
      { authorization: `Bearer ${key.body.token}` },
    );
    expect(status).toBe(201);
    expect(body.appointment.status).toBe("confirmed");
  });

  it("confirms the appointment and records the deposit once paid", async () => {
    const { book, look, mercadopago, deposits } = await shop({
      paymentMode: "deposit",
      depositAmount: 20_000,
    });
    const { body } = await book();
    (mercadopago.orders.get("ORD1") as Order).status = "processed";
    const paid = await look(body.payment.id);
    expect(paid.body.payment.status).toBe("paid");
    expect(paid.body.payment.checkoutUrl).toBeNull();
    expect(paid.body.appointment.status).toBe("confirmed");

    const [deposit] = await deposits();
    expect(deposit).toMatchObject({
      amount: 20_000,
      method: "online",
      appointmentId: body.appointment.id,
    });
  });

  it("confirms from a notification, and only once", async () => {
    const { app, book, look, mercadopago, deposits } = await shop({ paymentMode: "full" });
    const { body } = await book();
    (mercadopago.orders.get("ORD1") as Order).status = "processed";
    const webhook = app.client();
    await webhook.post("/api/public/payments/mercadopago", { data: { id: "ORD1" } });
    await webhook.post("/api/public/payments/mercadopago", { data: { id: "ORD1" } });
    expect((await look(body.payment.id)).body.payment.status).toBe("paid");
    expect(await deposits()).toHaveLength(1);
  });

  it("answers notifications about orders it doesn't know", async () => {
    const { app } = await shop();
    const { status } = await app
      .client()
      .post("/api/public/payments/mercadopago", { data: { id: "ORD404" } });
    expect(status).toBe(200);
  });

  it("doesn't believe an order that belongs to another payment", async () => {
    const { app, book, look, mercadopago, deposits } = await shop({ paymentMode: "full" });
    const { body } = await book();
    const order = mercadopago.orders.get("ORD1") as Order;
    order.status = "processed";
    order.external_reference = "someone-else";
    await app.client().post("/api/public/payments/mercadopago", { data: { id: "ORD1" } });
    expect((await look(body.payment.id)).body.payment.status).toBe("pending");
    expect(await deposits()).toHaveLength(0);
  });

  it("frees the time when the payment fails", async () => {
    const { app, book, free, look, mercadopago } = await shop({ paymentMode: "full" });
    const { body } = await book();
    (mercadopago.orders.get("ORD1") as Order).status = "failed";
    await app.client().post("/api/public/payments/mercadopago", { data: { id: "ORD1" } });
    const { body: state } = await look(body.payment.id);
    expect(state.payment.status).toBe("failed");
    expect(state.appointment.status).toBe("cancelled");
    expect(await free()).toContain("10:00");
  });

  it("frees the time when nobody pays", async () => {
    const { book, free, look, mercadopago, sweep } = await shop({ paymentMode: "full" });
    const { body } = await book();
    await sweep(Date.now() + 10 * MINUTE);
    expect(await free()).not.toContain("10:00");
    await sweep(Date.now() + 20 * MINUTE);
    expect(await free()).toContain("10:00");
    expect((await look(body.payment.id)).body.payment.status).toBe("cancelled");
    expect(mercadopago.orders.get("ORD1")?.status).toBe("canceled");
  });

  it("confirms a payment that only a sweep finds out about", async () => {
    const { book, look, mercadopago, sweep } = await shop({ paymentMode: "full" });
    const { body } = await book();
    (mercadopago.orders.get("ORD1") as Order).status = "processed";
    await sweep(Date.now() + 2 * MINUTE);
    expect((await look(body.payment.id)).body.appointment.status).toBe("confirmed");
  });

  it("keeps the time while Mercado Pago can't say", async () => {
    const { book, free, mercadopago, sweep } = await shop({ paymentMode: "full" });
    await book();
    mercadopago.state.failReads = true;
    await sweep(Date.now() + 20 * MINUTE);
    expect(await free()).not.toContain("10:00");
  });

  it("keeps the time while a payment is under review", async () => {
    const { book, free, mercadopago, sweep } = await shop({ paymentMode: "full" });
    await book();
    (mercadopago.orders.get("ORD1") as Order).status = "processing";
    await sweep(Date.now() + 20 * MINUTE);
    expect(await free()).not.toContain("10:00");
  });

  it("gives the time back if the order can't be created", async () => {
    const { book, free, mercadopago } = await shop({ paymentMode: "full" });
    mercadopago.state.failOrders = true;
    const { status, body } = await book();
    expect(status).toBe(502);
    expect(body.error.code).toBe("payment_unavailable");
    expect(await free()).toContain("10:00");
  });

  it("charges what's left after a discount code", async () => {
    const { owner, base, book, mercadopago } = await shop({ paymentMode: "full" });
    await owner.post(`${base}/gift-cards`, {
      kind: "discount",
      code: "MITAD",
      percent: 50,
    });
    const { body } = await book({ giftCode: "MITAD" });
    expect(body.payment.amount).toBe(25_000);
    expect(mercadopago.created[0]).toMatchObject({ total_amount: "25000" });
  });

  it("picks up the same booking instead of calling the time taken", async () => {
    const { book, mercadopago } = await shop({ paymentMode: "full" });
    const first = await book();
    const again = await book();
    expect(again.status).toBe(200);
    expect(again.body.payment).toEqual(first.body.payment);
    expect(mercadopago.created).toHaveLength(1);
  });

  it("charges anew if what's owed changed", async () => {
    const { book, look, mercadopago } = await shop({ paymentMode: "optional" });
    const first = await book({ payNow: true });
    const later = await book({ payNow: false });
    expect(later.status).toBe(201);
    expect(later.body.payment).toBeNull();
    expect((await look(first.body.payment.id)).body.payment.status).toBe("abandoned");
    expect(mercadopago.orders.get("ORD1")?.status).toBe("canceled");
  });

  it("lets a new booking replace the one left unpaid", async () => {
    const { book, free, look, mercadopago } = await shop({ paymentMode: "full" });
    const first = await book();
    const second = await book({}, "11:00");
    expect(second.status).toBe(201);
    expect((await look(first.body.payment.id)).body.payment.status).toBe("abandoned");
    expect(mercadopago.orders.get("ORD1")?.status).toBe("canceled");
    expect(await free()).toContain("10:00");
    expect(await free()).not.toContain("11:00");
  });

  it("gives the time back when the customer cancels", async () => {
    const { app, book, free, mercadopago } = await shop({ paymentMode: "full" });
    const { body } = await book();
    const { status, body: state } = await app
      .client()
      .post(`/api/public/businesses/fte-barber/payments/${body.payment.id}/cancel`);
    expect(status).toBe(200);
    expect(state.payment.status).toBe("abandoned");
    expect(state.appointment.status).toBe("cancelled");
    expect(mercadopago.orders.get("ORD1")?.status).toBe("canceled");
    expect(await free()).toContain("10:00");
  });

  it("doesn't cancel a payment whose money already arrived", async () => {
    const { app, book, deposits, mercadopago } = await shop({ paymentMode: "full" });
    const { body } = await book();
    (mercadopago.orders.get("ORD1") as Order).status = "processed";
    const { body: state } = await app
      .client()
      .post(`/api/public/businesses/fte-barber/payments/${body.payment.id}/cancel`);
    expect(state.payment.status).toBe("paid");
    expect(state.appointment.status).toBe("confirmed");
    expect(await deposits()).toHaveLength(1);
  });

  it("keeps the time for a while if the order can't be cancelled", async () => {
    const { book, free, mercadopago, sweep } = await shop({ paymentMode: "full" });
    await book();
    mercadopago.state.failCancels = true;
    await sweep(Date.now() + 22 * MINUTE);
    expect(await free()).not.toContain("10:00");
    await sweep(Date.now() + 40 * MINUTE);
    expect(await free()).toContain("10:00");
  });

  /** Books, lets the hold run out, and has the money arrive afterwards. */
  async function latePayment(service = { paymentMode: "full" }) {
    const context = await shop(service);
    const { body } = await context.book();
    await context.sweep(Date.now() + 25 * MINUTE);
    expect((await context.look(body.payment.id)).body.payment.status).toBe("cancelled");
    const paid = (detail?: string) => {
      const order = context.mercadopago.orders.get("ORD1") as Order;
      order.status = "processed";
      order.status_detail = detail;
    };
    const notify = () =>
      context.app.client().post("/api/public/payments/mercadopago", { data: { id: "ORD1" } });
    return { ...context, paymentId: body.payment.id as string, paid, notify };
  }

  it("keeps the appointment when money arrives late and the time is free", async () => {
    const { paid, notify, look, paymentId, deposits, free } = await latePayment();
    paid();
    await notify();
    const { body } = await look(paymentId);
    expect(body.payment.status).toBe("paid");
    expect(body.appointment.status).toBe("confirmed");
    expect(await deposits()).toHaveLength(1);
    expect(await free()).not.toContain("10:00");
    await notify();
    expect(await deposits()).toHaveLength(1);
  });

  it("finds late money on a sweep", async () => {
    const { paid, sweep, look, paymentId } = await latePayment();
    paid();
    await sweep(Date.now() + 40 * MINUTE);
    expect((await look(paymentId)).body.payment.status).toBe("paid");
  });

  it("refunds late money when someone else took the time", async () => {
    const { book, paid, notify, look, paymentId, deposits, mercadopago, owner, base } =
      await latePayment();
    const other = await book({
      customer: { firstName: "Luz", lastName: "Gómez", phone: "+57 300 765 4321" },
    });
    expect(other.status).toBe(201);
    paid();
    await notify();
    expect((await look(paymentId)).body.payment.status).toBe("refunded");
    expect(mercadopago.orders.get("ORD1")?.status).toBe("refunded");
    expect(await deposits()).toHaveLength(0);
    const { body } = await owner.get(`${base}/payments`);
    expect(body.refunds).toEqual([
      expect.objectContaining({ id: paymentId, status: "refunded", firstName: "Ana" }),
    ]);
  });

  it("refunds money for a booking the customer gave up", async () => {
    const { app, book, free, look, mercadopago } = await shop({ paymentMode: "full" });
    const first = await book();
    await book({}, "11:00");
    (mercadopago.orders.get("ORD1") as Order).status = "processed";
    await app.client().post("/api/public/payments/mercadopago", { data: { id: "ORD1" } });
    expect((await look(first.body.payment.id)).body.payment.status).toBe("refunded");
    expect(await free()).toContain("10:00");
  });

  it("keeps trying a refund Mercado Pago refuses", async () => {
    const context = await latePayment();
    const { book, paid, notify, look, paymentId, mercadopago, sweep, owner, base } = context;
    await book({ customer: { firstName: "Luz", lastName: "Gómez", phone: "+57 300 765 4321" } });
    mercadopago.state.failRefunds = true;
    paid();
    await notify();
    expect((await look(paymentId)).body.payment.status).toBe("refunding");
    expect((await owner.get(`${base}/payments`)).body.refunds[0].status).toBe("refunding");
    mercadopago.state.failRefunds = false;
    await sweep(Date.now() + 2 * 60 * MINUTE);
    expect((await look(paymentId)).body.payment.status).toBe("refunded");
  });

  it("counts a refund the business made itself", async () => {
    const context = await latePayment();
    const { book, paid, notify, look, paymentId, mercadopago, sweep } = context;
    await book({ customer: { firstName: "Luz", lastName: "Gómez", phone: "+57 300 765 4321" } });
    mercadopago.state.failRefunds = true;
    paid();
    await notify();
    (mercadopago.orders.get("ORD1") as Order).status_detail = "refunded";
    await sweep(Date.now() + 2 * 60 * MINUTE);
    expect((await look(paymentId)).body.payment.status).toBe("refunded");
  });

  it("leaves alone an order that was already refunded", async () => {
    const { paid, notify, look, paymentId, deposits } = await latePayment();
    paid("refunded");
    await notify();
    expect((await look(paymentId)).body.payment.status).toBe("cancelled");
    expect(await deposits()).toHaveLength(0);
  });

  it("shows only the customer's business payment", async () => {
    const { app, book } = await shop({ paymentMode: "full" });
    await book();
    const { status } = await app
      .client()
      .get("/api/public/businesses/fte-barber/payments/not-a-payment");
    expect(status).toBe(404);
  });
});
