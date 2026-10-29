import type { PaymentMethod } from "@openturnly/core";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  cashMovements,
  customers,
  deposits,
  locations,
  saleItems,
  salePayments,
  sales,
  users,
} from "../db/schema.ts";
import type { Queryable } from "./schedules.ts";

/** Payment methods that bring money in; deposits and gift cards were counted when received. */
const MONEY = ["cash", "card", "transfer", "other"] as const;

type Filter = { businessId: string; locationId?: string; from: Date; to: Date };

const emptyByMethod = (): Record<PaymentMethod, number> => ({
  cash: 0,
  card: 0,
  transfer: 0,
  other: 0,
});

/**
 * The cash register of a period: money that came in by where it came from (sales, deposits,
 * internal sales, gift cards sold, other income) minus expenses, by payment method, with
 * the lines behind each figure. Money counts when it's received, so a sale paid with a
 * deposit or a gift card only counts what was paid on the day.
 */
export async function cashReport(db: Queryable, filter: Filter) {
  const { businessId, locationId, from, to } = filter;
  const saleRows = await db
    .select({
      id: sales.id,
      number: sales.number,
      internal: sales.internal,
      createdAt: sales.createdAt,
      locationName: locations.name,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(sales)
    .leftJoin(locations, eq(locations.id, sales.locationId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(
      and(
        eq(sales.businessId, businessId),
        eq(sales.status, "paid"),
        gte(sales.createdAt, from),
        lt(sales.createdAt, to),
        locationId ? eq(sales.locationId, locationId) : undefined,
      ),
    )
    .orderBy(desc(sales.createdAt));
  const saleIds = saleRows.map((row) => row.id);
  const [payments, giftCardSales] =
    saleIds.length > 0
      ? await Promise.all([
          db
            .select({
              saleId: salePayments.saleId,
              method: salePayments.method,
              amount: salePayments.amount,
            })
            .from(salePayments)
            .where(
              and(inArray(salePayments.saleId, saleIds), inArray(salePayments.method, [...MONEY])),
            ),
          db
            .selectDistinct({ saleId: saleItems.saleId })
            .from(saleItems)
            .where(and(inArray(saleItems.saleId, saleIds), eq(saleItems.kind, "gift_card"))),
        ])
      : [[], []];
  const soldCards = new Set(giftCardSales.map((row) => row.saleId));

  const depositRows = await db
    .select({
      id: deposits.id,
      amount: deposits.amount,
      method: deposits.method,
      note: deposits.note,
      createdAt: deposits.createdAt,
      locationName: locations.name,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(deposits)
    .innerJoin(customers, eq(customers.id, deposits.customerId))
    .leftJoin(locations, eq(locations.id, deposits.locationId))
    .where(
      and(
        eq(deposits.businessId, businessId),
        eq(deposits.status, "active"),
        gte(deposits.createdAt, from),
        lt(deposits.createdAt, to),
        locationId ? eq(deposits.locationId, locationId) : undefined,
      ),
    )
    .orderBy(desc(deposits.createdAt));

  const movementRows = await db
    .select({
      id: cashMovements.id,
      kind: cashMovements.kind,
      amount: cashMovements.amount,
      method: cashMovements.method,
      category: cashMovements.category,
      description: cashMovements.description,
      transferId: cashMovements.transferId,
      createdAt: cashMovements.createdAt,
      locationName: locations.name,
      createdByName: users.name,
    })
    .from(cashMovements)
    .innerJoin(locations, eq(locations.id, cashMovements.locationId))
    .leftJoin(users, eq(users.id, cashMovements.createdBy))
    .where(
      and(
        eq(cashMovements.businessId, businessId),
        gte(cashMovements.createdAt, from),
        lt(cashMovements.createdAt, to),
        locationId ? eq(cashMovements.locationId, locationId) : undefined,
      ),
    )
    .orderBy(desc(cashMovements.createdAt));

  const byMethod = emptyByMethod();
  const saleLines = saleRows.map((sale) => {
    const paid = payments.filter((payment) => payment.saleId === sale.id);
    for (const payment of paid) byMethod[payment.method as PaymentMethod] += payment.amount;
    return {
      id: sale.id,
      number: sale.number,
      createdAt: sale.createdAt,
      locationName: sale.locationName,
      customer: sale.firstName ? `${sale.firstName} ${sale.lastName}` : null,
      flow: soldCards.has(sale.id) ? "giftCards" : sale.internal ? "internal" : "sales",
      methods: [...new Set(paid.map((payment) => payment.method))],
      amount: paid.reduce((sum, payment) => sum + payment.amount, 0),
    };
  });
  for (const deposit of depositRows) byMethod[deposit.method] += deposit.amount;
  for (const move of movementRows) {
    if (move.kind === "income") byMethod[move.method] += move.amount;
    if (move.kind === "expense") byMethod[move.method] -= move.amount;
  }

  const sum = (rows: { amount: number }[]) => rows.reduce((total, row) => total + row.amount, 0);
  const of = (kind: string) => movementRows.filter((move) => move.kind === kind);
  const flows = {
    sales: sum(saleLines.filter((line) => line.flow === "sales")),
    deposits: sum(depositRows),
    internal: sum(saleLines.filter((line) => line.flow === "internal")),
    giftCards: sum(saleLines.filter((line) => line.flow === "giftCards")),
    otherIncome: sum(of("income")),
    expenses: sum(of("expense")),
  };
  return {
    flows: {
      ...flows,
      result:
        flows.sales +
        flows.deposits +
        flows.internal +
        flows.giftCards +
        flows.otherIncome -
        flows.expenses,
    },
    byMethod,
    sales: saleLines,
    deposits: depositRows.map((row) => ({
      id: row.id,
      amount: row.amount,
      method: row.method,
      note: row.note,
      createdAt: row.createdAt,
      locationName: row.locationName,
      customer: `${row.firstName} ${row.lastName}`,
    })),
    movements: movementRows,
  };
}

/**
 * The cash that should be in a location's drawer (or all of them) right now: cash taken
 * in sales and deposits, plus cash income, minus cash expenses and cash taken out, with the
 * corrections made after counting it.
 */
export async function cashInDrawer(db: Queryable, businessId: string, locationId?: string) {
  const [fromSales] = await db
    .select({ total: sql<number>`coalesce(sum(${salePayments.amount}), 0)`.mapWith(Number) })
    .from(salePayments)
    .innerJoin(sales, eq(sales.id, salePayments.saleId))
    .where(
      and(
        eq(sales.businessId, businessId),
        eq(sales.status, "paid"),
        eq(salePayments.method, "cash"),
        locationId ? eq(sales.locationId, locationId) : undefined,
      ),
    );
  const [fromDeposits] = await db
    .select({ total: sql<number>`coalesce(sum(${deposits.amount}), 0)`.mapWith(Number) })
    .from(deposits)
    .where(
      and(
        eq(deposits.businessId, businessId),
        eq(deposits.status, "active"),
        eq(deposits.method, "cash"),
        locationId ? eq(deposits.locationId, locationId) : undefined,
      ),
    );
  const [fromMovements] = await db
    .select({
      total: sql<number>`coalesce(sum(case
        when ${cashMovements.kind} in ('income', 'transfer_in', 'adjustment') then ${cashMovements.amount}
        else -${cashMovements.amount} end), 0)`.mapWith(Number),
    })
    .from(cashMovements)
    .where(
      and(
        eq(cashMovements.businessId, businessId),
        eq(cashMovements.method, "cash"),
        locationId ? eq(cashMovements.locationId, locationId) : undefined,
      ),
    );
  return (fromSales?.total ?? 0) + (fromDeposits?.total ?? 0) + (fromMovements?.total ?? 0);
}
