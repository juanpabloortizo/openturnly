ALTER TABLE "customers" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "booking_form" jsonb DEFAULT '{"phone":"required","email":"optional","questions":[]}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "customers_business_phone_idx" ON "customers" USING btree ("business_id","phone");