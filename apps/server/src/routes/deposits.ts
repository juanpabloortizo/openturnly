import { depositSchema } from "@openturnly/core";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { appointments, customers, deposits, locations, sales } from "../db/schema.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";
import { resolveLocation } from "../lib/locations.ts";

const listQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  locationId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  appointmentId: z.string().min(1).optional(),
});

/** Money customers leave in advance ("abonos"), used up when their appointment is charged. */
export function depositRoutes({ db }: Deps) {
  const list = (businessId: string, filter: z.infer<typeof listQuery> & { id?: string }) =>
    db
      .select({
        id: deposits.id,
        amount: deposits.amount,
        method: deposits.method,
        note: deposits.note,
        status: deposits.status,
        createdAt: deposits.createdAt,
        voidedAt: deposits.voidedAt,
        appointmentId: deposits.appointmentId,
        appointmentCode: appointments.code,
        locationId: deposits.locationId,
        locationName: locations.name,
        appliedSale: { id: sales.id, number: sales.number },
        customer: {
          id: customers.id,
          firstName: customers.firstName,
          lastName: customers.lastName,
        },
      })
      .from(deposits)
      .innerJoin(customers, eq(customers.id, deposits.customerId))
      .leftJoin(appointments, eq(appointments.id, deposits.appointmentId))
      .leftJoin(locations, eq(locations.id, deposits.locationId))
      .leftJoin(sales, eq(sales.id, deposits.appliedSaleId))
      .where(
        and(
          eq(deposits.businessId, businessId),
          filter.id ? eq(deposits.id, filter.id) : undefined,
          filter.from ? gte(deposits.createdAt, new Date(filter.from)) : undefined,
          filter.to ? lt(deposits.createdAt, new Date(filter.to)) : undefined,
          filter.locationId ? eq(deposits.locationId, filter.locationId) : undefined,
          filter.customerId ? eq(deposits.customerId, filter.customerId) : undefined,
          filter.appointmentId ? eq(deposits.appointmentId, filter.appointmentId) : undefined,
        ),
      )
      .orderBy(desc(deposits.createdAt))
      .then((rows) =>
        rows.map((row) => ({ ...row, appliedSale: row.appliedSale?.id ? row.appliedSale : null })),
      );

  return (
    new Hono<BusinessEnv>()
      .get("/", async (c) => {
        const query = listQuery.safeParse(c.req.query());
        if (!query.success) throw apiError(400, "invalid_range");
        return c.json({ deposits: await list(c.get("business").id, query.data) });
      })

      .post("/", async (c) => {
        const businessId = c.get("business").id;
        const input = await parseBody(c, depositSchema);
        const [customer] = await db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.businessId, businessId), eq(customers.id, input.customerId)));
        if (!customer) throw apiError(404, "customer_not_found");
        let appointmentLocation: string | null = null;
        if (input.appointmentId) {
          const [appointment] = await db
            .select({ customerId: appointments.customerId, locationId: appointments.locationId })
            .from(appointments)
            .where(
              and(
                eq(appointments.businessId, businessId),
                eq(appointments.id, input.appointmentId),
              ),
            );
          if (!appointment || appointment.customerId !== input.customerId) {
            throw apiError(404, "appointment_not_found");
          }
          appointmentLocation = appointment.locationId;
        }
        const location = await resolveLocation(
          db,
          businessId,
          input.locationId ?? appointmentLocation,
          { forBooking: false },
        );
        const [created] = await db
          .insert(deposits)
          .values({
            businessId,
            customerId: input.customerId,
            appointmentId: input.appointmentId,
            locationId: location.id,
            amount: input.amount,
            method: input.method,
            note: input.note ?? null,
            createdBy: c.get("user")?.id ?? null,
          })
          .returning({ id: deposits.id });
        const [deposit] = await list(businessId, { id: created?.id });
        return c.json({ deposit }, 201);
      })

      /** Gives a deposit back: only while it hasn't paid for a sale. */
      .post("/:depositId/void", async (c) => {
        const businessId = c.get("business").id;
        const [current] = await db
          .select()
          .from(deposits)
          .where(
            and(eq(deposits.businessId, businessId), eq(deposits.id, c.req.param("depositId"))),
          );
        if (!current) throw apiError(404, "deposit_not_found");
        if (current.appliedSaleId) throw apiError(409, "deposit_used");
        await db
          .update(deposits)
          .set({ status: "void", voidedAt: new Date() })
          .where(eq(deposits.id, current.id));
        const [deposit] = await list(businessId, { id: current.id });
        return c.json({ deposit });
      })
  );
}
