CREATE TABLE "user_tours" (
	"user_id" text NOT NULL,
	"tour" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_tours_user_id_tour_pk" PRIMARY KEY("user_id","tour")
);
--> statement-breakpoint
ALTER TABLE "user_tours" ADD CONSTRAINT "user_tours_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;