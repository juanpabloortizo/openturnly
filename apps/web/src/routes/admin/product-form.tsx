import {
  attributeKey,
  COMMISSION_TYPES,
  type CommissionType,
  DEFAULT_TAX_RATES,
  PRODUCT_UNITS,
  type ProductAttributeKind,
  type ProductInput,
  type ProductUnit,
  productSchema,
} from "@openturnly/core";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "../../components/confirm.tsx";
import { Modal, Switch } from "../../components/controls.tsx";
import { MoneyInput } from "../../components/money-input.tsx";
import { toast } from "../../components/toast.tsx";
import { Button, Field, Input, Select, Textarea } from "../../components/ui.tsx";
import type { Product, ProductAttribute } from "../../lib/api.ts";
import { useLocations } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { errorMessage, type FieldErrors, fieldMessage, validate } from "../../lib/forms.ts";
import {
  useAttributeMutations,
  useProductAttributes,
  useProductMutations,
} from "../../lib/inventory.ts";
import { useBusinessContext } from "./business.tsx";

/** The business's categories and brands, sorted by name. */
export function useProductLists(businessId: string) {
  const { i18n } = useTranslation();
  const query = useProductAttributes(businessId);
  const all = query.data ?? [];
  const byId = new Map(all.map((entry) => [entry.id, entry]));
  const of = (kind: ProductAttributeKind) =>
    all
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language, { numeric: true }));
  const nameOf = (id: string | null) => (id ? (byId.get(id)?.name ?? null) : null);
  /** The entry that's the same as `name` however it's written ("coca cola" is "Coca-Cola"). */
  const same = (kind: ProductAttributeKind, name: string) => {
    const key = attributeKey(name);
    return key ? of(kind).find((entry) => attributeKey(entry.name) === key) : undefined;
  };
  return { query, of, nameOf, same };
}

/**
 * A category or brand list in one dialog: type a name and add it, and every entry
 * shows underneath (the ones like what's typed), to rename or (if no product uses it)
 * delete. Opened from a product, `onPick` takes the entry added or clicked.
 */
