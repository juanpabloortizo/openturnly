-- One connection per install now: the most recently changed one stays.
DELETE FROM "whatsapp_connections" WHERE "id" NOT IN (SELECT "id" FROM "whatsapp_connections" ORDER BY "updated_at" DESC LIMIT 1);--> statement-breakpoint
CREATE TABLE "email_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"username" text NOT NULL,
	"encrypted_password" text,
	"from_email" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"last_error" text,
	"last_connected_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_connections" DROP CONSTRAINT "whatsapp_connections_business_id_businesses_id_fk";
--> statement-breakpoint
DROP INDEX "whatsapp_connections_business_id_idx";--> statement-breakpoint
DROP INDEX "whatsapp_connections_phone_number_id_idx";--> statement-breakpoint
ALTER TABLE "whatsapp_connections" DROP COLUMN "business_id";