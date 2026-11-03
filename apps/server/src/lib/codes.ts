import { SHORT_ID_ALPHABET, SHORT_ID_LENGTH } from "@openturnly/core";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { appointments, businesses, customers } from "../db/schema.ts";

/** 32 characters without 0/O and 1/I, so codes read well aloud and over the phone. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** "K7Q4XM": 32^6 ≈ a billion combinations, random so codes can't be guessed in order. */
export function randomCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // 256 is a multiple of 32, so every character is equally likely.
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/** A booking code not used by any other appointment yet. */
export async function newBookingCode(db: Pick<Db, "select">): Promise<string> {
  for (;;) {
    const code = randomCode();
    const [taken] = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.code, code));
    if (!taken) return code;
  }
}

/** "k7m2qx9a4p": a random short id for admin URLs (see core's short-id). */
export function randomShortId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SHORT_ID_LENGTH));
  return Array.from(bytes, (byte) => SHORT_ID_ALPHABET[byte % SHORT_ID_ALPHABET.length]).join("");
}

/** A short id no other business has (the database would refuse a repeat anyway). */
export async function newBusinessShortId(db: Pick<Db, "select">): Promise<string> {
  for (;;) {
    const shortId = randomShortId();
    const [taken] = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.shortId, shortId));
    if (!taken) return shortId;
  }
}

/** A short id no other customer of the business has. */
export async function newCustomerShortId(
  db: Pick<Db, "select">,
  businessId: string,
): Promise<string> {
  for (;;) {
    const shortId = randomShortId();
    const [taken] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.businessId, businessId), eq(customers.shortId, shortId)));
    if (!taken) return shortId;
  }
}
