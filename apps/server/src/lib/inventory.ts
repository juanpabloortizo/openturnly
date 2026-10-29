import type { StockMovementKind } from "@openturnly/core";
import { and, eq, sql } from "drizzle-orm";
import { productStock, stockMovements } from "../db/schema.ts";
import type { Queryable } from "./schedules.ts";

/** Waits for the business's other stock changes, so balances stay right. */
export async function lockStock(tx: Queryable, businessId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${businessId}:stock`}, 0))`,
  );
}

/** Units of a product at a location right now. */
export async function stockAt(tx: Queryable, productId: string, locationId: string) {
  const [row] = await tx
    .select({ quantity: productStock.quantity })
    .from(productStock)
    .where(and(eq(productStock.productId, productId), eq(productStock.locationId, locationId)));
  return row?.quantity ?? 0;
}

/**
 * Changes the stock of a product at a location by `quantity` (+ in, − out) and records the
 * movement with the balance it leaves. Call it after `lockStock`.
 */
export async function moveStock(
  tx: Queryable,
  move: {
    businessId: string;
    productId: string;
    locationId: string;
    kind: StockMovementKind;
    quantity: number;
    unitCost?: number | null;
    saleId?: string | null;
    transferId?: string | null;
    note?: string | null;
    createdBy?: string | null;
  },
) {
  const [stock] = await tx
    .insert(productStock)
    .values({ productId: move.productId, locationId: move.locationId, quantity: move.quantity })
    .onConflictDoUpdate({
      target: [productStock.productId, productStock.locationId],
      set: { quantity: sql`${productStock.quantity} + ${move.quantity}` },
    })
    .returning({ quantity: productStock.quantity });
  const balanceAfter = stock?.quantity ?? move.quantity;
  await tx.insert(stockMovements).values({
    businessId: move.businessId,
    productId: move.productId,
    locationId: move.locationId,
    kind: move.kind,
    quantity: move.quantity,
    balanceAfter,
    unitCost: move.unitCost ?? null,
    saleId: move.saleId ?? null,
    transferId: move.transferId ?? null,
    note: move.note ?? null,
    createdBy: move.createdBy ?? null,
  });
  return balanceAfter;
}
