import { customerAdminSchema, customerPatchSchema } from "@openturnly/core";
import { and, asc, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { appointments, customers, deposits, sales } from "../db/schema.ts";
import { apiError, type BusinessEnv, type Deps, parseBody } from "../lib/http.ts";

/**
 * The business's customers ("Clientes"). They are created by bookings (matched by mobile
 * number, then email) or added by hand, and keep their appointment history.
 */
const mergeSchema = z.object({ intoId: z.string().min(1) });

export function customerRoutes({ db }: Deps) {
  const findCustomer = async (businessId: string, customerId: string) => {
    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.businessId, businessId), eq(customers.id, customerId)));
    if (!customer) throw apiError(404, "customer_not_found");
    return customer;
  };

  /** A phone or email already used by another customer of the business is a duplicate. */
  const assertContactFree = async (
    businessId: string,
    contact: { phone?: string | null; email?: string | null },
    exceptId?: string,
  ) => {
    for (const field of ["phone", "email"] as const) {
      const value = contact[field];
      if (!value) continue;
      const [taken] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.businessId, businessId),
            eq(customers[field], value),
            exceptId ? ne(customers.id, exceptId) : undefined,
          ),
        );
      if (taken) throw apiError(409, "customer_exists", { [field]: "customer_exists" });
    }
  };

  const confirmed = sql`${appointments.status} = 'confirmed'`;

  return (
    new Hono<BusinessEnv>()
      /**
       * All customers with their visit counts, or with `?q=` the first matches by name,
       * phone or email (what the new-appointment form uses). Professionals can only search.
       */
      .get("/", async (c) => {
        const q = (c.req.query("q") ?? "").trim();
        if (c.get("access").role === "professional" && q.length < 2) {
          return c.json({ customers: [] });
        }
        const pattern = `%${q.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
        const digits = q.replace(/\D/g, "");
        const search = q
          ? or(
              sql`(${customers.firstName} || ' ' || ${customers.lastName}) ilike ${pattern}`,
              ilike(customers.email, pattern),
              digits.length >= 3 ? ilike(customers.phone, `%${digits}%`) : undefined,
            )
          : undefined;
        const rows = await db
          .select({
            id: customers.id,
            firstName: customers.firstName,
            lastName: customers.lastName,
            email: customers.email,
            phone: customers.phone,
            createdAt: customers.createdAt,
            visits: sql<number>`count(${appointments.id}) filter (where ${confirmed})`.mapWith(
              Number,
            ),
            lastVisit:
              sql<Date | null>`max(${appointments.startsAt}) filter (where ${confirmed} and ${appointments.startsAt} <= now())`.mapWith(
                appointments.startsAt,
              ),
            nextVisit:
              sql<Date | null>`min(${appointments.startsAt}) filter (where ${confirmed} and ${appointments.startsAt} > now())`.mapWith(
                appointments.startsAt,
              ),
          })
          .from(customers)
          .leftJoin(appointments, eq(appointments.customerId, customers.id))
          .where(and(eq(customers.businessId, c.get("business").id), search))
          .groupBy(customers.id)
          .orderBy(asc(customers.firstName), asc(customers.lastName))
          .limit(q ? 20 : 10_000);
        return c.json({ customers: rows });
      })

      .get("/:customerId", async (c) => {
        const customer = await findCustomer(c.get("business").id, c.req.param("customerId"));
        const history = await db
          .select({
            id: appointments.id,
            code: appointments.code,
            startsAt: appointments.startsAt,
            endsAt: appointments.endsAt,
            status: appointments.status,
            serviceName: appointments.serviceName,
            resourceName: appointments.resourceName,
            priceAmount: appointments.priceAmount,
            answers: appointments.answers,
            source: appointments.source,
          })
          .from(appointments)
          .where(eq(appointments.customerId, customer.id))
          .orderBy(desc(appointments.startsAt));
        return c.json({ customer, appointments: history });
      })

      .post("/", async (c) => {
        const businessId = c.get("business").id;
        const input = await parseBody(c, customerAdminSchema);
        await assertContactFree(businessId, input);
        const [customer] = await db
          .insert(customers)
          .values({ ...input, businessId })
          .returning();
        return c.json({ customer }, 201);
      })

      .patch("/:customerId", async (c) => {
        const businessId = c.get("business").id;
        const current = await findCustomer(businessId, c.req.param("customerId"));
        const input = await parseBody(c, customerPatchSchema);
        const phone = input.phone === undefined ? current.phone : input.phone;
        const email = input.email === undefined ? current.email : input.email;
        if (!phone && !email) {
          throw apiError(400, "validation_failed", { phone: "contact_required" });
        }
        await assertContactFree(businessId, input, current.id);
        const [customer] = await db
          .update(customers)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(customers.id, current.id))
          .returning();
        return c.json({ customer });
      })

      /**
       * Joins a duplicate into another customer: its appointments move over, missing contact
       * details and notes are kept, and the duplicate is removed.
       */
      .post("/:customerId/merge", async (c) => {
        const businessId = c.get("business").id;
        const source = await findCustomer(businessId, c.req.param("customerId"));
        const { intoId } = await parseBody(c, mergeSchema);
        if (intoId === source.id)
          throw apiError(400, "validation_failed", { intoId: "invalid_value" });
        const target = await findCustomer(businessId, intoId);
        const customer = await db.transaction(async (tx) => {
          await tx
            .update(appointments)
            .set({ customerId: target.id })
            .where(eq(appointments.customerId, source.id));
          await tx
            .update(sales)
            .set({ customerId: target.id })
            .where(eq(sales.customerId, source.id));
          await tx
            .update(deposits)
            .set({ customerId: target.id })
            .where(eq(deposits.customerId, source.id));
          await tx.delete(customers).where(eq(customers.id, source.id));
          const notes = [target.notes, source.notes].filter(Boolean).join("\n\n") || null;
          const [merged] = await tx
            .update(customers)
            .set({
              phone: target.phone ?? source.phone,
              email: target.email ?? source.email,
              notes,
              updatedAt: new Date(),
            })
            .where(eq(customers.id, target.id))
            .returning();
          return merged;
        });
        return c.json({ customer });
      })

      .delete("/:customerId", async (c) => {
        // Their appointments go too (data protection requests ask for exactly that).
        const current = await findCustomer(c.get("business").id, c.req.param("customerId"));
        await db.delete(customers).where(eq(customers.id, current.id));
        return c.body(null, 204);
      })
  );
}
