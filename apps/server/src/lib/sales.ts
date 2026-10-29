import type { saleSchema } from "@openturnly/core";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/client.ts";
import {
  appointments,
  type Business,
  customers,
  deposits,
  locations,
  resources,
  saleItems,
  salePayments,
  sales,
  saleTips,
  services,
  users,
} from "../db/schema.ts";
import { apiError } from "./http.ts";
import { resolveLocation } from "./locations.ts";
import type { Queryable } from "./schedules.ts";

type SaleInput = z.output<typeof saleSchema>;

/** Appointments among `ids` already charged in a sale that wasn't voided. */
export async function chargedAppointments(db: Queryable, ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; number: number }>();
  const rows = await db
    .select({ appointmentId: saleItems.appointmentId, id: sales.id, number: sales.number })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(and(inArray(saleItems.appointmentId, ids), eq(sales.status, "paid")));
  return new Map(
    rows.flatMap((row) =>
      row.appointmentId ? [[row.appointmentId, { id: row.id, number: row.number }] as const] : [],
    ),
  );
}

/**
 * Records a sale: checks the appointments it charges, prices each line, takes the
 * deposits it uses and numbers it. Everything happens in one transaction, one sale of the
 * business at a time, so an appointment can't be charged twice.
 */
export async function createSale(
  db: Db,
  business: Business,
  input: SaleInput,
  soldBy: string | null,
): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${business.id}:sales`}, 0))`,
    );

    // The appointments charged: this business's, confirmed, not charged yet.
    const appointmentIds = [
      ...new Set(input.items.flatMap((item) => (item.appointmentId ? [item.appointmentId] : []))),
    ];
    const charged =
      appointmentIds.length > 0
        ? await tx
            .select()
            .from(appointments)
            .where(
              and(
                eq(appointments.businessId, business.id),
                inArray(appointments.id, appointmentIds),
              ),
            )
        : [];
    if (charged.length !== appointmentIds.length) throw apiError(404, "appointment_not_found");
    if (charged.some((appointment) => appointment.status !== "confirmed")) {
      throw apiError(409, "appointment_cancelled");
    }
    if ((await chargedAppointments(tx, appointmentIds)).size > 0) {
      throw apiError(409, "appointment_paid");
    }

    const location = await resolveLocation(
      tx,
      business.id,
      input.locationId ?? charged[0]?.locationId,
      { forBooking: false },
    );

    const customerId = input.customerId ?? charged[0]?.customerId ?? null;
    if (customerId) {
      const [customer] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.businessId, business.id), eq(customers.id, customerId)));
      if (!customer) throw apiError(404, "customer_not_found");
    }

    const serviceIds = [
      ...new Set(input.items.flatMap((item) => (item.serviceId ? [item.serviceId] : []))),
    ];
    const catalog =
      serviceIds.length > 0
        ? await tx
            .select({ id: services.id, name: services.name })
            .from(services)
            .where(and(eq(services.businessId, business.id), inArray(services.id, serviceIds)))
        : [];
    const serviceNames = new Map(catalog.map((service) => [service.id, service.name]));
    if (serviceNames.size !== serviceIds.length) throw apiError(404, "service_not_found");

    const peopleIds = [
      ...new Set([
        ...input.items.flatMap((item) => (item.resourceId ? [item.resourceId] : [])),
        ...input.tips.map((tip) => tip.resourceId),
      ]),
    ];
    const people =
      peopleIds.length > 0
        ? await tx
            .select({ id: resources.id, name: resources.name })
            .from(resources)
            .where(and(eq(resources.businessId, business.id), inArray(resources.id, peopleIds)))
        : [];
    const names = new Map(people.map((person) => [person.id, person.name]));
    if (names.size !== peopleIds.length) throw apiError(404, "professional_not_found");

    const lines = input.items.map((item, position) => {
      const appointment = charged.find((row) => row.id === item.appointmentId);
      const name =
        appointment?.serviceName ?? (item.serviceId ? serviceNames.get(item.serviceId) : undefined);
      if (!name) throw apiError(404, "service_not_found");
      const gross = item.quantity * item.unitPrice;
      if (item.discountAmount > gross) {
        throw apiError(400, "validation_failed", {
          [`items.${position}.discountAmount`]: "too_big",
        });
      }
      return {
        kind: item.kind,
        appointmentId: item.appointmentId ?? null,
        serviceId: item.serviceId,
        name,
        resourceId: item.resourceId,
        resourceName: item.resourceId ? (names.get(item.resourceId) ?? null) : null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountAmount: item.discountAmount,
        total: gross - item.discountAmount,
        position,
      };
    });
    const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
    if (input.discountAmount > subtotal) {
      throw apiError(400, "validation_failed", { discountAmount: "too_big" });
    }
    const total = subtotal - input.discountAmount;
    const tipAmount = input.tips.reduce((sum, tip) => sum + tip.amount, 0);

    const payments = input.payments.filter((payment) => payment.amount > 0);
    const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (paid !== total + tipAmount) {
      throw apiError(400, "payments_mismatch", { payments: "payments_mismatch" });
    }

    // Deposits used: active, not used yet, the same customer's, used in full.
    const depositIds = payments.flatMap((payment) =>
      payment.method === "deposit" ? [payment.depositId ?? ""] : [],
    );
    if (new Set(depositIds).size !== depositIds.length) {
      throw apiError(400, "validation_failed", { payments: "deposit_twice" });
    }
    const used =
      depositIds.length > 0
        ? await tx
            .select()
            .from(deposits)
            .where(and(eq(deposits.businessId, business.id), inArray(deposits.id, depositIds)))
        : [];
    for (const payment of payments) {
      if (payment.method !== "deposit") continue;
      const deposit = used.find((row) => row.id === payment.depositId);
      if (
        !deposit ||
        deposit.status !== "active" ||
        deposit.appliedSaleId !== null ||
        deposit.customerId !== customerId
      ) {
        throw apiError(409, "deposit_unavailable");
      }
      if (deposit.amount !== payment.amount) {
        throw apiError(400, "validation_failed", { payments: "deposit_amount" });
      }
    }

    const [last] = await tx
      .select({ number: sql<number>`coalesce(max(${sales.number}), 0)`.mapWith(Number) })
      .from(sales)
      .where(eq(sales.businessId, business.id));
    const [sale] = await tx
      .insert(sales)
      .values({
        businessId: business.id,
        locationId: location.id,
        number: (last?.number ?? 0) + 1,
        customerId,
        internal: input.internal,
        subtotal,
        discountAmount: input.discountAmount,
        total,
        tipAmount,
        note: input.note ?? null,
        soldBy,
      })
      .returning({ id: sales.id });
    if (!sale) throw apiError(500, "internal_error");

    await tx.insert(saleItems).values(lines.map((line) => ({ ...line, saleId: sale.id })));
    if (input.tips.length > 0) {
      await tx.insert(saleTips).values(
        input.tips.map((tip) => ({
          saleId: sale.id,
          resourceId: tip.resourceId,
          resourceName: names.get(tip.resourceId) ?? "—",
          amount: tip.amount,
        })),
      );
    }
    if (payments.length > 0) {
      await tx.insert(salePayments).values(
        payments.map((payment) => ({
          saleId: sale.id,
          method: payment.method,
          amount: payment.amount,
          depositId: payment.method === "deposit" ? (payment.depositId ?? null) : null,
        })),
      );
    }
    if (depositIds.length > 0) {
      await tx
        .update(deposits)
        .set({ appliedSaleId: sale.id })
        .where(inArray(deposits.id, depositIds));
    }
    return sale.id;
  });
}

