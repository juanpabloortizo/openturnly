import { todayIn } from "@openturnly/core";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import {
  appointments,
  type Business,
  type GiftCard,
  giftCards,
  salePayments,
  sales,
} from "../db/schema.ts";
import { apiError } from "./http.ts";
import type { Queryable } from "./schedules.ts";

/**
 * What a card can do today. "scheduled": not valid yet; "used_up": a discount code with no
 * uses left; "spent": a gift card with no balance left.
 */
export type GiftCardState = "active" | "inactive" | "scheduled" | "expired" | "used_up" | "spent";

export type GiftCardUsage = {
  /** Discount codes: confirmed appointments and paid sales that used it. */
  uses: number;
  /** Gift cards: what paid sales took from the balance. */
  spent: number;
};

/** How much each card was used, from the appointments and sales that used it. */
export async function giftCardUsage(db: Queryable, ids: string[]) {
  const usage = new Map<string, GiftCardUsage>(ids.map((id) => [id, { uses: 0, spent: 0 }]));
  if (ids.length === 0) return usage;
  const [booked, sold, paid] = await Promise.all([
    db
      .select({ id: appointments.giftCardId, total: count() })
      .from(appointments)
      .where(and(inArray(appointments.giftCardId, ids), eq(appointments.status, "confirmed")))
      .groupBy(appointments.giftCardId),
    db
      .select({ id: sales.giftCardId, total: count() })
      .from(sales)
      .where(and(inArray(sales.giftCardId, ids), eq(sales.status, "paid")))
      .groupBy(sales.giftCardId),
    db
      .select({
        id: salePayments.giftCardId,
        total: sql<number>`coalesce(sum(${salePayments.amount}), 0)`.mapWith(Number),
      })
      .from(salePayments)
      .innerJoin(sales, eq(sales.id, salePayments.saleId))
      .where(and(inArray(salePayments.giftCardId, ids), eq(sales.status, "paid")))
      .groupBy(salePayments.giftCardId),
  ]);
  for (const row of [...booked, ...sold]) {
    const entry = row.id ? usage.get(row.id) : undefined;
    if (entry) entry.uses += row.total;
  }
  for (const row of paid) {
    const entry = row.id ? usage.get(row.id) : undefined;
    if (entry) entry.spent += row.total;
  }
  return usage;
}

export function giftCardState(card: GiftCard, usage: GiftCardUsage, today: string): GiftCardState {
  if (!card.active) return "inactive";
  if (card.validFrom && card.validFrom > today) return "scheduled";
  if (card.validUntil && card.validUntil < today) return "expired";
  if (card.kind === "discount" && card.maxUses !== null && usage.uses >= card.maxUses) {
    return "used_up";
  }
  if (card.kind === "balance" && (card.amount ?? 0) - usage.spent <= 0) return "spent";
  return "active";
}

/** What a discount code takes off `price`: its percentage, or its amount up to the price. */
export function discountFor(card: Pick<GiftCard, "percent" | "amount">, price: number) {
  if (card.percent !== null) return Math.round((price * card.percent) / 100);
  return Math.min(card.amount ?? 0, price);
}

/** A card with how it was used, what it can do today and, for gift cards, what's left. */
export function giftCardView(card: GiftCard, usage: GiftCardUsage, business: Business) {
  return {
    ...card,
    uses: usage.uses,
    spent: usage.spent,
    remaining: card.kind === "balance" ? Math.max(0, (card.amount ?? 0) - usage.spent) : null,
    state: giftCardState(card, usage, todayIn(business.timezone)),
  };
}

/**
 * The card a customer or the counter typed, if it can be used now as `kind`. Anything else
 * reads as one error, with why in its fields, so codes can't be told apart by probing.
 */
export async function usableGiftCard(
  db: Queryable,
  business: Business,
  find: { code: string } | { id: string },
  kind: GiftCard["kind"],
) {
  const [card] = await db
    .select()
    .from(giftCards)
    .where(
      and(
        eq(giftCards.businessId, business.id),
        "code" in find
          ? eq(giftCards.code, find.code.trim().toUpperCase())
          : eq(giftCards.id, find.id),
      ),
    );
  if (!card || card.kind !== kind) {
    throw apiError(404, "gift_card_not_found", { code: "not_found" });
  }
  const usage = (await giftCardUsage(db, [card.id])).get(card.id) ?? { uses: 0, spent: 0 };
  const view = giftCardView(card, usage, business);
  if (view.state !== "active") throw apiError(409, "gift_card_unusable", { code: view.state });
  return view;
}
