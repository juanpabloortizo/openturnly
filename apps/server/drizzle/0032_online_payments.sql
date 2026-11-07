CREATE TABLE "online_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"appointment_id" text,
	"order_id" text,
	"checkout_url" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"deposit_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text,
	"site_id" text NOT NULL,
	"test_mode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "payment_mode" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "deposit_amount" bigint;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_connections" ADD CONSTRAINT "payment_connections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "online_payments_order_idx" ON "online_payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "online_payments_status_idx" ON "online_payments" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "online_payments_appointment_idx" ON "online_payments" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_connections_business_idx" ON "payment_connections" USING btree ("business_id");