/** Voids a sale: it stays in the history, counts nowhere, and its deposits are free again. */
export async function voidSale(db: Db, businessId: string, saleId: string) {
  await db.transaction(async (tx) => {
    const [voided] = await tx
      .update(sales)
      .set({ status: "void", voidedAt: new Date() })
      .where(and(eq(sales.businessId, businessId), eq(sales.id, saleId), eq(sales.status, "paid")))
      .returning({ id: sales.id });
    if (!voided) {
      const [existing] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(and(eq(sales.businessId, businessId), eq(sales.id, saleId)));
      if (!existing) throw apiError(404, "sale_not_found");
      return;
    }
    await tx
      .update(deposits)
      .set({ appliedSaleId: null })
      .where(eq(deposits.appliedSaleId, saleId));
  });
}

/** Sales with everything shown about them: lines, tips, payments, who and where. */
export async function loadSales(
  db: Queryable,
  businessId: string,
  filter: { from?: Date; to?: Date; locationId?: string; saleId?: string },
) {
  const rows = await db
    .select({
      id: sales.id,
      number: sales.number,
      status: sales.status,
      internal: sales.internal,
      locationId: sales.locationId,
      locationName: locations.name,
      subtotal: sales.subtotal,
      discountAmount: sales.discountAmount,
      total: sales.total,
      tipAmount: sales.tipAmount,
      note: sales.note,
      createdAt: sales.createdAt,
      voidedAt: sales.voidedAt,
      soldByName: users.name,
      customer: {
        id: customers.id,
        firstName: customers.firstName,
        lastName: customers.lastName,
        phone: customers.phone,
        email: customers.email,
      },
    })
    .from(sales)
    .leftJoin(locations, eq(locations.id, sales.locationId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(users, eq(users.id, sales.soldBy))
    .where(
      and(
        eq(sales.businessId, businessId),
        filter.saleId ? eq(sales.id, filter.saleId) : undefined,
        filter.locationId ? eq(sales.locationId, filter.locationId) : undefined,
        filter.from ? gte(sales.createdAt, filter.from) : undefined,
        filter.to ? lt(sales.createdAt, filter.to) : undefined,
      ),
    )
    .orderBy(desc(sales.createdAt));
  const ids = rows.map((row) => row.id);
  const [items, tips, payments] =
    ids.length > 0
      ? await Promise.all([
          db
            .select()
            .from(saleItems)
            .where(inArray(saleItems.saleId, ids))
            .orderBy(asc(saleItems.position)),
          db.select().from(saleTips).where(inArray(saleTips.saleId, ids)),
          db.select().from(salePayments).where(inArray(salePayments.saleId, ids)),
        ])
      : [[], [], []];
  return rows.map((row) => ({
    ...row,
    // A left join with no customer gives an object of nulls.
    customer: row.customer?.id ? row.customer : null,
    items: items.filter((item) => item.saleId === row.id),
    tips: tips.filter((tip) => tip.saleId === row.id),
    payments: payments.filter((payment) => payment.saleId === row.id),
  }));
}
