ALTER TABLE "appointments" ADD COLUMN "code" text;--> statement-breakpoint
-- Existing appointments get a random code from the same alphabet as new ones. The
-- reference to the outer row makes Postgres draw a new code for each appointment.
UPDATE "appointments" SET "code" = (
	SELECT string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::int, 1), '')
	FROM generate_series(1, 6)
	WHERE "appointments"."id" IS NOT NULL
);--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "notes" text;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_code_idx" ON "appointments" USING btree ("code");--> statement-breakpoint
ALTER TABLE "businesses" DROP COLUMN "country";
