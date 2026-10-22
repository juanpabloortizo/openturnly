CREATE TABLE "automation_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"appointment_id" text,
	"dedupe_key" text,
	"event" text NOT NULL,
	"payload" json NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"response_status" integer,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"offset_min" integer DEFAULT 0 NOT NULL,
	"url" text NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb NOT NULL,
	"extra" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_deliveries" ADD CONSTRAINT "automation_deliveries_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_deliveries" ADD CONSTRAINT "automation_deliveries_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_deliveries_dedupe_idx" ON "automation_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "automation_deliveries_due_idx" ON "automation_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "automation_deliveries_automation_idx" ON "automation_deliveries" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE INDEX "automations_business_id_idx" ON "automations" USING btree ("business_id");