import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appointments, customers } from "../src/db/schema.ts";
import { addMember, createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

const REGION = { timezone: "America/Bogota", currency: "COP", locale: "es" };

describe("sample business", () => {
  it("fills a business with made-up services, team, customers and appointments", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);

    const res = await owner.post("/api/businesses/sample", REGION);
    expect(res.status).toBe(201);
    const business = res.body.business;
    expect(business).toMatchObject({
      name: "Barbería de ejemplo",
      slug: "ejemplo",
      sample: true,
      currency: "COP",
    });

    // The booking page works as is, with prices that look right in pesos.
    const page = await app.client().get("/api/public/businesses/ejemplo");
    expect(page.status).toBe(200);
    const menu = page.body.services as { name: string; category: string; priceAmount: number }[];
    expect(menu.map((service) => service.category)).toEqual([
      "Cortes",
      "Cortes",
      "Cortes",
      "Barba",
      "Barba",
      "Color",
    ]);
    expect(menu[0]).toMatchObject({ name: "Corte clásico", priceAmount: 25_000 });
    expect(page.body.professionals.map((member: { name: string }) => member.name)).toEqual([
      "Camila",
      "Daniel",
      "Mateo",
    ]);

    const people = await app.db
      .select()
      .from(customers)
      .where(eq(customers.businessId, business.id));
    expect(people.map((person) => person.firstName).sort()).toEqual(["Andrés", "Laura", "Paula"]);

    // Appointments around today, never two at once for the same professional.
    const booked = await app.db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, business.id))
      .orderBy(asc(appointments.startsAt));
    expect(booked.length).toBeGreaterThan(5);
    for (const [index, appointment] of booked.entries()) {
      const clash = booked
        .slice(index + 1)
        .find(
          (other) =>
            other.resourceId === appointment.resourceId && other.startsAt < appointment.endsAt,
        );
      expect(clash).toBeUndefined();
    }
    expect(booked.some((appointment) => appointment.status === "no_show")).toBe(true);

    // Booked days ago, like real bookings: no alarm about a wave of bot bookings.
    const protection = await owner.get(`/api/businesses/${business.id}/protection`);
    expect(protection.body.protection).toMatchObject({ active: false, lastHour: 0 });
  });

  it("follows the owner's language and currency, and never takes a used link", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    await createBusiness(owner, { name: "Sample", slug: "sample" });

    const res = await owner.post("/api/businesses/sample", {
      timezone: "America/New_York",
      currency: "USD",
      locale: "en",
    });
    expect(res.body.business).toMatchObject({ name: "Sample Barbershop", slug: "sample-2" });
    const page = await app.client().get("/api/public/businesses/sample-2");
    // Cents: a $25 haircut.
    expect(page.body.services[0]).toMatchObject({ name: "Classic haircut", priceAmount: 2_500 });

    // A business created by hand is a real one.
    const real = await owner.get("/api/businesses");
    expect(
      real.body.businesses.map((item: { slug: string; sample: boolean }) => [
        item.slug,
        item.sample,
      ]),
    ).toEqual([
      ["sample", false],
      ["sample-2", true],
    ]);
  });

  it("is only for the owner", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const member = await addMember(app, owner, business.id, "staff@example.com");
    expect((await member.post("/api/businesses/sample", REGION)).status).toBe(403);
    expect((await app.client().post("/api/businesses/sample", REGION)).status).toBe(401);
  });
});
