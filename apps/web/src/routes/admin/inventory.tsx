import {
  addDays,
  formatPrice,
  fromMinorUnits,
  instantToZoned,
  MANUAL_STOCK_KINDS,
  PRODUCT_UNITS,
  type ProductInput,
  productSchema,
  STOCK_MOVEMENT_KINDS,
  type StockMovementKind,
  stockMovementSchema,
  todayIn,
  zonedTimeToInstant,
} from "@openturnly/core";
import { ArrowLeftRight, Package, Plus, Search, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox, searchable } from "../../components/combobox.tsx";
import { useConfirm } from "../../components/confirm.tsx";
import { EmptyState, Modal, PageHeader, PageTabs, Switch } from "../../components/controls.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import {
  DateRangePicker,
  type Period,
  periodPresets,
} from "../../components/date-range-picker.tsx";
import { MoneyInput } from "../../components/money-input.tsx";
import { toast } from "../../components/toast.tsx";
import { Alert, Badge, Button, Field, Input, Select, Spinner } from "../../components/ui.tsx";
import type { Product, StockMovement } from "../../lib/api.ts";
import { useLocations } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { type Cell, downloadCsv, downloadXlsx } from "../../lib/export.ts";
import { errorMessage, type FieldErrors, fieldMessage, validate } from "../../lib/forms.ts";
import {
  useMoveStock,
  useProductMutations,
  useProducts,
  useStockMovements,
} from "../../lib/inventory.ts";
import { useTab } from "../../lib/tabs.ts";
import { ExportMenu } from "./appointments-list.tsx";
import { useBusinessContext } from "./business.tsx";

const TABS = ["products", "movements"] as const;

/** "Reuzel · Pote · 113 g": what tells similar products apart. */
function productDetail(product: Product, unitLabel: (unit: string) => string) {
  const content = product.content !== null ? `${product.content} ${unitLabel(product.unit)}` : null;
  return [product.brand, product.format, content].filter(Boolean).join(" · ");
}

/** Products with their stock at each location, and the history of every movement. */
export function InventoryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useTab(TABS);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [moving, setMoving] = useState(false);

  return (
    <>
      <PageHeader
        title={t("inventory.title")}
        subtitle={t("inventory.subtitle")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setMoving(true)}>
              <ArrowLeftRight className="size-4" aria-hidden />
              {t("inventory.move")}
            </Button>
            <Button data-tour="inventory-new" onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden />
              {t("inventory.new")}
            </Button>
          </>
        }
      />
      <PageTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "products", label: t("inventory.tabs.products") },
          { value: "movements", label: t("inventory.tabs.movements") },
        ]}
      />
      {tab === "products" ? (
        <ProductsTable onOpen={setEditing} onNew={() => setEditing("new")} />
      ) : (
        <MovementsTable />
      )}
      {editing && (
        <ProductForm
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {moving && <StockMovementForm onClose={() => setMoving(false)} />}
    </>
  );
}

