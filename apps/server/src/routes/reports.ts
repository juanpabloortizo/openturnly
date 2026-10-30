import { isDateString } from "@openturnly/core";
import { Hono } from "hono";
import { z } from "zod";
import { apiError, type BusinessEnv, type Deps } from "../lib/http.ts";
import { commissionsReport, summaryReport, tipsReport } from "../lib/reports.ts";

const periodQuery = z
  .object({
    from: z.string().refine(isDateString),
    to: z.string().refine(isDateString),
    locationId: z.string().min(1).optional(),
    resourceId: z.string().min(1).optional(),
  })
  .refine((query) => query.from <= query.to);

/** Longest period one report covers: a bit over a year. */
const MAX_DAYS = 400;

/** Reports for the business's admins: summary, tips and commissions over a period. */
export function reportRoutes({ db }: Deps) {
  const parse = (query: Record<string, string>) => {
    const result = periodQuery.safeParse(query);
    if (!result.success) throw apiError(400, "invalid_range");
    const { from, to } = result.data;
    if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > MAX_DAYS * 86_400_000) {
      throw apiError(400, "invalid_range");
    }
    return result.data;
  };

  return new Hono<BusinessEnv>()
    .get("/summary", async (c) => {
      const { from, to, locationId } = parse(c.req.query());
      return c.json(await summaryReport(db, c.get("business"), { from, to }, locationId));
    })
    .get("/tips", async (c) => {
      const { from, to, locationId, resourceId } = parse(c.req.query());
      return c.json(
        await tipsReport(db, c.get("business"), { from, to }, { locationId, resourceId }),
      );
    })
    .get("/commissions", async (c) => {
      const { from, to, locationId } = parse(c.req.query());
      return c.json(await commissionsReport(db, c.get("business"), { from, to }, locationId));
    });
}
