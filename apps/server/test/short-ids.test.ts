import { addDays, isShortId, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { randomShortId } from "../src/lib/codes.ts";
import { addMember, createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

describe("short ids", () => {
  it("are 10 characters of the alphabet, random each time", () => {
    const ids = Array.from({ length: 2000 }, randomShortId);
    expect(ids.every(isShortId)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isShortId("k7m2qx9a4p")).toBe(true);
    // Too short, upper case, and characters left out because they look alike.
    expect(isShortId("k7m2qx9a4")).toBe(false);
    expect(isShortId("K7M2QX9A4P")).toBe(false);
    expect(isShortId("k7m2qx9a4o")).toBe(false);
    expect(isShortId("80942820-2f1e-4350-9c5e-2050e118b5b0")).toBe(false);
  });

  it("find a business by its short id, only for people with access", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const other = await createBusiness(owner, { name: "Otro", slug: "otro" });
    const shortId = (await owner.get(`/api/businesses/${business.id}`)).body.business.shortId;
    expect(isShortId(shortId)).toBe(true);
    expect((await owner.get(`/api/businesses/${other.id}`)).body.business.shortId).not.toBe(
      shortId,
    );

    // The short id works wherever the id does.
    const byShortId = await owner.get(`/api/businesses/${shortId}`);
    expect(byShortId.body.business.id).toBe(business.id);
    expect((await owner.get(`/api/businesses/${shortId}/customers`)).status).toBe(200);

    // A member of another business can't reach it by its short id either.
    const member = await addMember(app, owner, other.id);
    expect((await member.get(`/api/businesses/${shortId}`)).status).toBe(404);
    expect((await member.get(`/api/businesses/${shortId}/customers`)).status).toBe(404);
  });

  it("are given to customers however they are created", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const base = `/api/businesses/${business.id}`;
    await owner.patch(base, { closedOnHolidays: false });
    const haircut = (
      await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 25_000 })
    ).body.service;
    const juan = (
      await owner.post(`${base}/professionals`, { name: "Juan", serviceIds: [haircut.id] })
    ).body.professional;
    let saturday = addDays(todayIn("America/Bogota"), 2);
    while (weekdayOf(saturday) !== 6) saturday = addDays(saturday, 1);

    // By hand, from a booking and from a spreadsheet.
    await owner.post(`${base}/customers`, {
      firstName: "Ana",
      lastName: "A",
      phone: "+57 300 111 2233",
      email: null,
    });
    const booked = await owner.post(`${base}/appointments`, {
      serviceId: haircut.id,
      resourceId: juan.id,
      date: saturday,
      time: "09:00",
      customer: { firstName: "Luis", lastName: "L", phone: "+57 300 444 5566", email: null },
    });
    expect(booked.status).toBe(201);
    await owner.post(`${base}/customers/import`, {
      rows: [
        { firstName: "Eva", phone: "3007778899" },
        { firstName: "Leo", phone: "3001234567" },
      ],
      apply: true,
    });

    const list = (await owner.get(`${base}/customers`)).body.customers;
    expect(list).toHaveLength(4);
    expect(list.every((customer: { shortId: string }) => isShortId(customer.shortId))).toBe(true);
    expect(new Set(list.map((customer: { shortId: string }) => customer.shortId)).size).toBe(4);

    // The agenda gets it too, to link to the customer.
    const from = encodeURIComponent(`${saturday}T00:00:00-05:00`);
    const to = encodeURIComponent(`${addDays(saturday, 1)}T00:00:00-05:00`);
    const [appointment] = (await owner.get(`${base}/appointments?from=${from}&to=${to}`)).body
      .appointments;
    const luis = list.find((customer: { firstName: string }) => customer.firstName === "Luis");
    expect(appointment.customer.shortId).toBe(luis.shortId);
  });
});
