import { type BookingRules, normalizePhone, slotsForDate } from "@openturnly/core";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  type Appointment,
  appointments,
  type Business,
  type Customer,
  customers,
  resources,
  type Service,
} from "../db/schema.ts";
import { businessCountry } from "./holidays.ts";
import { apiError } from "./http.ts";
import { bookingRules, loadSchedules, pickLeastBusy } from "./schedules.ts";

/**
 * The business moving its own appointments: opening hours, closures and other bookings
 * still apply, but not the customers' minimum notice or booking window.
 */
export function staffRules(business: Business): BookingRules {
  return { ...bookingRules(business), minNoticeMin: 0, maxAdvanceDays: 3650 };
}

/**
 * Moves an appointment to another time, professional or service, if that time is free
 * under `rules`. Waits in the business's booking queue like a new booking does, so a move
 * and a booking can't take the same time.
 */
export async function moveAppointment(
  db: Db,
  business: Business,
  current: Appointment,
  service: Service,
  input: { resourceId: string | null; date: string; time: string },
  rules: BookingRules,
): Promise<Appointment> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${business.id}, 0))`);
    const schedules = await loadSchedules(
      tx,
      business,
      service.id,
      input.resourceId,
      input.date,
      input.date,
      current.id,
    );
    const slot = slotsForDate(input.date, service.durationMin, schedules, rules, Date.now()).find(
      (candidate) => candidate.time === input.time,
    );
    if (!slot) throw apiError(409, "slot_taken");

    const resourceId = pickLeastBusy(slot.resourceIds, schedules, slot.start);
    const [resource] = resourceId
      ? await tx
          .select({ name: resources.name })
          .from(resources)
          .where(eq(resources.id, resourceId))
      : [];
    const [updated] = await tx
      .update(appointments)
      .set({
        serviceId: service.id,
        serviceName: service.name,
        // The price agreed at booking stays unless the service itself changes.
        priceAmount: service.id === current.serviceId ? current.priceAmount : service.priceAmount,
        resourceId,
        resourceName: resource?.name ?? null,
        startsAt: new Date(slot.start),
        endsAt: new Date(slot.end),
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, current.id))
      .returning();
    if (!updated) throw apiError(404, "appointment_not_found");
    return updated;
  });
}

/**
 * A customer's appointment found by its booking code and their phone or email, the way a
 * customer proves it's theirs. Any mismatch reads as "not found", so codes can't be probed.
 */
export async function findCustomerAppointment(
  db: Db,
  business: Business,
  code: string,
  contact: string,
): Promise<{ appointment: Appointment; customer: Customer }> {
  const [row] = await db
    .select({ appointment: appointments, customer: customers })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .where(
      and(
        eq(appointments.businessId, business.id),
        eq(appointments.code, code.trim().toUpperCase()),
      ),
    );
  const typed = contact.trim();
  const matches =
    row &&
    (typed.includes("@")
      ? row.customer.email !== null && row.customer.email === typed.toLowerCase()
      : row.customer.phone !== null &&
        row.customer.phone === normalizePhone(typed, businessCountry(business) ?? undefined));
  if (!row || !matches) throw apiError(404, "appointment_not_found");
  return row;
}

/** Whether the customer may still move or cancel this appointment themselves. */
export function assertCustomerCanChange(
  business: Business,
  appointment: Appointment,
  now = Date.now(),
) {
  if (appointment.status !== "confirmed") throw apiError(409, "appointment_cancelled");
  if (business.customerChangeNoticeMin === null) throw apiError(403, "changes_not_allowed");
  const deadline = appointment.startsAt.getTime() - business.customerChangeNoticeMin * 60_000;
  if (now > deadline) throw apiError(409, "too_late_to_change");
}
