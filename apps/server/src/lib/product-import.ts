import {
  attributeKey,
  DEFAULT_TAX_RATES,
  type ProductAttributeKind,
  parseContent,
  type productImportSchema,
  toMinorUnits,
} from "@openturnly/core";
import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/client.ts";
import {
  type Business,
  locations,
  type Product,
  productAttributes,
  products,
} from "../db/schema.ts";
import { businessCountry } from "./holidays.ts";
import { apiError } from "./http.ts";
import { findOrCreateAttribute, lockStock, moveStock, stockAt } from "./inventory.ts";

type ImportInput = z.output<typeof productImportSchema>;
type Row = ImportInput["rows"][number];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ProductImportResult = {
  /** Index of the row in the file's data (0 = first row after the headers). */
  row: number;
  status: "created" | "updated" | "unchanged" | "error";
  /** For errors: what's wrong ("name_required", "invalid_number"…) and in which column. */
  error?: string;
  field?: string;
};

export type ProductImport = {
  applied: boolean;
  counts: { created: number; updated: number; unchanged: number; errors: number };
  /** Categories and brands that didn't exist and are created. */
  newLists: Record<ProductAttributeKind, number>;
  /** Products whose stock is set to what the file says somewhere. */
  stockChanges: number;
  /** Only the rows with errors. */
  results: ProductImportResult[];
};

class RowError extends Error {
  readonly field: string | undefined;
  constructor(code: string, field?: string) {
    super(code);
    this.field = field;
  }
}

/** Thrown to roll a preview back once its results are known. */
class Preview extends Error {
  readonly result: ProductImport;
  constructor(result: ProductImport) {
    super("preview");
    this.result = result;
  }
}

/**
 * "25.000", "25,000.50", "$ 1.250" or "12,5": a number as people write it. Groups of three
 * after a single separator are thousands. null when empty; RowError when it isn't a number.
 */
export function readNumber(text: string, field: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const clean = trimmed.replace(/[^\d.,-]/g, "");
  const dot = clean.lastIndexOf(".");
  const comma = clean.lastIndexOf(",");
  let normalized = clean;
  if (dot >= 0 && comma >= 0) {
    const decimal = dot > comma ? "." : ",";
    normalized = clean
      .split(decimal === "." ? "," : ".")
      .join("")
      .replace(decimal, ".");
  } else if (dot >= 0 || comma >= 0) {
    const parts = clean.split(dot >= 0 ? "." : ",");
    normalized = parts.length > 2 || parts[1]?.length === 3 ? parts.join("") : parts.join(".");
  }
  const value = Number(normalized);
  if (!clean || !Number.isFinite(value)) throw new RowError("invalid_number", field);
  return value;
}

/** "Sí", "1", "activo"… true; "No", "0", "inactivo"… false; empty: null. */
function readYesNo(text: string, field: string): boolean | null {
  const value = text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!value) return null;
  if (["1", "si", "s", "x", "yes", "y", "true", "activo", "active"].includes(value)) return true;
  if (["0", "no", "n", "false", "inactivo", "inactive"].includes(value)) return false;
  throw new RowError("invalid_yes_no", field);
}

/**
 * Brings products in from a spreadsheet (the one the inventory page exports or its template).
 * A product is recognised by its barcode, else by its name with the same brand and content;
 * new ones are created and the others get the file's values (empty cells leave what's
 * there). Categories and brands are found in the lists the same way they are typed in
 * ("coca cola" is "Coca-Cola") or added to them. Content is read as people write it
 * ("400ml", "80 gr", "2 unidades"). A stock cell sets the stock at
 * that location with an adjustment. A preview runs the very same steps and is rolled back.
 */
