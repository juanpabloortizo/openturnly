import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { type Customer, customers } from "../db/schema.ts";

type Contact = { phone: string | null; email: string | null };
type Tx = Pick<Db, "select" | "insert" | "update">;

/**
 * Who is booking, if they booked before. The mobile number is the main key (stored in
 * E.164, so spacing or a missing country code never creates a second customer), then the
 * email. When the number matches one customer and the email another, the number wins.
 */
export async function matchCustomer(
  db: Pick<Db, "select">,
  businessId: string,
  { phone, email }: Contact,
): Promise<{ customer: Customer | null; emailOwner: Customer | null }> {
  const [byPhone] = phone
    ? await db
        .select()
        .from(customers)
        .where(and(eq(customers.businessId, businessId), eq(customers.phone, phone)))
        .orderBy(asc(customers.createdAt))
        .limit(1)
    : [];
  const [byEmail] = email
    ? await db
        .select()
        .from(customers)
        .where(and(eq(customers.businessId, businessId), eq(customers.email, email)))
    : [];
  return { customer: byPhone ?? byEmail ?? null, emailOwner: byEmail ?? null };
}

/**
 * The customer record for a booking: the matched one, or a new one. A booking only fills
 * in what the record is missing; names and details the business already has (and may have
 * corrected) are never overwritten.
 */
export async function saveBookingCustomer(
  tx: Tx,
  businessId: string,
  match: Awaited<ReturnType<typeof matchCustomer>>,
  details: Contact & { firstName: string; lastName: string },
): Promise<string> {
  const { customer, emailOwner } = match;
  if (!customer) {
    const [created] = await tx
      .insert(customers)
      .values({ ...details, businessId })
      .returning({ id: customers.id });
    if (!created) throw new Error("customer insert returned nothing");
    return created.id;
  }
  const missing: Partial<Contact> = {};
  if (!customer.phone && details.phone) missing.phone = details.phone;
  // Emails are unique per business: only take it if nobody else has it.
  if (!customer.email && details.email && !emailOwner) missing.email = details.email;
  if (Object.keys(missing).length > 0) {
    await tx
      .update(customers)
      .set({ ...missing, updatedAt: new Date() })
      .where(eq(customers.id, customer.id));
  }
  return customer.id;
}
