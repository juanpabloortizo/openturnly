import type { McpServer } from "@modelcontextprotocol/server";
import { addDays, slotsBetween, todayIn } from "@openturnly/core";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import {
  appointments,
  closures,
  customers,
  holidayOverrides,
  locations,
  resources,
  services,
  weeklyHours,
} from "../db/schema.ts";
import {
  assertCustomerCanChange,
  findCustomerAppointment,
  moveAppointment,
  staffRules,
} from "../lib/appointment-changes.ts";
import { businessCountry, holidaysBetween } from "../lib/holidays.ts";
import { listLocations, resolveLocation } from "../lib/locations.ts";
import { bookingRules, loadSchedules } from "../lib/schedules.ts";
import { registerAdminTools } from "./admin-tools.ts";
import {
  appointmentView,
  asToolError,
  fullPhone,
  ok,
  priceView,
  type ToolContext,
  ToolError,
  weekdayName,
} from "./helpers.ts";

export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const time = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM, 24-hour clock");
export const id = z.string().min(1);
const locationId = id
  .optional()
  .describe("The location (see get_business_info); needed when the business has several");
const contact = z
  .string()
  .min(3)
  .describe("The customer's phone number or email, as they gave it when booking");
/** A Sunday, to name weekdays by number (0 = Sunday … 6 = Saturday). */
const A_SUNDAY = "2024-01-07";
/** Longest stretch the time-search tools look at in one call. */
const MAX_SEARCH_DAYS = 14;

type Catalog = {
  services: {
    id: string;
    name: string;
    description: string | null;
    durationMin: number;
    priceAmount: number | null;
    active?: boolean;
  }[];
  professionals: { id: string; name: string; serviceIds: string[]; active?: boolean }[];
  locations?: { id: string; name: string; serviceIds: string[] }[];
};

/**
 * The business's tools for one access key. Agent keys get what a receptionist talking to
 * customers needs; admin keys get the same with the business's own powers, plus managing
 * customers, catalog, hours, the business's details and a summary.
 */
