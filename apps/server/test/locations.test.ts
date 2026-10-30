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
  email: `client${n}@example.com`,
  phone: `+57 300 123 45${String(n).padStart(2, "0")}`,
  firstName: "Ana",
  lastName: `Cliente ${n}`,
});

/**
 * A barbershop with two locations: "Centro" (the first, renamed) with Juan and Pedro, and
 * "Norte" with Juan only. Juan does both services; Norte only offers the haircut.
 */
async function twoLocations() {
  const app = await createTestApp();
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
  // Public holidays would close days these tests expect open.
  await owner.patch(base, { closedOnHolidays: false });
  const haircut = (
    await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 25_000 })
  ).body.service;
  const beard = (
    await owner.post(`${base}/services`, { name: "Barba", durationMin: 30, priceAmount: 15_000 })
  ).body.service;
  const juan = (
    await owner.post(`${base}/professionals`, {
      name: "Juan",
      serviceIds: [haircut.id, beard.id],
    })
  ).body.professional;
  const pedro = (
    await owner.post(`${base}/professionals`, { name: "Pedro", serviceIds: [haircut.id] })
  ).body.professional;
  const [centro] = (await owner.get(`${base}/locations`)).body.locations;
  await owner.patch(`${base}/locations/${centro.id}`, { name: "Centro" });
  const created = await owner.post(`${base}/locations`, {
    name: "Norte",
    address: "Calle 100 #15-20",
    serviceIds: [haircut.id],
    resourceIds: [juan.id],
  });
  expect(created.status).toBe(201);
  const norte = created.body.location;
  return { app, owner, base, haircut, beard, juan, pedro, centro, norte };
}

const book = (client: TestClient, body: Record<string, unknown>) =>
  client.post("/api/public/businesses/fte-barber/bookings", { resourceId: null, ...body });

const times = async (client: TestClient, query: string) =>
  (await client.get(`/api/public/businesses/fte-barber/availability?${query}`)).body;

