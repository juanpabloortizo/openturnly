import {
  isDateString,
  isTimeString,
  parseTime,
  slotsForDate,
  staffBookingSchema,
  zonedTimeToInstant,
} from "@openturnly/core";
import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  appointments,
  type Business,
  customers,
  deposits,
  giftCards,
  locations,
  resources,
  services,
} from "../db/schema.ts";
import type { BusinessAccess } from "../lib/access.ts";
import { moveAppointment, staffRules } from "../lib/appointment-changes.ts";
import { newBookingCode } from "../lib/codes.ts";
import { matchCustomer, saveBookingCustomer } from "../lib/customers.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { resolveLocation } from "../lib/locations.ts";
import { chargedAppointments } from "../lib/sales.ts";
import { loadSchedules, pickLeastBusy } from "../lib/schedules.ts";

const rangeQuery = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  includeCancelled: z.enum(["true", "false"]).optional(),
  locationId: z.string().min(1).optional(),
});

/** Longest period one request can cover: enough for a yearly export. */
const MAX_RANGE_MS = 400 * 24 * 60 * 60 * 1000;

const rescheduleSchema = z.object({
  /** Another location; left out, the appointment stays where it is. */
  locationId: z.string().min(1).optional(),
  serviceId: z.string().min(1),
  /** A professional, or null for whoever is free. */
  resourceId: z.string().min(1).nullable(),
  date: z.string().refine(isDateString, "invalid_date"),
  time: z.string().refine(isTimeString, "invalid_time"),
});

