import {
  addDays,
  formatPrice,
  fromMinorUnits,
  instantToZoned,
  MANUAL_STOCK_KINDS,
  type ProductAttributeKind,
  STOCK_MOVEMENT_KINDS,
  type StockMovementKind,
  stockMovementSchema,
  todayIn,
  zonedTimeToInstant,
} from "@openturnly/core";
import {
  ArrowLeftRight,
  ChevronDown,
  Package,
  Plus,
  Search,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Combobox,
  searchable,
  useClickOutside,
  useMenuPlacement,
} from "../../components/combobox.tsx";
import { EmptyState, Modal, PageHeader, PageTabs } from "../../components/controls.tsx";
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
import { contentText, useMoveStock, useProducts, useStockMovements } from "../../lib/inventory.ts";
import { useTab } from "../../lib/tabs.ts";
import { ExportMenu } from "./appointments-list.tsx";
import { useBusinessContext } from "./business.tsx";
import { ListManager, ProductForm, useProductLists } from "./product-form.tsx";
import { ImportProducts, productSheet } from "./product-import.tsx";

const TABS = ["products", "movements"] as const;

/** A category, brand or size in a table cell: one line, cut short if it's long. */
function ListName({ name }: { name: string | null }) {
  return (
    <span
      className="block max-w-[8rem] truncate whitespace-nowrap text-zinc-600 xl:max-w-[14rem]"
      title={name ?? undefined}
    >
      {name ?? "—"}
    </span>
  );
}

/** At or under its alarm at some location shown. */
function isLow(product: Product, locationIds: string[]) {
  return (
    product.active &&
    locationIds.some((id) => {
      const at = product.alerts[id];
      return at !== undefined && (product.stock[id] ?? 0) <= at;
    })
  );
}

/** Products with their stock at each location, and the history of every movement. */
export function InventoryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useTab(TABS);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [creatingList, setCreatingList] = useState<ProductAttributeKind | null>(null);
  const [moving, setMoving] = useState(false);
  const [uploading, setUploading] = useState(false);

  return (
    <>
      <PageHeader
        title={t("inventory.title")}
        subtitle={t("inventory.subtitle")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setUploading(true)}>
              <Upload className="size-4" aria-hidden />
              {t("inventory.upload")}
            </Button>
            <Button variant="secondary" onClick={() => setMoving(true)}>
              <ArrowLeftRight className="size-4" aria-hidden />
              {t("inventory.move")}
            </Button>
            <NewMenu onProduct={() => setEditing("new")} onList={setCreatingList} />
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
      {creatingList && <ListManager kind={creatingList} onClose={() => setCreatingList(null)} />}
      {moving && <StockMovementForm onClose={() => setMoving(false)} />}
      {uploading && <ImportProducts onClose={() => setUploading(false)} />}
    </>
  );
}

