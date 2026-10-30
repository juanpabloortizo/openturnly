import { STOCK_MOVEMENT_KINDS, stockMovementSchema } from "@openturnly/core";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { locations, products, sales, stockMovements, users } from "../db/schema.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { lockStock, moveStock, stockAt } from "../lib/inventory.ts";
import { resolveLocation } from "../lib/locations.ts";

const listQuery = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  locationId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  kind: z.enum(STOCK_MOVEMENT_KINDS).optional(),
});

/** Stock movements: the inventory's history, and moving stock by hand. */
export function stockRoutes({ db }: Deps) {
  return new Hono<BusinessEnv>()
    .get("/", async (c) => {
      const query = listQuery.safeParse(c.req.query());
      if (!query.success) throw apiError(400, "invalid_range");
      const { from, to, locationId, productId, kind } = query.data;
      const rows = await db
        .select({
          id: stockMovements.id,
          kind: stockMovements.kind,
          quantity: stockMovements.quantity,
          balanceAfter: stockMovements.balanceAfter,
          unitCost: stockMovements.unitCost,
          note: stockMovements.note,
          createdAt: stockMovements.createdAt,
          transferId: stockMovements.transferId,
          productId: stockMovements.productId,
          productName: products.name,
          locationId: stockMovements.locationId,
          locationName: locations.name,
          sale: { id: sales.id, number: sales.number },
          createdByName: users.name,
        })
        .from(stockMovements)
        .innerJoin(products, eq(products.id, stockMovements.productId))
        .innerJoin(locations, eq(locations.id, stockMovements.locationId))
        .leftJoin(sales, eq(sales.id, stockMovements.saleId))
        .leftJoin(users, eq(users.id, stockMovements.createdBy))
        .where(
          and(
            eq(stockMovements.businessId, c.get("business").id),
            gte(stockMovements.createdAt, new Date(from)),
            lt(stockMovements.createdAt, new Date(to)),
            locationId ? eq(stockMovements.locationId, locationId) : undefined,
            productId ? eq(stockMovements.productId, productId) : undefined,
            kind ? eq(stockMovements.kind, kind) : undefined,
          ),
        )
        .orderBy(desc(stockMovements.createdAt));
      return c.json({
        movements: rows.map((row) => ({ ...row, sale: row.sale?.id ? row.sale : null })),
      });
    })

    .post("/", async (c) => {
      const businessId = c.get("business").id;
      const input = await parseBody(c, stockMovementSchema);
      const [product] = await db
        .select({ id: products.id, costAmount: products.costAmount })
        .from(products)
        .where(and(eq(products.businessId, businessId), eq(products.id, input.productId)));
      if (!product) throw apiError(404, "product_not_found");
      const balance = await db.transaction(async (tx) => {
        const location = await resolveLocation(tx, businessId, input.locationId, {
          forBooking: false,
        });
        await lockStock(tx, businessId);
        const base = {
          businessId,
          productId: product.id,
          note: input.note ?? null,
          createdBy: c.get("user")?.id ?? null,
        };
        switch (input.kind) {
          case "purchase":
            return moveStock(tx, {
              ...base,
              locationId: location.id,
              kind: "purchase",
              quantity: input.quantity,
              unitCost: input.unitCost ?? product.costAmount,
            });
          case "internal":
            return moveStock(tx, {
              ...base,
              locationId: location.id,
              kind: "internal",
              quantity: -input.quantity,
            });
          case "adjustment": {
            // A count: the stock becomes what was counted.
            const current = await stockAt(tx, product.id, location.id);
            if (current === input.quantity) throw apiError(409, "stock_unchanged");
            return moveStock(tx, {
              ...base,
              locationId: location.id,
              kind: "adjustment",
              quantity: input.quantity - current,
            });
          }
          case "transfer": {
            const target = await resolveLocation(tx, businessId, input.toLocationId, {
              forBooking: false,
            });
            const transferId = crypto.randomUUID();
            await moveStock(tx, {
              ...base,
              locationId: target.id,
              kind: "transfer_in",
              quantity: input.quantity,
              transferId,
            });
            return moveStock(tx, {
              ...base,
              locationId: location.id,
              kind: "transfer_out",
              quantity: -input.quantity,
              transferId,
            });
          }
        }
      });
      return c.json({ balance }, 201);
    });
}