export function registerTools(server: McpServer, ctx: ToolContext) {
  const { business, key, db, call } = ctx;
  const admin = key.kind === "admin";
  const base = `/api/businesses/${business.id}`;
  const publicBase = `/api/public/businesses/${business.slug}`;
  const tz = business.timezone;
  const today = () => todayIn(tz);

  const tool = <S extends z.ZodObject>(
    name: string,
    config: { title: string; description: string; input: S; readOnly?: boolean },
    run: (args: z.infer<S>) => Promise<unknown>,
  ) =>
    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: config.input,
        annotations: { readOnlyHint: config.readOnly ?? false, openWorldHint: false },
      },
      (async (args: z.infer<S>) => {
        try {
          return ok(await run(args));
        } catch (error) {
          return asToolError(error);
        }
      }) as never,
    );

  /** Services and professionals: what customers can book, or everything for admins. */
  const loadCatalog = async (): Promise<Catalog> => {
    if (!admin) return call<Catalog>("GET", publicBase);
    const [{ services: list }, { professionals }] = await Promise.all([
      call<{ services: Catalog["services"] }>("GET", `${base}/services`),
      call<{ professionals: Catalog["professionals"] }>("GET", `${base}/professionals`),
    ]);
    return { services: list, professionals };
  };

  /** Free start times, with who is free at each: customers' rules for agents, staff rules for admins. */
  const freeTimes = async (
    locationIdArg: string | undefined,
    serviceId: string,
    professionalId: string | undefined,
    from: string,
    to: string,
  ) => {
    const location = await resolveLocation(db, business.id, locationIdArg, { forBooking: true });
    const [service] = await db
      .select()
      .from(services)
      .where(
        and(
          eq(services.businessId, business.id),
          eq(services.id, serviceId),
          admin ? undefined : eq(services.active, true),
        ),
      );
    if (!service) throw new ToolError("service_not_found");
    const team = await db
      .select({ id: resources.id, name: resources.name })
      .from(resources)
      .where(eq(resources.businessId, business.id));
    if (professionalId && !team.some((member) => member.id === professionalId)) {
      throw new ToolError("professional_not_found");
    }
    const names = new Map(team.map((member) => [member.id, member.name]));
    const schedules = await loadSchedules(
      db,
      business,
      location.id,
      service.id,
      professionalId ?? null,
      from,
      to,
    );
    const rules = admin ? staffRules(business) : bookingRules(business);
    const slots = slotsBetween(from, to, service.durationMin, schedules, rules, Date.now());
    return {
      location: { id: location.id, name: location.name },
      service: { id: service.id, name: service.name, duration_minutes: service.durationMin },
      days: Object.entries(slots).map(([day, list]) => ({
        date: day,
        weekday: weekdayName(day, business.locale),
        times: list.map((slot) => ({
          time: slot.time,
          professionals: slot.resourceIds.flatMap((rid) => (rid ? [names.get(rid) ?? rid] : [])),
        })),
      })),
    };
  };

  const appointmentByCode = async (code: string) => {
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
    if (!row) throw new ToolError("appointment_not_found");
    return row;
  };

  const changeDeadline = (startsAt: Date) =>
    business.customerChangeNoticeMin === null
      ? null
      : new Date(startsAt.getTime() - business.customerChangeNoticeMin * 60_000);

  // --- About the business ----------------------------------------------------------

  tool(
    "get_business_info",
    {
      title: "Business information",
      description:
        "Name, contact details, locations with their opening hours, upcoming closures and holidays, booking rules and the details a booking needs. Call this first: it also gives today's date in the business's time zone. When there are several locations, ask the customer which one they want.",
      input: z.object({}),
      readOnly: true,
    },
    async () => {
      const day = today();
      const horizon = addDays(day, 60);
      const places = (await listLocations(db, business.id)).filter((place) => place.active);
      const hours = await db
        .select({
          locationId: weeklyHours.locationId,
          weekday: weeklyHours.weekday,
          start: weeklyHours.start,
          end: weeklyHours.end,
        })
        .from(weeklyHours)
        .where(and(eq(weeklyHours.businessId, business.id), isNull(weeklyHours.resourceId)))
        .orderBy(asc(weeklyHours.weekday), asc(weeklyHours.start));
      const closed = await db
        .select({
          from: closures.date,
          to: closures.endDate,
          location: locations.name,
          note: closures.note,
        })
        .from(closures)
        .leftJoin(locations, eq(locations.id, closures.locationId))
        .where(
          and(
            eq(closures.businessId, business.id),
            isNull(closures.resourceId),
            gte(closures.endDate, day),
            lte(closures.date, horizon),
          ),
        )
        .orderBy(asc(closures.date));
      const country = businessCountry(business);
      const overrides = new Set(
        (
          await db
            .select({ date: holidayOverrides.date })
            .from(holidayOverrides)
            .where(eq(holidayOverrides.businessId, business.id))
        ).map((row) => row.date),
      );
      const holidays = country ? holidaysBetween(country, day, horizon, business.locale) : [];
      const form = business.bookingForm;
      return {
        name: business.name,
        description: business.description,
        address: business.address,
        phone: business.phone,
        email: business.email,
        booking_page: `${ctx.config.appUrl}/${business.slug}`,
        time_zone: tz,
        today: day,
        today_weekday: weekdayName(day, business.locale),
        currency: business.currency,
        language: business.locale,
        locations: places.map((place) => ({
          id: place.id,
          name: place.name,
          address: place.address ?? business.address,
          phone: place.phone ?? business.phone,
          opening_hours: [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
            const ranges = hours.filter(
              (range) => range.locationId === place.id && range.weekday === weekday,
            );
            return {
              day: weekdayName(addDays(A_SUNDAY, weekday), business.locale),
              hours: ranges.length > 0 ? ranges.map((r) => `${r.start}-${r.end}`) : "closed",
            };
          }),
        })),
        // A closure without a location closes every location.
        upcoming_closures: closed.map((closure) => ({
          ...closure,
          location: closure.location ?? "all",
        })),
        upcoming_holidays: holidays.map((holiday) => ({
          ...holiday,
          open: business.closedOnHolidays === overrides.has(holiday.date),
        })),
        booking_rules: {
          time_slot_every_minutes: business.slotIntervalMin,
          book_at_least_minutes_ahead: business.minNoticeMin,
          book_at_most_days_ahead: business.maxAdvanceDays,
          customers_can_change_or_cancel:
            business.customerChangeNoticeMin === null
              ? "No: only the business changes or cancels appointments."
              : `Yes, up to ${business.customerChangeNoticeMin} minutes before the appointment, with the booking code and their phone or email.`,
        },
        booking_needs: {
          name: "first and last name",
          phone: form.phone,
          email: form.email,
          questions: form.questions,
        },
      };
    },
  );

  tool(
    "list_services",
    {
      title: "Services and prices",
      description: admin
        ? "All services with duration, price, whether they are active and who does each."
        : "Services customers can book, with duration, price and who does each.",
      input: z.object({}),
      readOnly: true,
    },
    async () => {
      const catalog = await loadCatalog();
      return catalog.services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        duration_minutes: service.durationMin,
        ...priceView(service.priceAmount, business.currency),
        ...(admin ? { active: service.active } : {}),
        professionals: catalog.professionals
          .filter((member) => member.serviceIds.includes(service.id))
          .map((member) => ({ id: member.id, name: member.name })),
        ...(catalog.locations
          ? {
              locations: catalog.locations
                .filter((place) => place.serviceIds.includes(service.id))
                .map((place) => ({ id: place.id, name: place.name })),
            }
          : {}),
      }));
    },
  );

  tool(
    "list_professionals",
    {
      title: "Professionals",
      description: "The team, with the services each one does.",
      input: z.object({}),
      readOnly: true,
    },
    async () => {
      const catalog = await loadCatalog();
      const names = new Map(catalog.services.map((service) => [service.id, service.name]));
      return catalog.professionals.map((member) => ({
        id: member.id,
        name: member.name,
        ...(admin ? { active: member.active } : {}),
        services: member.serviceIds.flatMap((sid) =>
          names.has(sid) ? [{ id: sid, name: names.get(sid) }] : [],
        ),
      }));
    },
  );

  // --- Availability ------------------------------------------------------------------

  tool(
    "find_available_times",
    {
      title: "Free times",
      description: `Free start times for a service on a date (or up to ${MAX_SEARCH_DAYS} days), and which professionals are free at each time. Dates and times are in the business's time zone.`,
      input: z.object({
        location_id: locationId,
        service_id: id,
        date,
        until_date: date.optional().describe("Last date to include; defaults to `date`"),
        professional_id: id.optional().describe("Only this professional's free times"),
      }),
      readOnly: true,
    },
    async (args) => {
      const until = args.until_date ?? args.date;
      if (until < args.date || until > addDays(args.date, MAX_SEARCH_DAYS - 1)) {
        throw new ToolError("invalid_range");
      }
      const result = await freeTimes(
        args.location_id,
        args.service_id,
        args.professional_id,
        args.date,
        until,
      );
      return result.days.length > 0
        ? result
        : {
            ...result,
            note: "No free times in those dates. Try other dates or find_next_available.",
          };
    },
  );

  tool(
    "find_next_available",
    {
      title: "Next free time",
      description:
        "The first day with free times for a service (optionally with one professional), and that day's times. Use it when the customer asks for the soonest appointment.",
      input: z.object({
        location_id: locationId,
        service_id: id,
        professional_id: id.optional(),
        from_date: date.optional().describe("Start looking on this date; defaults to today"),
      }),
      readOnly: true,
    },
    async (args) => {
      const from = args.from_date ?? today();
      const to = addDays(today(), admin ? 90 : business.maxAdvanceDays);
      if (from > to) return { note: "That date is beyond how far ahead bookings are taken." };
      const result = await freeTimes(
        args.location_id,
        args.service_id,
        args.professional_id,
        from,
        to,
      );
      const [first] = result.days;
      return first
        ? { location: result.location, service: result.service, ...first }
        : {
            location: result.location,
            service: result.service,
            note: `No free times until ${to}.`,
          };
    },
  );

  // --- Appointments ------------------------------------------------------------------

  const customerInput = z.object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    phone: z
      .string()
      .optional()
      .describe("Mobile number; local numbers use the business's country"),
    email: z.string().optional(),
  });

  if (admin) {
    tool(
      "book_appointment",
      {
        title: "Book an appointment",
        description:
          "Books an appointment for a customer: an existing one (customer_id) or new details, matched to existing customers by phone or email. The business's own rules apply (opening hours, other bookings), not the customers' minimum notice. Returns the booking code.",
        input: z.object({
          location_id: locationId,
          service_id: id,
          date,
          time,
          professional_id: id.optional().describe("Omit for whoever is free"),
          customer_id: id.optional(),
          customer: customerInput.optional(),
        }),
      },
      async (args) => {
        const { appointment } = await call<{ appointment: Parameters<typeof appointmentView>[1] }>(
          "POST",
          `${base}/appointments`,
          {
            locationId: args.location_id,
            serviceId: args.service_id,
            resourceId: args.professional_id ?? null,
            date: args.date,
            time: args.time,
            ...(args.customer_id
              ? { customerId: args.customer_id }
              : {
                  customer: args.customer && {
                    firstName: args.customer.first_name,
                    lastName: args.customer.last_name,
                    phone: fullPhone(business, args.customer.phone) ?? null,
                    email: args.customer.email ?? null,
                  },
                }),
          },
        );
        return { booked: true, ...appointmentView(business, appointment) };
      },
    );
  } else {
    tool(
      "book_appointment",
      {
        title: "Book an appointment",
        description:
          "Books an appointment for the customer at a free time (see find_available_times), with the same rules as the booking page. Confirm the service, date, time and their details with the customer first. Returns the booking code: give it to the customer.",
        input: z.object({
          location_id: locationId,
          service_id: id,
          date,
          time,
          professional_id: id.optional().describe("Omit for whoever is free"),
          customer: customerInput,
          answers: z
            .record(z.string(), z.string())
            .optional()
            .describe(
              "Answers to the business's questions, by question id (see get_business_info)",
            ),
        }),
      },
      async (args) => {
        const { appointment } = await call<{
          appointment: Parameters<typeof appointmentView>[1];
        }>("POST", `${publicBase}/bookings`, {
          locationId: args.location_id,
          serviceId: args.service_id,
          resourceId: args.professional_id ?? null,
          date: args.date,
          time: args.time,
          customer: {
            firstName: args.customer.first_name,
            lastName: args.customer.last_name,
            phone: args.customer.phone ?? null,
            email: args.customer.email ?? null,
          },
          answers: args.answers,
        });
        return {
          booked: true,
          ...appointmentView(business, { ...appointment, status: "confirmed" }),
        };
      },
    );
  }

  if (admin) {
    tool(
      "get_appointment",
      {
        title: "Appointment by code",
        description: "An appointment by its booking code, with the customer's details.",
        input: z.object({ code: id }),
        readOnly: true,
      },
      async (args) => {
        const { appointment, customer } = await appointmentByCode(args.code);
        return {
          ...appointmentView(business, appointment),
          booked_via: appointment.sourceLabel ?? appointment.source,
          customer: {
            id: customer.id,
            name: `${customer.firstName} ${customer.lastName}`,
            phone: customer.phone,
            email: customer.email,
          },
        };
      },
    );

    tool(
      "reschedule_appointment",
      {
        title: "Move an appointment",
        description:
          "Moves an appointment to another date and time, and optionally another location, professional or service. Keeps the same location and professional unless location_id or professional_id is given ('any' for whoever is free).",
        input: z.object({
          code: id,
          date,
          time,
          location_id: id.optional(),
          professional_id: id.optional(),
          service_id: id.optional(),
        }),
      },
      async (args) => {
        const { appointment } = await appointmentByCode(args.code);
        const moved = await call<{ appointment: Parameters<typeof appointmentView>[1] }>(
          "PATCH",
          `${base}/appointments/${appointment.id}`,
          {
            locationId: args.location_id,
            serviceId: args.service_id ?? appointment.serviceId,
            resourceId:
              args.professional_id === "any"
                ? null
                : (args.professional_id ?? appointment.resourceId),
            date: args.date,
            time: args.time,
          },
        );
        return { moved: true, ...appointmentView(business, moved.appointment) };
      },
    );

    tool(
      "cancel_appointment",
      {
        title: "Cancel an appointment",
        description: "Cancels an appointment by its booking code. It can't be undone.",
        input: z.object({ code: id }),
      },
      async (args) => {
        const { appointment } = await appointmentByCode(args.code);
        if (appointment.status === "cancelled") throw new ToolError("appointment_cancelled");
        await call("POST", `${base}/appointments/${appointment.id}/cancel`, {});
        return {
          cancelled: true,
          ...appointmentView(business, { ...appointment, status: "cancelled" }),
        };
      },
    );
  } else {
    tool(
      "find_appointment",
      {
        title: "Find the customer's appointment",
        description:
          "The customer's appointment, found with its booking code plus the phone or email they booked with. Says whether they can still change or cancel it.",
        input: z.object({ code: id, phone_or_email: contact }),
        readOnly: true,
      },
      async (args) => {
        const { appointment, customer } = await findCustomerAppointment(
          db,
          business,
          args.code,
          args.phone_or_email,
        );
        const deadline = changeDeadline(appointment.startsAt);
        return {
          ...appointmentView(business, appointment),
          customer: `${customer.firstName} ${customer.lastName}`,
          can_change_or_cancel:
            appointment.status === "confirmed" &&
            deadline !== null &&
            Date.now() <= deadline.getTime(),
        };
      },
    );

    tool(
      "reschedule_appointment",
      {
        title: "Move the customer's appointment",
        description:
          "Moves the customer's appointment (booking code + phone or email) to another free time for the same service, if the business allows customers to change it that close to the date. Keeps the same professional unless professional_id is given ('any' for whoever is free).",
        input: z.object({
          code: id,
          phone_or_email: contact,
          date,
          time,
          professional_id: id.optional(),
        }),
      },
      async (args) => {
        const { appointment } = await findCustomerAppointment(
          db,
          business,
          args.code,
          args.phone_or_email,
        );
        assertCustomerCanChange(business, appointment);
        const [service] = appointment.serviceId
          ? await db.select().from(services).where(eq(services.id, appointment.serviceId))
          : [];
        if (!service) throw new ToolError("service_not_found");
        const location = await resolveLocation(db, business.id, appointment.locationId, {
          forBooking: false,
        });
        const moved = await moveAppointment(
          db,
          business,
          appointment,
          service,
          {
            locationId: location.id,
            resourceId:
              args.professional_id === "any"
                ? null
                : (args.professional_id ?? appointment.resourceId),
            date: args.date,
            time: args.time,
          },
          bookingRules(business),
        );
        await ctx.automations.emit(moved.id, "rescheduled", appointment.startsAt);
        return { moved: true, ...appointmentView(business, moved) };
      },
    );

    tool(
      "cancel_appointment",
      {
        title: "Cancel the customer's appointment",
        description:
          "Cancels the customer's appointment (booking code + phone or email), if the business allows customers to cancel that close to the date. Confirm with the customer first: it can't be undone.",
        input: z.object({ code: id, phone_or_email: contact }),
      },
      async (args) => {
        const { appointment } = await findCustomerAppointment(
          db,
          business,
          args.code,
          args.phone_or_email,
        );
        assertCustomerCanChange(business, appointment);
        const [cancelled] = await db
          .update(appointments)
          .set({ status: "cancelled", cancelledAt: new Date() })
          .where(eq(appointments.id, appointment.id))
          .returning();
        await ctx.automations.emit(appointment.id, "cancelled");
        return { cancelled: true, ...appointmentView(business, cancelled ?? appointment) };
      },
    );
  }

  if (admin) registerAdminTools(tool, ctx);
}

export type Tool = <S extends z.ZodObject>(
  name: string,
  config: { title: string; description: string; input: S; readOnly?: boolean },
  run: (args: z.infer<S>) => Promise<unknown>,
) => unknown;
