import { addDays, businessUpdateSchema, toMinorUnits, zonedTimeToInstant } from "@openturnly/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { businesses } from "../db/schema.ts";
import { validateWith } from "../lib/http.ts";
import {
  appointmentView,
  fullPhone,
  priceView,
  type ToolContext,
  ToolError,
  weekdayName,
} from "./helpers.ts";
import { date, id, type Tool, time } from "./tools.ts";

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
/** Longest stretch get_agenda and get_summary cover in one call. */
const MAX_AGENDA_DAYS = 62;

type AgendaRow = Parameters<typeof appointmentView>[1] & {
  id: string;
  resourceId: string | null;
  source: string;
  sourceLabel: string | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
};

type CustomerRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes?: string | null;
  visits?: number;
  lastVisit?: string | null;
  nextVisit?: string | null;
};

/**
 * What only an admin key can do: run the calendar, customers, catalog and hours, and keep the
 * business's details up to date.
 */
export function registerAdminTools(tool: Tool, ctx: ToolContext) {
  const { business, call, db } = ctx;
  const base = `/api/businesses/${business.id}`;
  const money = (price: number) => toMinorUnits(price, business.currency);

  const customerView = (customer: CustomerRow) => ({
    id: customer.id,
    name: `${customer.firstName} ${customer.lastName}`,
    first_name: customer.firstName,
    last_name: customer.lastName,
    phone: customer.phone,
    email: customer.email,
    ...(customer.notes !== undefined ? { notes: customer.notes } : {}),
    ...(customer.visits !== undefined
      ? { visits: customer.visits, last_visit: customer.lastVisit, next_visit: customer.nextVisit }
      : {}),
  });

  /** Appointments between two local dates (both included). */
  const agenda = async (from: string, until: string, includeCancelled: boolean) => {
    if (until < from || until > addDays(from, MAX_AGENDA_DAYS - 1)) {
      throw new ToolError("invalid_range");
    }
    const start = new Date(zonedTimeToInstant(from, 0, business.timezone)).toISOString();
    const end = new Date(zonedTimeToInstant(addDays(until, 1), 0, business.timezone)).toISOString();
    const query = new URLSearchParams({
      from: start,
      to: end,
      includeCancelled: String(includeCancelled),
    });
    return (await call<{ appointments: AgendaRow[] }>("GET", `${base}/appointments?${query}`))
      .appointments;
  };

  // --- Calendar --------------------------------------------------------------------

  tool(
    "get_agenda",
    {
      title: "Calendar",
      description: `Appointments on a date or between two dates (up to ${MAX_AGENDA_DAYS} days), with customer and contact details, optionally for one professional.`,
      input: z.object({
        date,
        until_date: date.optional(),
        professional_id: id.optional(),
        include_cancelled: z.boolean().optional(),
      }),
      readOnly: true,
    },
    async (args) => {
      const rows = await agenda(
        args.date,
        args.until_date ?? args.date,
        args.include_cancelled ?? false,
      );
      return rows
        .filter((row) => !args.professional_id || row.resourceId === args.professional_id)
        .map((row) => ({
          ...appointmentView(business, row),
          booked_via: row.sourceLabel ?? row.source,
          customer: customerView(row.customer),
        }));
    },
  );

  tool(
    "get_summary",
    {
      title: "Summary of a period",
      description:
        "Appointments, cancellations and income (confirmed appointments' prices) between two dates, by service, by professional and by how they were booked.",
      input: z.object({ date, until_date: date }),
      readOnly: true,
    },
    async (args) => {
      const rows = await agenda(args.date, args.until_date, true);
      const confirmed = rows.filter((row) => row.status === "confirmed");
      const group = (keyOf: (row: AgendaRow) => string) => {
        const groups = new Map<string, { appointments: number; income: number }>();
        for (const row of confirmed) {
          const entry = groups.get(keyOf(row)) ?? { appointments: 0, income: 0 };
          entry.appointments += 1;
          entry.income += row.priceAmount ?? 0;
          groups.set(keyOf(row), entry);
        }
        return [...groups]
          .sort((a, b) => b[1].income - a[1].income)
          .map(([name, entry]) => ({
            name,
            appointments: entry.appointments,
            ...priceView(entry.income, business.currency),
          }));
      };
      const income = confirmed.reduce((total, row) => total + (row.priceAmount ?? 0), 0);
      return {
        from: args.date,
        until: args.until_date,
        appointments: confirmed.length,
        cancelled: rows.length - confirmed.length,
        customers: new Set(confirmed.map((row) => row.customer.id)).size,
        income: priceView(income, business.currency),
        by_service: group((row) => row.serviceName),
        by_professional: group((row) => row.resourceName ?? "—"),
        by_channel: group((row) => row.sourceLabel ?? row.source),
      };
    },
  );

  // --- Customers ---------------------------------------------------------------------

  tool(
    "search_customers",
    {
      title: "Search customers",
      description:
        "Customers whose name, phone or email contains the text, with visits, last and next visit.",
      input: z.object({ query: z.string().min(2) }),
      readOnly: true,
    },
    async (args) => {
      const { customers } = await call<{ customers: CustomerRow[] }>(
        "GET",
        `${base}/customers?q=${encodeURIComponent(args.query)}`,
      );
      return customers.map(customerView);
    },
  );

  tool(
    "get_customer",
    {
      title: "Customer and history",
      description: "A customer's details, notes and appointment history.",
      input: z.object({ customer_id: id }),
      readOnly: true,
    },
    async (args) => {
      const { customer, appointments } = await call<{
        customer: CustomerRow;
        appointments: AgendaRow[];
      }>("GET", `${base}/customers/${args.customer_id}`);
      return {
        ...customerView(customer),
        appointments: appointments.map((row) => appointmentView(business, row)),
      };
    },
  );

  const customerFields = {
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    notes: z.string().nullable(),
  };
  const customerBody = (args: Partial<Record<keyof typeof customerFields, string | null>>) =>
    Object.fromEntries(
      Object.entries({
        firstName: args.first_name,
        lastName: args.last_name,
        phone: fullPhone(business, args.phone),
        email: args.email,
        notes: args.notes,
      }).filter(([, value]) => value !== undefined),
    );

  tool(
    "create_customer",
    {
      title: "Add a customer",
      description: "Adds a customer. Needs a phone number or an email.",
      input: z.object({
        ...customerFields,
        phone: customerFields.phone.optional(),
        email: customerFields.email.optional(),
        notes: customerFields.notes.optional(),
      }),
    },
    async (args) => {
      const { customer } = await call<{ customer: CustomerRow }>(
        "POST",
        `${base}/customers`,
        customerBody(args),
      );
      return customerView(customer);
    },
  );

  tool(
    "update_customer",
    {
      title: "Edit a customer",
      description: "Changes a customer's name, phone, email or notes. Send only what changes.",
      input: z.object({
        customer_id: id,
        first_name: customerFields.first_name.optional(),
        last_name: customerFields.last_name.optional(),
        phone: customerFields.phone.optional(),
        email: customerFields.email.optional(),
        notes: customerFields.notes.optional(),
      }),
    },
    async ({ customer_id, ...args }) => {
      const { customer } = await call<{ customer: CustomerRow }>(
        "PATCH",
        `${base}/customers/${customer_id}`,
        customerBody(args),
      );
      return customerView(customer);
    },
  );

  // --- Catalog -----------------------------------------------------------------------

  const serviceResult = (service: {
    id: string;
    name: string;
    description: string | null;
    durationMin: number;
    priceAmount: number | null;
    active: boolean;
  }) => ({
    id: service.id,
    name: service.name,
    description: service.description,
    duration_minutes: service.durationMin,
    ...priceView(service.priceAmount, business.currency),
    active: service.active,
  });

  tool(
    "create_service",
    {
      title: "Add a service",
      description: `Adds a service. Price in ${business.currency}, in its main unit (0 for free).`,
      input: z.object({
        name: z.string().min(1),
        duration_minutes: z.number().int().min(5).max(600),
        price: z.number().min(0),
        description: z.string().optional(),
      }),
    },
    async (args) => {
      const { service } = await call<{ service: Parameters<typeof serviceResult>[0] }>(
        "POST",
        `${base}/services`,
        {
          name: args.name,
          durationMin: args.duration_minutes,
          priceAmount: money(args.price),
          description: args.description ?? null,
        },
      );
      return serviceResult(service);
    },
  );

  tool(
    "update_service",
    {
      title: "Edit a service",
      description:
        "Changes a service's name, duration, price or description, or turns it off (active: false) so it can't be booked. Send only what changes.",
      input: z.object({
        service_id: id,
        name: z.string().min(1).optional(),
        duration_minutes: z.number().int().min(5).max(600).optional(),
        price: z.number().min(0).optional(),
        description: z.string().nullable().optional(),
        active: z.boolean().optional(),
      }),
    },
    async (args) => {
      const body = Object.fromEntries(
        Object.entries({
          name: args.name,
          durationMin: args.duration_minutes,
          priceAmount: args.price === undefined ? undefined : money(args.price),
          description: args.description,
          active: args.active,
        }).filter(([, value]) => value !== undefined),
      );
      const { service } = await call<{ service: Parameters<typeof serviceResult>[0] }>(
        "PATCH",
        `${base}/services/${args.service_id}`,
        body,
      );
      return serviceResult(service);
    },
  );

  tool(
    "create_professional",
    {
      title: "Add a professional",
      description: "Adds a professional and the services they do.",
      input: z.object({ name: z.string().min(1), service_ids: z.array(id).optional() }),
    },
    async (args) => {
      const { professional } = await call<{ professional: { id: string; name: string } }>(
        "POST",
        `${base}/professionals`,
        { name: args.name, serviceIds: args.service_ids ?? [] },
      );
      return professional;
    },
  );

  tool(
    "update_professional",
    {
      title: "Edit a professional",
      description:
        "Renames a professional, changes the services they do (the full list), or turns them off (active: false). Send only what changes.",
      input: z.object({
        professional_id: id,
        name: z.string().min(1).optional(),
        active: z.boolean().optional(),
        service_ids: z.array(id).optional(),
      }),
    },
    async (args) => {
      const body = Object.fromEntries(
        Object.entries({
          name: args.name,
          active: args.active,
          serviceIds: args.service_ids,
        }).filter(([, value]) => value !== undefined),
      );
      const { professional } = await call<{ professional: { id: string; name: string } }>(
        "PATCH",
        `${base}/professionals/${args.professional_id}`,
        body,
      );
      return professional;
    },
  );

  // --- Hours, closures and holidays --------------------------------------------------

  type Range = { weekday: number; start: string; end: string };
  const rangesView = (ranges: Range[]) =>
    ranges.map((range) => ({ day: DAYS[range.weekday], start: range.start, end: range.end }));

  tool(
    "get_opening_hours",
    {
      title: "Weekly hours",
      description:
        "The business's weekly opening hours, or a professional's own hours (professionals without their own follow the business's).",
      input: z.object({ professional_id: id.optional() }),
      readOnly: true,
    },
    async (args) => {
      const hours = await call<{ business: Range[]; professionals: Record<string, Range[]> }>(
        "GET",
        `${base}/hours`,
      );
      if (!args.professional_id) return { hours: rangesView(hours.business) };
      const own = hours.professionals[args.professional_id];
      return own
        ? { hours: rangesView(own) }
        : { follows_business_hours: true, hours: rangesView(hours.business) };
    },
  );

  tool(
    "set_opening_hours",
    {
      title: "Change weekly hours",
      description:
        "Replaces the weekly hours of the business, or of one professional. List every open range; days left out are closed. For a professional, an empty list makes them follow the business's hours again.",
      input: z.object({
        professional_id: id.optional(),
        hours: z.array(z.object({ day: z.enum(DAYS), start: time, end: time })),
      }),
    },
    async (args) => {
      const { hours } = await call<{ hours: Range[] }>("PUT", `${base}/hours`, {
        resourceId: args.professional_id ?? null,
        hours: args.hours.map((range) => ({
          weekday: DAYS.indexOf(range.day),
          start: range.start,
          end: range.end,
        })),
      });
      return { saved: true, hours: rangesView(hours) };
    },
  );

  tool(
    "list_closures",
    {
      title: "Upcoming closures",
      description: "Days the business, or one professional, is closed (vacations, days off…).",
      input: z.object({}),
      readOnly: true,
    },
    async () => {
      const { closures } = await call<{
        closures: {
          id: string;
          date: string;
          endDate: string;
          resourceId: string | null;
          note: string | null;
        }[];
      }>("GET", `${base}/closures`);
      return closures.map((closure) => ({
        id: closure.id,
        from: closure.date,
        until: closure.endDate,
        professional_id: closure.resourceId,
        note: closure.note,
      }));
    },
  );

  tool(
    "add_closure",
    {
      title: "Close some days",
      description:
        "Closes the business, or one professional, on a date or a range of dates (vacations, a day off). Existing appointments are not cancelled.",
      input: z.object({
        date,
        until_date: date.optional(),
        professional_id: id.optional(),
        note: z.string().max(120).optional(),
      }),
    },
    async (args) => {
      const { closure } = await call<{ closure: { id: string } }>("POST", `${base}/closures`, {
        date: args.date,
        endDate: args.until_date ?? args.date,
        resourceId: args.professional_id ?? null,
        note: args.note ?? null,
      });
      return { closed: true, id: closure.id };
    },
  );

  tool(
    "remove_closure",
    {
      title: "Reopen closed days",
      description: "Removes a closure (see list_closures).",
      input: z.object({ closure_id: id }),
    },
    async (args) => {
      await call("DELETE", `${base}/closures/${args.closure_id}`);
      return { removed: true };
    },
  );

  tool(
    "list_holidays",
    {
      title: "Public holidays",
      description:
        "Public holidays of the business's country for the next 12 months, and whether it is open on each.",
      input: z.object({}),
      readOnly: true,
    },
    async () => {
      const { holidays } = await call<{
        holidays: { date: string; name: string; closed: boolean }[];
      }>("GET", `${base}/holidays?lang=${business.locale}`);
      return holidays.map((holiday) => ({
        date: holiday.date,
        weekday: weekdayName(holiday.date, business.locale),
        name: holiday.name,
        open: !holiday.closed,
      }));
    },
  );

  tool(
    "set_holiday",
    {
      title: "Open or close a holiday",
      description: "Opens or closes the business on one public holiday.",
      input: z.object({ date, open: z.boolean() }),
    },
    async (args) => {
      await call("PUT", `${base}/holidays/${args.date}`, { closed: !args.open });
      return { date: args.date, open: args.open };
    },
  );

  tool(
    "update_business_details",
    {
      title: "Business details",
      description:
        "Changes what customers see about the business on its booking page: its name, a short description, and the phone, email and address to reach or find it. Send only what changes; an empty text clears it. The booking link, time zone and currency are changed in the panel.",
      input: z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        address: z.string().optional(),
      }),
    },
    async (args) => {
      const changes = validateWith(
        businessUpdateSchema.pick({
          name: true,
          description: true,
          phone: true,
          email: true,
          address: true,
        }),
        args,
      );
      if (Object.keys(changes).length === 0) throw new ToolError("nothing_to_change");
      const [updated] = await db
        .update(businesses)
        .set(changes)
        .where(eq(businesses.id, business.id))
        .returning();
      if (!updated) throw new ToolError("business_not_found");
      return {
        saved: true,
        name: updated.name,
        description: updated.description,
        phone: updated.phone,
        email: updated.email,
        address: updated.address,
      };
    },
  );

  tool(
    "update_booking_rules",
    {
      title: "Booking rules",
      description:
        "Changes how online bookings work: minutes between offered times, how far ahead customers must and can book, closing on holidays, and until how many minutes before an appointment customers can change or cancel it (null: never). Send only what changes.",
      input: z.object({
        time_slot_every_minutes: z.number().int().optional(),
        book_at_least_minutes_ahead: z.number().int().min(0).optional(),
        book_at_most_days_ahead: z.number().int().min(1).optional(),
        closed_on_holidays: z.boolean().optional(),
        customers_can_change_until_minutes_before: z.number().int().min(0).nullable().optional(),
      }),
    },
    async (args) => {
      const changes = validateWith(
        businessUpdateSchema.pick({
          slotIntervalMin: true,
          minNoticeMin: true,
          maxAdvanceDays: true,
          closedOnHolidays: true,
          customerChangeNoticeMin: true,
        }),
        {
          slotIntervalMin: args.time_slot_every_minutes,
          minNoticeMin: args.book_at_least_minutes_ahead,
          maxAdvanceDays: args.book_at_most_days_ahead,
          closedOnHolidays: args.closed_on_holidays,
          customerChangeNoticeMin: args.customers_can_change_until_minutes_before,
        },
      );
      const [updated] = await db
        .update(businesses)
        .set(changes)
        .where(eq(businesses.id, business.id))
        .returning();
      if (!updated) throw new ToolError("business_not_found");
      return {
        saved: true,
        time_slot_every_minutes: updated.slotIntervalMin,
        book_at_least_minutes_ahead: updated.minNoticeMin,
        book_at_most_days_ahead: updated.maxAdvanceDays,
        closed_on_holidays: updated.closedOnHolidays,
        customers_can_change_until_minutes_before: updated.customerChangeNoticeMin,
      };
    },
  );
}