function ProductsTable({
  onOpen,
  onNew,
}: {
  onOpen: (product: Product) => void;
  onNew: () => void;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const products = useProducts(business.id);
  const locations = useLocations(business.id).data ?? [];
  const [locationId, setLocationId] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [alarms, setAlarms] = useState(false);
  const [query, setQuery] = useState("");
  const money = (amount: number) => formatPrice(amount, business.currency);
  const unitLabel = (unit: string) => t(`inventory.units.${unit}` as "inventory.units.unit");

  const shown = locationId ? locations.filter((location) => location.id === locationId) : locations;
  const stockOf = (product: Product) =>
    shown.reduce((sum, location) => sum + (product.stock[location.id] ?? 0), 0);
  /** At or under the minimum at some location shown that carries it. */
  const low = (product: Product) =>
    product.active &&
    shown.some(
      (location) =>
        product.stock[location.id] !== undefined &&
        (product.stock[location.id] ?? 0) <= product.minStock,
    );

  const all = products.data ?? [];
  const categories = [...new Set(all.flatMap((p) => (p.category ? [p.category] : [])))].sort();
  const brands = [...new Set(all.flatMap((p) => (p.brand ? [p.brand] : [])))].sort();
  const needle = searchable(query.trim());
  const rows = all.filter(
    (product) =>
      (status === "all" || product.active === (status === "active")) &&
      (!category || product.category === category) &&
      (!brand || product.brand === brand) &&
      (!alarms || low(product)) &&
      (!needle ||
        searchable(`${product.name} ${product.sku ?? ""} ${product.brand ?? ""}`).includes(needle)),
  );
  const alarmCount = all.filter(low).length;

  const columns: Column<Product>[] = [
    {
      key: "name",
      header: t("inventory.colProduct"),
      cell: (product) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-zinc-900">{product.name}</div>
          <div className="truncate text-[13px] text-zinc-500">
            {productDetail(product, unitLabel) || product.sku || "—"}
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: t("inventory.category"),
      className: "hidden md:table-cell",
      cell: (product) => <span className="text-zinc-600">{product.category ?? "—"}</span>,
    },
    {
      key: "price",
      header: t("inventory.price"),
      className: "hidden sm:table-cell text-right whitespace-nowrap",
      cell: (product) => (
        <div className="text-right">
          <div className="text-zinc-900 tabular-nums">
            {product.forSale ? money(product.priceAmount) : t("inventory.notForSale")}
          </div>
          {product.costAmount !== null && (
            <div className="text-[13px] text-zinc-500 tabular-nums">
              {t("inventory.costShort", { amount: money(product.costAmount) })}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "stock",
      header: t("inventory.colStock"),
      className: "text-right whitespace-nowrap",
      cell: (product) => (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 font-medium tabular-nums",
            low(product) ? "text-red-600" : "text-zinc-900",
          )}
          title={low(product) ? t("inventory.lowStock", { min: product.minStock }) : undefined}
        >
          {low(product) && <TriangleAlert className="size-3.5" aria-hidden />}
          {stockOf(product)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("inventory.colStatus"),
      className: "hidden sm:table-cell",
      cell: (product) =>
        product.active ? (
          <Badge tone="success">{t("inventory.active")}</Badge>
        ) : (
          <Badge>{t("inventory.inactive")}</Badge>
        ),
    },
  ];

  /** The inventory as a sheet: one row per product, stock per location. */
  const sheet = (): Cell[][] => [
    [
      t("inventory.colProduct"),
      t("inventory.sku"),
      t("inventory.category"),
      t("inventory.brand"),
      t("inventory.format"),
      t("inventory.content"),
      `${t("inventory.price")} (${business.currency})`,
      `${t("inventory.cost")} (${business.currency})`,
      t("inventory.minStock"),
      ...shown.map((location) => location.name),
      t("inventory.colStatus"),
    ],
    ...rows.map((product): Cell[] => [
      product.name,
      product.sku,
      product.category,
      product.brand,
      product.format,
      product.content !== null ? `${product.content} ${unitLabel(product.unit)}` : null,
      fromMinorUnits(product.priceAmount, business.currency),
      product.costAmount === null ? null : fromMinorUnits(product.costAmount, business.currency),
      product.minStock,
      ...shown.map((location) => product.stock[location.id] ?? 0),
      product.active ? t("inventory.active") : t("inventory.inactive"),
    ]),
  ];
  const fileName = `${t("inventory.exportFile")}-${business.slug}-${todayIn(business.timezone)}`;

  if (products.isPending) return <Spinner />;
  if (products.isError) return <Alert>{errorMessage(t, products.error)}</Alert>;
  if (all.length === 0) {
    return (
      <EmptyState
        icon={<Package className="size-5" aria-hidden />}
        title={t("inventory.emptyTitle")}
        body={t("inventory.emptyBody")}
        action={
          <Button onClick={onNew}>
            <Plus className="size-4" aria-hidden />
            {t("inventory.new")}
          </Button>
        }
      />
    );
  }

  const filter = "w-44 [&_select]:h-8 [&_select]:text-[13px]";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {locations.length > 1 && (
          <Select
            aria-label={t("locations.pick")}
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className={filter}
          >
            <option value="">{t("locations.all")}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label={t("inventory.category")}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className={filter}
        >
          <option value="">{t("inventory.allCategories")}</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t("inventory.brand")}
          value={brand}
          onChange={(event) => setBrand(event.target.value)}
          className={filter}
        >
          <option value="">{t("inventory.allBrands")}</option>
          {brands.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t("inventory.colStatus")}
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
          className={filter}
        >
          <option value="active">{t("inventory.active")}</option>
          <option value="inactive">{t("inventory.inactive")}</option>
          <option value="all">{t("inventory.allStatuses")}</option>
        </Select>
        <button
          type="button"
          aria-pressed={alarms}
          onClick={() => setAlarms((current) => !current)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium",
            alarms
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
          )}
        >
          <TriangleAlert className="size-3.5" aria-hidden />
          {t("inventory.alarms", { count: alarmCount })}
        </button>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(product) => product.id}
        onRowClick={onOpen}
        pageSize={25}
        empty={t("inventory.noMatches")}
        toolbar={
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("inventory.search")}
                aria-label={t("inventory.search")}
                className="h-8 pl-8"
              />
            </div>
            <ExportMenu
              disabled={rows.length === 0}
              onExcel={() => downloadXlsx(`${fileName}.xlsx`, t("inventory.title"), sheet())}
              onCsv={() => downloadCsv(`${fileName}.csv`, sheet())}
            />
          </div>
        }
      />
    </div>
  );
}

/** Text with suggestions from what was typed before (categories, brands, formats). */
function Suggest({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <>
      <Input
        id={id}
        list={`${id}-list`}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={`${id}-list`}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
}

function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const { save, remove } = useProductMutations(business.id);
  const products = useProducts(business.id).data ?? [];
  const locations = useLocations(business.id).data?.filter((location) => location.active) ?? [];
  const confirm = useConfirm();
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [format, setFormat] = useState(product?.format ?? "");
  const [content, setContent] = useState(product?.content?.toString() ?? "");
  const [unit, setUnit] = useState<string>(product?.unit ?? "unit");
  const [price, setPrice] = useState(product?.priceAmount ?? 0);
  const [cost, setCost] = useState(product?.costAmount ?? 0);
  const [minStock, setMinStock] = useState(String(product?.minStock ?? 0));
  const [forSale, setForSale] = useState(product?.forSale ?? true);
  const [active, setActive] = useState(product?.active ?? true);
  const [initialStock, setInitialStock] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const known = (pick: (product: Product) => string | null) =>
    [...new Set(products.flatMap((item) => (pick(item) ? [pick(item) as string] : [])))].sort();

  const submit = () => {
    const values: ProductInput = {
      name,
      sku,
      category,
      brand,
      format,
      content: content.trim() ? Number(content.replace(",", ".")) : null,
      unit: unit as ProductInput["unit"],
      priceAmount: price,
      costAmount: cost > 0 ? cost : null,
      minStock: Number(minStock) || 0,
      forSale,
      active,
      ...(!product && initialStock.trim()
        ? { initialStock: Number(initialStock), ...(locationId ? { locationId } : {}) }
        : {}),
    };
    const result = validate(productSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    save.mutate(
      { id: product?.id, input: values },
      {
        onSuccess: () => {
          toast.success(product ? t("common.saved") : t("inventory.created"));
          onClose();
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  };

  const deleteProduct = async () => {
    if (!product) return;
    const ok = await confirm({
      title: t("inventory.deleteTitle", { name: product.name }),
      description: t("inventory.deleteBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (ok) {
      remove.mutate(product.id, {
        onSuccess: () => {
          toast.success(t("inventory.deleted"));
          onClose();
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      });
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={product ? t("inventory.edit") : t("inventory.new")}
      footer={
        <>
          {product && (
            <Button
              variant="ghost"
              className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700"
              loading={remove.isPending}
              onClick={deleteProduct}
            >
              {t("common.delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("fields.name")}
          error={fieldMessage(t, "name", errors.name)}
          className="sm:col-span-2"
        >
          {(props) => (
            <Input
              {...props}
              placeholder={t("inventory.namePlaceholder")}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label={t("inventory.category")} optional>
          {(props) => (
            <Suggest
              id={props.id}
              value={category}
              onChange={setCategory}
              options={known((p) => p.category)}
            />
          )}
        </Field>
        <Field label={t("inventory.brand")} optional>
          {(props) => (
            <Suggest
              id={props.id}
              value={brand}
              onChange={setBrand}
              options={known((p) => p.brand)}
            />
          )}
        </Field>
        <Field label={t("inventory.format")} optional>
          {(props) => (
            <Suggest
              id={props.id}
              value={format}
              onChange={setFormat}
              options={known((p) => p.format)}
              placeholder={t("inventory.formatPlaceholder")}
            />
          )}
        </Field>
        <Field label={t("inventory.content")} optional>
          {(props) => (
            <div className="flex gap-2">
              <Input
                {...props}
                inputMode="decimal"
                className="text-right tabular-nums"
                placeholder="250"
                value={content}
                onChange={(event) => setContent(event.target.value.replace(/[^\d.,]/g, ""))}
              />
              <Select
                aria-label={t("inventory.unit")}
                className="w-32 shrink-0"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              >
                {PRODUCT_UNITS.map((value) => (
                  <option key={value} value={value}>
                    {t(`inventory.units.${value}`)}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </Field>
        <Field
          label={t("inventory.price")}
          error={fieldMessage(t, "priceAmount", errors.priceAmount)}
        >
          {(props) => (
            <MoneyInput
              id={props.id}
              currency={business.currency}
              value={price}
              onChange={setPrice}
            />
          )}
        </Field>
        <Field label={t("inventory.cost")} optional hint={t("inventory.costHint")}>
          {(props) => (
            <MoneyInput
              id={props.id}
              currency={business.currency}
              value={cost}
              onChange={setCost}
            />
          )}
        </Field>
        <Field label={t("inventory.sku")} optional>
          {(props) => (
            <Input {...props} value={sku} onChange={(event) => setSku(event.target.value)} />
          )}
        </Field>
        <Field label={t("inventory.minStock")} hint={t("inventory.minStockHint")}>
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              className="tabular-nums"
              value={minStock}
              onChange={(event) => setMinStock(event.target.value.replace(/\D/g, ""))}
            />
          )}
        </Field>
        {!product && (
          <Field label={t("inventory.initialStock")} optional>
            {(props) => (
              <div className="flex gap-2">
                <Input
                  {...props}
                  inputMode="numeric"
                  className="tabular-nums"
                  placeholder="0"
                  value={initialStock}
                  onChange={(event) => setInitialStock(event.target.value.replace(/\D/g, ""))}
                />
                {locations.length > 1 && (
                  <Select
                    aria-label={t("locations.pick")}
                    className="w-40 shrink-0"
                    value={locationId}
                    onChange={(event) => setLocationId(event.target.value)}
                  >
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            )}
          </Field>
        )}
        <div className="space-y-3 border-t border-zinc-100 pt-4 sm:col-span-2">
          <Switch
            checked={forSale}
            onChange={setForSale}
            label={t("inventory.forSale")}
            description={t("inventory.forSaleHint")}
          />
          <Switch
            checked={active}
            onChange={setActive}
            label={t("inventory.activeLabel")}
            description={t("inventory.activeHint")}
          />
        </div>
      </div>
    </Modal>
  );
}

/** Stock in, a count, internal use or a transfer, by hand. */
function StockMovementForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const products = (useProducts(business.id).data ?? []).filter((product) => product.active);
  const locations = useLocations(business.id).data?.filter((location) => location.active) ?? [];
  const move = useMoveStock(business.id);
  const [kind, setKind] = useState<(typeof MANUAL_STOCK_KINDS)[number]>("purchase");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [toLocationId, setToLocationId] = useState(locations[1]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState(0);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const product = products.find((item) => item.id === productId);
  const current = product?.stock[locationId] ?? 0;
  const kinds = MANUAL_STOCK_KINDS.filter(
    (option) => option !== "transfer" || locations.length > 1,
  );

  const submit = () => {
    const values = {
      kind,
      productId,
      locationId,
      quantity: Number(quantity) || 0,
      ...(kind === "transfer" ? { toLocationId } : {}),
      unitCost: kind === "purchase" && unitCost > 0 ? unitCost : null,
      note,
    };
    const result = validate(stockMovementSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) {
      if (result.errors?.productId) toast.error(t("inventory.pickProduct"));
      return;
    }
    move.mutate(values, {
      onSuccess: ({ balance }) => {
        toast.success(t("inventory.moved", { balance }));
        onClose();
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("inventory.move")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={move.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className={cn("grid gap-2", kinds.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
          {kinds.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                kind === option
                  ? "border-brand-500 bg-brand-50/50"
                  : "border-zinc-200 hover:border-zinc-300",
              )}
            >
              <div className="text-sm font-medium text-zinc-900">
                {t(`inventory.moveKinds.${option}`)}
              </div>
              <div className="mt-0.5 text-[12px] text-zinc-500">
                {t(`inventory.moveHints.${option}`)}
              </div>
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("inventory.colProduct")} className="sm:col-span-2">
            {(props) => (
              <Combobox
                id={props.id}
                value={productId}
                onChange={setProductId}
                options={products.map((item) => ({
                  value: item.id,
                  label: item.name,
                  detail: [item.brand, item.sku].filter(Boolean).join(" · ") || undefined,
                }))}
                placeholder={t("inventory.pickProduct")}
                searchPlaceholder={t("inventory.search")}
                emptyText={t("inventory.noMatches")}
              />
            )}
          </Field>
          {locations.length > 1 && (
            <Field label={kind === "transfer" ? t("inventory.fromLocation") : t("locations.pick")}>
              {(props) => (
                <Select
                  {...props}
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {kind === "transfer" && (
            <Field
              label={t("inventory.toLocation")}
              error={fieldMessage(t, "toLocationId", errors.toLocationId)}
            >
              {(props) => (
                <Select
                  {...props}
                  value={toLocationId}
                  onChange={(event) => setToLocationId(event.target.value)}
                >
                  {locations
                    .filter((location) => location.id !== locationId)
                    .map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}
          <Field
            label={kind === "adjustment" ? t("inventory.counted") : t("inventory.quantity")}
            hint={product ? t("inventory.currentStock", { count: current }) : undefined}
            error={fieldMessage(t, "quantity", errors.quantity)}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                className="tabular-nums"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value.replace(/\D/g, ""))}
              />
            )}
          </Field>
          {kind === "purchase" && (
            <Field label={t("inventory.unitCost")} optional>
              {(props) => (
                <MoneyInput
                  id={props.id}
                  currency={business.currency}
                  value={unitCost}
                  onChange={setUnitCost}
                />
              )}
            </Field>
          )}
          <Field label={t("checkout.note")} optional className="sm:col-span-2">
            {(props) => (
              <Input
                {...props}
                placeholder={t("inventory.notePlaceholder")}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

const KIND_TONES: Record<
  StockMovementKind,
  "success" | "danger" | "neutral" | "brand" | "warning"
> = {
  purchase: "success",
  return: "success",
  sale: "brand",
  internal: "warning",
  adjustment: "neutral",
  transfer_in: "neutral",
  transfer_out: "neutral",
};

/** Every stock movement in a period: entries, sales, counts, internal use, transfers. */
function MovementsTable() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const tz = business.timezone;
  const locations = useLocations(business.id).data ?? [];
  const [period, setPeriod] = useState<Period>(() => periodPresets(todayIn(tz)).month);
  const [locationId, setLocationId] = useState("");
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const range = useMemo(
    () => ({
      from: new Date(zonedTimeToInstant(period.start, 0, tz)).toISOString(),
      to: new Date(zonedTimeToInstant(addDays(period.end, 1), 0, tz)).toISOString(),
    }),
    [period, tz],
  );
  const movements = useStockMovements(business.id, { ...range, locationId, kind });
  const rows = useMemo(() => {
    const needle = searchable(query.trim());
    return (movements.data ?? []).filter(
      (move) => !needle || searchable(move.productName).includes(needle),
    );
  }, [movements.data, query]);
  const when = (iso: string) => instantToZoned(Date.parse(iso), tz);
  const day = new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  const columns: Column<StockMovement>[] = [
    {
      key: "when",
      header: t("sales.colDate"),
      className: "whitespace-nowrap",
      cell: (move) => {
        const { date, time } = when(move.createdAt);
        return (
          <span className="text-zinc-600 tabular-nums">
            {day.format(new Date(`${date}T12:00:00Z`))} · {time}
          </span>
        );
      },
    },
    {
      key: "product",
      header: t("inventory.colProduct"),
      cell: (move) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-zinc-900">{move.productName}</div>
          <div className="truncate text-[13px] text-zinc-500">
            {[
              locations.length > 1 ? move.locationName : null,
              move.sale ? t("checkout.paidIn", { number: move.sale.number }) : null,
              move.note,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </div>
      ),
    },
    {
      key: "kind",
      header: t("inventory.colKind"),
      cell: (move) => (
        <Badge tone={KIND_TONES[move.kind]}>{t(`inventory.kinds.${move.kind}`)}</Badge>
      ),
    },
    {
      key: "quantity",
      header: t("inventory.quantity"),
      className: "text-right",
      cell: (move) => (
        <span
          className={cn(
            "font-medium tabular-nums",
            move.quantity > 0 ? "text-emerald-700" : "text-red-600",
          )}
        >
          {move.quantity > 0 ? `+${move.quantity}` : move.quantity}
        </span>
      ),
    },
    {
      key: "balance",
      header: t("inventory.balance"),
      className: "hidden sm:table-cell text-right",
      cell: (move) => <span className="text-zinc-600 tabular-nums">{move.balanceAfter}</span>,
    },
    {
      key: "by",
      header: t("inventory.by"),
      className: "hidden lg:table-cell",
      cell: (move) => <span className="text-zinc-600">{move.createdByName ?? "—"}</span>,
    },
  ];

  const sheet = (): Cell[][] => [
    [
      t("sales.colDate"),
      t("agenda.exportStart"),
      t("inventory.colProduct"),
      t("locations.pick"),
      t("inventory.colKind"),
      t("inventory.quantity"),
      t("inventory.balance"),
      `${t("inventory.unitCost")} (${business.currency})`,
      t("sales.colNumber"),
      t("checkout.note"),
      t("inventory.by"),
    ],
    ...rows.map((move): Cell[] => {
      const { date, time } = when(move.createdAt);
      return [
        date,
        time,
        move.productName,
        move.locationName,
        t(`inventory.kinds.${move.kind}`),
        move.quantity,
        move.balanceAfter,
        move.unitCost === null ? null : fromMinorUnits(move.unitCost, business.currency),
        move.sale?.number ?? null,
        move.note,
        move.createdByName,
      ];
    }),
  ];
  const fileName = `${t("inventory.movementsFile")}-${business.slug}-${period.start}-${period.end}`;

  const filter = "w-44 [&_select]:h-8 [&_select]:text-[13px]";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker
          value={period}
          onChange={setPeriod}
          today={todayIn(tz)}
          locale={language}
          labels={{
            today: t("agenda.periods.today"),
            week: t("agenda.periods.week"),
            month: t("agenda.periods.month"),
            lastMonth: t("agenda.periods.lastMonth"),
            next30: t("agenda.periods.next30"),
            last30: t("agenda.periods.last30"),
            year: t("agenda.periods.year"),
            custom: t("agenda.periods.custom"),
            previous: t("agenda.previous"),
            next: t("agenda.next"),
          }}
        />
        {locations.length > 1 && (
          <Select
            aria-label={t("locations.pick")}
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className={filter}
          >
            <option value="">{t("locations.all")}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label={t("inventory.colKind")}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className={filter}
        >
          <option value="">{t("inventory.allKinds")}</option>
          {STOCK_MOVEMENT_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`inventory.kinds.${value}`)}
            </option>
          ))}
        </Select>
      </div>
      {movements.isError && <Alert>{errorMessage(t, movements.error)}</Alert>}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(move) => move.id}
        pageSize={25}
        empty={movements.isPending ? <Spinner /> : t("inventory.noMovements")}
        toolbar={
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("inventory.search")}
                aria-label={t("inventory.search")}
                className="h-8 pl-8"
              />
            </div>
            <ExportMenu
              disabled={rows.length === 0}
              onExcel={() =>
                downloadXlsx(`${fileName}.xlsx`, t("inventory.tabs.movements"), sheet())
              }
              onCsv={() => downloadCsv(`${fileName}.csv`, sheet())}
            />
          </div>
        }
      />
    </div>
  );
}
