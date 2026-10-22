import { formatPrice, fromMinorUnits, instantToZoned, normalizePhone } from "@openturnly/core";
import { HTTPException } from "hono/http-exception";
import type { ApiKey, Business } from "../db/schema.ts";
import { businessCountry } from "../lib/holidays.ts";
import type { Deps } from "../lib/http.ts";

/** Everything a tool needs: the business behind the URL and the key that called. */
export type ToolContext = Deps & {
  business: Business;
  key: ApiKey;
  /** Calls OpenTurnly's own HTTP API as this key, so tools follow exactly the same rules. */
  call: <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;
};

type ErrorBody = { error?: { code?: string; fields?: Record<string, string> } };

/** An API error passed on to the agent: a stable code plus field details. */
export class ToolError extends Error {
  readonly code: string;
  readonly fields: Record<string, string>;
  constructor(code: string, fields: Record<string, string> = {}) {
    super(code);
    this.code = code;
    this.fields = fields;
  }
}

export function internalCaller(
  fetchApp: (request: Request) => Promise<Response>,
  appUrl: string,
  token: string,
): ToolContext["call"] {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetchApp(
      new Request(`${appUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    if (res.status === 204) return null as T;
    const data = (await res.json().catch(() => null)) as (T & ErrorBody) | null;
    if (!res.ok) throw new ToolError(data?.error?.code ?? "internal_error", data?.error?.fields);
    return data as T;
  };
}

/** What each error means for an agent talking to a customer, and what to do next. */
const EXPLANATIONS: Record<string, string> = {
  slot_taken:
    "That time is not available. Look up free times again and offer the customer another one.",
  already_booked: "The customer already has an appointment that overlaps this time.",
  too_many_bookings:
    "The customer already has several upcoming appointments at this business; they should contact the business.",
  too_many_requests: "Too many requests right now. Wait a few minutes and try again.",
  appointment_not_found:
    "No appointment matches that booking code (and phone or email). Ask the customer to check them.",
  appointment_cancelled: "That appointment is already cancelled.",
  too_late_to_change:
    "It is too late for the customer to change or cancel this appointment themselves; they should contact the business.",
  changes_not_allowed:
    "This business doesn't let customers change or cancel appointments themselves; they should contact the business.",
  service_not_found:
    "That service doesn't exist or isn't offered any more. List the services again.",
  professional_not_found: "That professional doesn't exist. List the professionals again.",
  customer_not_found: "That customer doesn't exist. Search the customers again.",
  customer_exists: "Another customer already has that phone or email.",
  closure_exists: "There is already a closure on those dates for the same people.",
  key_not_found: "That key doesn't exist.",
  invalid_range: "Invalid dates: use YYYY-MM-DD, the end not before the start, at most 62 days.",
  invalid_date: "Invalid date: use YYYY-MM-DD.",
  validation_failed: "Some values are missing or invalid (see the fields).",
  nothing_to_change: "Nothing to change: send at least one of the fields.",
  business_not_found: "This business no longer exists.",
  forbidden: "This access key isn't allowed to do that.",
};

/** A tool result for the agent: JSON text it can read and quote. */
export function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Turns any failure into a tool error the agent can act on, instead of a protocol error. */
export async function asToolError(error: unknown) {
  let code = "internal_error";
  let fields: Record<string, string> = {};
  if (error instanceof ToolError) {
    code = error.code;
    fields = error.fields;
  } else if (error instanceof HTTPException) {
    const body = (await error
      .getResponse()
      .json()
      .catch(() => null)) as ErrorBody | null;
    code = body?.error?.code ?? "internal_error";
    fields = body?.error?.fields ?? {};
  } else {
    console.error(error);
  }
  const details = Object.keys(fields).length > 0 ? ` Details: ${JSON.stringify(fields)}` : "";
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `${code}: ${EXPLANATIONS[code] ?? "Request failed."}${details}`,
      },
    ],
  };
}

export function weekdayName(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** A price in the currency's main unit (18000 COP, 25.5 USD) plus how it reads. */
export function priceView(amount: number | null, currency: string) {
  return amount === null
    ? { price: null, price_text: null }
    : { price: fromMinorUnits(amount, currency), price_text: formatPrice(amount, currency) };
}

type AppointmentLike = {
  code: string;
  startsAt: Date | string;
  endsAt: Date | string;
  status: string;
  serviceName: string;
  resourceName: string | null;
  priceAmount: number | null;
};

/** An appointment as an agent reads it: local date and times, names and price. */
export function appointmentView(business: Business, appointment: AppointmentLike) {
  const start = instantToZoned(new Date(appointment.startsAt).getTime(), business.timezone);
  const end = instantToZoned(new Date(appointment.endsAt).getTime(), business.timezone);
  return {
    code: appointment.code,
    date: start.date,
    weekday: weekdayName(start.date, business.locale),
    time: start.time,
    end_time: end.time,
    service: appointment.serviceName,
    professional: appointment.resourceName,
    status: appointment.status,
    ...priceView(appointment.priceAmount, business.currency),
  };
}

/**
 * A phone number as people type it ("300 123 4567") in international form, using the
 * business's country when it has no country code. Left as typed when it can't be read,
 * so the API answers with its usual "invalid_phone".
 */
export function fullPhone(business: Business, phone: string | null | undefined) {
  if (!phone) return phone;
  return normalizePhone(phone, businessCountry(business) ?? undefined) ?? phone;
}
