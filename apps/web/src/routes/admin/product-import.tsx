import { fromMinorUnits, MAX_PRODUCT_IMPORT_ROWS, type ProductImportInput } from "@openturnly/core";
import type { TFunction } from "i18next";
import { Download, FileSpreadsheet, TriangleAlert } from "lucide-react";
import { type DragEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/controls.tsx";
import { toast } from "../../components/toast.tsx";
import { Button } from "../../components/ui.tsx";
import type { Location, Product, ProductAttribute } from "../../lib/api.ts";
import { useLocations } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { type Cell, downloadXlsx } from "../../lib/export.ts";
import { errorMessage } from "../../lib/forms.ts";
import { contentText, useImportProducts, useProducts } from "../../lib/inventory.ts";
import { readSpreadsheet } from "../../lib/spreadsheet.ts";
import { useBusinessContext } from "./business.tsx";
import { useProductLists } from "./product-form.tsx";

type Row = ProductImportInput["rows"][number];
type Column = Exclude<keyof Row, "stock">;

/** The spreadsheet's columns, in order; then one "Stock <location>" per location. */
const COLUMNS: Column[] = [
  "sku",
  "category",
  "brand",
  "name",
  "content",
  "cost",
  "price",
  "internalPrice",
  "commission",
  "commissionType",
  "description",
  "status",
  "taxIncluded",
  "taxRate",
];

/** "Código de barras" → "codigodebarras": headers compared without case, accents or signs. */
function plain(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Other ways the columns are named (our English sheet, other systems' exports). */
const HEADERS: Record<Column, string[]> = {
  sku: ["sku", "codigo", "codigodebarras", "barcode", "referencia", "ref"],
  category: ["categoria", "category"],
  brand: ["marca", "brand"],
  name: ["nombre", "name", "producto", "product"],
  // Other booking apps' sheets call it "Formato".
  content: [
    "medida",
    "contenido",
    "tamano",
    "formato",
    "presentacion",
    "formatopresentacion",
    "size",
    "content",
    "format",
  ],
  cost: ["costo", "cost", "costodecompra", "purchasecost"],
  price: [
    "precio",
    "price",
    "precioventa",
    "preciodeventa",
    "precioventaexterna",
    "preciodeventaalpublico",
    "saleprice",
    "retailprice",
  ],
  internalPrice: [
    "precioventainterna",
    "preciodeventainterna",
    "internalprice",
    "internalsaleprice",
  ],
  commission: ["comision", "commission", "comisiondeventa", "salescommission"],
  commissionType: ["tipodecomision", "commissiontype"],
  description: ["descripcion", "description"],
  status: ["estado", "status"],
  taxIncluded: ["preciocontieneiva", "precioincluyeiva", "ivaincluido", "priceincludesvat"],
  taxRate: ["iva", "vat"],
};

/** Which field each column of the file is, and which location each "Stock …" column is. */
function readHeaders(header: string[], locations: Location[]) {
  const fields = new Map<number, Column>();
  const stock = new Map<number, string>();
  const unknown: string[] = [];
  header.forEach((text, index) => {
    const key = plain(text);
    if (!key) return;
    if (key.startsWith("stock")) {
      const name = key.slice("stock".length);
      const location =
        locations.find((candidate) => plain(candidate.name) === name) ??
        (locations.length === 1 ? locations[0] : undefined);
      if (location) stock.set(index, location.id);
      else unknown.push(text);
      return;
    }
    const field =
      COLUMNS.find((column) => HEADERS[column].includes(key)) ??
      // "Tipo de comisión (0: %, 1: $)", "% IVA (vacío por defecto)".
      (key.startsWith("tipodecomision") || key.startsWith("commissiontype")
        ? "commissionType"
        : key.startsWith("iva") || key.startsWith("vat")
          ? "taxRate"
          : undefined);
    if (field && ![...fields.values()].includes(field)) fields.set(index, field);
    else unknown.push(text);
  });
  return { fields, stock, unknown };
}

/**
 * The inventory as the upload reads it: one row per product with its stock at each
 * location. The export and the template are this same sheet, so it can go back and forth.
 */
export function productSheet(
  t: TFunction,
  language: string,
  currency: string,
  products: Product[],
  locations: Location[],
  attributes: Map<string, ProductAttribute>,
): Cell[][] {
  const name = (id: string | null) => (id ? (attributes.get(id)?.name ?? null) : null);
  const money = (amount: number | null) =>
    amount === null ? null : fromMinorUnits(amount, currency);
  return [
    [
      ...COLUMNS.map((column) => t(`inventory.columns.${column}`)),
      ...locations.map((location) => t("inventory.columns.stock", { location: location.name })),
    ],
    ...products.map((product): Cell[] => {
      return [
        product.sku,
        name(product.categoryId),
        name(product.brandId),
        product.name,
        contentText(t, language, product),
        money(product.costAmount),
        money(product.priceAmount),
        money(product.internalPriceAmount),
        product.commissionValue === null
          ? null
          : product.commissionType === "fixed"
            ? money(product.commissionValue)
            : product.commissionValue,
        product.commissionValue === null ? null : product.commissionType === "fixed" ? 1 : 0,
        product.description,
        product.active ? t("inventory.active") : t("inventory.inactive"),
        product.taxRate === null ? t("inventory.no") : t("inventory.yes"),
        product.taxRate,
        ...locations.map((location) => product.stock[location.id] ?? 0),
      ];
    }),
  ];
}

type Step = "file" | "summary";

/** Many products at once from a spreadsheet: the file, then what will happen. */
export function ImportProducts({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const importer = useImportProducts(business.id);
  const products = useProducts(business.id).data ?? [];
  const locations = useLocations(business.id).data ?? [];
  const lists = useProductLists(business.id);
  const [step, setStep] = useState<Step>("file");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  /** Each row's number in the file, for the errors. */
  const [lines, setLines] = useState<number[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const summary = importer.data;
  const max = MAX_PRODUCT_IMPORT_ROWS.toLocaleString(i18n.language);

  const preview = (data: Row[]) =>
    importer.mutate(
      { rows: data, apply: false },
      {
        onSuccess: () => setStep("summary"),
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );

  const load = async (file: File | undefined) => {
    if (!file) return;
    try {
      const [header, ...body] = await readSpreadsheet(file);
      if (!header || body.length === 0) {
        toast.error(t("customers.import.empty"));
        return;
      }
      if (body.length > MAX_PRODUCT_IMPORT_ROWS) {
        toast.error(t("customers.import.tooMany", { max }));
        return;
      }
      const columns = readHeaders(header.cells, locations);
      if (![...columns.fields.values()].includes("name")) {
        toast.error(t("inventory.import.noName"));
        return;
      }
      const data = body.map(({ cells }) => {
        const row = Object.fromEntries(COLUMNS.map((column) => [column, ""])) as Row;
        for (const [index, field] of columns.fields) row[field] = cells[index] ?? "";
        row.stock = Object.fromEntries(
          [...columns.stock].map(([index, locationId]) => [locationId, cells[index] ?? ""]),
        );
        return row;
      });
      setFileName(file.name);
      setRows(data);
      setLines(body.map((row) => row.line));
      setUnknown(columns.unknown);
      preview(data);
    } catch {
      toast.error(t("customers.import.unreadable"));
    }
  };

  const apply = () =>
    importer.mutate(
      { rows, apply: true },
      {
        onSuccess: (result) => {
          toast.success(
            t("inventory.import.done", {
              created: result.counts.created,
              updated: result.counts.updated,
            }),
          );
          onClose();
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );

  const template = () => {
    const attributes = new Map((lists.query.data ?? []).map((entry) => [entry.id, entry]));
    downloadXlsx(
      `${t("inventory.exportFile")}-${business.slug}.xlsx`,
      t("inventory.title"),
      productSheet(t, i18n.language, business.currency, products, locations, attributes),
    );
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    load(event.dataTransfer.files[0]);
  };

  /** "«Precio venta» no es un número." with the column as the file names it. */
  const problem = (error: string, field?: string) =>
    t(
      [
        `inventory.import.problems.${error}`,
        "inventory.import.problems.invalid",
      ] as unknown as "inventory.import.problems.invalid",
      {
        column:
          field === "stock"
            ? t("inventory.columns.stock", { location: "" }).trim()
            : field
              ? t(`inventory.columns.${field}` as "inventory.columns.name")
              : "",
      },
    );

  const created = summary
    ? (["category", "brand"] as const).flatMap((kind) =>
        summary.newLists[kind] > 0
          ? [
              `${summary.newLists[kind]} ${t(`inventory.lists.${kind}.${summary.newLists[kind] === 1 ? "one" : "empty"}`)}`,
            ]
          : [],
      )
    : [];

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("inventory.import.title")}
      description={t(`inventory.import.steps.${step}`)}
      footer={
        step === "file" ? (
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => setStep("file")}>
              {t("common.back")}
            </Button>
            <Button
              onClick={apply}
              loading={importer.isPending}
              disabled={!summary || summary.counts.created + summary.counts.updated === 0}
            >
              {t("inventory.import.apply", {
                count: (summary?.counts.created ?? 0) + (summary?.counts.updated ?? 0),
              })}
            </Button>
          </>
        )
      }
    >
      {step === "file" && (
        <div className="space-y-5">
          <ol className="space-y-4">
            <li className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-on-brand">
                1
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm text-zinc-700">{t("inventory.import.downloadHint")}</p>
                <Button variant="secondary" size="sm" onClick={template}>
                  <Download className="size-4" aria-hidden />
                  {t("inventory.import.download")}
                </Button>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-on-brand">
                2
              </span>
              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={drop}
                className={cn(
                  "flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-2.5 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
                  dragging
                    ? "border-brand-400 bg-brand-50/60"
                    : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
                  importer.isPending && "pointer-events-none opacity-60",
                )}
              >
                <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600">
                  <FileSpreadsheet className="size-5" aria-hidden />
                </span>
                <span className="text-sm font-medium text-zinc-900">
                  {t("inventory.import.drop")}
                </span>
                <span className="text-[13px] text-zinc-500">
                  {t("inventory.import.formats", { max })}
                </span>
                <input
                  type="file"
                  accept=".xlsx,.csv,text/csv"
                  className="sr-only"
                  onChange={(event) => {
                    load(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            </li>
          </ol>
          <div className="rounded-lg bg-zinc-50 px-4 py-3">
            <p className="text-[13px] font-medium text-zinc-900">
              {t("inventory.import.rulesTitle")}
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] text-zinc-600">
              {(["match", "lists", "content", "empty", "stock"] as const).map((rule) => (
                <li key={rule}>{t(`inventory.import.rules.${rule}`)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {step === "summary" && summary && (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm text-zinc-600">
            <FileSpreadsheet className="size-4 text-zinc-400" aria-hidden />
            <span className="font-medium text-zinc-900">{fileName}</span>·
            {t("inventory.productsCount", { count: rows.length })}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["created", summary.counts.created],
                ["updated", summary.counts.updated],
                ["unchanged", summary.counts.unchanged],
                ["errors", summary.counts.errors],
              ] as const
            ).map(([key, value]) => (
              <div
                key={key}
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  key === "errors" && value > 0
                    ? "border-amber-200 bg-amber-50"
                    : "border-zinc-200",
                )}
              >
                <div className="text-[12px] text-zinc-500">
                  {t(`inventory.import.counts.${key}`)}
                </div>
                <div className="mt-0.5 text-xl font-semibold text-zinc-900 tabular-nums">
                  {value}
                </div>
              </div>
            ))}
          </div>
          {(created.length > 0 || summary.stockChanges > 0 || unknown.length > 0) && (
            <ul className="space-y-1 text-[13px] text-zinc-600">
              {created.length > 0 && (
                <li>
                  {t("inventory.import.newLists", {
                    lists: new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(
                      created,
                    ),
                  })}
                </li>
              )}
              {summary.stockChanges > 0 && (
                <li>{t("inventory.import.stockChanges", { count: summary.stockChanges })}</li>
              )}
              {unknown.length > 0 && (
                <li className="text-zinc-500">
                  {t("inventory.import.unknownColumns", { columns: unknown.join(", ") })}
                </li>
              )}
            </ul>
          )}
          {summary.results.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200">
              <ul className="divide-y divide-zinc-100 text-sm">
                {summary.results.slice(0, 200).map((result) => (
                  <li key={result.row} className="flex items-start gap-2 px-3 py-2">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
                    <span className="text-zinc-700">
                      <span className="font-medium text-zinc-900">
                        {t("customers.import.row", { row: lines[result.row] ?? result.row + 2 })}
                      </span>{" "}
                      {rows[result.row]?.name || rows[result.row]?.sku}
                      {(rows[result.row]?.name || rows[result.row]?.sku) && " — "}
                      {problem(result.error, result.field)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[13px] text-zinc-500">
            {summary.counts.errors > 0
              ? t("customers.import.errorsHint")
              : t("customers.import.readyHint")}
          </p>
        </div>
      )}
    </Modal>
  );
}
