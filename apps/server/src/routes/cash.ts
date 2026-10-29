import { cashMovementSchema } from "@openturnly/core";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { cashMovements } from "../db/schema.ts";
import { cashInDrawer, cashReport } from "../lib/cash.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { resolveLocation } from "../lib/locations.ts";

const rangeQuery = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  locationId: z.string().min(1).optional(),
});

/** Longest period one request can cover: enough for a yearly report. */
const MAX_RANGE_MS = 400 * 24 * 60 * 60 * 1000;

/** The cash register: money in and out per location and period, and the cash in the drawer. */
export function cashRoutes({ db }: Deps) {
  return (
    new Hono<BusinessEnv>()
      .get("/", async (c) => {
        const businessId = c.get("business").id;
        const query = rangeQuery.safeParse(c.req.query());
        if (!query.success) throw apiError(400, "invalid_range");
        const from = new Date(query.data.from);
        const to = new Date(query.data.to);
        if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
          throw apiError(400, "invalid_range");
        }
        const { locationId } = query.data;
        const [report, drawer] = await Promise.all([
          cashReport(db, { businessId, locationId, from, to }),
          cashInDrawer(db, businessId, locationId),
        ]);
        return c.json({ ...report, cashInDrawer: drawer });
      })

      .post("/movements", async (c) => {
        const businessId = c.get("business").id;
        const input = await parseBody(c, cashMovementSchema);
        const createdBy = c.get("user")?.id ?? null;
        await db.transaction(async (tx) => {
          const location = await resolveLocation(tx, businessId, input.locationId, {
            forBooking: false,
          });
          const base = { businessId, locationId: location.id, createdBy };
          if (input.kind === "income" || input.kind === "expense") {
            await tx.insert(cashMovements).values({
              ...base,
              kind: input.kind,
              amount: input.amount,
              method: input.method,
              category: input.category ?? null,
              description: input.description ?? null,
            });
          } else if (input.kind === "transfer") {
            // Out of this drawer, into another location's when there is one.
            const transferId = crypto.randomUUID();
            const target = input.toLocationId
              ? await resolveLocation(tx, businessId, input.toLocationId, { forBooking: false })
              : null;
            if (target?.id === location.id) {
              throw apiError(400, "validation_failed", { toLocationId: "same_location" });
            }
            await tx.insert(cashMovements).values({
              ...base,
              kind: "transfer_out",
              amount: input.amount,
              description: input.description ?? null,
              transferId,
            });
            if (target) {
              await tx.insert(cashMovements).values({
                ...base,
                locationId: target.id,
                kind: "transfer_in",
                amount: input.amount,
                description: input.description ?? null,
                transferId,
              });
            }
          } else if (input.kind === "adjustment") {
            // What was counted becomes the cash in the register.
            const expected = await cashInDrawer(tx, businessId, location.id);
            if (input.counted === expected) throw apiError(409, "cash_unchanged");
            await tx.insert(cashMovements).values({
              ...base,
              kind: "adjustment",
              amount: input.counted - expected,
              description: input.description ?? null,
            });
          }
        });
        return c.json({ cashInDrawer: await cashInDrawer(db, businessId, input.locationId) }, 201);
      })

      /** Undoes a movement entered by mistake; both halves of a transfer go together. */
      .delete("/movements/:movementId", async (c) => {
        const businessId = c.get("business").id;
        const [movement] = await db
          .select()
          .from(cashMovements)
          .where(
            and(
              eq(cashMovements.businessId, businessId),
              eq(cashMovements.id, c.req.param("movementId")),
            ),
          );
        if (!movement) throw apiError(404, "movement_not_found");
        await db
          .delete(cashMovements)
          .where(
            movement.transferId
              ? and(
                  eq(cashMovements.businessId, businessId),
                  eq(cashMovements.transferId, movement.transferId),
                )
              : eq(cashMovements.id, movement.id),
          );
        return c.body(null, 204);
      })
  );
}
