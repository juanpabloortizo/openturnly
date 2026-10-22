import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { businessImages, type ImageKind } from "../db/schema.ts";

/** The browser shrinks photos before uploading; this only guards against abuse. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Detects the format from the file's first bytes instead of trusting the client. */
export function imageType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Public URL of an image; the version makes browsers fetch new uploads. */
function imageUrl(slug: string, kind: ImageKind, updatedAt: Date) {
  return `/api/public/businesses/${slug}/images/${kind}?v=${updatedAt.getTime()}`;
}

/** Public URLs of a business's images, or null for the ones it hasn't uploaded. */
export async function imageUrls(db: Db, businessId: string, slug: string) {
  const rows = await db
    .select({ kind: businessImages.kind, updatedAt: businessImages.updatedAt })
    .from(businessImages)
    .where(eq(businessImages.businessId, businessId));
  const url = (kind: ImageKind) => {
    const row = rows.find((image) => image.kind === kind);
    return row ? imageUrl(slug, kind, row.updatedAt) : null;
  };
  return { logoUrl: url("logo"), coverUrl: url("cover") };
}

/** The logo URL of each business that has one, looked up in a single query. */
export async function logoUrls(db: Db, list: { id: string; slug: string }[]) {
  const urls = new Map<string, string>();
  if (list.length === 0) return urls;
  const rows = await db
    .select({ businessId: businessImages.businessId, updatedAt: businessImages.updatedAt })
    .from(businessImages)
    .where(
      and(
        eq(businessImages.kind, "logo"),
        inArray(
          businessImages.businessId,
          list.map((business) => business.id),
        ),
      ),
    );
  for (const row of rows) {
    const slug = list.find((business) => business.id === row.businessId)?.slug;
    if (slug) urls.set(row.businessId, imageUrl(slug, "logo", row.updatedAt));
  }
  return urls;
}

export async function findImage(db: Db, businessId: string, kind: ImageKind) {
  const [image] = await db
    .select()
    .from(businessImages)
    .where(and(eq(businessImages.businessId, businessId), eq(businessImages.kind, kind)));
  return image;
}
