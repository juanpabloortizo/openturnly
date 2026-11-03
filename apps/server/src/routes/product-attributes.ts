import { productAttributeSchema } from "@openturnly/core";
import { and, asc, count, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { productAttributes, products } from "../db/schema.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { sameAttribute } from "../lib/inventory.ts";

/**
 * The business's lists of categories and brands. An entry that's the same as
 * another (case, accents, spaces) is refused, so the existing one gets used instead.
 */
export function productAttributeRoutes({ db }: Deps) {
  const findOwn = async (businessId: string, id: string) => {
    const [attribute] = await db
      .select()
      .from(productAttributes)
      .where(and(eq(productAttributes.businessId, businessId), eq(productAttributes.id, id)));
    if (!attribute) throw apiError(404, "attribute_not_found");
    return attribute;
  };
  const usedBy = (id: string) => or(eq(products.categoryId, id), eq(products.brandId, id));
  const duplicate = () => apiError(409, "attribute_exists", { name: "attribute_exists" });

  return (
    new Hono<BusinessEnv>()
      /** Every entry, with how many products use it. */
      .get("/", async (c) => {
        const businessId = c.get("business").id;
        const [rows, uses] = await Promise.all([
          db
            .select()
            .from(productAttributes)
            .where(eq(productAttributes.businessId, businessId))
            .orderBy(asc(productAttributes.name)),
          Promise.all(
            (["categoryId", "brandId"] as const).map((column) =>
              db
                .select({ id: products[column], total: count() })
                .from(products)
                .where(eq(products.businessId, businessId))
                .groupBy(products[column]),
            ),
          ),
        ]);
        const counts = new Map(uses.flat().map((row) => [row.id, row.total]));
        return c.json({
          attributes: rows.map(({ key: _key, businessId: _business, ...attribute }) => ({
            ...attribute,
            products: counts.get(attribute.id) ?? 0,
          })),
        });
      })

      .post("/", async (c) => {
        const businessId = c.get("business").id;
        const input = await parseBody(c, productAttributeSchema);
        const { key, attribute: existing } = await sameAttribute(db, businessId, input);
        if (existing) throw duplicate();
        const [attribute] = await db
          .insert(productAttributes)
          .values({ businessId, kind: input.kind, name: input.name, key })
          .returning();
        if (!attribute) throw apiError(500, "internal_error");
        const { key: _key, businessId: _business, ...view } = attribute;
        return c.json({ attribute: { ...view, products: 0 } }, 201);
      })

      /** Renames it, for every product that uses it. */
      .patch("/:id", async (c) => {
        const businessId = c.get("business").id;
        const current = await findOwn(businessId, c.req.param("id"));
        const input = await parseBody(c, productAttributeSchema);
        if (input.kind !== current.kind) throw apiError(400, "invalid_kind");
        const { key, attribute: existing } = await sameAttribute(db, businessId, input);
        if (existing && existing.id !== current.id) throw duplicate();
        const [attribute] = await db
          .update(productAttributes)
          .set({ name: input.name, key })
          .where(eq(productAttributes.id, current.id))
          .returning();
        if (!attribute) throw apiError(404, "attribute_not_found");
        const [used] = await db.select({ total: count() }).from(products).where(usedBy(current.id));
        const { key: _key, businessId: _business, ...view } = attribute;
        return c.json({ attribute: { ...view, products: used?.total ?? 0 } });
      })

      /** Only entries no product uses. */
      .delete("/:id", async (c) => {
        const attribute = await findOwn(c.get("business").id, c.req.param("id"));
        const [used] = await db
          .select({ total: count() })
          .from(products)
          .where(usedBy(attribute.id));
        if ((used?.total ?? 0) > 0) throw apiError(409, "attribute_in_use");
        await db.delete(productAttributes).where(eq(productAttributes.id, attribute.id));
        return c.body(null, 204);
      })
  );
}
