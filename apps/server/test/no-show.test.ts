import { addDays, todayIn, weekdayOf } from "@openturnly/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appointments } from "../src/db/schema.ts";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

/** A date at least two days ahead that falls on `weekday` (0 = Sunday), in Bogotá. */
function next(weekday: number): string {
  let date = addDays(todayIn("America/Bogota"), 2);
  while (weekdayOf(date) !== weekday) date = addDays(date, 1);
  return date;
}

describe("no-shows", () => {
  it("marks a started appointment as a no-show, and undoes it while the time is free", async () => {
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
    const saturday = next(6);
    const book = async (time: string, phone: string) =>
      (
        await owner.post(`${base}/appointments`, {
          serviceId: haircut.id,
          resourceId: juan.id,
          date: saturday,
          time,
          customer: { firstName: "Ana", lastName: "Pérez", phone, email: null },
        })
      ).body.appointment;
    /** Moves an appointment to an hour that started 90 minutes ago. */
    const startedAgo = async (id: string) => {
      const start = new Date(Date.now() - 90 * 60_000);
      await app.db
        .update(appointments)
        .set({ startsAt: start, endsAt: new Date(start.getTime() + 60 * 60_000) })
        .where(eq(appointments.id, id));
    };

    const ana = await book("09:00", "+57 300 123 4567");
    const early = await owner.post(`${base}/appointments/${ana.id}/no-show`, {});
    expect([early.status, early.body.error.code]).toEqual([409, "appointment_not_started"]);

    await startedAgo(ana.id);
    const marked = await owner.post(`${base}/appointments/${ana.id}/no-show`, {});
    expect(marked.body.appointment.status).toBe("no_show");
    // It can't be moved, charged or cancelled any more.
    const moved = await owner.patch(`${base}/appointments/${ana.id}`, {
      serviceId: haircut.id,
      resourceId: juan.id,
      date: saturday,
      time: "15:00",
    });
    expect(moved.body.error.code).toBe("appointment_no_show");
    const charged = await owner.post(`${base}/sales`, {
      items: [{ kind: "service", serviceId: haircut.id, appointmentId: ana.id, unitPrice: 25_000 }],
      payments: [{ method: "cash", amount: 25_000 }],
    });
    expect(charged.body.error.code).toBe("appointment_no_show");
    const cancelled = await owner.post(`${base}/appointments/${ana.id}/cancel`, {});
    expect(cancelled.body.appointment.status).toBe("no_show");

    // Someone else took the time meanwhile: it can't come back.
    const leo = await book("11:00", "+57 300 765 4321");
    await startedAgo(leo.id);
    const taken = await owner.delete(`${base}/appointments/${ana.id}/no-show`);
    expect([taken.status, taken.body.error.code]).toEqual([409, "slot_taken"]);
    await owner.post(`${base}/appointments/${leo.id}/cancel`, {});
    const restored = await owner.delete(`${base}/appointments/${ana.id}/no-show`);
    expect(restored.body.appointment.status).toBe("confirmed");

    // A paid appointment did happen.
    await owner.post(`${base}/sales`, {
      items: [{ kind: "service", serviceId: haircut.id, appointmentId: ana.id, unitPrice: 25_000 }],
      payments: [{ method: "cash", amount: 25_000 }],
    });
    const paid = await owner.post(`${base}/appointments/${ana.id}/no-show`, {});
    expect(paid.body.error.code).toBe("appointment_paid");
  });
});
