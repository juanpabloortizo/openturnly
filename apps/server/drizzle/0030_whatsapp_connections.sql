CREATE TABLE "whatsapp_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"waba_id" text,
	"encrypted_access_token" text,
	"encrypted_app_secret" text,
	"webhook_verify_token" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"phone_number" text,
	"display_name" text,
	"last_error" text,
	"last_connected_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_deliveries" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "automation_deliveries" ADD COLUMN "message_status" text;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_connections_business_id_idx" ON "whatsapp_connections" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "whatsapp_connections_phone_number_id_idx" ON "whatsapp_connections" USING btree ("phone_number_id");--> statement-breakpoint
CREATE INDEX "automation_deliveries_message_id_idx" ON "automation_deliveries" USING btree ("message_id");