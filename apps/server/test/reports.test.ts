import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

describe("reports", () => {
  it("adds up bookings, occupancy, sales, tips and commissions", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const base = `/api/businesses/${business.id}`;
    await owner.patch(base, { closedOnHolidays: false });
    const haircut = (
      await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 40_000 })
    ).body.service;
    const juan = (
      await owner.post(`${base}/professionals`, {
        name: "Juan",
        serviceIds: [haircut.id],
        serviceCommission: 40,
        productCommission: 10,
      })
    ).body.professional;
    const wax = (
      await owner.post(`${base}/products`, { name: "Cera", priceAmount: 20_000, initialStock: 5 })
    ).body.product;
    const today = todayIn("America/Bogota");
    // Next week, Monday to Sunday: Juan's default hours (Mon–Fri 9–18, Sat 9–13 = 49 h).
    let monday = addDays(today, 1);
    while (weekdayOf(monday) !== 1) monday = addDays(monday, 1);
    const period = { from: monday, to: addDays(monday, 6) };
    const booked = await owner.post(`${base}/appointments`, {
      serviceId: haircut.id,
      resourceId: juan.id,
      date: period.from,
      time: "09:00",
      customer: { firstName: "Ana", lastName: "Pérez", phone: "+57 300 123 4567", email: null },
    });
    expect(booked.status).toBe(201);

    // A sale today: a service with a 20 % discount on the whole sale, a product and a tip.
    const sale = await owner.post(`${base}/sales`, {
      items: [
        { kind: "service", serviceId: haircut.id, resourceId: juan.id, unitPrice: 40_000 },
        { kind: "product", productId: wax.id, resourceId: juan.id, unitPrice: 20_000 },
      ],
      discountAmount: 12_000,
      tips: [{ resourceId: juan.id, amount: 5_000 }],
      payments: [{ method: "cash", amount: 53_000 }],
    });
    expect(sale.status).toBe(201);

    const query = (from: string, to: string) => `from=${from}&to=${to}`;
    const todayReport = (await owner.get(`${base}/reports/summary?${query(today, today)}`)).body;
    expect(todayReport.current.billed).toBe(48_000);
    expect(todayReport.topServices.map((row: { name: string }) => row.name)).toEqual([
      "Corte",
      "Cera",
    ]);

    const week = (await owner.get(`${base}/reports/summary?${query(period.from, period.to)}`)).body;
    expect(week.current.bookings).toBe(1);
    expect(week.current.occupancy).toBeCloseTo(1 / 49, 5);
    expect(week.origin).toEqual({ admin: 1 });

    const tips = (await owner.get(`${base}/reports/tips?${query(today, today)}`)).body;
    expect(tips.totals).toEqual([{ name: "Juan", amount: 5_000, count: 1 }]);

    // 48.000 / 60.000 of each line: service 32.000 × 40 % + product 16.000 × 10 % + tip.
    const commissions = (await owner.get(`${base}/reports/commissions?${query(today, today)}`)).body
      .professionals;
    expect(commissions).toEqual([
      expect.objectContaining({
        name: "Juan",
        services: 32_000,
        serviceCommission: 12_800,
        products: 16_000,
        productCommission: 1_600,
        tips: 5_000,
        total: 19_400,
      }),
    ]);
  });
});
