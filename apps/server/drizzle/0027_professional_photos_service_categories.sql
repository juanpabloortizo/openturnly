CREATE TABLE "resource_photos" (
	"resource_id" text PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "resource_photos" ADD CONSTRAINT "resource_photos_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;