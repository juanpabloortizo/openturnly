import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { addMember, createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

/** The next Saturday at least two days ahead, in Bogotá (default hours: 9–13). */
function nextSaturday(): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== 6) date = addDays(date, 1);
  return date;
}

const bookAt = (app: Awaited<ReturnType<typeof shopWithBooking>>["app"], body: object) =>
  app.client().post("/api/public/businesses/fte-barber/bookings", {
    resourceId: null,
    date: nextSaturday(),
    ...body,
  });

async function shopWithBooking() {
  const app = await createTestApp();
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
  const haircut = (
    await owner.post(`${base}/services`, { name: "Corte", durationMin: 30, priceAmount: 20_000 })
  ).body.service;
  const booking = await app.client().post("/api/public/businesses/fte-barber/bookings", {
    serviceId: haircut.id,
    resourceId: null,
    date: nextSaturday(),
    time: "09:00",
    customer: {
      email: "Ana@Example.com",
      phone: "+57 300 123 4567",
      firstName: "Ana",
      lastName: "Pérez",
    },
  });
  return { app, owner, business, base, booking, haircut };
}

describe("booking codes", () => {
  it("gives every booking a short code that shows up in the agenda", async () => {
    const { owner, base, booking } = await shopWithBooking();
    expect(booking.status).toBe(201);
    const code = booking.body.appointment.code;
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const agenda = await owner.get(`${base}/appointments?from=${from}&to=${to}`);
    expect(agenda.body.appointments[0].code).toBe(code);
  });
});

describe("customers", () => {
  it("are created by bookings and keep their history", async () => {
    const { owner, base, booking } = await shopWithBooking();
    const list = await owner.get(`${base}/customers`);
    expect(list.body.customers).toEqual([
      expect.objectContaining({
        email: "ana@example.com",
        phone: "+573001234567",
        visits: 1,
        lastVisit: null,
      }),
    ]);
    expect(list.body.customers[0].nextVisit).toBe(booking.body.appointment.startsAt);

    const detail = await owner.get(`${base}/customers/${list.body.customers[0].id}`);
    expect(detail.body.appointments).toEqual([
      expect.objectContaining({ code: booking.body.appointment.code, serviceName: "Corte" }),
    ]);
  });

  it("can be added, edited and removed by hand", async () => {
    const { owner, base } = await shopWithBooking();
    const created = await owner.post(`${base}/customers`, {
      email: "  Leo@Example.com ",
      phone: "+57 310 555 1234",
      firstName: " Leo ",
      lastName: "Gómez",
      notes: "Prefiere degradado",
    });
    expect(created.status).toBe(201);
    expect(created.body.customer).toMatchObject({
      email: "leo@example.com",
      phone: "+573105551234",
      firstName: "Leo",
      notes: "Prefiere degradado",
    });
    const id = created.body.customer.id;

    const duplicate = await owner.post(`${base}/customers`, {
      email: "ana@example.com",
      phone: "+57 300 000 0000",
      firstName: "Otra",
      lastName: "Ana",
    });
    expect(duplicate.status).toBe(409);
    const clash = await owner.patch(`${base}/customers/${id}`, { email: "ana@example.com" });
    expect(clash.body.error.fields).toEqual({ email: "customer_exists" });

    const edited = await owner.patch(`${base}/customers/${id}`, { notes: "" });
    expect(edited.body.customer.notes).toBeNull();

    expect((await owner.delete(`${base}/customers/${id}`)).status).toBe(204);
    expect((await owner.get(`${base}/customers/${id}`)).status).toBe(404);
  });

  it("removing a customer removes their appointments", async () => {
    const { owner, base } = await shopWithBooking();
    const [ana] = (await owner.get(`${base}/customers`)).body.customers;
    expect((await owner.delete(`${base}/customers/${ana.id}`)).status).toBe(204);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const agenda = await owner.get(`${base}/appointments?from=${from}&to=${to}`);
    expect(agenda.body.appointments).toEqual([]);
  });

  it("are recognized by phone or email, without overwriting what the business has", async () => {
    const { app, owner, base, haircut } = await shopWithBooking();
    // Same email, another number and another spelling of the name: still Ana.
    const second = await bookAt(app, {
      serviceId: haircut.id,
      time: "10:00",
      customer: {
        email: "ana@example.com",
        phone: "311 222 3333",
        firstName: "ana",
        lastName: "p",
      },
    });
    expect(second.status).toBe(201);
    const [ana] = (await owner.get(`${base}/customers`)).body.customers;
    expect(ana).toMatchObject({ firstName: "Ana", lastName: "Pérez", phone: "+573001234567" });
    expect(ana.visits).toBe(2);

    // Same number without email: Ana again, and her email is kept.
    const third = await bookAt(app, {
      serviceId: haircut.id,
      time: "11:00",
      customer: { phone: "+57 300 123 4567", firstName: "Ana", lastName: "Pérez" },
    });
    expect(third.status).toBe(201);
    expect((await owner.get(`${base}/customers`)).body.customers).toHaveLength(1);
  });

  it("can be merged when the same person shows up twice", async () => {
    const { owner, base } = await shopWithBooking();
    const [ana] = (await owner.get(`${base}/customers`)).body.customers;
    const twin = (
      await owner.post(`${base}/customers`, {
        firstName: "Ana",
        lastName: "Perez",
        email: "ana.perez@trabajo.com",
        notes: "Viene los sábados",
      })
    ).body.customer;

    const merged = await owner.post(`${base}/customers/${twin.id}/merge`, { intoId: ana.id });
    expect(merged.status).toBe(200);
    expect(merged.body.customer).toMatchObject({
      id: ana.id,
      email: "ana@example.com",
      notes: "Viene los sábados",
    });
    expect((await owner.get(`${base}/customers/${twin.id}`)).status).toBe(404);
  });

  it("need a phone or an email, each used once", async () => {
    const { owner, base } = await shopWithBooking();
    const [ana] = (await owner.get(`${base}/customers`)).body.customers;
    const samePhone = await owner.post(`${base}/customers`, {
      firstName: "Otra",
      lastName: "Persona",
      phone: "+57 300 123 4567",
    });
    expect(samePhone.body.error.fields).toEqual({ phone: "customer_exists" });
    const noContact = await owner.patch(`${base}/customers/${ana.id}`, { phone: "", email: "" });
    expect(noContact.body.error.fields).toEqual({ phone: "contact_required" });
  });

  it("belong to one business", async () => {
    const { app, owner, base } = await shopWithBooking();
    const other = await createBusiness(owner, { name: "Spa", slug: "spa-luna" });
    const member = await addMember(app, owner, other.id);
    expect((await member.get(`${base}/customers`)).status).toBe(404);
  });
});

