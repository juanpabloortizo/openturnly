import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { describe, expect, it } from "vitest";
import { networkKey } from "../src/lib/client-ip.ts";
import {
  createBusiness,
  createTestApp,
  setUpOwner,
  solveProof,
  TEST_GUARD_SETTINGS,
} from "./helpers.ts";

/** The next Saturday at least two days ahead, in Bogotá (default hours: 9–13). */
function nextSaturday(): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== 6) date = addDays(date, 1);
  return date;
}

async function shop(options: Parameters<typeof createTestApp>[0] = {}) {
  const app = await createTestApp(options);
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const haircut = (
    await owner.post(`/api/businesses/${business.id}/services`, {
      name: "Corte",
      durationMin: 30,
      priceAmount: 20_000,
    })
  ).body.service;
  const visitor = app.client();
  // Network limits need the visitor's address, as a trusted proxy reports it.
  const from = options.trustProxy ? { "x-forwarded-for": "203.0.113.7" } : undefined;
  let phone = 3_000_000_000;
  const booking = (time: string, extra: Record<string, unknown> = {}) => ({
    serviceId: haircut.id,
    resourceId: null,
    date: nextSaturday(),
    time,
    customer: { firstName: "Ana", lastName: "Pérez", phone: `+57 ${phone++}` },
    ...extra,
  });
  const book = (time: string, extra: Record<string, unknown> = {}) =>
    visitor.post("/api/public/businesses/fte-barber/bookings", booking(time, extra), from);
  return { app, owner, business, visitor, booking, book, from };
}

const limits = (overrides: Partial<typeof TEST_GUARD_SETTINGS.limits>) => ({
  limits: { ...TEST_GUARD_SETTINGS.limits, ...overrides },
});

describe("anti-bot puzzle", () => {
  it("is required, good for one booking only, and only at its business", async () => {
    const { owner, visitor, book } = await shop();
    const missing = await book("09:00", { proof: undefined });
    expect(missing.status).toBe(403);
    expect(missing.body.error).toEqual({ code: "challenge_failed", fields: { proof: "missing" } });

    const proof = await solveProof(visitor, "fte-barber");
    expect((await book("09:00", { proof })).status).toBe(201);
    const replay = await book("10:00", { proof });
    expect(replay.body.error.fields).toEqual({ proof: "used" });

    await createBusiness(owner, { name: "Spa", slug: "spa-luna" });
    const elsewhere = await solveProof(visitor, "spa-luna");
    expect((await book("10:00", { proof: elsewhere })).body.error.fields).toEqual({
      proof: "invalid",
    });
    expect((await book("10:00", { proof: "bm9wZQ==" })).body.error.fields).toEqual({
      proof: "invalid",
    });
  });

  it("refuses proofs solved faster than a person fills in the form", async () => {
    const { book } = await shop({ bookingGuard: { minAgeMs: 60_000 } });
    expect((await book("09:00")).body.error.fields).toEqual({ proof: "too_fast" });
  });
});