/** "Nuevo": a product, or an entry for the category or brand lists. */
function NewMenu({
  onProduct,
  onList,
}: {
  onProduct: () => void;
  onList: (kind: ProductAttributeKind) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const placement = useMenuPlacement(open, wrapper, 300, "right");
  useClickOutside(open, [wrapper], () => setOpen(false));
  const options = [
    { key: "product", title: t("inventory.newProduct"), pick: onProduct },
    ...(["category", "brand"] as const).map((kind) => ({
      key: kind,
      title: t(`inventory.lists.${kind}.new`),
      pick: () => onList(kind),
    })),
  ];
  return (
    <div ref={wrapper} className="relative">
      <Button
        data-tour="inventory-new"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Plus className="size-4" aria-hidden />
        {t("inventory.new")}
        <ChevronDown className="size-4 opacity-70" aria-hidden />
      </Button>
      {open && (
        <div
          role="menu"
          style={placement}
          className="absolute top-full right-0 z-30 mt-1 w-[300px] max-w-[calc(100vw-1rem)] rounded-xl bg-white p-1 shadow-lg ring-1 ring-zinc-200"
        >
          {options.map((option, index) => (
            <button
              key={option.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                option.pick();
              }}
              className={cn(
                "block w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-100",
                index === 1 && "mt-1 border-t border-zinc-100 pt-2.5",
              )}
            >
              <span className="block text-sm font-medium text-zinc-900">{option.title}</span>
              <span className="block text-[13px] text-zinc-500">
                {t(`inventory.menu.${option.key}` as "inventory.menu.product")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductsTable({
  onOpen,
  onNew,
}: {
  onOpen: (product: Product) => void;
  onNew: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const products = useProducts(business.id);
  const locations = useLocations(business.id).data ?? [];
  const lists = useProductLists(business.id);
  const [locationId, setLocationId] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [alarms, setAlarms] = useState(false);
  const [query, setQuery] = useState("");
  const money = (amount: number) => formatPrice(amount, business.currency);

  const shown = locationId ? locations.filter((location) => location.id === locationId) : locations;
  const stockOf = (product: Product) =>
    shown.reduce((sum, location) => sum + (product.stock[location.id] ?? 0), 0);
  const shownIds = shown.map((location) => location.id);
  const low = (product: Product) => isLow(product, shownIds);
  const size = (product: Product) => contentText(t, i18n.language, product);
  /** "Reuzel · 113 g": what tells similar products apart. */
  const detail = (product: Product) =>
    [lists.nameOf(product.brandId), size(product)].filter(Boolean).join(" · ");

  const all = products.data ?? [];
  const needle = searchable(query.trim());
  const rows = all.filter(
    (product) =>
      (status === "all" || product.active === (status === "active")) &&
      (!category || product.categoryId === category) &&
      (!brand || product.brandId === brand) &&
      (!alarms || low(product)) &&
      (!needle ||
        searchable(`${product.name} ${product.sku ?? ""} ${detail(product)}`).includes(needle)),
  );
  const alarmCount = all.filter(low).length;

  const columns: Column<Product>[] = [
    {
      key: "name",
      header: t("inventory.colProduct"),
      cell: (product) => (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-zinc-900">{product.name}</span>
            {/* The status has its own column on wide screens. */}
            {!product.active && (
              <span className="shrink-0 xl:hidden">
                <Badge>{t("inventory.inactive")}</Badge>
              </span>
            )}
          </div>
          {/* Brand and size get their own columns as the screen widens. */}
          <div className="truncate text-[13px] text-zinc-500">
            <span className="lg:hidden">{detail(product) || product.sku || "—"}</span>
            <span className="hidden lg:inline xl:hidden">
              {[size(product), product.sku].filter(Boolean).join(" · ")}
            </span>
            <span className="hidden xl:inline">{product.sku}</span>
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: t("inventory.category"),
      className: "hidden md:table-cell",
      cell: (product) => <ListName name={lists.nameOf(product.categoryId)} />,
    },
    {
      key: "brand",
      header: t("inventory.brand"),
      className: "hidden lg:table-cell",
      cell: (product) => <ListName name={lists.nameOf(product.brandId)} />,
    },
    {
      key: "content",
      header: t("inventory.content"),
      className: "hidden xl:table-cell",
      cell: (product) => <ListName name={size(product)} />,
    },
    {
      key: "price",
      header: t("inventory.colPrice"),
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
          title={
            low(product)
              ? t("inventory.lowStock", {
                  min: Math.max(...shownIds.map((id) => product.alerts[id] ?? 0)),
                })
              : undefined
          }
        >
          {low(product) && <TriangleAlert className="size-3.5" aria-hidden />}
          {stockOf(product)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("inventory.colStatus"),
      className: "hidden xl:table-cell",
      cell: (product) =>
        product.active ? (
          <Badge tone="success">{t("inventory.active")}</Badge>
        ) : (
          <Badge>{t("inventory.inactive")}</Badge>
        ),
    },
  ];

  /** The same sheet the bulk upload reads, so an export can be edited and uploaded back. */
  const sheet = (): Cell[][] =>
    productSheet(
      t,
      i18n.language,
      business.currency,
      rows,
      shown,
      new Map((lists.query.data ?? []).map((entry) => [entry.id, entry])),
    );
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
            {t("inventory.newProduct")}
          </Button>
        }
      />
    );
  }

  const filter = "w-44 [&_select]:h-8 [&_select]:text-[13px]";
  return (
    <div className="space-y-4">
      {alarmCount > 0 && !alarms && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"
        >
          <TriangleAlert className="size-4 shrink-0 text-amber-600" aria-hidden />
          <span className="min-w-0 flex-1">{t("inventory.lowBanner", { count: alarmCount })}</span>
          <button
            type="button"
            onClick={() => setAlarms(true)}
            className="font-medium text-amber-900 underline-offset-2 hover:underline"
          >
            {t("inventory.lowBannerAction")}
          </button>
        </div>
      )}
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
        {(
          [
            ["category", category, setCategory, t("inventory.allCategories")],
            ["brand", brand, setBrand, t("inventory.allBrands")],
          ] as const
        ).map(([kind, value, setValue, allLabel]) =>
          lists.of(kind).length === 0 ? null : (
            <Select
              key={kind}
              aria-label={t(`inventory.${kind}`)}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={filter}
            >
              <option value="">{allLabel}</option>
              {lists.of(kind).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          ),
        )}
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

/** Stock in, a count, internal use or a transfer, by hand. */
function StockMovementForm({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const products = (useProducts(business.id).data ?? []).filter((product) => product.active);
  const locations = useLocations(business.id).data?.filter((location) => location.active) ?? [];
  const lists = useProductLists(business.id);
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
                  detail:
                    [lists.nameOf(item.brandId), contentText(t, i18n.language, item), item.sku]
                      .filter(Boolean)
                      .join(" · ") || undefined,
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
