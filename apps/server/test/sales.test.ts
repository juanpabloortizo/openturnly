import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

/** A date at least two days ahead that falls on `weekday` (0 = Sunday), in Bogotá. */
function next(weekday: number): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== weekday) date = addDays(date, 1);
  return date;
}

/** A barbershop with Juan, a 25.000 haircut and an appointment for Ana on Saturday. */
async function shopWithAppointment() {
  const app = await createTestApp();
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
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
  const saturday = next(6);
  const booked = await owner.post(`${base}/appointments`, {
    serviceId: haircut.id,
    resourceId: juan.id,
    date: saturday,
    time: "09:00",
    customer: { firstName: "Ana", lastName: "Pérez", phone: "+57 300 123 4567", email: null },
  });
  expect(booked.status).toBe(201);
  const appointment = booked.body.appointment;
  const agenda = async () => {
    const from = `${saturday}T00:00:00-05:00`;
    const to = `${addDays(saturday, 1)}T00:00:00-05:00`;
    return (
      await owner.get(
        `${base}/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
    ).body.appointments;
  };
  return { app, owner, business, base, haircut, beard, juan, appointment, agenda };
}

describe("sales", () => {
  it("charges an appointment with a tip and split payment, once", async () => {
    const { owner, base, haircut, beard, juan, appointment, agenda } = await shopWithAppointment();
    const sale = {
      items: [
        {
          kind: "service",
          serviceId: haircut.id,
          appointmentId: appointment.id,
          resourceId: juan.id,
          unitPrice: 25_000,
        },
        // An extra service done during the visit, with a discount.
        {
          kind: "service",
          serviceId: beard.id,
          resourceId: juan.id,
          unitPrice: 15_000,
          discountAmount: 5_000,
        },
      ],
      discountAmount: 2_000,
      tips: [{ resourceId: juan.id, amount: 4_000 }],
      payments: [
        { method: "cash", amount: 20_000 },
        { method: "card", amount: 17_000 },
      ],
    };
    const charged = await owner.post(`${base}/sales`, sale);
    expect(charged.status).toBe(201);
    expect(charged.body.sale).toMatchObject({
      number: 1,
      status: "paid",
      subtotal: 35_000,
      discountAmount: 2_000,
      total: 33_000,
      tipAmount: 4_000,
      customer: expect.objectContaining({ firstName: "Ana" }),
      locationName: "FTE Barber Studio",
    });
    expect(charged.body.sale.items.map((item: { name: string }) => item.name)).toEqual([
      "Corte",
      "Barba",
    ]);
    expect(charged.body.sale.tips).toEqual([
      expect.objectContaining({ resourceName: "Juan", amount: 4_000 }),
    ]);
    expect((await agenda())[0].sale).toEqual({ id: charged.body.sale.id, number: 1 });

    // The same appointment can't be charged twice.
    const again = await owner.post(`${base}/sales`, sale);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("appointment_paid");

    // Voided, it can be charged again, and the next sale gets the next number.
    const voided = await owner.post(`${base}/sales/${charged.body.sale.id}/void`, {});
    expect(voided.body.sale.status).toBe("void");
    expect((await agenda())[0].sale).toBeNull();
    const recharged = await owner.post(`${base}/sales`, sale);
    expect(recharged.body.sale.number).toBe(2);
  });

  it("refuses payments that don't add up and discounts bigger than the sale", async () => {
    const { owner, base, haircut, appointment } = await shopWithAppointment();
    const line = {
      kind: "service",
      serviceId: haircut.id,
      appointmentId: appointment.id,
      unitPrice: 25_000,
    };
    const short = await owner.post(`${base}/sales`, {
      items: [line],
      payments: [{ method: "cash", amount: 20_000 }],
    });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe("payments_mismatch");
    const discount = await owner.post(`${base}/sales`, {
      items: [line],
      discountAmount: 30_000,
      payments: [],
    });
    expect(discount.body.error.fields).toEqual({ discountAmount: "too_big" });
  });

  it("uses a deposit left for the appointment", async () => {
    const { owner, base, haircut, appointment, agenda } = await shopWithAppointment();
    const customerId = (await agenda())[0].customer.id;
    const left = await owner.post(`${base}/deposits`, {
      customerId,
      appointmentId: appointment.id,
      amount: 10_000,
      method: "transfer",
    });
    expect(left.status).toBe(201);
    const deposit = left.body.deposit;
    expect((await agenda())[0].depositAmount).toBe(10_000);

    const sale = await owner.post(`${base}/sales`, {
      items: [
        {
          kind: "service",
          serviceId: haircut.id,
          appointmentId: appointment.id,
          unitPrice: 25_000,
        },
      ],
      payments: [
        { method: "deposit", amount: 10_000, depositId: deposit.id },
        { method: "cash", amount: 15_000 },
      ],
    });
    expect(sale.status).toBe(201);
    expect((await agenda())[0].depositAmount).toBe(0);
    const used = (await owner.get(`${base}/deposits?appointmentId=${appointment.id}`)).body
      .deposits;
    expect(used[0].appliedSale).toEqual({ id: sale.body.sale.id, number: 1 });
    // Used deposits can't be given back; voiding the sale frees it.
    expect((await owner.post(`${base}/deposits/${deposit.id}/void`, {})).status).toBe(409);
    await owner.post(`${base}/sales/${sale.body.sale.id}/void`, {});
    expect((await agenda())[0].depositAmount).toBe(10_000);
    const back = await owner.post(`${base}/deposits/${deposit.id}/void`, {});
    expect(back.body.deposit.status).toBe("void");
    expect((await agenda())[0].depositAmount).toBe(0);
  });

  it("sells without an appointment, lists sales and keeps them from professionals", async () => {
    const { app, owner, business, base, haircut, juan } = await shopWithAppointment();
    const walkIn = await owner.post(`${base}/sales`, {
      internal: true,
      items: [{ kind: "service", serviceId: haircut.id, resourceId: juan.id, unitPrice: 20_000 }],
      payments: [{ method: "cash", amount: 20_000 }],
      note: "Corte para el equipo",
    });
    expect(walkIn.status).toBe(201);
    expect(walkIn.body.sale).toMatchObject({ internal: true, customer: null, total: 20_000 });

    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const list = await owner.get(
      `${base}/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(list.body.sales).toHaveLength(1);

    await owner.post(`/api/businesses/${business.id}/members`, {
      name: "Juan",
      email: "juan@example.com",
      password: "juan-password-1",
      role: "professional",
      resourceId: juan.id,
    });
    const professional = app.client();
    await professional.post("/api/auth/sign-in/email", {
      email: "juan@example.com",
      password: "juan-password-1",
    });
    const forbidden = await professional.get(
      `${base}/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(forbidden.status).toBe(403);
  });
});
