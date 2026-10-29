import { productSchema } from "@openturnly/core";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { productStock, products, stockMovements } from "../db/schema.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { lockStock, moveStock } from "../lib/inventory.ts";
import { resolveLocation } from "../lib/locations.ts";

/** The products a business sells or uses, with their stock at each location. */
export function productRoutes({ db }: Deps) {
  const findProduct = async (businessId: string, productId: string) => {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.businessId, businessId), eq(products.id, productId)));
    if (!product) throw apiError(404, "product_not_found");
    return product;
  };

  const withStock = async (rows: (typeof products.$inferSelect)[]) => {
    const ids = rows.map((row) => row.id);
    const stock =
      ids.length > 0
        ? await db.select().from(productStock).where(inArray(productStock.productId, ids))
        : [];
    return rows.map((row) => ({
      ...row,
      /** Units by location id. */
      stock: Object.fromEntries(
        stock
          .filter((entry) => entry.productId === row.id)
          .map((entry) => [entry.locationId, entry.quantity]),
      ),
    }));
  };

  return (
    new Hono<BusinessEnv>()
      .get("/", async (c) => {
        const rows = await db
          .select()
          .from(products)
          .where(eq(products.businessId, c.get("business").id))
          .orderBy(asc(products.name));
        return c.json({ products: await withStock(rows) });
      })

      .post("/", async (c) => {
        const businessId = c.get("business").id;
        const { initialStock, locationId, ...input } = await parseBody(c, productSchema);
        const product = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(products)
            .values({ ...input, businessId })
            .returning();
          if (!created) throw apiError(500, "internal_error");
          if (initialStock) {
            const location = await resolveLocation(tx, businessId, locationId, {
              forBooking: false,
            });
            await lockStock(tx, businessId);
            await moveStock(tx, {
              businessId,
              productId: created.id,
              locationId: location.id,
              kind: "purchase",
              quantity: initialStock,
              unitCost: input.costAmount,
              createdBy: c.get("user")?.id ?? null,
            });
          }
          return created;
        });
        const [view] = await withStock([product]);
        return c.json({ product: view }, 201);
      })

      .patch("/:productId", async (c) => {
        const current = await findProduct(c.get("business").id, c.req.param("productId"));
        const {
          initialStock: _ignored,
          locationId: _unused,
          ...input
        } = await parseBody(c, productSchema.partial());
        const [product] =
          Object.keys(input).length > 0
            ? await db.update(products).set(input).where(eq(products.id, current.id)).returning()
            : [current];
        const [view] = await withStock(product ? [product] : []);
        return c.json({ product: view });
      })

      /** Only products that never moved: the others keep their history and are turned off. */
      .delete("/:productId", async (c) => {
        const product = await findProduct(c.get("business").id, c.req.param("productId"));
        const [moved] = await db
          .select({ total: count() })
          .from(stockMovements)
          .where(eq(stockMovements.productId, product.id));
        if ((moved?.total ?? 0) > 0) throw apiError(409, "product_in_use");
        await db.delete(products).where(eq(products.id, product.id));
        return c.body(null, 204);
      })
  );
}
