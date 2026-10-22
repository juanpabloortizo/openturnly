CREATE TABLE "business_images" (
	"business_id" text NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_images_business_id_kind_pk" PRIMARY KEY("business_id","kind")
);
--> statement-breakpoint
ALTER TABLE "business_images" ADD CONSTRAINT "business_images_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;