export async function importProducts(
  db: Db,
  business: Business,
  input: ImportInput,
  userId: string | undefined,
): Promise<ProductImport> {
  const locationIds = [...new Set(input.rows.flatMap((row) => Object.keys(row.stock)))];
  if (locationIds.length > 0) {
    const own = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.businessId, business.id), inArray(locations.id, locationIds)));
    if (own.length !== locationIds.length) throw apiError(404, "location_not_found");
  }
  const defaultTax = DEFAULT_TAX_RATES[businessCountry(business) ?? ""] ?? null;
  const money = (text: string, field: string) => {
    const value = readNumber(text, field);
    if (value === null) return null;
    if (value < 0) throw new RowError("invalid_number", field);
    return toMinorUnits(value, business.currency);
  };

  const run = async (tx: Tx): Promise<ProductImport> => {
    const result: ProductImport = {
      applied: input.apply,
      counts: { created: 0, updated: 0, unchanged: 0, errors: 0 },
      newLists: { category: 0, brand: 0 },
      stockChanges: 0,
      results: [],
    };
    const existingAttributes = new Set(
      (
        await tx
          .select({ id: productAttributes.id })
          .from(productAttributes)
          .where(eq(productAttributes.businessId, business.id))
      ).map((row) => row.id),
    );
    const all = await tx.select().from(products).where(eq(products.businessId, business.id));
    const bySku = new Map<string, Product>();
    const byName = new Map<string, Product>();
    const nameKey = (product: Pick<Product, "name" | "brandId" | "content" | "unit">) =>
      `${attributeKey(product.name)}|${product.brandId ?? ""}|${product.content ?? ""}${product.unit ?? ""}`;
    const remember = (product: Product) => {
      if (product.sku) bySku.set(product.sku.trim().toLowerCase(), product);
      byName.set(nameKey(product), product);
    };
    all.forEach(remember);
    let locked = false;

    const list = async (kind: ProductAttributeKind, text: string) => {
      const name = text.trim().replace(/\s+/g, " ");
      if (!name) return undefined;
      const { attribute } = await findOrCreateAttribute(tx, business.id, { kind, name });
      if (!existingAttributes.has(attribute.id)) {
        existingAttributes.add(attribute.id);
        result.newLists[kind] += 1;
      }
      return attribute.id;
    };

    const importRow = async (row: Row) => {
      // Everything is read first, so a bad cell leaves nothing half done.
      const name = row.name.trim().replace(/\s+/g, " ");
      const sku = row.sku.trim();
      const cost = money(row.cost, "cost");
      const price = money(row.price, "price");
      const internalPrice = money(row.internalPrice, "internalPrice");
      const commission = readNumber(row.commission, "commission");
      const typeText = row.commissionType.trim().toLowerCase();
      const commissionType = !typeText
        ? null
        : ["0", "%", "porcentaje", "percent"].includes(typeText)
          ? "percent"
          : ["1", "$", "valor", "fijo", "monto", "fixed"].includes(typeText)
            ? "fixed"
            : (() => {
                throw new RowError("invalid_commission_type", "commissionType");
              })();
      if (commission !== null && commission < 0) {
        throw new RowError("invalid_number", "commission");
      }
      if (commission !== null && (commissionType ?? "percent") === "percent" && commission > 100) {
        throw new RowError("commission_too_big", "commission");
      }
      const size = row.content.trim() ? parseContent(row.content) : null;
      if (row.content.trim() && !size) throw new RowError("invalid_content", "content");
      const active = readYesNo(row.status, "status");
      const taxIncluded = readYesNo(row.taxIncluded, "taxIncluded");
      const rate = readNumber(row.taxRate, "taxRate");
      if (rate !== null && (rate < 0 || rate > 100))
        throw new RowError("invalid_number", "taxRate");
      const taxRate =
        taxIncluded === false ? null : (rate ?? (taxIncluded ? defaultTax : undefined));
      if (taxIncluded && taxRate === null) throw new RowError("tax_rate_required", "taxRate");
      const stock = Object.entries(row.stock).flatMap(([locationId, text]) => {
        const value = readNumber(text, "stock");
        if (value === null) return [];
        if (value < 0 || !Number.isInteger(value)) throw new RowError("invalid_stock", "stock");
        return [{ locationId, quantity: value }];
      });
      // Errors are all found before anything is written, so a bad row leaves no trace.
      if (!name && !(sku && bySku.has(sku.toLowerCase()))) {
        throw new RowError("name_required", "name");
      }

      const categoryId = await list("category", row.category);
      const brandId = await list("brand", row.brand);
      const current =
        (sku ? bySku.get(sku.toLowerCase()) : undefined) ??
        (name
          ? byName.get(
              nameKey({
                name,
                brandId: brandId ?? null,
                content: size?.content ?? null,
                unit: size?.unit ?? null,
              }),
            )
          : undefined);

      const values: Partial<typeof products.$inferInsert> = {
        ...(name ? { name } : {}),
        ...(sku ? { sku } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(brandId ? { brandId } : {}),
        ...(size ?? {}),
        ...(row.description.trim() ? { description: row.description.trim() } : {}),
        ...(price !== null ? { priceAmount: price } : {}),
        ...(internalPrice !== null ? { internalPriceAmount: internalPrice } : {}),
        ...(cost !== null ? { costAmount: cost } : {}),
        ...(commission !== null
          ? {
              commissionType: commissionType ?? "percent",
              commissionValue:
                commissionType === "fixed"
                  ? toMinorUnits(commission, business.currency)
                  : commission,
            }
          : {}),
        ...(taxRate !== undefined ? { taxRate } : {}),
        ...(active !== null ? { active } : {}),
      };

      let product: Product;
      let changed = false;
      if (!current) {
        const [created] = await tx
          .insert(products)
          .values({ priceAmount: 0, ...values, name: name || sku, businessId: business.id })
          .returning();
        if (!created) throw new Error("product insert returned nothing");
        product = created;
        result.counts.created += 1;
      } else {
        const changes = Object.fromEntries(
          Object.entries(values).filter(
            ([field, value]) => current[field as keyof Product] !== value,
          ),
        );
        product = current;
        if (Object.keys(changes).length > 0) {
          const [updated] = await tx
            .update(products)
            .set({ ...changes, updatedAt: new Date() })
            .where(eq(products.id, current.id))
            .returning();
          if (updated) product = updated;
          changed = true;
        }
      }
      remember(product);

      let moved = false;
      for (const { locationId, quantity } of stock) {
        if (!locked) {
          await lockStock(tx, business.id);
          locked = true;
        }
        const now = await stockAt(tx, product.id, locationId);
        if (now === quantity) continue;
        await moveStock(tx, {
          businessId: business.id,
          productId: product.id,
          locationId,
          kind: "adjustment",
          quantity: quantity - now,
          note: business.locale.startsWith("es") ? "Carga masiva" : "Bulk upload",
          createdBy: userId ?? null,
        });
        moved = true;
      }
      if (moved) result.stockChanges += 1;
      if (current) {
        if (changed || moved) result.counts.updated += 1;
        else result.counts.unchanged += 1;
      }
    };

    for (const [index, row] of input.rows.entries()) {
      try {
        await importRow(row);
      } catch (error) {
        if (!(error instanceof RowError)) throw error;
        result.counts.errors += 1;
        result.results.push({
          row: index,
          status: "error",
          error: error.message,
          ...(error.field ? { field: error.field } : {}),
        });
      }
    }
    return result;
  };

  if (input.apply) return db.transaction(run);
  try {
    await db.transaction(async (tx) => {
      throw new Preview(await run(tx));
    });
  } catch (error) {
    if (error instanceof Preview) return error.result;
    throw error;
  }
  throw new Error("unreachable");
}