export function ListManager({
  kind,
  onClose,
  onPick,
}: {
  kind: ProductAttributeKind;
  onClose: () => void;
  onPick?: (entry: ProductAttribute) => void;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const confirm = useConfirm();
  const { save, remove } = useAttributeMutations(business.id);
  const lists = useProductLists(business.id);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const entries = lists.of(kind);
  // What's typed also searches the list, so a long one stays easy to go through.
  const typed = attributeKey(name);
  const shown = typed
    ? entries.filter((entry) => attributeKey(entry.name).includes(typed))
    : entries;
  const duplicate = name.trim() ? lists.same(kind, name) : undefined;
  const renamedTo = editing ? lists.same(kind, editing.name) : undefined;
  const renameClash = renamedTo && renamedTo.id !== editing?.id ? renamedTo : undefined;

  const pick = (entry: ProductAttribute) => {
    onPick?.(entry);
    onClose();
  };
  const add = () => {
    if (!name.trim() || duplicate) return;
    save.mutate(
      { input: { kind, name } },
      {
        onSuccess: (saved) => {
          if (onPick) return pick(saved);
          setName("");
          input.current?.focus();
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  };
  const rename = () => {
    if (!editing?.name.trim() || renameClash) return;
    save.mutate(
      { id: editing.id, input: { kind, name: editing.name } },
      {
        onSuccess: () => setEditing(null),
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  };

  const deleteEntry = async (entry: ProductAttribute) => {
    const ok = await confirm({
      title: t("inventory.deleteListTitle", { name: entry.name }),
      description: t("inventory.deleteListBody", { what: t(`inventory.lists.${kind}.empty`) }),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(entry.id, {
      onSuccess: () => toast.success(t("inventory.listDeleted", { name: entry.name })),
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t(`inventory.lists.${kind}.new`)}
      description={t(`inventory.lists.${kind}.hint`)}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              ref={input}
              aria-label={t("fields.name")}
              placeholder={t(`inventory.lists.${kind}.placeholder`)}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") add();
              }}
            />
            <Button
              variant="secondary"
              onClick={add}
              loading={save.isPending && !editing}
              disabled={!name.trim() || Boolean(duplicate)}
            >
              <Plus className="size-4" aria-hidden />
              {t("inventory.add")}
            </Button>
          </div>
          {duplicate && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span>{t("inventory.listExists", { name: duplicate.name })}</span>
              {onPick && (
                <button
                  type="button"
                  className="font-medium text-amber-900 underline-offset-2 hover:underline"
                  onClick={() => pick(duplicate)}
                >
                  {t("inventory.useExisting", { name: duplicate.name })}
                </button>
              )}
            </div>
          )}
        </div>

        {entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center text-[13px] text-zinc-500">
            {t("inventory.noLists", { what: t(`inventory.lists.${kind}.empty`) })}
          </p>
        ) : (
          <div>
            <p className="mb-1.5 text-xs text-zinc-500">
              {typed
                ? t("inventory.listMatches", { count: shown.length, total: entries.length })
                : t(`inventory.lists.${kind}.count`, { count: entries.length })}
            </p>
            {shown.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-200 px-4 py-4 text-center text-[13px] text-zinc-500">
                {t("inventory.listNoMatches")}
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200">
                {shown.map((entry) =>
                  editing?.id === entry.id ? (
                    <li key={entry.id} className="space-y-1.5 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Input
                          autoFocus
                          aria-label={t("inventory.rename")}
                          className="h-8"
                          value={editing.name}
                          onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") rename();
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setEditing(null);
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          onClick={rename}
                          loading={save.isPending}
                          disabled={!editing.name.trim() || Boolean(renameClash)}
                        >
                          {t("common.save")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          {t("common.cancel")}
                        </Button>
                      </div>
                      {renameClash && (
                        <p className="text-[13px] text-amber-700">
                          {t("inventory.listExists", { name: renameClash.name })}
                        </p>
                      )}
                    </li>
                  ) : (
                    <li key={entry.id} className="flex items-center gap-2 px-3 py-1.5">
                      {onPick ? (
                        <button
                          type="button"
                          onClick={() => pick(entry)}
                          className="min-w-0 flex-1 truncate rounded-md py-1 text-left text-sm text-zinc-900 hover:text-brand-700"
                        >
                          {entry.name}
                        </button>
                      ) : (
                        <span className="min-w-0 flex-1 truncate py-1 text-sm text-zinc-900">
                          {entry.name}
                        </span>
                      )}
                      <span className="shrink-0 text-[13px] text-zinc-500 tabular-nums">
                        {t("inventory.productsCount", { count: entry.products })}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("inventory.rename")}
                        title={t("inventory.rename")}
                        onClick={() => setEditing({ id: entry.id, name: entry.name })}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700 disabled:text-zinc-300 disabled:hover:bg-transparent"
                        aria-label={t("common.delete")}
                        title={
                          entry.products > 0
                            ? t("inventory.listInUse", { count: entry.products })
                            : t("common.delete")
                        }
                        disabled={entry.products > 0 || remove.isPending}
                        onClick={() => deleteEntry(entry)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Pick a category or brand from its list, or add a new one right there. */
function ListSelect({
  kind,
  value,
  onChange,
  error,
}: {
  kind: ProductAttributeKind;
  value: string | null;
  onChange: (id: string | null) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const lists = useProductLists(business.id);
  const [managing, setManaging] = useState(false);
  return (
    <Field label={t(`inventory.${kind}`)} optional error={fieldMessage(t, `${kind}Id`, error)}>
      {(props) => (
        <div>
          <Select
            {...props}
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">
              {t("inventory.choose", { what: t(`inventory.lists.${kind}.one`) })}
            </option>
            {lists.of(kind).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => setManaging(true)}
            className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline"
          >
            <Plus className="size-3.5" aria-hidden />
            {t(`inventory.lists.${kind}.new`)}
          </button>
          {managing && (
            <ListManager
              kind={kind}
              onClose={() => setManaging(false)}
              onPick={(entry) => onChange(entry.id)}
            />
          )}
        </div>
      )}
    </Field>
  );
}

const FORM_TABS = ["basic", "advanced", "alerts"] as const;
type FormTab = (typeof FORM_TABS)[number];
/** Which tab shows each field, to open the one with the first error. */
const FIELD_TABS: Record<string, FormTab> = {
  costAmount: "advanced",
  internalPriceAmount: "advanced",
  commissionValue: "advanced",
  taxRate: "advanced",
  description: "advanced",
};

/** "12" → 12; "" → null. */
const count = (text: string | undefined) => (text?.trim() ? Number(text) : null);

export function ProductForm({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const { save, remove } = useProductMutations(business.id);
  const locations = useLocations(business.id).data?.filter((location) => location.active) ?? [];
  const confirm = useConfirm();
  const [tab, setTab] = useState<FormTab>("basic");
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? null);
  const [brandId, setBrandId] = useState(product?.brandId ?? null);
  const [content, setContent] = useState(product?.content?.toString() ?? "");
  const [unit, setUnit] = useState<ProductUnit | null>(product?.unit ?? null);
  const [price, setPrice] = useState(product?.priceAmount ?? 0);
  const [forSale, setForSale] = useState(product?.forSale ?? true);
  const [active, setActive] = useState(product?.active ?? true);
  const [initialStock, setInitialStock] = useState<Record<string, string>>({});
  const [cost, setCost] = useState(product?.costAmount ?? 0);
  const [internalPrice, setInternalPrice] = useState(product?.internalPriceAmount ?? 0);
  const [commissionType, setCommissionType] = useState<CommissionType>(
    product?.commissionType ?? "percent",
  );
  const [percent, setPercent] = useState(
    product?.commissionType === "percent" && product.commissionValue !== null
      ? String(product.commissionValue)
      : "",
  );
  const [fixed, setFixed] = useState(
    product?.commissionType === "fixed" ? (product.commissionValue ?? 0) : 0,
  );
  const [taxIncluded, setTaxIncluded] = useState(product ? product.taxRate !== null : false);
  const [taxRate, setTaxRate] = useState(
    String(product?.taxRate ?? DEFAULT_TAX_RATES[business.country ?? ""] ?? ""),
  );
  const [description, setDescription] = useState(product?.description ?? "");
  const [alerts, setAlerts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(product?.alerts ?? {}).map(([locationId, at]) => [locationId, String(at)]),
    ),
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const rate = taxRate.trim() ? Number(taxRate.replace(",", ".")) : null;
    const amount = content.trim() ? Number(content.replace(",", ".")) : null;
    const values: ProductInput = {
      name,
      sku,
      categoryId,
      brandId,
      content: amount,
      unit,
      description,
      priceAmount: price,
      internalPriceAmount: internalPrice > 0 ? internalPrice : null,
      costAmount: cost > 0 ? cost : null,
      commissionType,
      commissionValue:
        commissionType === "percent"
          ? percent.trim()
            ? Number(percent.replace(",", "."))
            : null
          : fixed > 0
            ? fixed
            : null,
      taxRate: taxIncluded ? rate : null,
      forSale,
      active,
      alerts: locations.map((location) => ({
        locationId: location.id,
        alertAt: count(alerts[location.id]),
      })),
      ...(product
        ? {}
        : {
            initialStock: locations.flatMap((location) => {
              const quantity = count(initialStock[location.id]);
              return quantity ? [{ locationId: location.id, quantity }] : [];
            }),
          }),
    };
    const result = validate(productSchema, values);
    const found: FieldErrors = { ...(result.errors ?? {}) };
    if (taxIncluded && rate === null) found.taxRate = "required";
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      setTab(first.startsWith("alerts") ? "alerts" : (FIELD_TABS[first] ?? "basic"));
      return;
    }
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

  const numberInput = (
    value: string,
    onChange: (value: string) => void,
    props: Record<string, unknown> = {},
  ) => (
    <Input
      inputMode="numeric"
      className="tabular-nums"
      placeholder="0"
      {...props}
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
    />
  );

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={product ? t("inventory.edit") : t("inventory.newProduct")}
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
            {product ? t("common.save") : t("inventory.add")}
          </Button>
        </>
      }
    >
      <div
        role="tablist"
        className="sticky -top-4 z-10 -mx-5 -mt-4 mb-5 flex gap-5 overflow-x-auto border-b border-zinc-200 bg-white px-5 pt-3 [scrollbar-width:none]"
      >
        {FORM_TABS.map((value) => {
          const withErrors = Object.keys(errors).some(
            (field) =>
              (field.startsWith("alerts") ? "alerts" : (FIELD_TABS[field] ?? "basic")) === value,
          );
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                tab === value
                  ? "border-zinc-900 text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-800",
              )}
            >
              {t(`inventory.formTabs.${value}`)}
              {withErrors && <span className="size-1.5 rounded-full bg-red-500" aria-hidden />}
            </button>
          );
        })}
      </div>

      {tab === "basic" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("fields.name")} error={fieldMessage(t, "name", errors.name)}>
            {(props) => (
              <Input
                {...props}
                placeholder={t("inventory.namePlaceholder")}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label={t("inventory.sku")} optional error={fieldMessage(t, "sku", errors.sku)}>
            {(props) => (
              <Input {...props} value={sku} onChange={(event) => setSku(event.target.value)} />
            )}
          </Field>
          <ListSelect kind="brand" value={brandId} onChange={setBrandId} error={errors.brandId} />
          <ListSelect
            kind="category"
            value={categoryId}
            onChange={setCategoryId}
            error={errors.categoryId}
          />
          <Field
            label={t("inventory.content")}
            optional
            hint={t("inventory.contentHint")}
            error={
              fieldMessage(t, "content", errors.content) ?? fieldMessage(t, "unit", errors.unit)
            }
          >
            {(props) => (
              <div className="flex gap-2">
                <Input
                  {...props}
                  aria-invalid={errors.content ? true : undefined}
                  inputMode="decimal"
                  className="min-w-0 tabular-nums"
                  placeholder={t("inventory.contentPlaceholder")}
                  value={content}
                  onChange={(event) => setContent(event.target.value.replace(/[^\d.,]/g, ""))}
                />
                <Select
                  aria-label={t("inventory.unit")}
                  aria-invalid={errors.unit ? true : undefined}
                  className="w-40 shrink-0"
                  value={unit ?? ""}
                  onChange={(event) => setUnit((event.target.value || null) as ProductUnit | null)}
                >
                  <option value="">{t("inventory.unitPlaceholder")}</option>
                  {PRODUCT_UNITS.map((value) => (
                    <option key={value} value={value}>
                      {t(`inventory.unitNames.${value}`)}
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
          {!product && locations.length > 0 && (
            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium text-zinc-800">
                {t("inventory.initialStock")}
                <span className="ml-1.5 text-xs font-normal text-zinc-400">
                  {t("common.optional")}
                </span>
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {locations.map((location) => (
                  <div key={location.id} className="flex items-center gap-3">
                    {locations.length > 1 && (
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-600">
                        {location.name}
                      </span>
                    )}
                    <span className={locations.length > 1 ? "w-28 shrink-0" : "w-full"}>
                      {numberInput(
                        initialStock[location.id] ?? "",
                        (value) =>
                          setInitialStock((current) => ({ ...current, [location.id]: value })),
                        locations.length > 1
                          ? { "aria-label": location.name }
                          : { "aria-label": t("inventory.initialStock") },
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[13px] text-zinc-500">{t("inventory.initialStockHint")}</p>
            </div>
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
      )}

      {tab === "advanced" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("inventory.cost")}
            optional
            hint={t("inventory.costLongHint")}
            error={fieldMessage(t, "costAmount", errors.costAmount)}
          >
            {(props) => (
              <MoneyInput
                id={props.id}
                currency={business.currency}
                value={cost}
                onChange={setCost}
              />
            )}
          </Field>
          <Field
            label={t("inventory.internalPrice")}
            optional
            hint={t("inventory.internalPriceHint")}
            error={fieldMessage(t, "internalPriceAmount", errors.internalPriceAmount)}
          >
            {(props) => (
              <MoneyInput
                id={props.id}
                currency={business.currency}
                value={internalPrice}
                onChange={setInternalPrice}
              />
            )}
          </Field>
          <Field
            label={t("inventory.commission")}
            optional
            hint={t("inventory.commissionHint")}
            error={fieldMessage(t, "commissionValue", errors.commissionValue)}
          >
            {(props) => (
              <div className="flex gap-2">
                {commissionType === "percent" ? (
                  <Input
                    {...props}
                    inputMode="decimal"
                    className="tabular-nums"
                    placeholder="0"
                    value={percent}
                    onChange={(event) => setPercent(event.target.value.replace(/[^\d.,]/g, ""))}
                  />
                ) : (
                  <MoneyInput
                    id={props.id}
                    currency={business.currency}
                    value={fixed}
                    onChange={setFixed}
                    className="flex-1"
                  />
                )}
                <Select
                  aria-label={t("inventory.commission")}
                  className="w-36 shrink-0"
                  value={commissionType}
                  onChange={(event) => setCommissionType(event.target.value as CommissionType)}
                >
                  {COMMISSION_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {t(`inventory.commissionTypes.${value}`)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </Field>
          <div className="space-y-1.5">
            <Switch
              checked={taxIncluded}
              onChange={setTaxIncluded}
              label={t("inventory.tax")}
              description={t("inventory.taxHint")}
            />
            {taxIncluded && (
              <Field
                label={t("inventory.taxRate")}
                error={fieldMessage(t, "taxRate", errors.taxRate)}
              >
                {(props) => (
                  <div className="relative w-32">
                    <Input
                      {...props}
                      inputMode="decimal"
                      className="pr-8 tabular-nums"
                      value={taxRate}
                      onChange={(event) => setTaxRate(event.target.value.replace(/[^\d.,]/g, ""))}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-zinc-400">
                      %
                    </span>
                  </div>
                )}
              </Field>
            )}
          </div>
          <Field
            label={t("inventory.description")}
            optional
            className="sm:col-span-2"
            error={fieldMessage(t, "description", errors.description)}
          >
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                placeholder={t("inventory.descriptionPlaceholder")}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
        </div>
      )}

      {tab === "alerts" && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">{t("inventory.alertsIntro")}</p>
          <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {locations.map((location) => (
              <div key={location.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-900">{location.name}</div>
                  {product && (
                    <div className="text-[13px] text-zinc-500 tabular-nums">
                      {t("inventory.stockNow", { count: product.stock[location.id] ?? 0 })}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-zinc-600">
                  {t("inventory.alertAt")}
                  <span className="w-20">
                    {numberInput(
                      alerts[location.id] ?? "",
                      (value) => setAlerts((current) => ({ ...current, [location.id]: value })),
                      {
                        "aria-label": `${t("inventory.alertAt")} · ${location.name}`,
                        placeholder: "—",
                      },
                    )}
                  </span>
                  {t("inventory.alertAtHint")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
