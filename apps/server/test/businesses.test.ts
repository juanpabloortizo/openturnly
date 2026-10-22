import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { count, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  apiKeys,
  appointments,
  automationDeliveries,
  automations,
  businessImages,
  businessMembers,
  closures,
  customers,
  holidayOverrides,
  invitations,
  resourceServices,
  resources,
  services,
  users,
  weeklyHours,
} from "../src/db/schema.ts";
import { addMember, businessInput, createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

// The smallest valid PNG: a 1×1 transparent pixel.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);

describe("businesses", () => {
  it("lets the owner create, list, update and delete businesses", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);

    const business = await createBusiness(owner);
    await createBusiness(owner, { name: "Spa Luna", slug: "spa-luna" });

    const list = await owner.get("/api/businesses");
    expect(list.body.businesses.map((b: { slug: string }) => b.slug)).toEqual([
      "fte-barber",
      "spa-luna",
    ]);

    const updated = await owner.patch(`/api/businesses/${business.id}`, {
      phone: "+57 300 123 4567",
      email: "",
      slug: "fte-barber-studio",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.business).toMatchObject({
      phone: "+57 300 123 4567",
      email: null,
      slug: "fte-barber-studio",
    });

    // The booking page look: a hex accent and a background style, shown publicly.
    const colors = await owner.patch(`/api/businesses/${business.id}`, {
      brandColor: "#0F766E",
      pageTheme: "aurora",
    });
    expect(colors.body.business).toMatchObject({ brandColor: "#0f766e", pageTheme: "aurora" });
    const page = await app.client().get("/api/public/businesses/fte-barber-studio");
    expect(page.body.business).toMatchObject({ brandColor: "#0f766e", pageTheme: "aurora" });
    const badTheme = await owner.patch(`/api/businesses/${business.id}`, { pageTheme: "neon" });
    expect(badTheme.status).toBe(400);
    const badColor = await owner.patch(`/api/businesses/${business.id}`, { brandColor: "red" });
    expect(badColor.body.error.fields).toEqual({ brandColor: "invalid_color" });

    expect((await owner.delete(`/api/businesses/${business.id}`)).status).toBe(204);
    expect((await owner.get(`/api/businesses/${business.id}`)).status).toBe(404);
  });

  it("delete everything that belongs to a business with it, and nothing else", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const other = await createBusiness(owner, { name: "Spa Luna", slug: "spa-luna" });
    const base = `/api/businesses/${business.id}`;

    // Something in every table a business owns.
    const haircut = (
      await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 25_000 })
    ).body.service;
    await owner.post(`${base}/professionals`, { name: "Max", serviceIds: [haircut.id] });
    let saturday = addDays(todayIn("America/Bogota"), 2);
    while (weekdayOf(saturday) !== 6) saturday = addDays(saturday, 1);
    await owner.post(`${base}/closures`, { date: addDays(saturday, 7), resourceId: null });
    await owner.put(`${base}/holidays/2027-01-01`, { closed: false });
    await owner.raw("PUT", `${base}/images/logo`, PNG, "image/png");
    const member = await addMember(app, owner, business.id, "staff@example.com");
    await owner.post(`${base}/access`, { email: "pending@example.com" });
    await owner.post(`${base}/api-keys`, { name: "WhatsApp", kind: "agent" });
    const automation = (
      await owner.post(`${base}/automations`, {
        name: "Aviso",
        trigger: "created",
        actions: [{ id: "hook", type: "webhook", url: "https://example.com/hook" }],
      })
    ).body.automation;
    const booked = await app.client().post("/api/public/businesses/fte-barber/bookings", {
      serviceId: haircut.id,
      resourceId: null,
      date: saturday,
      time: "10:00",
      customer: { firstName: "Ana", lastName: "Pérez", phone: "+57 300 123 4567" },
    });
    expect(booked.status).toBe(201);
    await owner.post(`/api/businesses/${other.id}/services`, {
      name: "Masaje",
      durationMin: 60,
      priceAmount: 80_000,
    });

    const db = app.db;
    const owned = [
      businessMembers,
      invitations,
      businessImages,
      services,
      resources,
      weeklyHours,
      closures,
      holidayOverrides,
      customers,
      appointments,
      apiKeys,
      automations,
    ] as const;
    const professionalIds = (
      await db
        .select({ id: resources.id })
        .from(resources)
        .where(eq(resources.businessId, business.id))
    ).map((row) => row.id);
    const rows = async (businessId: string) => {
      const counts = await Promise.all(
        owned.map(async (table) => {
          const [row] = await db
            .select({ n: count() })
            .from(table)
            .where(eq(table.businessId, businessId));
          return row?.n ?? 0;
        }),
      );
      const [links] = await db
        .select({ n: count() })
        .from(resourceServices)
        .where(inArray(resourceServices.resourceId, professionalIds));
      const [sends] = await db
        .select({ n: count() })
        .from(automationDeliveries)
        .where(eq(automationDeliveries.automationId, automation.id));
      return { counts, links: links?.n ?? 0, sends: sends?.n ?? 0 };
    };
    const before = await rows(business.id);
    expect(before.counts.every((n) => n > 0)).toBe(true);
    expect(before.links).toBeGreaterThan(0);
    expect(before.sends).toBeGreaterThan(0);

    expect((await owner.delete(base)).status).toBe(204);

    const after = await rows(business.id);
    expect(after).toEqual({ counts: owned.map(() => 0), links: 0, sends: 0 });
    // The other business is untouched, and the staff member keeps their account.
    expect((await owner.get(`/api/businesses/${other.id}/services`)).body.services).toHaveLength(1);
    const [staff] = await db
      .select({ n: count() })
      .from(users)
      .where(eq(users.email, "staff@example.com"));
    expect(staff?.n).toBe(1);
    expect((await member.get(base)).status).toBe(404);
  });

  it("rejects invalid, reserved and duplicate slugs", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    await createBusiness(owner);

    const duplicate = await owner.post("/api/businesses", businessInput());
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.fields).toEqual({ slug: "slug_taken" });

    const invalid = await owner.post(
      "/api/businesses",
      businessInput({ slug: "admin", timezone: "Mars/Olympus", currency: "XXX" }),
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.fields).toMatchObject({
      slug: "slug_reserved",
      timezone: "invalid_timezone",
    });
    expect(invalid.body.error.fields.currency).toBeDefined();
  });

  it("requires a session", async () => {
    const app = await createTestApp();
    await setUpOwner(app);
    expect((await app.client().get("/api/businesses")).status).toBe(401);
  });
});

describe("business members", () => {
  it("only see and edit the businesses they were given access to", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const mine = await createBusiness(owner);
    const other = await createBusiness(owner, { name: "Spa Luna", slug: "spa-luna" });
    const member = await addMember(app, owner, mine.id);

    const list = await member.get("/api/businesses");
    expect(list.body.businesses.map((b: { id: string }) => b.id)).toEqual([mine.id]);

    expect((await member.get(`/api/businesses/${other.id}`)).status).toBe(404);
    expect((await member.patch(`/api/businesses/${other.id}`, { name: "Hacked" })).status).toBe(
      404,
    );
    expect((await member.patch(`/api/businesses/${mine.id}`, { name: "FTE" })).status).toBe(200);
  });

  it("cannot create or delete businesses", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const member = await addMember(app, owner, business.id);

    const created = await member.post(
      "/api/businesses",
      businessInput({ slug: "my-own-business" }),
    );
    expect(created.status).toBe(403);
    expect((await member.delete(`/api/businesses/${business.id}`)).status).toBe(403);
    // Business admins do manage who works in their own business.
    expect((await member.get(`/api/businesses/${business.id}/access`)).status).toBe(200);
  });
});
