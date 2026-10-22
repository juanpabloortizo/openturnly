ALTER TABLE "automation_deliveries" ADD COLUMN "action_id" text;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "actions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Each existing automation becomes one webhook step with its URL, headers and data.
UPDATE "automations" SET "actions" = jsonb_build_array(jsonb_build_object(
  'id', replace(gen_random_uuid()::text, '-', ''),
  'type', 'webhook',
  'name', '',
  'url', "url",
  'headers', "headers",
  'fields', "fields",
  'extra', "extra"
)) WHERE "actions" = '[]'::jsonb;--> statement-breakpoint
-- Past sends belong to that single step.
UPDATE "automation_deliveries" AS d SET "action_id" = a."actions"->0->>'id'
FROM "automations" AS a WHERE a."id" = d."automation_id" AND d."action_id" IS NULL;
