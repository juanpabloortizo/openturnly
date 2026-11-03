CREATE TABLE "product_attributes" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"content" double precision,
	"unit" text,
	"key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_stock" ADD COLUMN "alert_at" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "format_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "internal_price_amount" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "commission_value" double precision;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "commission_type" text DEFAULT 'percent' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tax_rate" double precision;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "commission_value" double precision;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "commission_type" text;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "tax_rate" double precision;--> statement-breakpoint
-- Products had free-text categories, brands and formats. Each different one (ignoring
-- case, accents and spaces, like core's attributeKey) becomes an entry of the business's
-- lists, and products point to it.
CREATE FUNCTION openturnly_attribute_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    translate(lower(coalesce(value, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]', '', 'g')
$$;--> statement-breakpoint
CREATE FUNCTION openturnly_format_key(name text, content double precision, unit text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT openturnly_attribute_key(name) || '|' || coalesce(trim_scale(content::numeric)::text, '')
    || '|' || CASE WHEN content IS NULL THEN '' ELSE coalesce(unit, '') END
$$;--> statement-breakpoint
INSERT INTO "product_attributes" ("id", "business_id", "kind", "name", "key", "created_at")
SELECT gen_random_uuid()::text, "business_id", 'category', mode() WITHIN GROUP (ORDER BY trim("category")),
  openturnly_attribute_key("category"), now()
FROM "products" WHERE openturnly_attribute_key("category") <> ''
GROUP BY "business_id", openturnly_attribute_key("category");--> statement-breakpoint
INSERT INTO "product_attributes" ("id", "business_id", "kind", "name", "key", "created_at")
SELECT gen_random_uuid()::text, "business_id", 'brand', mode() WITHIN GROUP (ORDER BY trim("brand")),
  openturnly_attribute_key("brand"), now()
FROM "products" WHERE openturnly_attribute_key("brand") <> ''
GROUP BY "business_id", openturnly_attribute_key("brand");--> statement-breakpoint
INSERT INTO "product_attributes" ("id", "business_id", "kind", "name", "content", "unit", "key", "created_at")
SELECT gen_random_uuid()::text, "business_id", 'format', mode() WITHIN GROUP (ORDER BY trim(coalesce("format", ''))), "content",
  CASE WHEN "content" IS NULL THEN NULL ELSE "unit" END,
  openturnly_format_key("format", "content", "unit"), now()
FROM "products" WHERE openturnly_attribute_key("format") <> '' OR "content" IS NOT NULL
GROUP BY "business_id", openturnly_format_key("format", "content", "unit"), "content",
  CASE WHEN "content" IS NULL THEN NULL ELSE "unit" END;--> statement-breakpoint
UPDATE "products" SET "category_id" = a."id" FROM "product_attributes" a
WHERE a."business_id" = "products"."business_id" AND a."kind" = 'category'
  AND a."key" = openturnly_attribute_key("products"."category");--> statement-breakpoint
UPDATE "products" SET "brand_id" = a."id" FROM "product_attributes" a
WHERE a."business_id" = "products"."business_id" AND a."kind" = 'brand'
  AND a."key" = openturnly_attribute_key("products"."brand");--> statement-breakpoint
UPDATE "products" SET "format_id" = a."id" FROM "product_attributes" a
WHERE a."business_id" = "products"."business_id" AND a."kind" = 'format'
  AND a."key" = openturnly_format_key("products"."format", "products"."content", "products"."unit");--> statement-breakpoint
-- The minimum was the same for every location; now each location has its own.
UPDATE "product_stock" SET "alert_at" = p."min_stock" FROM "products" p
WHERE p."id" = "product_stock"."product_id";--> statement-breakpoint
DROP FUNCTION openturnly_format_key(text, double precision, text);--> statement-breakpoint
DROP FUNCTION openturnly_attribute_key(text);--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_attributes_business_kind_key_idx" ON "product_attributes" USING btree ("business_id","kind","key");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_attributes_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_attributes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_product_attributes_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."product_attributes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_format_id_product_attributes_id_fk" FOREIGN KEY ("format_id") REFERENCES "public"."product_attributes"("id") ON DELETE no action ON UPDATE no action;