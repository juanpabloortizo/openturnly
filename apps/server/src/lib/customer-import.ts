import { type customerImportSchema, importedCustomerSchema } from "@openturnly/core";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/client.ts";
import { type Business, type Customer, customers } from "../db/schema.ts";
import { newCustomerShortId } from "./codes.ts";
import { matchCustomer } from "./customers.ts";
import { businessCountry } from "./holidays.ts";

type ImportInput = z.output<typeof customerImportSchema>;

export type ImportResult = {
  /** Index of the row in the file's data (0 = first row after the headers). */
  row: number;
  status: "created" | "updated" | "unchanged" | "skipped" | "error";
  /** For errors: what's wrong ("invalid_phone", "contact_required"…). */
  error?: string;
  /** For updates: the email was left as it was, another customer has it. */
  warning?: "email_taken";
};

/** Thrown to roll a preview back once its results are known. */
class Preview extends Error {
  readonly results: ImportResult[];
  constructor(results: ImportResult[]) {
    super("preview");
    this.results = results;
  }
}

/**
 * Brings customers in from a spreadsheet, recognised the way bookings recognise them: by
 * mobile number, then email. New ones are created; existing ones get the file's details
 * when `update` is on (empty cells leave what's there). A preview runs the very same
 * steps in a transaction that is rolled back, so it counts duplicates inside the file too.
 */
export async function importCustomers(
  db: Db,
  business: Business,
  input: ImportInput,
): Promise<ImportResult[]> {
  const schema = importedCustomerSchema(businessCountry(business));
  const run = async (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => {
    const results: ImportResult[] = [];
    for (const [row, raw] of input.rows.entries()) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path[0];
        const code = issue?.code === "custom" ? issue.message : (issue?.code ?? "invalid");
        results.push({ row, status: "error", error: field ? `${String(field)}_${code}` : code });
        continue;
      }
      const data = parsed.data;
      const { customer, emailOwner } = await matchCustomer(tx, business.id, data);
      if (!customer) {
        await tx.insert(customers).values({
          ...data,
          businessId: business.id,
          shortId: await newCustomerShortId(tx, business.id),
        });
        results.push({ row, status: "created" });
        continue;
      }
      if (!input.update) {
        results.push({ row, status: "skipped" });
        continue;
      }
      const changes: Partial<Customer> = {};
      if (data.firstName !== customer.firstName) changes.firstName = data.firstName;
      if (data.lastName && data.lastName !== customer.lastName) changes.lastName = data.lastName;
      // Matched by email, so no other customer has this number (it would have matched).
      if (data.phone && data.phone !== customer.phone) changes.phone = data.phone;
      let warning: ImportResult["warning"];
      if (data.email && data.email !== customer.email) {
        // Emails are unique per business: keep the one there if someone else has it.
        if (emailOwner && emailOwner.id !== customer.id) warning = "email_taken";
        else changes.email = data.email;
      }
      if (data.notes && data.notes !== customer.notes) changes.notes = data.notes;
      if (Object.keys(changes).length === 0) {
        results.push({ row, status: "unchanged", ...(warning ? { warning } : {}) });
        continue;
      }
      await tx
        .update(customers)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(customers.id, customer.id));
      results.push({ row, status: "updated", ...(warning ? { warning } : {}) });
    }
    return results;
  };

  if (input.apply) return db.transaction(run);
  try {
    await db.transaction(async (tx) => {
      throw new Preview(await run(tx));
    });
  } catch (error) {
    if (error instanceof Preview) return error.results;
    throw error;
  }
  return [];
}
