import { saleSchema } from "@openturnly/core";
import { Hono } from "hono";
import { z } from "zod";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { createSale, loadSales, voidSale } from "../lib/sales.ts";

const rangeQuery = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  locationId: z.string().min(1).optional(),
});

/** Longest period one request can cover: enough for a yearly export. */
const MAX_RANGE_MS = 400 * 24 * 60 * 60 * 1000;

/** What the business charged: appointments, products… with how each sale was paid. */
export function saleRoutes({ db }: Deps) {
  const findSale = async (businessId: string, saleId: string) => {
    const [sale] = await loadSales(db, businessId, { saleId });
    if (!sale) throw apiError(404, "sale_not_found");
    return sale;
  };

  return new Hono<BusinessEnv>()
    .get("/", async (c) => {
      const query = rangeQuery.safeParse(c.req.query());
      if (!query.success) throw apiError(400, "invalid_range");
      const from = new Date(query.data.from);
      const to = new Date(query.data.to);
      if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
        throw apiError(400, "invalid_range");
      }
      const list = await loadSales(db, c.get("business").id, {
        from,
        to,
        locationId: query.data.locationId,
      });
      return c.json({ sales: list });
    })

    .get("/:saleId", async (c) =>
      c.json({ sale: await findSale(c.get("business").id, c.req.param("saleId")) }),
    )

    .post("/", async (c) => {
      const business = c.get("business");
      const input = await parseBody(c, saleSchema);
      const user = c.get("user");
      const saleId = await createSale(db, business, input, user?.id ?? null);
      return c.json({ sale: await findSale(business.id, saleId) }, 201);
    })

    .post("/:saleId/void", async (c) => {
      const businessId = c.get("business").id;
      await voidSale(db, businessId, c.req.param("saleId"));
      return c.json({ sale: await findSale(businessId, c.req.param("saleId")) });
    });
}
