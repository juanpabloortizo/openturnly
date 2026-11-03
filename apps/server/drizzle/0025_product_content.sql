ALTER TABLE "products" ADD COLUMN "content" double precision;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit" text;--> statement-breakpoint
-- The size moves from the format's name onto the product, as core's parseContent reads it:
-- "Pote 113 g" holds 113 g, "Botella 2 unidades" 2 units, "Unidad" one. A name without a
-- number and a unit says nothing.
CREATE FUNCTION openturnly_unit(word text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN word IN ('ml', 'mls', 'cc', 'mililitro', 'mililitros', 'milliliter', 'milliliters') THEN 'ml'
    WHEN word IN ('l', 'lt', 'lts', 'litro', 'litros', 'liter', 'liters', 'litre', 'litres') THEN 'l'
    WHEN word IN ('g', 'gr', 'grs', 'gramo', 'gramos', 'gram', 'grams') THEN 'g'
    WHEN word IN ('kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'kilogram', 'kilograms') THEN 'kg'
    WHEN word IN ('oz', 'onza', 'onzas', 'ounce', 'ounces') THEN 'oz'
    WHEN word IN ('u', 'un', 'und', 'unds', 'ud', 'uds', 'unid', 'unidad', 'unidades', 'unit', 'units') THEN 'unit'
  END
$$;--> statement-breakpoint
UPDATE "products" SET "content" = s."content", "unit" = s."unit"
FROM (
  SELECT "id",
    CASE WHEN "m" IS NULL THEN 1 ELSE replace("m"[1], ',', '.')::double precision END AS "content",
    CASE
      WHEN "m" IS NULL THEN CASE WHEN openturnly_unit("plain") = 'unit' THEN 'unit' END
      ELSE openturnly_unit("m"[2])
    END AS "unit"
  FROM (
    SELECT "id", "plain", regexp_match("plain", '(\d+(?:[.,]\d+)?)\s*([a-z]+)\.?$') AS "m"
    FROM (
      SELECT "id", trim(translate(lower("name"), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')) AS "plain"
      FROM "product_attributes"
      WHERE "kind" = 'format'
    ) "named"
  ) "read"
) s
WHERE "products"."format_id" = s."id" AND s."unit" IS NOT NULL AND s."content" > 0;--> statement-breakpoint
DROP FUNCTION openturnly_unit(text);
