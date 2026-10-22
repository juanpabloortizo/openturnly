ALTER TABLE "businesses" ADD COLUMN "page_theme" text DEFAULT 'soft' NOT NULL;--> statement-breakpoint
-- A chosen background colour becomes the closest look: dark stays dark, the rest plain.
UPDATE "businesses" SET "page_theme" = CASE WHEN "page_background" = '#18181b' THEN 'dark' ELSE 'plain' END WHERE "page_background" IS NOT NULL;--> statement-breakpoint
-- Names typed all in lower or upper case before names were tidied on save.
UPDATE "customers" SET "first_name" = initcap("first_name") WHERE "first_name" = lower("first_name") OR "first_name" = upper("first_name");--> statement-breakpoint
UPDATE "customers" SET "last_name" = initcap("last_name") WHERE "last_name" = lower("last_name") OR "last_name" = upper("last_name");
