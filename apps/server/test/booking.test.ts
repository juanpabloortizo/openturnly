import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { holidaysBetween } from "../src/lib/holidays.ts";
import {
  addMember,
  createBusiness,
  createTestApp,
  setUpOwner,
  type TestClient,
} from "./helpers.ts";

/** A date at least two days ahead that falls on `weekday` (0 = Sunday), in Bogotá. */
function next(weekday: number): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== weekday) date = addDays(date, 1);
  return date;
}

const customer = {
  email: "ana@example.com",
  phone: "+57 300 123 4567",
  firstName: "Ana",
  lastName: "Pérez",
};

async function barbershop() {
  const app = await createTestApp();
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
  const haircut = (
    await owner.post(`${base}/services`, {
      name: "Corte clásico",
      durationMin: 60,
      priceAmount: 25_000,
    })
  ).body.service;
  return { app, owner, business, base, haircut };
}

const book = (client: TestClient, body: Record<string, unknown>) =>
  client.post("/api/public/businesses/fte-barber/bookings", {
    resourceId: null,
    customer,
    ...body,
  });

const availability = (client: TestClient, query: string) =>
  client.get(`/api/public/businesses/fte-barber/availability?${query}`);

describe("catalog", () => {
  it("manages services and professionals", async () => {
    const { owner, base, haircut } = await barbershop();
    const beard = (
      await owner.post(`${base}/services`, { name: "Barba", durationMin: 30, priceAmount: 15_000 })
    ).body.service;
    // The price is always shown, so it is required.
    const noPrice = await owner.post(`${base}/services`, {
      name: "Cejas",
      durationMin: 15,
      priceAmount: null,
    });
    expect(noPrice.status).toBe(400);

    const max = await owner.post(`${base}/professionals`, {
      name: "Max",
      serviceIds: [haircut.id],
    });
    expect(max.status).toBe(201);

    const list = await owner.get(`${base}/professionals`);
    expect(list.body.professionals).toEqual([
      expect.objectContaining({ name: "Max", serviceIds: [haircut.id], hasOwnHours: false }),
    ]);

    // Someone who offers nothing bookable is not shown to customers.
    await owner.post(`${base}/professionals`, { name: "Nadie", serviceIds: [] });
    const page = await owner.get("/api/public/businesses/fte-barber");
    expect(page.body.professionals.map((member: { name: string }) => member.name)).toEqual(["Max"]);

    // A service created later is offered by everyone.
    const shave = (
      await owner.post(`${base}/services`, { name: "Afeitado", durationMin: 30, priceAmount: 0 })
    ).body.service;
    const after = await owner.get(`${base}/professionals`);
    expect(after.body.professionals[0].serviceIds.sort()).toEqual([haircut.id, shave.id].sort());

    await owner.patch(`${base}/services/${beard.id}`, { active: false });
    expect((await owner.delete(`${base}/professionals/${max.body.professional.id}`)).status).toBe(
      204,
    );
  });

  it("validates hours", async () => {
    const { owner, base } = await barbershop();
    const overlap = await owner.put(`${base}/hours`, {
      resourceId: null,
      hours: [
        { weekday: 1, start: "09:00", end: "13:00" },
        { weekday: 1, start: "12:00", end: "18:00" },
      ],
    });
    expect(overlap.status).toBe(400);
    expect(overlap.body.error.fields).toEqual({ hours: "hours_overlap" });

    const split = await owner.put(`${base}/hours`, {
      resourceId: null,
      hours: [
        { weekday: 1, start: "09:00", end: "12:00" },
        { weekday: 1, start: "14:00", end: "18:00" },
      ],
    });
    expect(split.status).toBe(200);
    expect((await owner.get(`${base}/hours`)).body.business).toHaveLength(2);
  });

  it("keeps businesses apart", async () => {
    const { app, owner, base } = await barbershop();
    const other = await createBusiness(owner, { name: "Spa", slug: "spa-luna" });
    const member = await addMember(app, owner, other.id);
    expect((await member.get(`${base}/services`)).status).toBe(404);
    expect((await member.get(`/api/businesses/${other.id}/services`)).status).toBe(200);
  });
});

