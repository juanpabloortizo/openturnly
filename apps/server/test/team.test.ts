import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner, type TestApp } from "./helpers.ts";

/** The next Saturday at least two days ahead, in Bogotá (default hours: 9–13). */
function nextSaturday(): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== 6) date = addDays(date, 1);
  return date;
}

async function signIn(app: TestApp, email: string, password: string) {
  const client = app.client();
  const res = await client.post("/api/auth/sign-in/email", { email, password });
  return { client, status: res.status };
}

async function shopWithTeam() {
  const app = await createTestApp();
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
  const haircut = (
    await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 20_000 })
  ).body.service;
  const juan = (
    await owner.post(`${base}/professionals`, { name: "Juan", serviceIds: [haircut.id] })
  ).body.professional;
  const pepe = (
    await owner.post(`${base}/professionals`, { name: "Pepe", serviceIds: [haircut.id] })
  ).body.professional;
  return { app, owner, business, base, haircut, juan, pepe, saturday: nextSaturday() };
}

describe("giving access with an account", () => {
  it("creates admins and professionals with a password chosen here", async () => {
    const { app, owner, business, base, juan } = await shopWithTeam();
    const admin = await owner.post(`${base}/members`, {
      name: "Ana Dueña",
      email: "Ana@Example.com",
      password: "ana-password-1",
      role: "admin",
    });
    expect(admin.status).toBe(201);
    expect(admin.body.created).toBe(true);

    const professional = await owner.post(`${base}/members`, {
      name: "Juan",
      email: "juan@example.com",
      password: "juan-password-1",
      role: "professional",
      resourceId: juan.id,
    });
    expect(professional.status).toBe(201);

    const access = await owner.get(`${base}/access`);
    expect(access.body.members).toEqual([
      expect.objectContaining({ email: "ana@example.com", role: "admin", resourceId: null }),
      expect.objectContaining({
        email: "juan@example.com",
        role: "professional",
        resourceName: "Juan",
      }),
    ]);

    const ana = await signIn(app, "ana@example.com", "ana-password-1");
    expect(ana.status).toBe(200);
    const list = await ana.client.get("/api/businesses");
    expect(list.body.businesses[0].access).toEqual({ role: "admin", resourceId: null });
    expect((await ana.client.patch(`/api/businesses/${business.id}`, { name: "FTE" })).status).toBe(
      200,
    );

    // A profile goes with one person only, and a new account needs a password.
    const twice = await owner.post(`${base}/members`, {
      name: "Otro",
      email: "otro@example.com",
      password: "otro-password-1",
      role: "professional",
      resourceId: juan.id,
    });
    expect(twice.body.error.fields).toEqual({ resourceId: "profile_taken" });
    const noPassword = await owner.post(`${base}/members`, {
      name: "Sin clave",
      email: "sin@example.com",
      role: "admin",
    });
    expect(noPassword.body.error.fields).toEqual({ password: "required" });
    const shortPassword = await owner.post(`${base}/members`, {
      name: "Corta",
      email: "corta@example.com",
      password: "nine-char",
      role: "admin",
    });
    expect(shortPassword.body.error.fields).toEqual({ password: "too_small" });
  });

  it("lets admins reset passwords, change roles and remove access, but not their own", async () => {
    const { app, owner, base, pepe } = await shopWithTeam();
    await owner.post(`${base}/members`, {
      name: "Ana",
      email: "ana@example.com",
      password: "ana-password-1",
      role: "admin",
    });
    const created = await owner.post(`${base}/members`, {
      name: "Pepe",
      email: "pepe@example.com",
      password: "pepe-password-1",
      role: "admin",
    });
    const pepeId = created.body.userId;
    const ana = (await signIn(app, "ana@example.com", "ana-password-1")).client;
    const pepeSession = (await signIn(app, "pepe@example.com", "pepe-password-1")).client;
    expect((await pepeSession.get("/api/me")).status).toBe(200);

    const reset = await ana.put(`${base}/members/${pepeId}/password`, {
      password: "pepe-password-2",
    });
    expect(reset.status).toBe(200);
    // Old sessions are closed and only the new password works.
    expect((await pepeSession.get("/api/me")).status).toBe(401);
    expect((await signIn(app, "pepe@example.com", "pepe-password-1")).status).toBe(401);
    expect((await signIn(app, "pepe@example.com", "pepe-password-2")).status).toBe(200);

    const moved = await ana.patch(`${base}/members/${pepeId}`, {
      role: "professional",
      resourceId: pepe.id,
    });
    expect(moved.status).toBe(200);

    const me = (await ana.get("/api/me")).body.user.id;
    expect(
      (await ana.patch(`${base}/members/${me}`, { role: "professional", resourceId: pepe.id })).body
        .error.code,
    ).toBe("cannot_change_own_role");
    expect((await ana.delete(`${base}/members/${me}`)).body.error.code).toBe("cannot_remove_self");
    expect((await ana.delete(`${base}/members/${pepeId}`)).status).toBe(204);
  });

  it("won't let an admin reset the password of someone who also works elsewhere", async () => {
    const { owner, base, app } = await shopWithTeam();
    const other = await createBusiness(owner, { name: "Spa", slug: "spa-luna" });
    await owner.post(`${base}/members`, {
      name: "Ana",
      email: "ana@example.com",
      password: "ana-password-1",
      role: "admin",
    });
    const shared = await owner.post(`${base}/members`, {
      name: "Lu",
      email: "lu@example.com",
      password: "lu-password-1",
      role: "admin",
    });
    // Already has an account: added to the spa without a new password.
    const added = await owner.post(`/api/businesses/${other.id}/members`, {
      name: "Lu",
      email: "lu@example.com",
      role: "admin",
    });
    expect(added.body.created).toBe(false);

    const ana = (await signIn(app, "ana@example.com", "ana-password-1")).client;
    const reset = await ana.put(`${base}/members/${shared.body.userId}/password`, {
      password: "taken-over-1",
    });
    expect(reset.status).toBe(403);
  });
});

