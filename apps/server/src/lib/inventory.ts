import { attributeKey, type ProductAttributeKind, type StockMovementKind } from "@openturnly/core";
import { and, eq, sql } from "drizzle-orm";
import { productAttributes, productStock, stockMovements } from "../db/schema.ts";
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

/** An entry of the business's category or brand list, by id, if it's that kind. */
export async function findAttribute(
  tx: Queryable,
  businessId: string,
  kind: ProductAttributeKind,
  id: string,
) {
  const [attribute] = await tx
    .select()
    .from(productAttributes)
    .where(
      and(
        eq(productAttributes.businessId, businessId),
        eq(productAttributes.kind, kind),
        eq(productAttributes.id, id),
      ),
    );
  return attribute ?? null;
}

/** The entry that's the same as `input` (see core's attributeKey), if there's one. */
export async function sameAttribute(
  tx: Queryable,
  businessId: string,
  input: { kind: ProductAttributeKind; name: string },
) {
  const key = attributeKey(input.name);
  const [attribute] = await tx
    .select()
    .from(productAttributes)
    .where(
      and(
        eq(productAttributes.businessId, businessId),
        eq(productAttributes.kind, input.kind),
        eq(productAttributes.key, key),
      ),
    );
  return { key, attribute: attribute ?? null };
}

/** The entry for `input`: the existing one that's the same, or a new one. */
export async function findOrCreateAttribute(
  tx: Queryable,
  businessId: string,
  input: { kind: ProductAttributeKind; name: string },
) {
  const { key, attribute } = await sameAttribute(tx, businessId, input);
  if (attribute) return { attribute, created: false };
  const [created] = await tx
    .insert(productAttributes)
    .values({ businessId, kind: input.kind, name: input.name, key })
    .returning();
  if (!created) throw new Error("attribute insert returned nothing");
  return { attribute: created, created: true };
}