/** The business calendar: appointments between two instants, with who booked them. */
export function appointmentRoutes({ db, automations }: Deps) {
  /** A confirmed appointment of the business; professionals only reach their own. */
  const findAppointment = async (
    businessId: string,
    appointmentId: string,
    access: BusinessAccess,
  ) => {
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.businessId, businessId), eq(appointments.id, appointmentId)));
    if (!appointment) throw apiError(404, "appointment_not_found");
    if (access.role === "professional" && appointment.resourceId !== access.resourceId) {
      throw apiError(404, "appointment_not_found");
    }
    if (appointment.status !== "confirmed") throw apiError(409, "appointment_cancelled");
    return appointment;
  };

  const findService = async (businessId: string, serviceId: string) => {
    const [service] = await db
      .select()
      .from(services)
      .where(and(eq(services.businessId, businessId), eq(services.id, serviceId)));
    if (!service) throw apiError(404, "service_not_found");
    return service;
  };

  /**
   * Free times on `date` for a service, with who is free at each. Professionals only see
   * times when they themselves are free.
   */
  const freeSlots = async (
    business: Business,
    access: BusinessAccess,
    locationId: string | null | undefined,
    serviceId: string,
    date: string,
    ignoreAppointmentId?: string,
  ) => {
    if (!isDateString(date)) throw apiError(400, "invalid_date");
    const location = await resolveLocation(db, business.id, locationId, { forBooking: true });
    const service = await findService(business.id, serviceId);
    const schedules = await loadSchedules(
      db,
      business,
      location.id,
      service.id,
      null,
      date,
      date,
      ignoreAppointmentId,
    );
    const own = access.role === "professional" ? access.resourceId : null;
    return slotsForDate(date, service.durationMin, schedules, staffRules(business), Date.now())
      .map((slot) => ({
        time: slot.time,
        resourceIds: slot.resourceIds.filter(
          (id): id is string => id !== null && (own === null || id === own),
        ),
      }))
      .filter((slot) => own === null || slot.resourceIds.length > 0);
  };

  /** The professional a booking goes to: professionals always book for themselves. */
  const bookedFor = (access: BusinessAccess, resourceId: string | null) => {
    if (access.role !== "professional") return resourceId;
    if (!access.resourceId) throw apiError(403, "no_profile");
    return access.resourceId;
  };

  return (
    new Hono<BusinessEnv>()
      .get("/", async (c) => {
        const access = c.get("access");
        const query = rangeQuery.safeParse(c.req.query());
        if (!query.success) throw apiError(400, "invalid_range");
        const from = new Date(query.data.from);
        const to = new Date(query.data.to);
        if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
          throw apiError(400, "invalid_range");
        }

        const rows = await db
          .select({
            id: appointments.id,
            code: appointments.code,
            startsAt: appointments.startsAt,
            endsAt: appointments.endsAt,
            status: appointments.status,
            locationId: appointments.locationId,
            locationName: locations.name,
            serviceId: appointments.serviceId,
            serviceName: appointments.serviceName,
            resourceId: appointments.resourceId,
            resourceName: appointments.resourceName,
            priceAmount: appointments.priceAmount,
            discountAmount: appointments.discountAmount,
            giftCode: giftCards.code,
            answers: appointments.answers,
            source: appointments.source,
            sourceLabel: appointments.sourceLabel,
            createdAt: appointments.createdAt,
            cancelledAt: appointments.cancelledAt,
            customer: {
              id: customers.id,
              firstName: customers.firstName,
              lastName: customers.lastName,
              email: customers.email,
              phone: customers.phone,
            },
          })
          .from(appointments)
          .innerJoin(customers, eq(customers.id, appointments.customerId))
          .leftJoin(locations, eq(locations.id, appointments.locationId))
          .leftJoin(giftCards, eq(giftCards.id, appointments.giftCardId))
          .where(
            and(
              eq(appointments.businessId, c.get("business").id),
              query.data.locationId
                ? eq(appointments.locationId, query.data.locationId)
                : undefined,
              lt(appointments.startsAt, to),
              gt(appointments.endsAt, from),
              query.data.includeCancelled === "true"
                ? undefined
                : ne(appointments.status, "cancelled"),
              // Professionals see only their own agenda.
              access.role === "professional"
                ? eq(appointments.resourceId, access.resourceId ?? "")
                : undefined,
            ),
          )
          .orderBy(asc(appointments.startsAt));
        // Whether each one was charged, and the deposits waiting to pay for it.
        const ids = rows.map((row) => row.id);
        const charged = await chargedAppointments(db, ids);
        const waiting =
          ids.length > 0 && access.role !== "professional"
            ? await db
                .select({ appointmentId: deposits.appointmentId, amount: deposits.amount })
                .from(deposits)
                .where(
                  and(
                    inArray(deposits.appointmentId, ids),
                    eq(deposits.status, "active"),
                    isNull(deposits.appliedSaleId),
                  ),
                )
            : [];
        return c.json({
          appointments: rows.map((row) => ({
            ...row,
            sale: charged.get(row.id) ?? null,
            depositAmount: waiting
              .filter((deposit) => deposit.appointmentId === row.id)
              .reduce((sum, deposit) => sum + deposit.amount, 0),
          })),
        });
      })

      /** Times a new appointment could take on `date`, and who is free at each. */
      .get("/slots", async (c) => {
        const { serviceId = "", date = "", locationId } = c.req.query();
        const slots = await freeSlots(
          c.get("business"),
          c.get("access"),
          locationId,
          serviceId,
          date,
        );
        return c.json({ slots });
      })

      /** Times an appointment could move to on `date`, and who is free at each. */
      .get("/:appointmentId/slots", async (c) => {
        const business = c.get("business");
        const access = c.get("access");
        const appointment = await findAppointment(
          business.id,
          c.req.param("appointmentId"),
          access,
        );
        const { serviceId = "", date = "", locationId } = c.req.query();
        const slots = await freeSlots(
          business,
          access,
          locationId || appointment.locationId,
          serviceId,
          date,
          appointment.id,
        );
        return c.json({ slots });
      })

      /** An appointment the business books itself (phone call, walk-in…). */
      .post("/", async (c) => {
        const business = c.get("business");
        const access = c.get("access");
        const input = await parseBody(c, staffBookingSchema);
        const resourceId = bookedFor(access, input.resourceId);
        const location = await resolveLocation(db, business.id, input.locationId, {
          forBooking: true,
        });
        const service = await findService(business.id, input.serviceId);
        const startsAt = zonedTimeToInstant(input.date, parseTime(input.time), business.timezone);
        const endsAt = startsAt + service.durationMin * 60_000;

        const appointment = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${business.id}, 0))`);

          let customerId: string;
          if (input.customerId) {
            const [customer] = await tx
              .select({ id: customers.id })
              .from(customers)
              .where(
                and(eq(customers.businessId, business.id), eq(customers.id, input.customerId)),
              );
            if (!customer) throw apiError(404, "customer_not_found");
            customerId = customer.id;
          } else {
            const details = input.customer;
            if (!details) throw apiError(400, "validation_failed", { customerId: "required" });
            const match = await matchCustomer(tx, business.id, details);
            customerId = await saveBookingCustomer(tx, business.id, match, details);
          }

          const [clash] = await tx
            .select({ code: appointments.code, startsAt: appointments.startsAt })
            .from(appointments)
            .where(
              and(
                eq(appointments.customerId, customerId),
                eq(appointments.status, "confirmed"),
                lt(appointments.startsAt, new Date(endsAt)),
                gt(appointments.endsAt, new Date(startsAt)),
              ),
            )
            .limit(1);
          if (clash) {
            throw apiError(409, "already_booked", {
              code: clash.code,
              startsAt: clash.startsAt.toISOString(),
            });
          }

          const schedules = await loadSchedules(
            tx,
            business,
            location.id,
            service.id,
            resourceId,
            input.date,
            input.date,
          );
          const slot = slotsForDate(
            input.date,
            service.durationMin,
            schedules,
            staffRules(business),
            Date.now(),
          ).find((candidate) => candidate.time === input.time);
          if (!slot) throw apiError(409, "slot_taken");
          const assigned = pickLeastBusy(slot.resourceIds, schedules, slot.start);
          const [resource] = assigned
            ? await tx
                .select({ name: resources.name })
                .from(resources)
                .where(eq(resources.id, assigned))
            : [];
          const [created] = await tx
            .insert(appointments)
            .values({
              code: await newBookingCode(tx),
              businessId: business.id,
              locationId: location.id,
              serviceId: service.id,
              resourceId: assigned,
              customerId,
              startsAt: new Date(slot.start),
              endsAt: new Date(slot.end),
              serviceName: service.name,
              resourceName: resource?.name ?? null,
              priceAmount: service.priceAmount,
              // Booked by an AI agent with the business's admin key, or by its people.
              source: access.apiKey ? "agent" : "admin",
              sourceLabel: access.apiKey?.name ?? null,
            })
            .returning();
          return created;
        });
        if (appointment) await automations.emit(appointment.id, "created");
        return c.json({ appointment }, 201);
      })

      /** Moves an appointment to another time, professional or service. */
      .patch("/:appointmentId", async (c) => {
        const business = c.get("business");
        const access = c.get("access");
        const current = await findAppointment(business.id, c.req.param("appointmentId"), access);
        const parsed = await parseBody(c, rescheduleSchema);
        // Professionals move their own appointments, but can't hand them to someone else.
        const location = await resolveLocation(
          db,
          business.id,
          parsed.locationId ?? current.locationId,
          { forBooking: false },
        );
        const input = {
          ...parsed,
          locationId: location.id,
          resourceId: bookedFor(access, parsed.resourceId),
        };
        const service = await findService(business.id, input.serviceId);
        const appointment = await moveAppointment(
          db,
          business,
          current,
          service,
          input,
          staffRules(business),
        );
        await automations.emit(appointment.id, "rescheduled", current.startsAt);
        return c.json({ appointment });
      })

      .post("/:appointmentId/cancel", async (c) => {
        const [cancelled] = await db
          .update(appointments)
          .set({ status: "cancelled", cancelledAt: new Date() })
          .where(
            and(
              eq(appointments.businessId, c.get("business").id),
              eq(appointments.id, c.req.param("appointmentId")),
              eq(appointments.status, "confirmed"),
            ),
          )
          .returning({ id: appointments.id, status: appointments.status });
        if (cancelled) {
          await automations.emit(cancelled.id, "cancelled");
          return c.json({ appointment: cancelled });
        }
        // Already cancelled: nothing changes and nothing is sent again.
        const [existing] = await db
          .select({ id: appointments.id, status: appointments.status })
          .from(appointments)
          .where(
            and(
              eq(appointments.businessId, c.get("business").id),
              eq(appointments.id, c.req.param("appointmentId")),
            ),
          );
        if (!existing) throw apiError(404, "appointment_not_found");
        return c.json({ appointment: existing });
      })
  );
}