describe("booking form", () => {
  it("asks for what the business chose, plus its own questions", async () => {
    const { app, owner, business, base, haircut } = await shopWithBooking();
    const form = {
      phone: "optional",
      email: "required",
      questions: [
        {
          id: "first",
          label: "¿Primera vez?",
          type: "select",
          required: true,
          options: ["Sí", "No"],
        },
      ],
    };
    const saved = await owner.patch(`/api/businesses/${business.id}`, { bookingForm: form });
    expect(saved.status).toBe(200);
    const page = await app.client().get("/api/public/businesses/fte-barber");
    expect(page.body.business.bookingForm).toMatchObject(form);

    const missing = await bookAt(app, {
      serviceId: haircut.id,
      time: "10:00",
      customer: { firstName: "Leo", lastName: "Gómez" },
    });
    expect(missing.body.error.fields).toEqual({
      "customer.email": "required",
      "answers.first": "required",
    });

    const booked = await bookAt(app, {
      serviceId: haircut.id,
      time: "10:00",
      customer: { firstName: "Leo", lastName: "Gómez", email: "leo@example.com" },
      answers: { first: "Sí" },
    });
    expect(booked.status).toBe(201);
    const leo = (await owner.get(`${base}/customers`)).body.customers.find(
      (customer: { email: string }) => customer.email === "leo@example.com",
    );
    expect(leo.phone).toBeNull();
    const detail = await owner.get(`${base}/customers/${leo.id}`);
    expect(detail.body.appointments[0].answers).toEqual([
      { id: "first", label: "¿Primera vez?", value: "Sí" },
    ]);
  });

  it("always keeps one required way to reach the customer", async () => {
    const { owner, business } = await shopWithBooking();
    const res = await owner.patch(`/api/businesses/${business.id}`, {
      bookingForm: { phone: "optional", email: "hidden", questions: [] },
    });
    expect(res.body.error.fields).toEqual({ "bookingForm.phone": "contact_required" });
  });
});
