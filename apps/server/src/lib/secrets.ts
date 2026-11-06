import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;

/** One key for what's stored encrypted, kept apart from the install's other uses of SECRET. */
function keyFrom(secret: string) {
  return createHash("sha256").update(`stored-credentials:${secret}`).digest();
}

/** AES-256-GCM, for credentials the server has to read back (never for passwords). */
export function encryptSecret(secret: string, plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** The stored value's text. Throws if it wasn't encrypted with this SECRET. */
export function decryptSecret(secret: string, stored: string): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error("unreadable_secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
