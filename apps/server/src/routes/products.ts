import {
  missingContentField,
  type ProductInput,
  productImportSchema,
  productSchema,
  productUpdateSchema,
} from "@openturnly/core";
import { and, asc, count, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client.ts";
import { locations, productStock, products, stockMovements } from "../db/schema.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { findAttribute, lockStock, moveStock } from "../lib/inventory.ts";
import { importProducts } from "../lib/product-import.ts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The products a business sells or uses, with their stock and alarms at each location. */
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
    return rows.map((row) => {
      const own = stock.filter((entry) => entry.productId === row.id);
      return {
        ...row,
        /** Units by location id. */
        stock: Object.fromEntries(own.map((entry) => [entry.locationId, entry.quantity])),
        /** Where a warning shows, by location id: at this many units or fewer. */
        alerts: Object.fromEntries(
          own.flatMap((entry) =>
            entry.alertAt === null ? [] : [[entry.locationId, entry.alertAt]],
          ),
        ),
      };
    });
  };

  /** The category and brand must be entries of this business's lists. */
  const checkLists = async (businessId: string, input: Partial<ProductInput>) => {
    for (const [field, kind] of [
      ["categoryId", "category"],
      ["brandId", "brand"],
    ] as const) {
      const id = input[field];
      if (id && !(await findAttribute(db, businessId, kind, id))) {
        throw apiError(400, "attribute_not_found", { [field]: "attribute_not_found" });
      }
    }
  };

  /** Only this business's locations. */
  const checkLocations = async (businessId: string, ids: string[]) => {
    if (ids.length === 0) return;
    const own = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.businessId, businessId), inArray(locations.id, ids)));
    if (own.length !== new Set(ids).size) throw apiError(404, "location_not_found");
  };

  const saveAlerts = async (
    tx: Tx,
    productId: string,
    alerts: { locationId: string; alertAt: number | null }[],
  ) => {
    for (const { locationId, alertAt } of alerts) {
      // No alarm where the product never was doesn't need a row of its own.
      if (alertAt === null) {
        await tx
          .update(productStock)
          .set({ alertAt: null })
          .where(
            and(eq(productStock.productId, productId), eq(productStock.locationId, locationId)),
          );
        continue;
      }
      await tx
        .insert(productStock)
        .values({ productId, locationId, quantity: 0, alertAt })
        .onConflictDoUpdate({
          target: [productStock.productId, productStock.locationId],
          set: { alertAt },
        });
    }
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

      /** How many active products are at or under their alarm somewhere, for the menu. */
      .get("/low-stock", async (c) => {
        const [row] = await db
          .select({ total: sql<number>`count(distinct ${products.id})`.mapWith(Number) })
          .from(productStock)
          .innerJoin(products, eq(products.id, productStock.productId))
          .where(
            and(
              eq(products.businessId, c.get("business").id),
              eq(products.active, true),
              isNotNull(productStock.alertAt),
              lte(productStock.quantity, productStock.alertAt),
            ),
          );
        return c.json({ count: row?.total ?? 0 });
      })

      .post("/", async (c) => {
        const businessId = c.get("business").id;
        const { initialStock = [], alerts = [], ...input } = await parseBody(c, productSchema);
        await checkLists(businessId, input);
        await checkLocations(businessId, [
          ...initialStock.map((entry) => entry.locationId),
          ...alerts.map((entry) => entry.locationId),
        ]);
        const product = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(products)
            .values({ ...input, businessId })
            .returning();
          if (!created) throw apiError(500, "internal_error");
          const counted = initialStock.filter((entry) => entry.quantity > 0);
          if (counted.length > 0) await lockStock(tx, businessId);
          for (const entry of counted) {
            await moveStock(tx, {
              businessId,
              productId: created.id,
              locationId: entry.locationId,
              kind: "purchase",
              quantity: entry.quantity,
              unitCost: input.costAmount,
              createdBy: c.get("user")?.id ?? null,
            });
          }
          await saveAlerts(tx, created.id, alerts);
          return created;
        });
        const [view] = await withStock([product]);
        return c.json({ product: view }, 201);
      })

      .patch("/:productId", async (c) => {
        const businessId = c.get("business").id;
        const current = await findProduct(businessId, c.req.param("productId"));
        const parsed = await parseBody(c, productUpdateSchema);
        // Only what was sent: the schema's defaults would reset everything else.
        const sent: Record<string, unknown> = await c.req.json();
        const body = Object.fromEntries(
          Object.entries(parsed).filter(([field]) => field in sent),
        ) as typeof parsed;
        const { initialStock: _ignored, alerts, ...input } = body;
        await checkLists(businessId, input);
        await checkLocations(
          businessId,
          (alerts ?? []).map((entry) => entry.locationId),
        );
        const commissionType = input.commissionType ?? current.commissionType;
        const commissionValue =
          input.commissionValue !== undefined ? input.commissionValue : current.commissionValue;
        if (commissionType === "percent" && commissionValue !== null && commissionValue > 100) {
          throw apiError(400, "validation_failed", { commissionValue: "too_big" });
        }
        const missing = missingContentField({
          content: input.content !== undefined ? input.content : current.content,
          unit: input.unit !== undefined ? input.unit : current.unit,
        });
        if (missing) throw apiError(400, "validation_failed", { [missing]: "required" });
        const product = await db.transaction(async (tx) => {
          const [updated] =
            Object.keys(input).length > 0
              ? await tx
                  .update(products)
                  .set({ ...input, updatedAt: new Date() })
                  .where(eq(products.id, current.id))
                  .returning()
              : [current];
          if (alerts) await saveAlerts(tx, current.id, alerts);
          return updated ?? current;
        });
        const [view] = await withStock([product]);
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

      /**
       * Products from a spreadsheet: a preview of what would be created or updated, or (with
       * `apply`) the upload itself. Results come back row by row.
       */
      .post("/import", async (c) => {
        const input = await parseBody(c, productImportSchema);
        const result = await importProducts(db, c.get("business"), input, c.get("user")?.id);
        return c.json(result);
      })
  );
}
