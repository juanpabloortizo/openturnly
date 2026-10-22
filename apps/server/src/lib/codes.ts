import { eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { appointments } from "../db/schema.ts";

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
