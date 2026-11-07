import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { appointments } from "../src/db/schema.ts";
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
      await owner.post(`${base}/products`, {
        name: "Cera",
        priceAmount: 20_000,
        initialStock: [
          { locationId: (await owner.get(`${base}/locations`)).body.locations[0].id, quantity: 5 },
        ],
      })
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
    expect(todayReport.series).toEqual({
      unit: "day",
      points: [{ start: today, bookings: 0, billed: 48_000 }],
    });
    expect(todayReport.topServices.map((row: { name: string }) => row.name)).toEqual([
      "Corte",
      "Cera",
    ]);

    const week = (await owner.get(`${base}/reports/summary?${query(period.from, period.to)}`)).body;
    expect(week.current.bookings).toBe(1);
    expect(week.current.occupancy).toBeCloseTo(1 / 49, 5);
    expect(week.origin).toEqual({ admin: 1 });
    // The chart has every day of the week, the booking on Monday.
    expect(week.series.unit).toBe("day");
    expect(week.series.points.map((point: { bookings: number }) => point.bookings)).toEqual([
      1, 0, 0, 0, 0, 0, 0,
    ]);
    // Longer periods are grouped by week (from Monday) and by month.
    const quarter = (
      await owner.get(`${base}/reports/summary?${query(period.from, addDays(period.from, 90))}`)
    ).body;
    expect(quarter.series.unit).toBe("week");
    expect(quarter.series.points).toHaveLength(13);
    expect(quarter.series.points[0]).toEqual({ start: period.from, bookings: 1, billed: 0 });
    const year = (await owner.get(`${base}/reports/summary?${query("2026-01-15", "2026-12-31")}`))
      .body;
    expect(year.series.points.map((point: { start: string }) => point.start).slice(0, 3)).toEqual([
      "2026-01-15",
      "2026-02-01",
      "2026-03-01",
    ]);

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

  it("counts an appointment as paid once its deposits cover the price", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const base = `/api/businesses/${business.id}`;
    const { customer } = (
      await owner.post(`${base}/customers`, {
        firstName: "Ana",
        lastName: "Pérez",
        phone: "+57 300 123 4567",
      })
    ).body;
    const now = Date.now();
    const [appointment] = await app.db
      .insert(appointments)
      .values({
        code: "PAID01",
        businessId: business.id,
        customerId: customer.id,
        startsAt: new Date(now),
        endsAt: new Date(now + 30 * 60_000),
        serviceName: "Corte",
        priceAmount: 5_000,
      })
      .returning();
    const today = todayIn("America/Bogota");
    const paid = async () =>
      (await owner.get(`${base}/reports/summary?from=${today}&to=${today}`)).body.today[0].paid;
    const leave = (amount: number) =>
      owner.post(`${base}/deposits`, {
        customerId: customer.id,
        appointmentId: appointment?.id,
        amount,
        method: "cash",
      });

    expect(await paid()).toBe(false);
    await leave(2_000);
    expect(await paid()).toBe(false);
    await leave(3_000);
    expect(await paid()).toBe(true);
  });
});
