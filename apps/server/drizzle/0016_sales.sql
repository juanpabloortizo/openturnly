CREATE TABLE "deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"location_id" text,
	"customer_id" text NOT NULL,
	"appointment_id" text,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"applied_sale_id" text,
	"created_by" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_id" text NOT NULL,
	"kind" text NOT NULL,
	"appointment_id" text,
	"service_id" text,
	"name" text NOT NULL,
	"resource_id" text,
	"resource_name" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" bigint NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_id" text NOT NULL,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"deposit_id" text
);
--> statement-breakpoint
CREATE TABLE "sale_tips" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_id" text NOT NULL,
	"resource_id" text,
	"resource_name" text NOT NULL,
	"amount" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"location_id" text,
	"number" integer NOT NULL,
	"customer_id" text,
	"internal" boolean DEFAULT false NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"tip_amount" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"sold_by" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_applied_sale_id_sales_id_fk" FOREIGN KEY ("applied_sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_tips" ADD CONSTRAINT "sale_tips_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_tips" ADD CONSTRAINT "sale_tips_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposits_business_created_idx" ON "deposits" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "deposits_customer_idx" ON "deposits" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "deposits_appointment_idx" ON "deposits" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_appointment_idx" ON "sale_items" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_tips_sale_idx" ON "sale_tips" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_business_number_idx" ON "sales" USING btree ("business_id","number");--> statement-breakpoint
CREATE INDEX "sales_business_created_idx" ON "sales" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id");