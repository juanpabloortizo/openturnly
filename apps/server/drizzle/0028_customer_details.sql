ALTER TABLE "businesses" ALTER COLUMN "booking_form" SET DEFAULT '{"phone":"required","email":"optional","birthDate":"hidden","document":"hidden","gender":"hidden","questions":[]}'::jsonb;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "document" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "gender" text;--> statement-breakpoint
-- Forms saved before these fields existed don't ask for them; what a business chose stays.
UPDATE "businesses" SET "booking_form" = '{"birthDate":"hidden","document":"hidden","gender":"hidden"}'::jsonb || "booking_form";
