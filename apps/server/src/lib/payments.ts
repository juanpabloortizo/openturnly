import {
  currencyDigits,
  fromMinorUnits,
  instantToZoned,
  MERCADOPAGO_SITE_CURRENCIES,
  slotsForDate,
} from "@openturnly/core";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import {
  type Appointment,
  appointments,
  BUSY_STATUSES,
  type Business,
  businesses,
  customers,
  deposits,
  type OnlinePayment,
  type OnlinePaymentStatus,
  onlinePayments,
  paymentConnections,
} from "../db/schema.ts";
import { apiError } from "./http.ts";
import { bookingRules, loadSchedules, type Queryable } from "./schedules.ts";
import { decryptSecret, encryptSecret } from "./secrets.ts";

/**
 * Paying for an appointment on the booking page, with the business's own Mercado Pago
 * account. Booking holds the time as "pending_payment" and sends the customer to pay. The
 * order's state at Mercado Pago is what counts: it's read when the customer comes back, when
 * a notification arrives and on every sweep, so a lost notification changes nothing. A paid
 * order confirms the appointment and becomes a deposit of it; otherwise the time is released.
 *
 * A slow payment can still finish after that, so released orders are watched for a day. The
 * money then keeps the appointment if its time is still free, and goes back to the customer
 * if it isn't.
 */

/** How long a customer has to pay. */
const HOLD_MS = 15 * 60_000;
/** Time for a payment finished at the last moment to show up before the hold ends. */
const GRACE_MS = 5 * 60_000;
/** How long Mercado Pago may keep reviewing a payment before the time is released anyway. */
const REVIEW_MS = 24 * 60 * 60_000;
/** If an order can't be cancelled it may have just been paid, so the time waits this long. */
const CANCEL_RETRY_MS = 10 * 60_000;
/** How long a released order is watched in case its money still arrives. */
const LATE_WATCH_MS = 24 * 60 * 60_000;
/** Sweeps ask about each open payment this often. */
const SWEEP_EVERY_MS = 60_000;
/** Sweeps ask about each released order this often. */
const LATE_CHECK_EVERY_MS = 10 * 60_000;
/** A refund Mercado Pago refused, usually for lack of balance, is tried again this often. */
const REFUND_RETRY_EVERY_MS = 60 * 60_000;
/** The page waiting for a payment asks this often at most, however often it polls. */
const POLL_EVERY_MS = 4_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Paid at a shop days later, so it could never confirm a time held for minutes. */
const NOT_ALLOWED_TYPES = ["ticket", "atm"];
const RELEASED: OnlinePaymentStatus[] = ["failed", "cancelled", "abandoned"];

type Order = {
  id: string;
  status: string;
  status_detail?: string;
  external_reference?: string;
  checkout_url?: string;
};

type MercadopagoUser = {
  id: number;
  nickname?: string;
  first_name?: string;
  last_name?: string;
  site_id: string;
  tags?: string[];
};

export type Payments = ReturnType<typeof createPayments>;

