CREATE TABLE "location_services" (
	"location_id" text NOT NULL,
	"service_id" text NOT NULL,
	CONSTRAINT "location_services_location_id_service_id_pk" PRIMARY KEY("location_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_locations" (
	"resource_id" text NOT NULL,
	"location_id" text NOT NULL,
	CONSTRAINT "resource_locations_resource_id_location_id_pk" PRIMARY KEY("resource_id","location_id")
);
--> statement-breakpoint
-- Every business starts with one location: its own name, address and phone, all its
-- services and people, its opening hours and its appointments.
INSERT INTO "locations" ("id", "business_id", "name", "address", "phone", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "id", "name", "address", "phone", now(), now() FROM "businesses";
--> statement-breakpoint
INSERT INTO "location_services" ("location_id", "service_id")
SELECT "locations"."id", "services"."id" FROM "locations"
JOIN "services" ON "services"."business_id" = "locations"."business_id";
--> statement-breakpoint
INSERT INTO "resource_locations" ("resource_id", "location_id")
SELECT "resources"."id", "locations"."id" FROM "locations"
JOIN "resources" ON "resources"."business_id" = "locations"."business_id";
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "location_id" text;--> statement-breakpoint
UPDATE "appointments" SET "location_id" = "locations"."id" FROM "locations"
WHERE "locations"."business_id" = "appointments"."business_id";
--> statement-breakpoint
-- Closures saved before close every location, as they closed the whole business.
ALTER TABLE "closures" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "weekly_hours" ADD COLUMN "location_id" text;--> statement-breakpoint
UPDATE "weekly_hours" SET "location_id" = "locations"."id" FROM "locations"
WHERE "locations"."business_id" = "weekly_hours"."business_id";
--> statement-breakpoint
ALTER TABLE "weekly_hours" ALTER COLUMN "location_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "location_services" ADD CONSTRAINT "location_services_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_services" ADD CONSTRAINT "location_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_locations" ADD CONSTRAINT "resource_locations_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_locations" ADD CONSTRAINT "resource_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_services_service_id_idx" ON "location_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "locations_business_id_idx" ON "locations" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "resource_locations_location_id_idx" ON "resource_locations" USING btree ("location_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closures" ADD CONSTRAINT "closures_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_hours" ADD CONSTRAINT "weekly_hours_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_location_starts_idx" ON "appointments" USING btree ("location_id","starts_at");