describe("professionals", () => {
  it("see and book only their own agenda", async () => {
    const { app, owner, business, base, haircut, juan, pepe, saturday } = await shopWithTeam();
    await owner.post(`${base}/members`, {
      name: "Juan",
      email: "juan@example.com",
      password: "juan-password-1",
      role: "professional",
      resourceId: juan.id,
    });
    const pro = (await signIn(app, "juan@example.com", "juan-password-1")).client;

    // The admin books one for each of them.
    const forPepe = await owner.post(`${base}/appointments`, {
      serviceId: haircut.id,
      resourceId: pepe.id,
      date: saturday,
      time: "09:00",
      customer: { firstName: "Ana", lastName: "Pérez", phone: "+57 300 000 0001" },
    });
    expect(forPepe.status).toBe(201);
    expect(forPepe.body.appointment).toMatchObject({ resourceName: "Pepe", source: "admin" });

    // The professional books for themselves, even when asking for someone else.
    const own = await pro.post(`${base}/appointments`, {
      serviceId: haircut.id,
      resourceId: pepe.id,
      date: saturday,
      time: "10:00",
      customer: { firstName: "Leo", lastName: "Gómez", phone: "+57 300 000 0002" },
    });
    expect(own.status).toBe(201);
    expect(own.body.appointment.resourceName).toBe("Juan");

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const agenda = await pro.get(`${base}/appointments?from=${from}&to=${to}`);
    expect(agenda.body.appointments.map((a: { id: string }) => a.id)).toEqual([
      own.body.appointment.id,
    ]);

    // Moving their own works; someone else's doesn't exist for them; cancelling is the admin's.
    const moved = await pro.patch(`${base}/appointments/${own.body.appointment.id}`, {
      serviceId: haircut.id,
      resourceId: null,
      date: saturday,
      time: "11:00",
    });
    expect(moved.status).toBe(200);
    expect(
      (
        await pro.patch(`${base}/appointments/${forPepe.body.appointment.id}`, {
          serviceId: haircut.id,
          resourceId: null,
          date: saturday,
          time: "12:00",
        })
      ).status,
    ).toBe(404);
    expect(
      (await pro.post(`${base}/appointments/${own.body.appointment.id}/cancel`, {})).status,
    ).toBe(403);

    // Free times are only theirs.
    const slots = await pro.get(
      `${base}/appointments/slots?serviceId=${haircut.id}&date=${saturday}`,
    );
    expect(
      slots.body.slots.every(
        (slot: { resourceIds: string[] }) => slot.resourceIds.join() === juan.id,
      ),
    ).toBe(true);

    // Customers only by search; the rest of the business is off limits.
    expect((await pro.get(`${base}/customers`)).body.customers).toEqual([]);
    expect((await pro.get(`${base}/customers?q=leo`)).body.customers).toEqual([
      expect.objectContaining({ firstName: "Leo" }),
    ]);
    expect((await pro.get(`${base}/services`)).status).toBe(200);
    expect(
      (await pro.post(`${base}/services`, { name: "X", durationMin: 30, priceAmount: 0 })).status,
    ).toBe(403);
    expect((await pro.get(`${base}/closures`)).status).toBe(403);
    expect((await pro.patch(`/api/businesses/${business.id}`, { name: "X" })).status).toBe(403);
    expect((await pro.get(`${base}/access`)).status).toBe(403);
  });
});
