import { createHash, randomBytes } from "node:crypto";

/** A URL-safe secret for links sent to people (invitations, booking management). */
export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored hashed so a leaked database cannot be used to open the links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
