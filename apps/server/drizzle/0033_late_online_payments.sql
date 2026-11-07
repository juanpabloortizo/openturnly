ALTER TABLE "online_payments" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "online_payments" ADD COLUMN "refunded_at" timestamp with time zone;