describe("public booking", () => {
  it("shows the catalog and free times", async () => {
    const { app, haircut } = await barbershop();
    const visitor = app.client();

    const page = await visitor.get("/api/public/businesses/fte-barber");
    expect(page.body.services).toEqual([
      expect.objectContaining({ name: "Corte clásico", durationMin: 60, priceAmount: 25_000 }),
    ]);
    expect(page.body.professionals).toEqual([]);

    const saturday = next(6);
    const res = await availability(
      visitor,
      `serviceId=${haircut.id}&from=${saturday}&to=${addDays(saturday, 1)}`,
    );
    // Default hours: Saturday 09:00–13:00, Sunday closed.
    expect(res.body.days).toEqual({
      [saturday]: ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"],
    });
  });

  it("books a free time once and only once", async () => {
    const { app, owner, base, haircut } = await barbershop();
    const saturday = next(6);

    const first = await book(app.client(), {
      serviceId: haircut.id,
      date: saturday,
      time: "10:00",
    });
    expect(first.status).toBe(201);
    expect(first.body.appointment).toMatchObject({
      serviceName: "Corte clásico",
      date: saturday,
      time: "10:00",
      currency: "COP",
    });

    const second = await book(app.client(), {
      serviceId: haircut.id,
      date: saturday,
      time: "10:30",
      customer: { ...customer, email: "leo@example.com", phone: "+57 310 000 0001" },
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("slot_taken");

    // The same person again (same number, even with another email) is told what they
    // already have instead.
    const samePerson = await book(app.client(), {
      serviceId: haircut.id,
      date: saturday,
      time: "10:30",
      customer: { ...customer, email: "otra@example.com", phone: "300 123 4567" },
    });
    expect(samePerson.status).toBe(409);
    expect(samePerson.body.error).toEqual({
      code: "already_booked",
      fields: { code: first.body.appointment.code, startsAt: first.body.appointment.startsAt },
    });

    const free = await availability(
      app.client(),
      `serviceId=${haircut.id}&from=${saturday}&to=${saturday}`,
    );
    expect(free.body.days[saturday]).toEqual(["09:00", "11:00", "11:30", "12:00"]);

    const from = new Date(`${saturday}T00:00:00-05:00`).toISOString();
    const to = new Date(`${addDays(saturday, 1)}T00:00:00-05:00`).toISOString();
    const agenda = await owner.get(`${base}/appointments?from=${from}&to=${to}`);
    expect(agenda.body.appointments).toEqual([
      expect.objectContaining({
        serviceName: "Corte clásico",
        status: "confirmed",
        customer: expect.objectContaining({
          firstName: "Ana",
          email: "ana@example.com",
          // Stored without spaces, with the country code.
          phone: "+573001234567",
        }),
      }),
    ]);

    // Cancelling frees the time again.
    const id = agenda.body.appointments[0].id;
    expect((await owner.post(`${base}/appointments/${id}/cancel`)).status).toBe(200);
    const again = await book(app.client(), {
      serviceId: haircut.id,
      date: saturday,
      time: "10:30",
    });
    expect(again.status).toBe(201);
  });

  it("lets only one of two simultaneous bookings take the same time", async () => {
    const { app, haircut } = await barbershop();
    const saturday = next(6);
    const attempt = (email: string) =>
      book(app.client(), {
        serviceId: haircut.id,
        date: saturday,
        time: "11:00",
        customer: { ...customer, email },
      });

    const results = await Promise.all([attempt("one@example.com"), attempt("two@example.com")]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  });

  it("assigns anyone available and respects each professional's services", async () => {
    const { app, owner, base, haircut } = await barbershop();
    const max = (
      await owner.post(`${base}/professionals`, { name: "Max", serviceIds: [haircut.id] })
    ).body.professional;
    const leo = (
      await owner.post(`${base}/professionals`, { name: "Leo", serviceIds: [haircut.id] })
    ).body.professional;
    const saturday = next(6);

    const first = await book(app.client(), {
      serviceId: haircut.id,
      date: saturday,
      time: "09:00",
      resourceId: max.id,
    });
    expect(first.body.appointment.resourceName).toBe("Max");

    // Max is busy at 09:00, so "anyone" goes to Leo.
    const second = await book(app.client(), {
      serviceId: haircut.id,
      date: saturday,
      time: "09:00",
      customer: { ...customer, email: "leo-client@example.com", phone: "+57 310 000 0002" },
    });
    expect(second.body.appointment.resourceName).toBe("Leo");

    // Both busy now.
    const third = await book(app.client(), {
      serviceId: haircut.id,
      date: saturday,
      time: "09:30",
      customer: { ...customer, email: "third@example.com", phone: "+57 310 000 0003" },
    });
    expect(third.status).toBe(409);

    // Leo stops offering the haircut: only Max's times remain.
    await owner.patch(`${base}/professionals/${leo.id}`, { serviceIds: [] });
    const onlyMax = await availability(
      app.client(),
      `serviceId=${haircut.id}&resourceId=${leo.id}&from=${saturday}&to=${saturday}`,
    );
    expect(onlyMax.body.days).toEqual({});
  });

  it("uses each professional's own hours and closed days", async () => {
    const { app, owner, base, haircut } = await barbershop();
    const max = (
      await owner.post(`${base}/professionals`, { name: "Max", serviceIds: [haircut.id] })
    ).body.professional;
    const saturday = next(6);
    const monday = next(1);

    const put = await owner.put(`${base}/hours`, {
      resourceId: max.id,
      hours: [{ weekday: 6, start: "11:00", end: "13:00" }],
    });
    expect(put.status).toBe(200);

    const sat = await availability(
      app.client(),
      `serviceId=${haircut.id}&from=${saturday}&to=${saturday}`,
    );
    expect(sat.body.days[saturday]).toEqual(["11:00", "11:30", "12:00"]);

    const closed = await owner.post(`${base}/closures`, { date: saturday, resourceId: null });
    expect(closed.status).toBe(201);
    const none = await availability(
      app.client(),
      `serviceId=${haircut.id}&from=${saturday}&to=${monday}`,
    );
    expect(Object.keys(none.body.days)).toEqual([]);
  });

  it("closes several days in a row", async () => {
    const { app, owner, base, haircut } = await barbershop();
    // Public holidays (a Monday, often) would close days this test expects open.
    await owner.patch(base, { closedOnHolidays: false });
    const saturday = next(6);
    const monday = addDays(saturday, 2);
    const tuesday = addDays(saturday, 3);
    const query = `serviceId=${haircut.id}&from=${saturday}&to=${tuesday}`;
    expect(Object.keys((await availability(app.client(), query)).body.days)).toContain(monday);

    const closed = await owner.post(`${base}/closures`, {
      date: saturday,
      endDate: monday,
      resourceId: null,
      note: "Vacaciones",
    });
    expect(closed.status).toBe(201);
    expect(closed.body.closure).toEqual(
      expect.objectContaining({ date: saturday, endDate: monday, note: "Vacaciones" }),
    );
    expect(Object.keys((await availability(app.client(), query)).body.days)).toEqual([tuesday]);

    // Overlapping or backwards ranges are refused.
    const overlap = await owner.post(`${base}/closures`, { date: monday, resourceId: null });
    expect(overlap.status).toBe(409);
    const backwards = await owner.post(`${base}/closures`, {
      date: tuesday,
      endDate: saturday,
      resourceId: null,
    });
    expect(backwards.body.error.fields).toEqual({ endDate: "end_before_start" });
  });

  it("rejects bots, bad input and customers with too many bookings", async () => {
    const { app, haircut } = await barbershop();
    const saturday = next(6);
    const visitor = app.client();

    const bot = await book(visitor, {
      serviceId: haircut.id,
      date: saturday,
      time: "09:00",
      website: "http://spam.example",
    });
    expect(bot.status).toBe(400);

    const bad = await book(visitor, {
      serviceId: haircut.id,
      date: saturday,
      time: "09:00",
      customer: { ...customer, phone: "abc" },
    });
    expect(bad.body.error.fields).toMatchObject({ "customer.phone": "invalid_phone" });

    for (const time of ["09:00", "10:00", "11:00"]) {
      expect((await book(visitor, { serviceId: haircut.id, date: saturday, time })).status).toBe(
        201,
      );
    }
    const fourth = await book(visitor, { serviceId: haircut.id, date: saturday, time: "12:00" });
    expect(fourth.body.error.code).toBe("too_many_bookings");
  });
});

describe("public holidays", () => {
  /** The next Colombian public holiday that is not a Sunday (the default hours close Sundays). */
  function nextHoliday() {
    const today = todayIn("America/Bogota");
    const holiday = holidaysBetween("CO", addDays(today, 2), addDays(today, 360)).find(
      (candidate) => weekdayOf(candidate.date) !== 0,
    );
    if (!holiday) throw new Error("no upcoming holiday found");
    return holiday;
  }

  it("closes on the country's holidays, detected from the time zone", async () => {
    const { app, owner, base, haircut } = await barbershop();
    await owner.patch(base, { maxAdvanceDays: 365 });
    const holiday = nextHoliday();
    const query = `serviceId=${haircut.id}&from=${holiday.date}&to=${holiday.date}`;

    expect((await availability(app.client(), query)).body.days).toEqual({});

    const list = await owner.get(`${base}/holidays?lang=es`);
    expect(list.body.country).toBe("CO");
    expect(list.body.holidays).toContainEqual(
      expect.objectContaining({ date: holiday.date, closed: true }),
    );

    // Open just this holiday.
    await owner.put(`${base}/holidays/${holiday.date}`, { closed: false });
    expect(Object.keys((await availability(app.client(), query)).body.days)).toEqual([
      holiday.date,
    ]);
  });

  it("can stay open on holidays, and the switch resets single-day exceptions", async () => {
    const { app, owner, base, haircut } = await barbershop();
    await owner.patch(base, { maxAdvanceDays: 365 });
    const holiday = nextHoliday();
    const query = `serviceId=${haircut.id}&from=${holiday.date}&to=${holiday.date}`;

    await owner.put(`${base}/holidays/${holiday.date}`, { closed: false });
    await owner.patch(base, { closedOnHolidays: false });
    const list = await owner.get(`${base}/holidays`);
    expect(list.body.holidays.every((entry: { closed: boolean }) => !entry.closed)).toBe(true);
    expect(Object.keys((await availability(app.client(), query)).body.days)).toEqual([
      holiday.date,
    ]);

    // Close only this one again.
    await owner.put(`${base}/holidays/${holiday.date}`, { closed: true });
    expect((await availability(app.client(), query)).body.days).toEqual({});
  });

  it("follows the time zone's country, and resets exceptions when it changes", async () => {
    const { owner, base } = await barbershop();
    await owner.patch(base, { maxAdvanceDays: 365 });
    const holiday = nextHoliday();
    await owner.put(`${base}/holidays/${holiday.date}`, { closed: false });

    // Another city in the same country keeps the exceptions.
    await owner.patch(base, { timezone: "America/Bogota" });
    const same = await owner.get(`${base}/holidays`);
    expect(same.body.holidays).toContainEqual(
      expect.objectContaining({ date: holiday.date, closed: false }),
    );

    const moved = await owner.patch(base, { timezone: "America/Mexico_City" });
    expect(moved.status).toBe(200);
    const list = await owner.get(`${base}/holidays`);
    expect(list.body.country).toBe("MX");
    expect(list.body.holidays.every((entry: { closed: boolean }) => entry.closed)).toBe(true);
  });
});
