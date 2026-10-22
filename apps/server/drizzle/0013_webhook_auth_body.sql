-- Webhook steps gain a method, an authentication and a hand-written JSON body, lose their
-- name, and name their data by group: "customer.first_name" instead of "customer_first_name".
-- Steps saved before keep working as they did: POST, no authentication, the same data.
-- Running it twice changes nothing.
UPDATE "automations" SET "actions" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN step->>'type' = 'webhook'
      THEN ('{"method": "POST", "auth": {"type": "none"}, "body": "fields", "json": ""}'::jsonb || (step - 'name'))
        || jsonb_build_object('fields', CASE WHEN jsonb_typeof(step->'fields') = 'array' THEN (
          SELECT coalesce(jsonb_agg(
            CASE
              WHEN field = 'event' OR field LIKE '%.%' THEN field
              WHEN field LIKE 'customer\_%' THEN 'customer.' || substr(field, 10)
              WHEN field LIKE 'business\_%' THEN 'business.' || substr(field, 10)
              WHEN field IN ('booking_page', 'time_zone') THEN 'business.' || field
              ELSE 'appointment.' || field
            END
            ORDER BY n
          ), '[]'::jsonb)
          FROM jsonb_array_elements_text(step->'fields') WITH ORDINALITY AS chosen(field, n)
        ) ELSE 'null'::jsonb END)
      ELSE step
    END
    ORDER BY position
  ), '[]'::jsonb)
  FROM jsonb_array_elements("actions") WITH ORDINALITY AS steps(step, position)
);
--> statement-breakpoint
-- The same renames in messages, extra values and JSON bodies: {{time}} → {{appointment.time}}.
UPDATE "automations" SET "actions" = regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  "actions"::text,
  '\{\{\s*customer_([a-z_]+)\s*\}\}', '{{customer.\1}}', 'g'),
  '\{\{\s*business_([a-z_]+)\s*\}\}', '{{business.\1}}', 'g'),
  '\{\{\s*(booking_page|time_zone)\s*\}\}', '{{business.\1}}', 'g'),
  '\{\{\s*(code|status|date|time|end_time|weekday|date_text|starts_at|ends_at|service|duration_minutes|professional|price|price_text|booked_via|answers|previous_date|previous_time)\s*\}\}',
  '{{appointment.\1}}', 'g')::jsonb;
