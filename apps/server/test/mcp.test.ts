import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner, type TestApp } from "./helpers.ts";

/** The next Saturday at least two days ahead, in Bogotá (default hours: 9–13). */
function nextSaturday(): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== 6) date = addDays(date, 1);
  return date;
}

/** An MCP client talking to the test app, as an AI agent would over HTTP. */
async function connect(app: TestApp, token: string | null, slug = "fte-barber") {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:3000/${slug}/mcp`),
    {
      fetch: (url, init) => Promise.resolve(app.app.request(String(url), init)),
      requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : {},
    },
  );
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

/** Calls a tool and returns its JSON result, or the error text. */
async function run(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  const text = result.content[0]?.text ?? "";
  // biome-ignore lint/suspicious/noExplicitAny: tests read tool results ad hoc.
  return result.isError ? { error: text } : (JSON.parse(text) as any);
}

async function shop() {
  const app = await createTestApp();
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
  const haircut = (
    await owner.post(`${base}/services`, { name: "Corte", durationMin: 60, priceAmount: 25_000 })
  ).body.service;
  const juan = (
    await owner.post(`${base}/professionals`, { name: "Juan", serviceIds: [haircut.id] })
  ).body.professional;
  const agentKey = (await owner.post(`${base}/api-keys`, { name: "WhatsApp", kind: "agent" })).body;
  const adminKey = (await owner.post(`${base}/api-keys`, { name: "Asistente", kind: "admin" }))
    .body;
  return {
    app,
    owner,
    business,
    base,
    haircut,
    juan,
    agentKey,
    adminKey,
    saturday: nextSaturday(),
  };
}

describe("access keys", () => {
  it("are shown once, listed by their last characters, and can be revoked", async () => {
    const { owner, base, agentKey } = await shop();
    expect(agentKey.token).toMatch(/^ot_[\w-]{32}$/);
    expect(agentKey.key).toMatchObject({ name: "WhatsApp", kind: "agent" });
    const list = await owner.get(`${base}/api-keys`);
    expect(list.body.keys).toHaveLength(2);
    expect(list.body.keys[0]).toMatchObject({ name: "WhatsApp", hint: agentKey.token.slice(-4) });
    expect(JSON.stringify(list.body)).not.toContain(agentKey.token);

    expect((await owner.delete(`${base}/api-keys/${agentKey.key.id}`)).status).toBe(204);
    expect((await owner.get(`${base}/api-keys`)).body.keys).toHaveLength(1);
  });

  it("let admin keys use the admin API, but not manage keys or reach other businesses", async () => {
    const { app, owner, base, adminKey, agentKey } = await shop();
    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
    const agent = app.client();
    expect((await agent.get(`${base}/services`, bearer(adminKey.token))).status).toBe(200);
    expect((await agent.get(`${base}/services`, bearer(agentKey.token))).status).toBe(403);
    expect((await agent.get(`${base}/api-keys`, bearer(adminKey.token))).status).toBe(403);
    expect((await agent.get(`${base}/services`, bearer("ot_not-a-real-key"))).status).toBe(401);

    const other = await createBusiness(owner, { name: "Spa", slug: "spa-luna" });
    expect(
      (await agent.get(`/api/businesses/${other.id}/services`, bearer(adminKey.token))).status,
    ).toBe(401);
  });
});

describe("MCP server", () => {
  it("needs a key of that business", async () => {
    const { app, owner, agentKey } = await shop();
    await expect(connect(app, null)).rejects.toThrow();
    await expect(connect(app, "ot_wrong-key-wrong-key-wrong-key")).rejects.toThrow();
    await createBusiness(owner, { name: "Spa", slug: "spa-luna" });
    await expect(connect(app, agentKey.token, "spa-luna")).rejects.toThrow();
  });

  it("gives customer-facing agents only what a receptionist needs", async () => {
    const { app, agentKey, adminKey } = await shop();
    const agent = await connect(app, agentKey.token);
    const names = (await agent.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "book_appointment",
      "cancel_appointment",
      "find_appointment",
      "find_available_times",
      "find_next_available",
      "get_business_info",
      "list_professionals",
      "list_services",
      "reschedule_appointment",
    ]);
    const admin = await connect(app, adminKey.token);
    const adminNames = (await admin.listTools()).tools.map((tool) => tool.name);
    expect(adminNames).toEqual(
      expect.arrayContaining(["get_agenda", "search_customers", "create_service", "get_summary"]),
    );
    expect(adminNames).not.toContain("find_appointment");
  });

  it("lets an agent inform, book, look up, move and cancel for a customer", async () => {
    const { app, owner, base, haircut, juan, agentKey, saturday } = await shop();
    const agent = await connect(app, agentKey.token);

    const info = await run(agent, "get_business_info");
    expect(info).toMatchObject({ name: "FTE Barber Studio", time_zone: "America/Bogota" });
    expect(info.opening_hours).toHaveLength(7);
    expect(info.booking_needs.phone).toBe("required");

    const services = await run(agent, "list_services");
    expect(services).toEqual([
      expect.objectContaining({
        id: haircut.id,
        duration_minutes: 60,
        price: 25_000,
        professionals: [{ id: juan.id, name: "Juan" }],
      }),
    ]);
    expect(await run(agent, "list_professionals")).toEqual([
      { id: juan.id, name: "Juan", services: [{ id: haircut.id, name: "Corte" }] },
    ]);

    const free = await run(agent, "find_available_times", {
      service_id: haircut.id,
      date: saturday,
    });
    expect(free.days[0].times[0]).toEqual({ time: "09:00", professionals: ["Juan"] });
    const next = await run(agent, "find_next_available", { service_id: haircut.id });
    expect(next.times.length).toBeGreaterThan(0);

    const booked = await run(agent, "book_appointment", {
      service_id: haircut.id,
      date: saturday,
      time: "09:00",
      customer: { first_name: "ana", last_name: "pérez", phone: "300 123 4567" },
    });
    expect(booked).toMatchObject({
      booked: true,
      date: saturday,
      time: "09:00",
      professional: "Juan",
    });
    const code = booked.code;

    // Marked as booked by the agent, with the key's name.
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const agenda = await owner.get(`${base}/appointments?from=${from}&to=${to}`);
    expect(agenda.body.appointments[0]).toMatchObject({ source: "agent", sourceLabel: "WhatsApp" });

    // Someone else's code or the wrong phone looks the same: not found.
    expect(
      (await run(agent, "find_appointment", { code, phone_or_email: "+57 311 000 0000" })).error,
    ).toMatch(/^appointment_not_found/);
    const found = await run(agent, "find_appointment", { code, phone_or_email: "3001234567" });
    expect(found).toMatchObject({ code, customer: "Ana Pérez", can_change_or_cancel: true });

    const moved = await run(agent, "reschedule_appointment", {
      code,
      phone_or_email: "+57 300 123 4567",
      date: saturday,
      time: "11:00",
    });
    expect(moved).toMatchObject({ moved: true, time: "11:00" });

    const taken = await run(agent, "book_appointment", {
      service_id: haircut.id,
      date: saturday,
      time: "11:00",
      customer: { first_name: "Leo", last_name: "Gómez", phone: "300 765 4321" },
    });
    expect(taken.error).toMatch(/^slot_taken/);

    const cancelled = await run(agent, "cancel_appointment", {
      code,
      phone_or_email: "3001234567",
    });
    expect(cancelled).toMatchObject({ cancelled: true, status: "cancelled" });
  });

  it("respects how close to the date customers may change appointments", async () => {
    const { app, owner, business, haircut, agentKey, saturday } = await shop();
    const agent = await connect(app, agentKey.token);
    const { code } = await run(agent, "book_appointment", {
      service_id: haircut.id,
      date: saturday,
      time: "09:00",
      customer: { first_name: "Ana", last_name: "Pérez", phone: "300 123 4567" },
    });
    await owner.patch(`/api/businesses/${business.id}`, { customerChangeNoticeMin: null });
    const refused = await run(agent, "cancel_appointment", { code, phone_or_email: "3001234567" });
    expect(refused.error).toMatch(/^changes_not_allowed/);

    // Two weeks' notice: a booking a few days ahead is already too close.
    await owner.patch(`/api/businesses/${business.id}`, { customerChangeNoticeMin: 14 * 24 * 60 });
    const late = await run(agent, "cancel_appointment", { code, phone_or_email: "3001234567" });
    expect(late.error).toMatch(/^too_late_to_change/);
  });

  it("lets an admin key run the calendar, customers, catalog and hours", async () => {
    const { app, haircut, juan, adminKey, saturday } = await shop();
    const admin = await connect(app, adminKey.token);

    const booked = await run(admin, "book_appointment", {
      service_id: haircut.id,
      date: saturday,
      time: "10:00",
      customer: { first_name: "Leo", last_name: "Gómez", phone: "300 765 4321" },
    });
    expect(booked).toMatchObject({ booked: true, time: "10:00" });

    const agenda = await run(admin, "get_agenda", { date: saturday });
    expect(agenda).toEqual([
      expect.objectContaining({
        code: booked.code,
        booked_via: "Asistente",
        customer: expect.objectContaining({ name: "Leo Gómez", phone: "+573007654321" }),
      }),
    ]);
    const appointment = await run(admin, "get_appointment", { code: booked.code });
    expect(appointment.customer.name).toBe("Leo Gómez");
    expect(
      await run(admin, "reschedule_appointment", {
        code: booked.code,
        date: saturday,
        time: "12:00",
      }),
    ).toMatchObject({ moved: true, time: "12:00" });

    const [leo] = await run(admin, "search_customers", { query: "leo" });
    expect(leo).toMatchObject({ name: "Leo Gómez", visits: 1 });
    expect((await run(admin, "get_customer", { customer_id: leo.id })).appointments).toHaveLength(
      1,
    );
    expect(
      await run(admin, "update_customer", { customer_id: leo.id, notes: "Prefiere tijera" }),
    ).toMatchObject({ notes: "Prefiere tijera" });
    expect(
      await run(admin, "create_customer", {
        first_name: "Eva",
        last_name: "Ruiz",
        email: "eva@x.co",
      }),
    ).toMatchObject({ name: "Eva Ruiz" });

    const beard = await run(admin, "create_service", {
      name: "Barba",
      duration_minutes: 30,
      price: 12000,
    });
    expect(beard).toMatchObject({ name: "Barba", price: 12_000, active: true });
    expect(
      await run(admin, "update_service", { service_id: beard.id, price: 15000 }),
    ).toMatchObject({ price: 15_000 });
    const max = await run(admin, "create_professional", { name: "Max", service_ids: [beard.id] });
    expect(
      await run(admin, "update_professional", {
        professional_id: max.id,
        service_ids: [beard.id, haircut.id],
      }),
    ).toMatchObject({ name: "Max" });

    expect(
      await run(admin, "set_opening_hours", {
        professional_id: juan.id,
        hours: [{ day: "saturday", start: "09:00", end: "12:00" }],
      }),
    ).toMatchObject({ saved: true, hours: [{ day: "saturday", start: "09:00", end: "12:00" }] });
    expect(
      (await run(admin, "get_opening_hours", { professional_id: juan.id })).hours,
    ).toHaveLength(1);

    const closure = await run(admin, "add_closure", {
      date: addDays(saturday, 7),
      professional_id: juan.id,
      note: "Vacaciones",
    });
    expect(await run(admin, "list_closures")).toEqual([
      expect.objectContaining({ id: closure.id, note: "Vacaciones" }),
    ]);
    expect(await run(admin, "remove_closure", { closure_id: closure.id })).toEqual({
      removed: true,
    });

    const holidays = await run(admin, "list_holidays");
    expect(holidays.length).toBeGreaterThan(5);
    expect(await run(admin, "set_holiday", { date: holidays[0].date, open: true })).toMatchObject({
      open: true,
    });
    expect(
      await run(admin, "update_booking_rules", { customers_can_change_until_minutes_before: 60 }),
    ).toMatchObject({ saved: true, customers_can_change_until_minutes_before: 60 });

    // The business's own details, as its booking page shows them.
    expect(
      await run(admin, "update_business_details", {
        description: "  Cortes clásicos y barba.  ",
        phone: "604 444 1234",
        email: "Hola@FTE.example",
        address: "Calle 10 # 43-12, Medellín",
      }),
    ).toMatchObject({
      saved: true,
      name: "FTE Barber Studio",
      description: "Cortes clásicos y barba.",
      email: "hola@fte.example",
      address: "Calle 10 # 43-12, Medellín",
    });
    expect(await run(admin, "get_business_info")).toMatchObject({
      phone: "604 444 1234",
      description: "Cortes clásicos y barba.",
    });
    // An empty text clears it; a bad email is refused; nothing at all is an error.
    expect(await run(admin, "update_business_details", { phone: "" })).toMatchObject({
      phone: null,
    });
    expect(
      (await run(admin, "update_business_details", { email: "no-es-correo" })).error,
    ).toBeTruthy();
    expect((await run(admin, "update_business_details", {})).error).toBeTruthy();

    const summary = await run(admin, "get_summary", { date: saturday, until_date: saturday });
    expect(summary).toMatchObject({ appointments: 1, cancelled: 0, income: { price: 25_000 } });

    expect(await run(admin, "cancel_appointment", { code: booked.code })).toMatchObject({
      cancelled: true,
    });
  });
});