describe("booking limits", () => {
  it("caps bookings per network at one business", async () => {
    const { book } = await shop({ trustProxy: true, bookingGuard: limits({ perNetworkHour: 2 }) });
    expect((await book("09:00")).status).toBe(201);
    expect((await book("09:30")).status).toBe(201);
    const third = await book("10:00");
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("too_many_requests");
  });

  it("caps bookings per phone number", async () => {
    const { book } = await shop({ bookingGuard: limits({ perContactHour: 1 }) });
    const customer = { firstName: "Ana", lastName: "Pérez", phone: "+57 300 111 2222" };
    expect((await book("09:00", { customer })).status).toBe(201);
    expect((await book("11:00", { customer })).status).toBe(429);
  });

  it("caps availability lookups per network", async () => {
    const { visitor, from } = await shop({
      trustProxy: true,
      bookingGuard: limits({ availabilityPerMinute: 2 }),
    });
    const day = nextSaturday();
    const path = `/api/public/businesses/fte-barber/availability?serviceId=x&from=${day}&to=${day}`;
    await visitor.get(path, from);
    await visitor.get(path, from);
    expect((await visitor.get(path, from)).status).toBe(429);
  });

  it("leaves network limits off when every visitor shows the same internal address", async () => {
    // Docker Desktop, or a proxy without TRUST_PROXY: limiting it would block everyone.
    const { book } = await shop({ bookingGuard: limits({ perNetworkHour: 1 }) });
    expect((await book("09:00")).status).toBe(201);
    expect((await book("09:30")).status).toBe(201);
  });

  it("counts IPv6 addresses by their /64 network", () => {
    expect(networkKey("203.0.113.7")).toBe("203.0.113.7");
    expect(networkKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(networkKey("2001:db8:aa:1::1")).toBe("2001:db8:aa:1::/64");
    expect(networkKey("2001:0db8:00aa:0001:ffff:1:2:3")).toBe("2001:db8:aa:1::/64");
    expect(networkKey("2001:db8::7")).toBe("2001:db8:0:0::/64");
    expect(networkKey(null)).toBeNull();
    for (const internal of [
      "127.0.0.1",
      "10.0.0.8",
      "172.17.0.1",
      "192.168.65.1",
      "::1",
      "fd00::1",
    ]) {
      expect(networkKey(internal)).toBeNull();
    }
  });
});

describe("surge brake", () => {
  it("hardens the puzzle and warns admins when bookings pour in", async () => {
    const { owner, business, visitor, book } = await shop({
      bookingGuard: { surge: { minPerHour: 2, factor: 2, holdMs: 60 * 60_000, capFactor: 2 } },
    });
    const calm = await visitor.get("/api/public/businesses/fte-barber/challenge");
    expect(calm.body.level).toBe("normal");
    const easyProof = await solveProof(visitor, "fte-barber");

    expect((await book("09:00")).status).toBe(201);
    expect((await book("09:30")).status).toBe(201);

    const busy = await visitor.get("/api/public/businesses/fte-barber/challenge");
    expect(busy.body.level).toBe("protected");
    // A puzzle fetched before the surge is no longer enough...
    expect((await book("10:00", { proof: easyProof })).body.error.fields).toEqual({
      proof: "too_easy",
    });
    // ...but a hard one still books: the page keeps working.
    expect((await book("10:00")).status).toBe(201);

    const protection = await owner.get(`/api/businesses/${business.id}/protection`);
    expect(protection.body.protection).toMatchObject({ active: true, lastHour: 3, threshold: 2 });

    // At twice the threshold, online bookings wait for the next hour.
    expect((await book("10:30")).status).toBe(201);
    const capped = await book("11:00");
    expect(capped.status).toBe(429);
    expect(capped.body.error.code).toBe("busy");
  });

  it("allows fewer bookings per network during a surge", async () => {
    const { book } = await shop({
      trustProxy: true,
      bookingGuard: {
        ...limits({ perNetworkHourInSurge: 1 }),
        surge: { minPerHour: 1, factor: 2, holdMs: 60 * 60_000, capFactor: 10 },
      },
    });
    // The surge starts with the first booking; from then on this network gets one per hour.
    expect((await book("09:00")).status).toBe(201);
    expect((await book("09:30")).status).toBe(201);
    expect((await book("10:00")).status).toBe(429);
  });
});

describe("proxy setup", () => {
  it("tells the owner when a proxy forwards requests but isn't trusted", async () => {
    const { owner, visitor } = await shop();
    expect((await owner.get("/api/me/notices")).body.notices).toEqual([]);
    await visitor.get("/api/public/businesses/fte-barber", { "x-forwarded-for": "203.0.113.7" });
    expect((await owner.get("/api/me/notices")).body.notices).toEqual(["proxy_not_trusted"]);

    const trusted = await shop({ trustProxy: true });
    await trusted.visitor.get("/api/public/businesses/fte-barber", {
      "x-forwarded-for": "203.0.113.7",
    });
    expect((await trusted.owner.get("/api/me/notices")).body.notices).toEqual([]);
  });
});
