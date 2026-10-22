CREATE TABLE "holiday_overrides" (
	"business_id" text NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "holiday_overrides_business_id_date_pk" PRIMARY KEY("business_id","date")
);
--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "max_advance_days" SET DEFAULT 30;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "closed_on_holidays" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday_overrides" ADD CONSTRAINT "holiday_overrides_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Pre-release: 60 days was the old default, nobody chose it explicitly yet.
UPDATE "businesses" SET "max_advance_days" = 30 WHERE "max_advance_days" = 60;