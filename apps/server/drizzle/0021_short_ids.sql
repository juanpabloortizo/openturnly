-- Short ids for admin URLs. Existing businesses and customers get a random one (same
-- alphabet and length as core's randomShortId), regenerated until none repeats.
CREATE FUNCTION openturnly_short_id() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(substr('23456789abcdefghijkmnpqrstuvwxyz', floor(random() * 32)::int + 1, 1), '')
  FROM generate_series(1, 10)
$$;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "short_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "short_id" text;--> statement-breakpoint
DO $$
BEGIN
  UPDATE "businesses" SET "short_id" = openturnly_short_id();
  LOOP
    UPDATE "businesses" SET "short_id" = openturnly_short_id()
    WHERE "id" IN (
      SELECT "id" FROM (
        SELECT "id", row_number() OVER (PARTITION BY "short_id" ORDER BY "id") AS n FROM "businesses"
      ) AS repeated WHERE n > 1
    );
    EXIT WHEN NOT FOUND;
  END LOOP;
  UPDATE "customers" SET "short_id" = openturnly_short_id();
  LOOP
    UPDATE "customers" SET "short_id" = openturnly_short_id()
    WHERE "id" IN (
      SELECT "id" FROM (
        SELECT "id", row_number() OVER (PARTITION BY "business_id", "short_id" ORDER BY "id") AS n
        FROM "customers"
      ) AS repeated WHERE n > 1
    );
    EXIT WHEN NOT FOUND;
  END LOOP;
END $$;--> statement-breakpoint
DROP FUNCTION openturnly_short_id();--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "short_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "short_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_business_short_id_idx" ON "customers" USING btree ("business_id","short_id");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_short_id_unique" UNIQUE("short_id");
