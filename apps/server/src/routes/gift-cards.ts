import { giftCardPatchSchema, giftCardSchema, giftCodeSchema } from "@openturnly/core";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  customers,
  type GiftCard,
  giftCards,
  saleItems,
  salePayments,
  sales,
} from "../db/schema.ts";
import { giftCardUsage, giftCardView } from "../lib/gift-cards.ts";
import { apiError, type BusinessEnv, type Deps, parseBody, validateWith } from "../lib/http.ts";
import { resolveLocation } from "../lib/locations.ts";
import { lockSales, nextSaleNumber } from "../lib/sales.ts";

/** Discount codes and gift cards with a balance, with how much each was used. */
export function giftCardRoutes({ db }: Deps) {
  const list = async (businessId: string, where?: { id?: string; code?: string }) => {
    const rows = await db
      .select({
        card: giftCards,
        customer: {
          id: customers.id,
          firstName: customers.firstName,
          lastName: customers.lastName,
        },
      })
      .from(giftCards)
      .leftJoin(customers, eq(customers.id, giftCards.customerId))
      .where(
        and(
          eq(giftCards.businessId, businessId),
          where?.id ? eq(giftCards.id, where.id) : undefined,
          where?.code ? eq(giftCards.code, where.code) : undefined,
        ),
      )
      .orderBy(desc(giftCards.createdAt));
    return rows;
  };

  const withUsage = async (
    business: BusinessEnv["Variables"]["business"],
    rows: Awaited<ReturnType<typeof list>>,
  ) => {
    const usage = await giftCardUsage(
      db,
      rows.map((row) => row.card.id),
    );
    return rows.map((row) => ({
      ...giftCardView(row.card, usage.get(row.card.id) ?? { uses: 0, spent: 0 }, business),
      customer: row.customer?.id ? row.customer : null,
    }));
  };

  const findCard = async (businessId: string, id: string): Promise<GiftCard> => {
    const [card] = await db
      .select()
      .from(giftCards)
      .where(and(eq(giftCards.businessId, businessId), eq(giftCards.id, id)));
    if (!card) throw apiError(404, "gift_card_not_found");
    return card;
  };

  return (
    new Hono<BusinessEnv>()
      .get("/", async (c) => {
        const business = c.get("business");
        return c.json({ giftCards: await withUsage(business, await list(business.id)) });
      })

      /** A card by the code someone typed at the counter, whatever its state. */
      .get("/lookup", async (c) => {
        const business = c.get("business");
        const code = validateWith(giftCodeSchema, c.req.query("code") ?? "");
        const [card] = await withUsage(business, await list(business.id, { code }));
        if (!card) throw apiError(404, "gift_card_not_found");
        return c.json({ giftCard: card });
      })

      .post("/", async (c) => {
        const business = c.get("business");
        const input = await parseBody(c, giftCardSchema);
        if (input.customerId) {
          const [customer] = await db
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.businessId, business.id), eq(customers.id, input.customerId)));
          if (!customer) throw apiError(404, "customer_not_found");
        }
        const id = await db.transaction(async (tx) => {
          await lockSales(tx, business.id);
          const [taken] = await tx
            .select({ id: giftCards.id })
            .from(giftCards)
            .where(and(eq(giftCards.businessId, business.id), eq(giftCards.code, input.code)));
          if (taken) throw apiError(409, "code_taken", { code: "code_taken" });
          const [card] = await tx
            .insert(giftCards)
            .values({
              businessId: business.id,
              code: input.code,
              kind: input.kind,
              percent: input.kind === "discount" ? input.percent : null,
              amount: input.amount,
              maxUses: input.kind === "discount" ? input.maxUses : null,
              validFrom: input.validFrom,
              validUntil: input.validUntil,
              customerId: input.customerId,
              note: input.note ?? null,
              createdBy: c.get("user")?.id ?? null,
            })
            .returning({ id: giftCards.id });
          if (!card) throw apiError(500, "internal_error");
          // A gift card sold is a sale like any other: it shows in Sales and the cash register.
          if (input.kind === "balance" && input.paidWith) {
            const location = await resolveLocation(tx, business.id, input.locationId, {
              forBooking: false,
            });
            const [sale] = await tx
              .insert(sales)
              .values({
                businessId: business.id,
                locationId: location.id,
                number: await nextSaleNumber(tx, business.id),
                customerId: input.customerId,
                subtotal: input.amount,
                total: input.amount,
                soldBy: c.get("user")?.id ?? null,
              })
              .returning({ id: sales.id });
            if (!sale) throw apiError(500, "internal_error");
            await tx.insert(saleItems).values({
              saleId: sale.id,
              kind: "gift_card",
              giftCardId: card.id,
              name: `Gift card ${input.code}`,
              unitPrice: input.amount,
              total: input.amount,
            });
            await tx
              .insert(salePayments)
              .values({ saleId: sale.id, method: input.paidWith, amount: input.amount });
          }
          return card.id;
        });
        const [giftCard] = await withUsage(business, await list(business.id, { id }));
        return c.json({ giftCard }, 201);
      })

      .patch("/:giftCardId", async (c) => {
        const business = c.get("business");
        const current = await findCard(business.id, c.req.param("giftCardId"));
        const input = await parseBody(c, giftCardPatchSchema);
        const validFrom = input.validFrom !== undefined ? input.validFrom : current.validFrom;
        const validUntil = input.validUntil !== undefined ? input.validUntil : current.validUntil;
        if (validFrom && validUntil && validFrom > validUntil) {
          throw apiError(400, "validation_failed", { validUntil: "end_before_start" });
        }
        await db
          .update(giftCards)
          .set({
            ...input,
            ...(current.kind === "balance" ? { maxUses: null } : {}),
          })
          .where(eq(giftCards.id, current.id));
        const [giftCard] = await withUsage(business, await list(business.id, { id: current.id }));
        return c.json({ giftCard });
      })

      /** Only cards nobody used, and not sold: otherwise turn them off. */
      .delete("/:giftCardId", async (c) => {
        const business = c.get("business");
        const card = await findCard(business.id, c.req.param("giftCardId"));
        const usage = (await giftCardUsage(db, [card.id])).get(card.id);
        const [sold] = await db
          .select({ id: saleItems.id })
          .from(saleItems)
          .where(eq(saleItems.giftCardId, card.id))
          .limit(1);
        if ((usage?.uses ?? 0) > 0 || (usage?.spent ?? 0) > 0 || sold) {
          throw apiError(409, "gift_card_in_use");
        }
        await db.delete(giftCards).where(eq(giftCards.id, card.id));
        return c.body(null, 204);
      })
  );
}
