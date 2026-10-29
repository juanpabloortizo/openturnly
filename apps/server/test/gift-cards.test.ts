import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner, type TestClient } from "./helpers.ts";

/** A date at least two days ahead that falls on `weekday` (0 = Sunday), in Bogotá. */
function next(weekday: number): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== weekday) date = addDays(date, 1);
  return date;
}

const customer = (n: number) => ({
  firstName: "Ana",
  lastName: `Cliente ${n}`,
  phone: `+57 300 123 45${String(n).padStart(2, "0")}`,
  email: null,
});

async function shop() {
  const app = await createTestApp();
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
  await owner.patch(base, { closedOnHolidays: false });
  const haircut = (
    await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 40_000 })
  ).body.service;
  return { app, owner, business, base, haircut };
}

const book = (client: TestClient, body: Record<string, unknown>) =>
  client.post("/api/public/businesses/fte-barber/bookings", { resourceId: null, ...body });

describe("gift cards", () => {
  it("takes a discount code on the booking page, up to its uses", async () => {
    const { app, owner, base, haircut } = await shop();
    const created = await owner.post(`${base}/gift-cards`, {
      kind: "discount",
      code: "verano20",
      percent: 20,
      maxUses: 1,
    });
    expect(created.status).toBe(201);
    expect(created.body.giftCard).toMatchObject({ code: "VERANO20", state: "active", uses: 0 });

    const visitor = app.client();
    const check = await visitor.post("/api/public/businesses/fte-barber/gift-code", {
      code: "Verano20",
      serviceId: haircut.id,
    });
    expect(check.body).toMatchObject({ discountAmount: 8_000, priceAmount: 40_000 });

    const saturday = next(6);
    const booked = await book(visitor, {
      serviceId: haircut.id,
      date: saturday,
      time: "09:00",
      customer: customer(1),
      giftCode: "verano20",
    });
    expect(booked.status).toBe(201);
    expect(booked.body.appointment.discountAmount).toBe(8_000);

    // Its only use is taken; cancelling the appointment gives it back.
    const second = await book(visitor, {
      serviceId: haircut.id,
      date: saturday,
      time: "11:00",
      customer: customer(2),
      giftCode: "VERANO20",
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toEqual({ code: "gift_card_unusable", fields: { code: "used_up" } });
    await owner.post(`${base}/appointments/${booked.body.appointment.id}/cancel`, {});
    const list = (await owner.get(`${base}/gift-cards`)).body.giftCards;
    expect(list[0]).toMatchObject({ uses: 0, state: "active" });

    // Unknown codes read as not found.
    const unknown = await visitor.post("/api/public/businesses/fte-barber/gift-code", {
      code: "NOPE",
      serviceId: haircut.id,
    });
    expect(unknown.status).toBe(404);
  });

  it("sells a gift card and spends its balance at the counter", async () => {
    const { owner, base, haircut } = await shop();
    const sold = await owner.post(`${base}/gift-cards`, {
      kind: "balance",
      code: "GC-ANA",
      amount: 50_000,
      paidWith: "card",
    });
    expect(sold.status).toBe(201);
    const card = sold.body.giftCard;
    expect(card).toMatchObject({ remaining: 50_000, state: "active" });

    // Selling it was a sale.
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const range = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const sales = (await owner.get(`${base}/sales?${range}`)).body.sales;
    expect(sales[0]).toMatchObject({ number: 1, total: 50_000 });
    expect(sales[0].items[0]).toMatchObject({ kind: "gift_card", giftCardId: card.id });

    const line = { kind: "service", serviceId: haircut.id, unitPrice: 40_000 };
    const spend = await owner.post(`${base}/sales`, {
      items: [line],
      payments: [{ method: "gift_card", giftCardId: card.id, amount: 40_000 }],
    });
    expect(spend.status).toBe(201);
    const lookup = await owner.get(`${base}/gift-cards/lookup?code=gc-ana`);
    expect(lookup.body.giftCard.remaining).toBe(10_000);

    // More than what's left is refused.
    const over = await owner.post(`${base}/sales`, {
      items: [line],
      payments: [
        { method: "gift_card", giftCardId: card.id, amount: 20_000 },
        { method: "cash", amount: 20_000 },
      ],
    });
    expect(over.body.error.code).toBe("gift_card_balance");

    // Used cards can't be deleted; voiding the sale that sold it turns it off.
    expect((await owner.delete(`${base}/gift-cards/${card.id}`)).status).toBe(409);
    await owner.post(`${base}/sales/${sales[0].id}/void`, {});
    expect((await owner.get(`${base}/gift-cards/lookup?code=GC-ANA`)).body.giftCard.state).toBe(
      "inactive",
    );
  });

  it("applies a discount code at the counter and keeps codes unique", async () => {
    const { owner, base, haircut } = await shop();
    const code = (
      await owner.post(`${base}/gift-cards`, {
        kind: "discount",
        code: "AMIGO",
        amount: 5_000,
        validUntil: addDays(todayIn("America/Bogota"), 30),
      })
    ).body.giftCard;
    const twice = await owner.post(`${base}/gift-cards`, {
      kind: "discount",
      code: "amigo",
      percent: 5,
    });
    expect(twice.status).toBe(409);
    const both = await owner.post(`${base}/gift-cards`, {
      kind: "discount",
      code: "BOTH",
      percent: 10,
      amount: 1_000,
    });
    expect(both.status).toBe(400);

    const sale = await owner.post(`${base}/sales`, {
      giftCardId: code.id,
      items: [{ kind: "service", serviceId: haircut.id, unitPrice: 40_000 }],
      discountAmount: 5_000,
      payments: [{ method: "cash", amount: 35_000 }],
    });
    expect(sale.status).toBe(201);
    expect((await owner.get(`${base}/gift-cards`)).body.giftCards[0].uses).toBe(1);

    // Expired codes stop working.
    await owner.patch(`${base}/gift-cards/${code.id}`, {
      validFrom: addDays(todayIn("America/Bogota"), -10),
      validUntil: addDays(todayIn("America/Bogota"), -1),
    });
    const late = await owner.post(`${base}/sales`, {
      giftCardId: code.id,
      items: [{ kind: "service", serviceId: haircut.id, unitPrice: 40_000 }],
      discountAmount: 5_000,
      payments: [{ method: "cash", amount: 35_000 }],
    });
    expect(late.body.error).toEqual({ code: "gift_card_unusable", fields: { code: "expired" } });
  });
});