export function createPayments({
  db,
  config,
  onConfirmed,
}: {
  db: Db;
  config: Config;
  /** Runs once the appointment is confirmed, outside any transaction. */
  onConfirmed: (appointmentId: string) => Promise<void>;
}) {
  const request = async <T>(token: string, path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${config.mercadopagoApiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`mercadopago ${response.status}: ${body.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  };

  const findConnection = async (businessId: string) => {
    const [connection] = await db
      .select()
      .from(paymentConnections)
      .where(eq(paymentConnections.businessId, businessId));
    return connection ?? null;
  };

  const tokenOf = async (businessId: string) => {
    const connection = await findConnection(businessId);
    return connection ? decryptSecret(config.secret, connection.encryptedAccessToken) : null;
  };

  const noteChecked = (payment: OnlinePayment, now: number) =>
    db
      .update(onlinePayments)
      .set({ checkedAt: new Date(now) })
      .where(eq(onlinePayments.id, payment.id));

  const cancelOrder = (token: string, orderId: string) =>
    request(token, `/v1/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "X-Idempotency-Key": `cancel-${orderId}` },
    }).then(
      () => true,
      () => false,
    );

  /** Closes a payment that wasn't paid and frees the time. Does nothing if it's not open. */
  const close = async (tx: Queryable, payment: OnlinePayment, status: OnlinePaymentStatus) => {
    const [closed] = await tx
      .update(onlinePayments)
      .set({ status, closedAt: new Date() })
      .where(and(eq(onlinePayments.id, payment.id), eq(onlinePayments.status, "pending")))
      .returning();
    if (closed?.appointmentId) {
      await tx
        .update(appointments)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(
          and(
            eq(appointments.id, closed.appointmentId),
            eq(appointments.status, "pending_payment"),
          ),
        );
    }
    return closed;
  };

  /** Ends a payment that wasn't paid. Only the first call does anything. */
  const release = async (payment: OnlinePayment, status: OnlinePaymentStatus) =>
    (await db.transaction((tx) => close(tx, payment, status))) ?? payment;

  /** Writes the money down as a deposit of the appointment it paid for. */
  const recordDeposit = async (
    tx: Queryable,
    payment: OnlinePayment,
    appointment: Appointment,
    order: Order,
  ) => {
    const [deposit] = await tx
      .insert(deposits)
      .values({
        businessId: payment.businessId,
        customerId: appointment.customerId,
        appointmentId: appointment.id,
        locationId: appointment.locationId,
        amount: payment.amount,
        method: "online",
        note: `Mercado Pago ${order.id}`,
      })
      .returning({ id: deposits.id });
    const [linked] = await tx
      .update(onlinePayments)
      .set({ depositId: deposit?.id })
      .where(eq(onlinePayments.id, payment.id))
      .returning();
    return linked;
  };

  /** Confirms the appointment and records the money. Only the first call does anything. */
  const confirm = async (payment: OnlinePayment, order: Order) => {
    const confirmed = await db.transaction(async (tx) => {
      const [paid] = await tx
        .update(onlinePayments)
        .set({ status: "paid", paidAt: new Date() })
        .where(and(eq(onlinePayments.id, payment.id), eq(onlinePayments.status, "pending")))
        .returning();
      if (!paid?.appointmentId) return paid;
      const [appointment] = await tx
        .update(appointments)
        .set({ status: "confirmed" })
        .where(
          and(eq(appointments.id, paid.appointmentId), eq(appointments.status, "pending_payment")),
        )
        .returning();
      if (!appointment) return paid;
      return recordDeposit(tx, paid, appointment, order);
    });
    if (!confirmed) return payment;
    if (confirmed.depositId && confirmed.appointmentId) {
      await onConfirmed(confirmed.appointmentId);
    }
    return confirmed;
  };

  /** Brings a pending payment up to date with Mercado Pago. */
  const settle = async (payment: OnlinePayment, now = Date.now()): Promise<OnlinePayment> => {
    if (payment.status !== "pending") return payment;
    const token = await tokenOf(payment.businessId);
    await noteChecked(payment, now);

    const expiry = payment.expiresAt.getTime();
    // Nothing to ask about: the order was never created, or the account is gone.
    if (!token || !payment.orderId) {
      return now > expiry + GRACE_MS ? release(payment, "cancelled") : payment;
    }
    const order = await request<Order>(token, `/v1/orders/${payment.orderId}`).catch((error) => {
      // Can't tell whether it was paid, so the time stays held until the next try.
      console.error("payments: could not read an order:", (error as Error).message);
      return null;
    });
    if (!order || order.external_reference !== payment.id) return payment;

    if (order.status === "processed") return confirm(payment, order);
    if (order.status === "failed") return release(payment, "failed");
    if (order.status === "canceled" || order.status === "refunded") {
      return release(payment, "cancelled");
    }
    // Mercado Pago is still deciding: a payment under review keeps its time for a while.
    const limit = order.status === "created" ? expiry + GRACE_MS : expiry + REVIEW_MS;
    if (now <= limit) return payment;
    const cancelled = await cancelOrder(token, order.id);
    // It may have been paid just now: the next read will say.
    if (!cancelled && now <= limit + CANCEL_RETRY_MS) return payment;
    return release(payment, "cancelled");
  };

  /** Whether an appointment that lost its time can still have it. */
  const canKeep = async (tx: Queryable, appointment: Appointment, now: number) => {
    const { serviceId, locationId } = appointment;
    if (appointment.status !== "cancelled" || !serviceId || !locationId) return false;
    if (appointment.startsAt.getTime() <= now) return false;
    const [business] = await tx
      .select()
      .from(businesses)
      .where(eq(businesses.id, appointment.businessId));
    if (!business) return false;
    const [ownClash] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.customerId, appointment.customerId),
          inArray(appointments.status, BUSY_STATUSES),
          lt(appointments.startsAt, appointment.endsAt),
          gt(appointments.endsAt, appointment.startsAt),
        ),
      )
      .limit(1);
    if (ownClash) return false;

    const { date } = instantToZoned(appointment.startsAt.getTime(), business.timezone);
    const schedules = await loadSchedules(
      tx,
      business,
      locationId,
      serviceId,
      appointment.resourceId,
      date,
      date,
      appointment.id,
    );
    const durationMin = (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000;
    // The customer booked in time: only whether it's still free counts, not the notice.
    const rules = { ...bookingRules(business), minNoticeMin: 0 };
    return slotsForDate(date, durationMin, schedules, rules, now).some(
      (slot) => slot.start === appointment.startsAt.getTime(),
    );
  };

  /** Sends money back to the customer. A failed try stays "refunding" and is tried again. */
  const refund = async (payment: OnlinePayment, now = Date.now()) => {
    if (payment.status !== "refunding" || !payment.orderId) return payment;
    await noteChecked(payment, now);
    const token = await tokenOf(payment.businessId);
    if (!token) return payment;
    const orderId = payment.orderId;
    // Each try has its own key, and a full refund can't happen twice for one order.
    const done = await request(token, `/v1/orders/${orderId}/refund`, {
      method: "POST",
      headers: { "X-Idempotency-Key": `refund-${payment.id}-${now}` },
    }).then(
      () => true,
      async (error) => {
        console.error("payments: could not refund:", (error as Error).message);
        // The business may have refunded it itself on Mercado Pago.
        const order = await request<Order>(token, `/v1/orders/${orderId}`).catch(() => null);
        return order?.status === "refunded" || order?.status_detail === "refunded";
      },
    );
    if (!done) return payment;
    const [refunded] = await db
      .update(onlinePayments)
      .set({ status: "refunded", refundedAt: new Date(now) })
      .where(and(eq(onlinePayments.id, payment.id), eq(onlinePayments.status, "refunding")))
      .returning();
    return refunded ?? payment;
  };

  /** Money that arrived after the time was released: keeps the appointment or goes back. */
  const placeLatePayment = async (payment: OnlinePayment, order: Order, now: number) => {
    const placed = await db.transaction(async (tx) => {
      // In the booking queue, so nobody books the time while this decides on it.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${payment.businessId}, 0))`,
      );
      const [current] = await tx
        .select()
        .from(onlinePayments)
        .where(eq(onlinePayments.id, payment.id));
      if (!current || !RELEASED.includes(current.status)) return current;
      const [appointment] = current.appointmentId
        ? await tx.select().from(appointments).where(eq(appointments.id, current.appointmentId))
        : [];
      const keep =
        current.status !== "abandoned" &&
        appointment !== undefined &&
        (await canKeep(tx, appointment, now));
      if (!keep) {
        const [refunding] = await tx
          .update(onlinePayments)
          .set({ status: "refunding" })
          .where(eq(onlinePayments.id, current.id))
          .returning();
        return refunding;
      }
      const [paid] = await tx
        .update(onlinePayments)
        .set({ status: "paid", paidAt: new Date(now), closedAt: null })
        .where(eq(onlinePayments.id, current.id))
        .returning();
      const [confirmed] = await tx
        .update(appointments)
        .set({ status: "confirmed", cancelledAt: null })
        .where(eq(appointments.id, appointment.id))
        .returning();
      if (!paid || !confirmed) throw apiError(500, "internal_error");
      return recordDeposit(tx, paid, confirmed, order);
    });
    if (placed?.status === "refunding") return refund(placed, now);
    if (placed?.status === "paid" && placed.depositId && placed.appointmentId) {
      await onConfirmed(placed.appointmentId);
    }
    return placed ?? payment;
  };

  /** Looks at a released order in case its money arrived after all. */
  const recover = async (payment: OnlinePayment, now = Date.now()) => {
    if (!RELEASED.includes(payment.status) || !payment.orderId) return payment;
    await noteChecked(payment, now);
    const token = await tokenOf(payment.businessId);
    if (!token) return payment;
    const order = await request<Order>(token, `/v1/orders/${payment.orderId}`).catch(() => null);
    if (!order || order.external_reference !== payment.id) return payment;
    // A refund the business made itself leaves the order "processed" with this detail.
    if (order.status !== "processed" || order.status_detail?.includes("refunded")) return payment;
    return placeLatePayment(payment, order, now);
  };

  /** Stops Mercado Pago taking money for orders nobody wants any more, if it can. */
  const cancelOrders = async (dropped: OnlinePayment[]) => {
    for (const payment of dropped) {
      const token = await tokenOf(payment.businessId);
      if (token && payment.orderId) await cancelOrder(token, payment.orderId);
    }
  };

  const watched = (payment: OnlinePayment, now: number) =>
    RELEASED.includes(payment.status) &&
    payment.closedAt !== null &&
    now - payment.closedAt.getTime() < LATE_WATCH_MS;

  return {
    findConnection,

    /** Whether the business can be paid on its booking page. */
    accepting: async (businessId: string) => (await findConnection(businessId)) !== null,

    /** Checks the token against Mercado Pago and saves it as the business's account. */
    async connect(business: Business, accessToken: string) {
      const user = await request<MercadopagoUser>(accessToken, "/users/me").catch(() => {
        throw apiError(400, "payment_token_invalid");
      });
      const currency = MERCADOPAGO_SITE_CURRENCIES[user.site_id];
      if (currency !== business.currency) {
        throw apiError(409, "payment_currency_mismatch", { currency: currency ?? "" });
      }
      const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
      const values = {
        encryptedAccessToken: encryptSecret(config.secret, accessToken),
        accountId: String(user.id),
        accountName: name || user.nickname || null,
        siteId: user.site_id,
        testMode: user.tags?.includes("test_user") ?? false,
      };
      await db
        .insert(paymentConnections)
        .values({ businessId: business.id, ...values })
        .onConflictDoUpdate({ target: paymentConnections.businessId, set: values });
      return findConnection(business.id);
    },

    async disconnect(businessId: string) {
      await db.delete(paymentConnections).where(eq(paymentConnections.businessId, businessId));
    },

    /** Holds the time, in the booking's transaction: a sweep frees it whatever happens next. */
    async hold(
      tx: Queryable,
      input: { business: Business; appointmentId: string; amount: number; now: number },
    ) {
      const [payment] = await tx
        .insert(onlinePayments)
        .values({
          businessId: input.business.id,
          appointmentId: input.appointmentId,
          amount: input.amount,
          currency: input.business.currency,
          expiresAt: new Date(input.now + HOLD_MS),
        })
        .returning();
      if (!payment) throw apiError(500, "internal_error");
      return payment;
    },

    /** Creates the order and returns where to send the customer. */
    async checkout(payment: OnlinePayment, business: Business, title: string) {
      const back = `${config.appUrl}/${business.slug}?payment=${payment.id}`;
      const price = fromMinorUnits(payment.amount, payment.currency).toFixed(
        currencyDigits(payment.currency),
      );
      try {
        const token = await tokenOf(business.id);
        if (!token) throw new Error("no payment account");
        const order = await request<Order>(token, "/v1/orders", {
          method: "POST",
          headers: { "X-Idempotency-Key": payment.id },
          body: JSON.stringify({
            type: "online",
            processing_mode: "manual",
            external_reference: payment.id,
            total_amount: price,
            expiration_time: `PT${HOLD_MS / 60_000}M`,
            items: [{ title, unit_price: price, quantity: 1 }],
            config: {
              online: {
                success_url: back,
                pending_url: back,
                failure_url: back,
                auto_return: "all",
              },
              payment_method: { not_allowed_types: NOT_ALLOWED_TYPES },
            },
          }),
        });
        const [updated] = await db
          .update(onlinePayments)
          .set({ orderId: order.id, checkoutUrl: order.checkout_url })
          .where(eq(onlinePayments.id, payment.id))
          .returning();
        if (!updated) throw new Error("payment disappeared");
        return updated;
      } catch (error) {
        console.error("payments: could not create an order:", (error as Error).message);
        await release(payment, "failed");
        throw apiError(502, "payment_unavailable");
      }
    },

    /** The payment as the page waiting for it should see it. */
    async refresh(payment: OnlinePayment, now = Date.now()) {
      const asked = payment.checkedAt?.getTime() ?? 0;
      if (now - asked < POLL_EVERY_MS) return payment;
      return watched(payment, now) ? recover(payment, now) : settle(payment, now);
    },

    /** Mercado Pago says an order changed. It's only a nudge to go and read the order. */
    async notified(orderId: string) {
      const [payment] = await db
        .select()
        .from(onlinePayments)
        .where(eq(onlinePayments.orderId, orderId));
      if (!payment) return;
      await (payment.status === "pending" ? settle(payment) : recover(payment));
    },

    /** What a customer left waiting to be paid, with the appointments it holds. */
    heldBy: (tx: Queryable, customerId: string) =>
      tx
        .select({ payment: onlinePayments, appointment: appointments })
        .from(onlinePayments)
        .innerJoin(appointments, eq(appointments.id, onlinePayments.appointmentId))
        .where(
          and(
            eq(appointments.customerId, customerId),
            eq(onlinePayments.status, "pending"),
            eq(appointments.status, "pending_payment"),
          ),
        ),

    /** Drops a held payment inside the booking that replaces it. */
    replace: (tx: Queryable, payment: OnlinePayment) => close(tx, payment, "abandoned"),

    cancelOrders,

    /** The customer gives up on paying: frees the time, unless the money already arrived. */
    async abandon(payment: OnlinePayment, now = Date.now()) {
      const current = await settle(payment, now);
      if (current.status !== "pending") return current;
      const closed = await release(current, "abandoned");
      await cancelOrders([closed]);
      return closed;
    },

    /** Late money sent back to customers, or on its way, for the business to see. */
    refunds: (businessId: string) =>
      db
        .select({
          id: onlinePayments.id,
          amount: onlinePayments.amount,
          currency: onlinePayments.currency,
          status: onlinePayments.status,
          refundedAt: onlinePayments.refundedAt,
          code: appointments.code,
          firstName: customers.firstName,
          lastName: customers.lastName,
        })
        .from(onlinePayments)
        .leftJoin(appointments, eq(appointments.id, onlinePayments.appointmentId))
        .leftJoin(customers, eq(customers.id, appointments.customerId))
        .where(
          and(
            eq(onlinePayments.businessId, businessId),
            inArray(onlinePayments.status, ["refunding", "refunded"]),
          ),
        )
        .orderBy(desc(onlinePayments.createdAt))
        .limit(20),

    /** Catches up with the open payments: lost notifications and customers who never paid. */
    async sweep(now = Date.now()) {
      const open = await db
        .select()
        .from(onlinePayments)
        .where(
          and(
            eq(onlinePayments.status, "pending"),
            or(
              isNull(onlinePayments.checkedAt),
              lt(onlinePayments.checkedAt, new Date(now - SWEEP_EVERY_MS)),
            ),
          ),
        )
        .limit(50);
      for (const payment of open) {
        await settle(payment, now).catch((error) =>
          console.error("payments: could not settle", payment.id, (error as Error).message),
        );
      }

      const released = await db
        .select()
        .from(onlinePayments)
        .where(
          and(
            inArray(onlinePayments.status, RELEASED),
            isNotNull(onlinePayments.orderId),
            gt(onlinePayments.closedAt, new Date(now - LATE_WATCH_MS)),
            or(
              isNull(onlinePayments.checkedAt),
              lt(onlinePayments.checkedAt, new Date(now - LATE_CHECK_EVERY_MS)),
            ),
          ),
        )
        .limit(50);
      const refunding = await db
        .select()
        .from(onlinePayments)
        .where(
          and(
            eq(onlinePayments.status, "refunding"),
            or(
              isNull(onlinePayments.checkedAt),
              lt(onlinePayments.checkedAt, new Date(now - REFUND_RETRY_EVERY_MS)),
            ),
          ),
        )
        .limit(50);
      for (const payment of [...released, ...refunding]) {
        await (payment.status === "refunding" ? refund(payment, now) : recover(payment, now)).catch(
          (error) =>
            console.error("payments: could not recover", payment.id, (error as Error).message),
        );
      }
    },
  };
}
