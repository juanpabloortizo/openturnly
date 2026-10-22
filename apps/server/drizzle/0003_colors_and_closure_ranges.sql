ALTER TABLE "businesses" ADD COLUMN "brand_color" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "page_background" text;--> statement-breakpoint
ALTER TABLE "closures" ADD COLUMN "end_date" date;--> statement-breakpoint
UPDATE "closures" SET "end_date" = "date";--> statement-breakpoint
ALTER TABLE "closures" ALTER COLUMN "end_date" SET NOT NULL;