describe("locations", () => {
  it("starts every business with one location that has everything", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const base = `/api/businesses/${business.id}`;
    const service = (
      await owner.post(`${base}/services`, { name: "Corte", durationMin: 30, priceAmount: 1 })
    ).body.service;
    const professional = (
      await owner.post(`${base}/professionals`, { name: "Juan", serviceIds: [service.id] })
    ).body.professional;

    const { locations } = (await owner.get(`${base}/locations`)).body;
    expect(locations).toEqual([
      expect.objectContaining({
        name: business.name,
        active: true,
        serviceIds: [service.id],
        resourceIds: [professional.id],
      }),
    ]);
    // With one location, nobody needs to say which one.
    const page = (await app.client().get("/api/public/businesses/fte-barber")).body;
    expect(page.locations).toHaveLength(1);
    const saturday = next(6);
    const booked = await book(app.client(), {
      serviceId: service.id,
      date: saturday,
      time: "09:00",
      customer: customer(1),
    });
    expect(booked.status).toBe(201);
    expect(booked.body.appointment.location.name).toBe(business.name);
  });

  it("books each location with its own services and people", async () => {
    const { app, owner, base, haircut, beard, juan, pedro, centro, norte } = await twoLocations();
    const page = (await app.client().get("/api/public/businesses/fte-barber")).body;
    expect(page.locations).toEqual([
      expect.objectContaining({
        id: centro.id,
        name: "Centro",
        serviceIds: [haircut.id, beard.id],
        professionalIds: [juan.id, pedro.id],
      }),
      expect.objectContaining({
        id: norte.id,
        name: "Norte",
        address: "Calle 100 #15-20",
        serviceIds: [haircut.id],
        professionalIds: [juan.id],
      }),
    ]);

    const saturday = next(6);
    const visitor = app.client();
    // Several locations: the booking must say which one.
    const unspecified = await book(visitor, {
      serviceId: haircut.id,
      date: saturday,
      time: "09:00",
      customer: customer(1),
    });
    expect(unspecified.status).toBe(400);
    expect(unspecified.body.error.code).toBe("location_required");

    // Norte doesn't offer the beard trim.
    const beardNorte = await times(
      visitor,
      `locationId=${norte.id}&serviceId=${beard.id}&from=${saturday}&to=${saturday}`,
    );
    expect(beardNorte.days).toEqual({});

    // Juan books at Norte at 09:00: at Centro, only Pedro is left at that time.
    const norteBooking = await book(visitor, {
      locationId: norte.id,
      serviceId: haircut.id,
      date: saturday,
      time: "09:00",
      customer: customer(2),
    });
    expect(norteBooking.status).toBe(201);
    expect(norteBooking.body.appointment.resourceName).toBe("Juan");
    const centroTimes = await times(
      visitor,
      `locationId=${centro.id}&serviceId=${haircut.id}&from=${saturday}&to=${saturday}`,
    );
    expect(centroTimes.staff[saturday]["09:00"]).toEqual([pedro.id]);
    const juanAtCentro = await book(visitor, {
      locationId: centro.id,
      serviceId: haircut.id,
      resourceId: juan.id,
      date: saturday,
      time: "09:00",
      customer: customer(3),
    });
    expect(juanAtCentro.status).toBe(409);
    expect(juanAtCentro.body.error.code).toBe("slot_taken");

    // The agenda shows where each appointment is, and filters by location.
    const from = `${saturday}T00:00:00-05:00`;
    const to = `${addDays(saturday, 1)}T00:00:00-05:00`;
    const agenda = (
      await owner.get(
        `${base}/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
    ).body.appointments;
    expect(agenda).toEqual([
      expect.objectContaining({ locationId: norte.id, locationName: "Norte" }),
    ]);
    const atCentro = (
      await owner.get(
        `${base}/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&locationId=${centro.id}`,
      )
    ).body.appointments;
    expect(atCentro).toEqual([]);
  });

  it("keeps hours and closures per location", async () => {
    const { app, owner, base, haircut, juan, pedro, centro, norte } = await twoLocations();
    const saturday = next(6);
    const sunday = addDays(saturday, 1);
    // Norte opens on Sundays; Centro doesn't.
    const hours = await owner.put(`${base}/hours`, {
      locationId: norte.id,
      resourceId: null,
      hours: [{ weekday: 0, start: "10:00", end: "14:00" }],
    });
    expect(hours.status).toBe(200);
    const norteHours = (await owner.get(`${base}/hours?locationId=${norte.id}`)).body;
    expect(norteHours).toEqual({
      locationId: norte.id,
      business: [{ weekday: 0, start: "10:00", end: "14:00" }],
      professionals: {},
    });
    const query = (location: string) =>
      `locationId=${location}&serviceId=${haircut.id}&from=${saturday}&to=${sunday}`;
    expect(Object.keys((await times(app.client(), query(norte.id))).days)).toEqual([sunday]);
    expect(Object.keys((await times(app.client(), query(centro.id))).days)).toEqual([saturday]);

    // Own hours only where the professional works.
    const elsewhere = await owner.put(`${base}/hours`, {
      locationId: norte.id,
      resourceId: pedro.id,
      hours: [{ weekday: 6, start: "09:00", end: "10:00" }],
    });
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body.error.code).toBe("not_at_location");

    // A closure at Centro leaves Norte open.
    const closed = await owner.post(`${base}/closures`, {
      date: saturday,
      endDate: sunday,
      locationId: centro.id,
      resourceId: null,
    });
    expect(closed.status).toBe(201);
    expect(Object.keys((await times(app.client(), query(centro.id))).days)).toEqual([]);
    expect(Object.keys((await times(app.client(), query(norte.id))).days)).toEqual([sunday]);

    // Juan's day off applies at every location he works at.
    await owner.post(`${base}/closures`, {
      date: sunday,
      locationId: norte.id,
      resourceId: juan.id,
    });
    expect(Object.keys((await times(app.client(), query(norte.id))).days)).toEqual([]);
  });

  it("moves people between locations and protects locations in use", async () => {
    const { app, owner, base, haircut, juan, centro, norte } = await twoLocations();
    // Taking Juan out of Norte leaves it without people: it takes bookings on its own hours.
    await owner.patch(`${base}/professionals/${juan.id}`, { locationIds: [centro.id] });
    const professionals = (await owner.get(`${base}/professionals`)).body.professionals;
    expect(professionals.find((p: { id: string }) => p.id === juan.id).locationIds).toEqual([
      centro.id,
    ]);
    const saturday = next(6);
    const first = await book(app.client(), {
      locationId: norte.id,
      serviceId: haircut.id,
      date: saturday,
      time: "09:00",
      customer: customer(1),
    });
    expect(first.status).toBe(201);
    expect(first.body.appointment.resourceName).toBeNull();
    const second = await book(app.client(), {
      locationId: norte.id,
      serviceId: haircut.id,
      date: saturday,
      time: "09:00",
      customer: customer(2),
    });
    expect(second.status).toBe(409);

    // Its history keeps it: deactivate it instead.
    const remove = await owner.delete(`${base}/locations/${norte.id}`);
    expect(remove.status).toBe(409);
    expect(remove.body.error.code).toBe("location_in_use");
    expect((await owner.patch(`${base}/locations/${norte.id}`, { active: false })).status).toBe(
      200,
    );
    const page = (await app.client().get("/api/public/businesses/fte-barber")).body;
    expect(page.locations.map((place: { id: string }) => place.id)).toEqual([centro.id]);

    // The last location taking bookings stays.
    const last = await owner.patch(`${base}/locations/${centro.id}`, { active: false });
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe("last_active_location");

    // An unused location can go.
    const spare = (
      await owner.post(`${base}/locations`, { name: "Sur", serviceIds: [], resourceIds: [] })
    ).body.location;
    expect((await owner.delete(`${base}/locations/${spare.id}`)).status).toBe(204);
  });
});
