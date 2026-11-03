-- Formats become plain text, like categories and brands: "Botella" holding 2 units reads
-- "Botella 2 unidades", 250 ml "250 ml". Keys are the name's (see core's attributeKey).
CREATE FUNCTION openturnly_attribute_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    translate(lower(coalesce(value, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]', '', 'g')
$$;--> statement-breakpoint
UPDATE "product_attributes" SET "name" = trim(concat_ws(' ',
  nullif(trim("product_attributes"."name"), ''),
  trim_scale("content"::numeric)::text,
  CASE "unit"
    WHEN 'unit' THEN CASE
      WHEN b."locale" LIKE 'es%' THEN CASE WHEN "content" = 1 THEN 'unidad' ELSE 'unidades' END
      ELSE CASE WHEN "content" = 1 THEN 'unit' ELSE 'units' END
    END
    ELSE "unit"
  END))
FROM "businesses" b
WHERE b."id" = "product_attributes"."business_id" AND "content" IS NOT NULL;--> statement-breakpoint
-- Two entries that now read the same become one: products move to the oldest.
DROP INDEX "product_attributes_business_kind_key_idx";--> statement-breakpoint
UPDATE "product_attributes" SET "key" = openturnly_attribute_key("name");--> statement-breakpoint
CREATE TEMPORARY TABLE "attribute_merges" AS
SELECT "id", first_value("id") OVER (
  PARTITION BY "business_id", "kind", "key" ORDER BY "created_at", "id"
) AS "keep"
FROM "product_attributes";--> statement-breakpoint
UPDATE "products" SET "category_id" = m."keep" FROM "attribute_merges" m
WHERE "products"."category_id" = m."id" AND m."keep" <> m."id";--> statement-breakpoint
UPDATE "products" SET "brand_id" = m."keep" FROM "attribute_merges" m
WHERE "products"."brand_id" = m."id" AND m."keep" <> m."id";--> statement-breakpoint
UPDATE "products" SET "format_id" = m."keep" FROM "attribute_merges" m
WHERE "products"."format_id" = m."id" AND m."keep" <> m."id";--> statement-breakpoint
DELETE FROM "product_attributes" USING "attribute_merges" m
WHERE "product_attributes"."id" = m."id" AND m."keep" <> m."id";--> statement-breakpoint
DROP TABLE "attribute_merges";--> statement-breakpoint
CREATE UNIQUE INDEX "product_attributes_business_kind_key_idx" ON "product_attributes" USING btree ("business_id","kind","key");--> statement-breakpoint
DROP FUNCTION openturnly_attribute_key(text);--> statement-breakpoint
ALTER TABLE "product_attributes" ALTER COLUMN "name" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "product_attributes" DROP COLUMN "content";--> statement-breakpoint
ALTER TABLE "product_attributes" DROP COLUMN "unit";
