ALTER TABLE "products" DROP CONSTRAINT "products_format_id_product_attributes_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "format_id";--> statement-breakpoint
-- Formats are each product's own content now (0025), so their list goes.
DELETE FROM "product_attributes" WHERE "kind" = 'format';
