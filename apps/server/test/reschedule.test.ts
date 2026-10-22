import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

/** The next Saturday at least two days ahead, in Bogotá (default hours: 9–13). */
function nextSaturday(): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== 6) date = addDays(date, 1);
  return date;
}

async function shopWithTwoBarbers() {
  const app = await createTestApp();
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
  const haircut = (
    await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 20_000 })
  ).body.service;
  const max = (await owner.post(`${base}/professionals`, { name: "Max", serviceIds: [haircut.id] }))
    .body.professional;
  const leo = (await owner.post(`${base}/professionals`, { name: "Leo", serviceIds: [haircut.id] }))
    .body.professional;
  const saturday = nextSaturday();
  const book = (time: string, phone: string, resourceId: string | null = null) =>
    app.client().post("/api/public/businesses/fte-barber/bookings", {
      serviceId: haircut.id,
      resourceId,
      date: saturday,
      time,
      customer: { firstName: "Ana", lastName: "Pérez", phone },
    });
  return { app, owner, base, haircut, max, leo, saturday, book };
}

describe("choosing a time before a person", () => {
  it("says who is free at each time", async () => {
    const { app, haircut, max, leo, saturday, book } = await shopWithTwoBarbers();
    const query = `serviceId=${haircut.id}&from=${saturday}&to=${saturday}`;
    const before = await app
      .client()
      .get(`/api/public/businesses/fte-barber/availability?${query}`);
    expect(before.body.staff[saturday]["09:00"].sort()).toEqual([max.id, leo.id].sort());

    await book("09:00", "+57 300 000 0001", max.id);
    const after = await app.client().get(`/api/public/businesses/fte-barber/availability?${query}`);
    expect(after.body.staff[saturday]["09:00"]).toEqual([leo.id]);
  });
});

describe("rescheduling from the calendar", () => {
  it("moves an appointment to another time and professional", async () => {
    const { owner, base, haircut, max, saturday, book } = await shopWithTwoBarbers();
    const booked = (await book("09:00", "+57 300 000 0001")).body.appointment;
    const id = booked.id;

    // Its own time counts as free while moving it.
    const slots = await owner.get(
      `${base}/appointments/${id}/slots?serviceId=${haircut.id}&date=${saturday}`,
    );
    expect(slots.body.slots.map((slot: { time: string }) => slot.time)).toContain("09:00");

    const moved = await owner.patch(`${base}/appointments/${id}`, {
      serviceId: haircut.id,
      resourceId: max.id,
      date: saturday,
      time: "11:00",
    });
    expect(moved.status).toBe(200);
    expect(moved.body.appointment).toMatchObject({
      resourceName: "Max",
      priceAmount: 20_000,
      code: booked.code,
    });
    expect(Date.parse(moved.body.appointment.startsAt) - Date.parse(booked.startsAt)).toBe(
      2 * 60 * 60_000,
    );
  });

  it("refuses times that are taken, closed or for cancelled appointments", async () => {
    const { owner, base, haircut, max, saturday, book } = await shopWithTwoBarbers();
    const mine = (await book("09:00", "+57 300 000 0001", max.id)).body.appointment;
    await book("11:00", "+57 300 000 0002", max.id);

    const taken = await owner.patch(`${base}/appointments/${mine.id}`, {
      serviceId: haircut.id,
      resourceId: max.id,
      date: saturday,
      time: "11:00",
    });
    expect(taken.body.error.code).toBe("slot_taken");

    const closed = await owner.patch(`${base}/appointments/${mine.id}`, {
      serviceId: haircut.id,
      resourceId: max.id,
      date: saturday,
      time: "15:00",
    });
    expect(closed.body.error.code).toBe("slot_taken");

    await owner.post(`${base}/appointments/${mine.id}/cancel`, {});
    const cancelled = await owner.patch(`${base}/appointments/${mine.id}`, {
      serviceId: haircut.id,
      resourceId: null,
      date: saturday,
      time: "10:00",
    });
    expect(cancelled.body.error.code).toBe("appointment_cancelled");
  });
});

describe("the appointment list", () => {
  it("covers long periods and includes cancelled appointments on request", async () => {
    const { owner, base, book } = await shopWithTwoBarbers();
    const booked = (await book("09:00", "+57 300 000 0001")).body.appointment;
    await owner.post(`${base}/appointments/${booked.id}/cancel`, {});

    const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 300 * 86_400_000).toISOString();
    const active = await owner.get(`${base}/appointments?from=${from}&to=${to}`);
    expect(active.body.appointments).toEqual([]);
    const all = await owner.get(`${base}/appointments?from=${from}&to=${to}&includeCancelled=true`);
    expect(all.body.appointments).toEqual([
      expect.objectContaining({ code: booked.code, status: "cancelled" }),
    ]);
    expect(all.body.appointments[0].cancelledAt).toBeTruthy();
  });
});
