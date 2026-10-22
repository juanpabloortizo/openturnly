import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { businessImages, IMAGE_KINDS, type ImageKind } from "../db/schema.ts";
import { apiError, type BusinessEnv, type Deps } from "../lib/http.ts";
import { imageType, imageUrls, MAX_IMAGE_BYTES } from "../lib/images.ts";

function parseKind(kind: string): ImageKind {
  if (!(IMAGE_KINDS as readonly string[]).includes(kind)) throw apiError(404, "not_found");
  return kind as ImageKind;
}

/** Logo and cover photo of the booking page. The body is the image file itself. */
export function imageRoutes({ db }: Deps) {
  return new Hono<BusinessEnv>()
    .get("/", async (c) => {
      const business = c.get("business");
      return c.json(await imageUrls(db, business.id, business.slug));
    })

    .put(
      "/:kind",
      bodyLimit({
        maxSize: MAX_IMAGE_BYTES,
        onError: () => {
          throw apiError(413, "image_too_large");
        },
      }),
      async (c) => {
        const business = c.get("business");
        const kind = parseKind(c.req.param("kind"));
        const data = Buffer.from(await c.req.arrayBuffer());
        const contentType = imageType(data);
        if (!contentType) throw apiError(400, "image_invalid");

        await db
          .insert(businessImages)
          .values({ businessId: business.id, kind, contentType, data })
          .onConflictDoUpdate({
            target: [businessImages.businessId, businessImages.kind],
            set: { contentType, data, updatedAt: new Date() },
          });
        return c.json(await imageUrls(db, business.id, business.slug));
      },
    )

    .delete("/:kind", async (c) => {
      const business = c.get("business");
      const kind = parseKind(c.req.param("kind"));
      await db
        .delete(businessImages)
        .where(and(eq(businessImages.businessId, business.id), eq(businessImages.kind, kind)));
      return c.json(await imageUrls(db, business.id, business.slug));
    });
}
