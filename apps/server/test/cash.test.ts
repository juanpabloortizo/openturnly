import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

function next(weekday: number): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== weekday) date = addDays(date, 1);
  return date;
}

describe("cash register", () => {
  it("adds up sales, deposits, internal sales, gift cards, income and expenses", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const base = `/api/businesses/${business.id}`;
    await owner.patch(base, { closedOnHolidays: false });
    const [main] = (await owner.get(`${base}/locations`)).body.locations;
    const north = (
      await owner.post(`${base}/locations`, { name: "Norte", serviceIds: [], resourceIds: [] })
    ).body.location;
    const haircut = (
      await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 30_000 })
    ).body.service;
    const appointment = (
      await owner.post(`${base}/appointments`, {
        locationId: main.id,
        serviceId: haircut.id,
        resourceId: null,
        date: next(6),
        time: "09:00",
        customer: { firstName: "Ana", lastName: "Pérez", phone: "+57 300 123 4567", email: null },
      })
    ).body.appointment;

    // A 10.000 cash deposit, then the appointment charged: deposit + 15.000 card + 5.000 cash.
    const deposit = (
      await owner.post(`${base}/deposits`, {
        customerId: appointment.customerId,
        appointmentId: appointment.id,
        amount: 10_000,
        method: "cash",
      })
    ).body.deposit;
    const charged = await owner.post(`${base}/sales`, {
      items: [
        {
          kind: "service",
          serviceId: haircut.id,
          appointmentId: appointment.id,
          unitPrice: 30_000,
        },
      ],
      payments: [
        { method: "deposit", amount: 10_000, depositId: deposit.id },
        { method: "card", amount: 15_000 },
        { method: "cash", amount: 5_000 },
      ],
    });
    expect(charged.status).toBe(201);
    // An internal sale, a gift card sold, other income and an expense.
    await owner.post(`${base}/sales`, {
      internal: true,
      locationId: main.id,
      items: [{ kind: "service", serviceId: haircut.id, unitPrice: 8_000 }],
      payments: [{ method: "cash", amount: 8_000 }],
    });
    await owner.post(`${base}/gift-cards`, {
      kind: "balance",
      code: "GC-1",
      amount: 50_000,
      paidWith: "transfer",
      locationId: main.id,
    });
    const move = (body: Record<string, unknown>) =>
      owner.post(`${base}/cash/movements`, { locationId: main.id, ...body });
    expect(
      (await move({ kind: "income", amount: 2_000, method: "cash", category: "Propina caja" }))
        .status,
    ).toBe(201);
    expect(
      (await move({ kind: "expense", amount: 7_000, method: "cash", category: "Aseo" })).status,
    ).toBe(201);

    const range = `from=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`;
    const report = (await owner.get(`${base}/cash?${range}&locationId=${main.id}`)).body;
    expect(report.flows).toEqual({
      sales: 20_000,
      deposits: 10_000,
      internal: 8_000,
      giftCards: 50_000,
      otherIncome: 2_000,
      expenses: 7_000,
      result: 83_000,
    });
    expect(report.byMethod).toEqual({ cash: 18_000, card: 15_000, transfer: 50_000, other: 0 });
    // Cash: 10.000 deposit + 5.000 + 8.000 + 2.000 − 7.000.
    expect(report.cashInDrawer).toBe(18_000);

    // 5.000 cash to Norte, then a count of 12.000 at the main drawer.
    const transfer = await move({ kind: "transfer", amount: 5_000, toLocationId: north.id });
    expect(transfer.body.cashInDrawer).toBe(13_000);
    const counted = await move({ kind: "adjustment", counted: 12_000, description: "Conteo" });
    expect(counted.body.cashInDrawer).toBe(12_000);
    expect((await move({ kind: "adjustment", counted: 12_000 })).status).toBe(409);
    const atNorth = (await owner.get(`${base}/cash?${range}&locationId=${north.id}`)).body;
    expect(atNorth.cashInDrawer).toBe(5_000);

    // Undoing the transfer removes both halves.
    const transferOut = (
      await owner.get(`${base}/cash?${range}&locationId=${main.id}`)
    ).body.movements.find((row: { kind: string }) => row.kind === "transfer_out");
    expect((await owner.delete(`${base}/cash/movements/${transferOut.id}`)).status).toBe(204);
    expect(
      (await owner.get(`${base}/cash?${range}&locationId=${north.id}`)).body.cashInDrawer,
    ).toBe(0);
  });
});
