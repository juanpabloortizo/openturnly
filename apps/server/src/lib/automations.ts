import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  AUTOMATION_EVENTS,
  addDays,
  fieldsBody,
  formatPrice,
  fromMinorUnits,
  instantToZoned,
  renderJsonTemplate,
  todayIn,
  toMinorUnits,
  type WebhookAction,
  type WebhookAuth,
  zonedTimeToInstant,
} from "@openturnly/core";
import { and, asc, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import {
  type Appointment,
  type Automation,
  type AutomationDelivery,
  appointments,
  automationDeliveries,
  automations,
  type Business,
  businesses,
  type Customer,
  customers,
} from "../db/schema.ts";
import { isInternalAddress } from "./client-ip.ts";

/** Reminders and follow-ups that came due while the server was down still go out, up to this late. */
const GRACE_MS = 15 * 60_000;
/** Waits before each retry of a failed delivery; after the last one it is marked failed. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
const TIMEOUT_MS = 10_000;
/** How long the delivery history is kept. */
const HISTORY_DAYS = 30;

export function newAutomationSecret() {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

type AppointmentWithCustomer = {
  appointment: Pick<
    Appointment,
    | "code"
    | "status"
    | "startsAt"
    | "endsAt"
    | "serviceName"
    | "resourceName"
    | "priceAmount"
    | "answers"
    | "source"
    | "sourceLabel"
  >;
  customer: Pick<Customer, "firstName" | "lastName" | "phone" | "email">;
};

/** Every value an automation can send about one appointment, by group as placeholders name them. */
export function automationValues(
  business: Business,
  { appointment, customer }: AppointmentWithCustomer,
  event: string,
  appUrl: string,
  previousStartsAt?: Date,
): Record<string, unknown> {
  const tz = business.timezone;
  const start = instantToZoned(appointment.startsAt.getTime(), tz);
  const end = instantToZoned(appointment.endsAt.getTime(), tz);
  const previous = previousStartsAt ? instantToZoned(previousStartsAt.getTime(), tz) : null;
  const day = new Date(`${start.date}T12:00:00Z`);
  return {
    event,
    appointment: {
      code: appointment.code,
      status: appointment.status,
      date: start.date,
      time: start.time,
      end_time: end.time,
      weekday: new Intl.DateTimeFormat(business.locale, {
        weekday: "long",
        timeZone: "UTC",
      }).format(day),
      date_text: new Intl.DateTimeFormat(business.locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(day),
      starts_at: appointment.startsAt.toISOString(),
      ends_at: appointment.endsAt.toISOString(),
      service: appointment.serviceName,
      duration_minutes: Math.round(
        (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000,
      ),
      professional: appointment.resourceName,
      price:
        appointment.priceAmount === null
          ? null
          : fromMinorUnits(appointment.priceAmount, business.currency),
      price_text:
        appointment.priceAmount === null
          ? null
          : formatPrice(appointment.priceAmount, business.currency),
      booked_via: appointment.sourceLabel ?? appointment.source,
      answers: Object.fromEntries(
        appointment.answers.map((answer) => [answer.label, answer.value]),
      ),
      previous_date: previous?.date ?? null,
      previous_time: previous?.time ?? null,
    },
    customer: {
      name: `${customer.firstName} ${customer.lastName}`,
      first_name: customer.firstName,
      last_name: customer.lastName,
      phone: customer.phone,
      phone_digits: customer.phone?.replace(/\D/g, "") ?? null,
      email: customer.email,
    },
    business: {
      name: business.name,
      phone: business.phone,
      address: business.address,
      booking_page: `${appUrl}/${business.slug}`,
      time_zone: tz,
    },
  };
}

/** The JSON an automation sends: its chosen fields and extra values, or its own JSON. */
export function buildPayload(
  action: Pick<WebhookAction, "fields" | "extra" | "body" | "json">,
  values: Record<string, unknown>,
): Record<string, unknown> {
  // A body written by hand, in the receiver's own format (checked when the flow was saved).
  if (action.body === "json")
    return renderJsonTemplate(action.json, values) as Record<string, unknown>;
  return fieldsBody(action, values);
}

/**
 * The webhook steps of a flow, each with how long it waits after the flow fires: the
 * wait steps before it added up, plus the older all-steps wait of change triggers.
 */
export function webhookSteps(automation: Pick<Automation, "trigger" | "offsetMin" | "actions">) {
  const timed = automation.trigger === "before" || automation.trigger === "after";
  let waitMs = timed ? 0 : automation.offsetMin * 60_000;
  const steps: { action: WebhookAction; delayMs: number }[] = [];
  for (const action of automation.actions) {
    if (action.type === "wait") waitMs += action.minutes * 60_000;
    else steps.push({ action, delayMs: waitMs });
  }
  return steps;
}

/** A short-lived HS256 JWT, for receivers that check a JWT signed with a shared secret. */
export function signJwt(secret: string, claims: Record<string, unknown>) {
  const encode = (part: unknown) => Buffer.from(JSON.stringify(part)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

/** The headers that prove who's calling, for the authentication a step uses. */
function authHeaders(auth: WebhookAuth, claims: Record<string, unknown>): Record<string, string> {
  switch (auth.type) {
    case "basic":
      return {
        authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
      };
    case "header":
      return { [auth.name.toLowerCase()]: auth.value };
    case "jwt": {
      const now = Math.floor(Date.now() / 1000);
      return {
        authorization: `Bearer ${signJwt(auth.secret, { ...claims, iat: now, exp: now + 300 })}`,
      };
    }
    default:
      return {};
  }
}

/** HMAC-SHA256 of "<timestamp>.<body>", as sent in X-OpenTurnly-Signature. */
export function signDelivery(secret: string, timestamp: number, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

type SendResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
  durationMs: number;
  /** Start of what the receiver answered, for tests. */
  response: string | null;
};

/** How much of a receiver's answer a test shows. */
const RESPONSE_PREVIEW_CHARS = 2_000;

export type Automations = ReturnType<typeof createAutomations>;

/**
 * Runs the businesses' automations: queues a delivery when an appointment changes,
 * finds reminders and follow-ups as they come due, and sends the queue with retries.
 * `start()` runs it every few seconds inside the server process: no extra service.
 */
export function createAutomations({ db, config }: { db: Db; config: Config }) {
  const loadAppointment = async (appointmentId: string) => {
    const [row] = await db
      .select({ appointment: appointments, customer: customers, business: businesses })
      .from(appointments)
      .innerJoin(customers, eq(customers.id, appointments.customerId))
      .innerJoin(businesses, eq(businesses.id, appointments.businessId))
      .where(eq(appointments.id, appointmentId));
    return row ?? null;
  };

  /**
   * Refuses addresses inside the server's network unless the install allows them, and plain
   * http anywhere else: appointment data only crosses the internet encrypted.
   */
  const checkDestination = async (url: URL) => {
    const plain = url.protocol === "http:";
    if (config.allowPrivateWebhooks && !plain) return;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host)
      ? [host]
      : (await lookup(host, { all: true })).map((entry) => entry.address);
    const anyInternal = addresses.length === 0 || addresses.some(isInternalAddress);
    if (anyInternal && !config.allowPrivateWebhooks) throw new Error("internal_address");
    if (plain && !addresses.every(isInternalAddress)) throw new Error("https_required");
  };

  const post = async (
    secret: string,
    action: WebhookAction,
    event: string,
    deliveryId: string,
    payload: Record<string, unknown>,
    { readResponse = false, test = false } = {},
  ): Promise<SendResult> => {
    const body = JSON.stringify(payload);
    const startedAt = performance.now();
    const timestamp = Math.floor(Date.now() / 1000);
    const elapsed = () => Math.round(performance.now() - startedAt);
    try {
      const url = new URL(action.url);
      await checkDestination(url);
      // The step's own headers, then its authentication, then ours (which can't be replaced).
      const custom = Object.fromEntries(action.headers.map((h) => [h.name.toLowerCase(), h.value]));
      const res = await fetch(url, {
        method: action.method,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          ...custom,
          ...authHeaders(action.auth, { iss: "openturnly", event, delivery: deliveryId }),
          "content-type": "application/json",
          ...(test ? { "x-openturnly-test": "true" } : {}),
          "user-agent": "OpenTurnly-Webhooks/1.0",
          "x-openturnly-event": event,
          "x-openturnly-delivery": deliveryId,
          "x-openturnly-timestamp": String(timestamp),
          "x-openturnly-signature": `sha256=${signDelivery(secret, timestamp, body)}`,
        },
        body,
      });
      let response: string | null = null;
      if (readResponse) response = (await res.text()).slice(0, RESPONSE_PREVIEW_CHARS);
      else await res.body?.cancel();
      const ok = res.status >= 200 && res.status < 300;
      return {
        ok,
        status: res.status,
        error: ok ? null : `HTTP ${res.status}`,
        durationMs: elapsed(),
        response,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.name === "TimeoutError"
            ? "timeout"
            : // fetch wraps network errors: the cause says what happened (ECONNREFUSED…).
              ((error.cause as { code?: string } | undefined)?.code ?? error.message)
          : String(error);
      return {
        ok: false,
        status: null,
        error: message.slice(0, 300),
        durationMs: elapsed(),
        response: null,
      };
    }
  };

  /** Sends one queued delivery and records the outcome, scheduling a retry if it failed. */
  const send = async (delivery: AutomationDelivery, automation: Automation, now: number) => {
    const skip = (error: string) =>
      db
        .update(automationDeliveries)
        .set({ status: "skipped", error })
        .where(eq(automationDeliveries.id, delivery.id));
    const step = webhookSteps(automation).find((item) => item.action.id === delivery.actionId);
    // The step was removed from the flow after this was queued.
    if (!step) return skip("step_removed");
    const { action } = step;
    // Cancelled while it waited: no reminder or late "you're booked" for an appointment
    // that's off. Notices sent right away still go out: what they report did happen.
    const waited =
      automation.trigger === "before" || automation.trigger === "after" || step.delayMs > 0;
    if (delivery.appointmentId && waited && delivery.event !== AUTOMATION_EVENTS.cancelled) {
      const [appointment] = await db
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, delivery.appointmentId));
      if (appointment?.status === "cancelled") return skip("appointment_cancelled");
    }
    const result = await post(
      automation.secret,
      action,
      delivery.event,
      delivery.id,
      delivery.payload,
    );
    const attempts = delivery.attempts + 1;
    const retryIn = RETRY_DELAYS_MS[attempts - 1];
    await db
      .update(automationDeliveries)
      .set({
        attempts,
        responseStatus: result.status,
        error: result.error,
        ...(result.ok
          ? { status: "sent" as const, sentAt: new Date(now) }
          : retryIn === undefined
            ? { status: "failed" as const }
            : { nextAttemptAt: new Date(now + retryIn) }),
      })
      .where(eq(automationDeliveries.id, delivery.id));
  };

  let running = false;

  return {
    /**
     * Queues the business's automations for a change to an appointment. Never fails the
     * request that made the change: problems are logged.
     */
    async emit(
      appointmentId: string,
      trigger: "created" | "rescheduled" | "cancelled",
      previousStartsAt?: Date,
    ) {
      try {
        const row = await loadAppointment(appointmentId);
        if (!row) return;
        const list = await db
          .select()
          .from(automations)
          .where(
            and(
              eq(automations.businessId, row.business.id),
              eq(automations.trigger, trigger),
              eq(automations.active, true),
            ),
          );
        if (list.length === 0) return;
        const event = AUTOMATION_EVENTS[trigger];
        const values = automationValues(row.business, row, event, config.appUrl, previousStartsAt);
        const rows = list.flatMap((automation) =>
          webhookSteps(automation).map(({ action, delayMs }) => ({
            automationId: automation.id,
            actionId: action.id,
            appointmentId,
            event,
            payload: buildPayload(action, values),
            // Steps after a wait: queued now, sent when the wait is over.
            nextAttemptAt: new Date(Date.now() + delayMs),
          })),
        );
        if (rows.length > 0) await db.insert(automationDeliveries).values(rows);
      } catch (error) {
        console.error("automations: could not queue", trigger, error);
      }
    },

    /** Queues reminders and follow-ups that have come due (each only once per time). */
    async sweep(now = Date.now()) {
      const timed = await db
        .select()
        .from(automations)
        .where(
          and(eq(automations.active, true), inArray(automations.trigger, ["before", "after"])),
        );
      for (const automation of timed) {
        const offset = automation.offsetMin * 60_000;
        const before = automation.trigger === "before";
        const window = before
          ? // Due at start - offset; only for appointments booked before that moment.
            and(
              gt(appointments.startsAt, new Date(Math.max(now, now - GRACE_MS + offset))),
              lte(appointments.startsAt, new Date(now + offset)),
              lte(
                appointments.createdAt,
                sql`${appointments.startsAt} - make_interval(mins => ${automation.offsetMin})`,
              ),
            )
          : and(
              gt(appointments.endsAt, new Date(now - GRACE_MS - offset)),
              lte(appointments.endsAt, new Date(now - offset)),
            );
        const due = await db
          .select({ appointment: appointments, customer: customers, business: businesses })
          .from(appointments)
          .innerJoin(customers, eq(customers.id, appointments.customerId))
          .innerJoin(businesses, eq(businesses.id, appointments.businessId))
          .where(
            and(
              eq(appointments.businessId, automation.businessId),
              eq(appointments.status, "confirmed"),
              window,
            ),
          );
        const event = AUTOMATION_EVENTS[automation.trigger];
        for (const row of due) {
          const at = before ? row.appointment.startsAt : row.appointment.endsAt;
          const values = automationValues(row.business, row, event, config.appUrl);
          for (const { action, delayMs } of webhookSteps(automation)) {
            await db
              .insert(automationDeliveries)
              .values({
                automationId: automation.id,
                actionId: action.id,
                appointmentId: row.appointment.id,
                // A moved appointment gets a new reminder for its new time.
                dedupeKey: `${automation.id}:${action.id}:${row.appointment.id}:${at.toISOString()}`,
                event,
                payload: buildPayload(action, values),
                nextAttemptAt: new Date(now + delayMs),
              })
              .onConflictDoNothing();
          }
        }
      }
      await db
        .delete(automationDeliveries)
        .where(lt(automationDeliveries.createdAt, new Date(now - HISTORY_DAYS * 86_400_000)));
    },

    /** Sends what's due in the queue. */
    async deliverDue(now = Date.now(), limit = 25) {
      const due = await db
        .select({ delivery: automationDeliveries, automation: automations })
        .from(automationDeliveries)
        .innerJoin(automations, eq(automations.id, automationDeliveries.automationId))
        .where(
          and(
            eq(automationDeliveries.status, "pending"),
            lte(automationDeliveries.nextAttemptAt, new Date(now)),
          ),
        )
        .orderBy(asc(automationDeliveries.nextAttemptAt))
        .limit(limit);
      for (const { delivery, automation } of due) await send(delivery, automation, now);
      return due.length;
    },

    /**
     * Runs a flow right away and returns how each step answered, with one of the
     * business's appointments or example data. A saved automation's test is signed with
     * its secret and shows in its history; a draft's is signed with a throwaway secret.
     */
    async test(
      business: Business,
      flow: Pick<Automation, "trigger" | "actions"> & { id?: string; secret?: string },
      { appointmentId, actionId }: { appointmentId?: string | null; actionId?: string } = {},
    ) {
      const row = appointmentId ? await loadAppointment(appointmentId) : null;
      if (appointmentId && row?.business.id !== business.id) {
        throw new Error("appointment_not_found");
      }
      const event = AUTOMATION_EVENTS[flow.trigger];
      const values = row
        ? automationValues(row.business, row, event, config.appUrl)
        : sampleValues(business, event, config.appUrl);
      // Waits are skipped: a test shows right away how each system answers.
      const steps = webhookSteps({ ...flow, offsetMin: 0 })
        .map((step) => step.action)
        .filter((action) => !actionId || action.id === actionId);
      const secret = flow.secret ?? `whsec_test_${randomBytes(12).toString("base64url")}`;
      return Promise.all(
        steps.map(async (action) => {
          // A hand-written body goes exactly as written; a test says so in a header instead.
          const payload =
            action.body === "json"
              ? buildPayload(action, values)
              : { ...buildPayload(action, values), test: true };
          const deliveryId = randomUUID();
          const result = await post(secret, action, event, deliveryId, payload, {
            readResponse: true,
            test: true,
          });
          if (flow.id) {
            await db.insert(automationDeliveries).values({
              id: deliveryId,
              automationId: flow.id,
              actionId: action.id,
              appointmentId: row?.appointment.id ?? null,
              event,
              payload,
              status: result.ok ? "sent" : "failed",
              attempts: 1,
              responseStatus: result.status,
              error: result.error,
              nextAttemptAt: new Date(),
              sentAt: result.ok ? new Date() : null,
            });
          }
          return { actionId: action.id, event, payload, ...result };
        }),
      );
    },

    /** Runs the sweep and the sender every `intervalMs` until `stop()`. */
    start(intervalMs = 15_000) {
      const tick = async () => {
        if (running) return;
        running = true;
        try {
          await this.sweep();
          while ((await this.deliverDue()) > 0) {
            // Keep going while there's a backlog.
          }
        } catch (error) {
          console.error("automations:", error);
        } finally {
          running = false;
        }
      };
      const timer = setInterval(tick, intervalMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}

/** The same example appointment the builder previews: in 3 days at 10:00, Ana's haircut. */
function sampleValues(business: Business, event: string, appUrl: string) {
  const startsAt = new Date(
    zonedTimeToInstant(addDays(todayIn(business.timezone), 3), 10 * 60, business.timezone),
  );
  return automationValues(
    business,
    {
      appointment: {
        code: "K7Q4XM",
        status: "confirmed",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        serviceName: "Corte clásico",
        resourceName: "Juan",
        priceAmount: toMinorUnits(18_000, business.currency),
        answers: [],
        source: "online",
        sourceLabel: null,
      },
      customer: {
        firstName: "Ana",
        lastName: "Pérez",
        phone: "+573001234567",
        email: "ana@example.com",
      },
    },
    event,
    appUrl,
  );
}
