import {
  type BookingForm,
  type BusinessUpdateInput,
  bookingFormSchema,
  businessUpdateSchema,
  formatPrice,
  PAGE_THEMES,
  type PageTheme,
} from "@openturnly/core";
import { ArrowUpRight, Check, ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { BookingBackdrop } from "../../components/booking-backdrop.tsx";
import { BookingHeader } from "../../components/booking-header.tsx";
import { Combobox } from "../../components/combobox.tsx";
import { useConfirm } from "../../components/confirm.tsx";
import { PageHeader, PageTabs, SaveBar, SettingsCard } from "../../components/controls.tsx";
import { SlugInput } from "../../components/slug-input.tsx";
import { toast } from "../../components/toast.tsx";
import {
  Button,
  buttonClass,
  CopyField,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "../../components/ui.tsx";
import type { Business } from "../../lib/api.ts";
import { BRAND_COLORS, brandStyle, DEFAULT_BRAND, isLight } from "../../lib/brand.ts";
import { useBusinessImages, useDeleteBusiness, useUpdateBusiness } from "../../lib/businesses.ts";
import { useServices } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import {
  apiFieldErrors,
  errorMessage,
  type FieldErrors,
  fieldMessage,
  validate,
} from "../../lib/forms.ts";
import { prepareImage } from "../../lib/images.ts";
import {
  countryName,
  currencyOptions,
  useTimeZoneCountries,
  useTimeZoneOptions,
} from "../../lib/locale.ts";
import { useTab } from "../../lib/tabs.ts";
import { AutomationsTab } from "./automations.tsx";
import { BookingFormCard, FormPreview } from "./booking-form.tsx";
import { publicUrl, useBusinessContext } from "./business.tsx";
import { UsersSection } from "./business-access.tsx";
import { IntegrationsTab } from "./integrations.tsx";

const TABS = ["general", "page", "integrations", "automations"] as const;

export function SettingsPage() {
  const { t } = useTranslation();
  const { business, user } = useBusinessContext();
  const [tab, setTab] = useTab(TABS);
  // The instance owner and the business admins manage access, integrations and automations.
  const admin = business.access.role !== "professional";
  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <PageTabs
        tour="settings-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "general", label: t("settings.tabs.general") },
          { value: "page", label: t("settings.tabs.page") },
          ...(admin
            ? [
                { value: "integrations" as const, label: t("settings.tabs.integrations") },
                { value: "automations" as const, label: t("settings.tabs.automations") },
              ]
            : []),
        ]}
      />
      {/* Keyed by business so switching businesses starts from fresh values. */}
      <div key={business.id}>
        {tab === "general" && (
          <GeneralTab business={business} admin={admin} owner={user.role === "owner"} />
        )}
        {tab === "page" && <PageTab business={business} />}
        {tab === "integrations" && admin && <IntegrationsTab />}
        {tab === "automations" && admin && <AutomationsTab />}
      </div>
    </>
  );
}

/** The business's details, region and language (one save), who has access, and deleting it. */
function GeneralTab({
  business,
  admin,
  owner,
}: {
  business: Business;
  admin: boolean;
  owner: boolean;
}) {
  const form = useBusinessForm(business, (current) => ({
    name: current.name,
    slug: current.slug,
    description: current.description ?? "",
    phone: current.phone ?? "",
    email: current.email ?? "",
    address: current.address ?? "",
    timezone: current.timezone,
    currency: current.currency,
    locale: current.locale,
  }));
  return (
    <div className="space-y-6">
      {/* The save bar floats while these cards are on screen. */}
      <div>
        <div className="space-y-6">
          <InfoCard form={form} />
          <RegionCard form={form} />
        </div>
        <SaveBar
          dirty={form.dirty}
          saving={form.saving}
          onSave={form.save}
          onDiscard={form.discard}
        />
      </div>
      {admin && <UsersSection />}
      {owner && <DeleteCard business={business} />}
    </div>
  );
}

/**
 * Everything about the booking page in one place: its link, images, colours and what it
 * asks, with a live preview on the right and one save for all of it.
 */
function PageTab({ business }: { business: Business }) {
  const { t } = useTranslation();
  const update = useUpdateBusiness(business.id);
  const savedColor = business.brandColor ?? DEFAULT_BRAND;
  const [brandColor, setBrandColor] = useState(savedColor);
  const [pageTheme, setPageTheme] = useState(business.pageTheme);
  const [form, setForm] = useState<BookingForm>(business.bookingForm);
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  // Bumped on discard so the questions editor starts again from the saved form.
  const [formVersion, setFormVersion] = useState(0);
  const [preview, setPreview] = useState<"page" | "form">("page");
  const dirty =
    brandColor !== savedColor ||
    pageTheme !== business.pageTheme ||
    JSON.stringify(form) !== JSON.stringify(business.bookingForm);

  const save = () => {
    const result = validate(bookingFormSchema, form);
    setFormErrors(result.errors ?? {});
    if (!result.data) {
      setPreview("form");
      return;
    }
    update.mutate(
      {
        brandColor: brandColor === DEFAULT_BRAND ? null : brandColor,
        pageTheme,
        bookingForm: result.data,
      },
      {
        onSuccess: (saved) => {
          setForm(saved.bookingForm);
          toast.success(t("common.saved"));
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  };
  const discard = () => {
    setBrandColor(savedColor);
    setPageTheme(business.pageTheme);
    setForm(business.bookingForm);
    setFormErrors({});
    setFormVersion((version) => version + 1);
  };

  return (
    <div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {/* The preview follows the part being edited (pointer too: Safari doesn't focus buttons). */}
          <div
            className="space-y-6"
            onPointerDownCapture={() => setPreview("page")}
            onFocusCapture={() => setPreview("page")}
          >
            <LinkCard business={business} />
            <ImagesCard business={business} />
            <AppearanceCard
              business={business}
              brandColor={brandColor}
              onBrandColor={setBrandColor}
              pageTheme={pageTheme}
              onPageTheme={setPageTheme}
            />
          </div>
          <div
            onPointerDownCapture={() => setPreview("form")}
            onFocusCapture={() => setPreview("form")}
          >
            <BookingFormCard key={formVersion} form={form} onChange={setForm} errors={formErrors} />
          </div>
        </div>
        <div className="lg:sticky lg:top-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-zinc-500">{t("settings.previewTitle")}</p>
            <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="tablist">
              {(["page", "form"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={preview === view}
                  onClick={() => setPreview(view)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    preview === view
                      ? "bg-white text-zinc-900 shadow-xs"
                      : "text-zinc-500 hover:text-zinc-800",
                  )}
                >
                  {t(`settings.previews.${view}`)}
                </button>
              ))}
            </div>
          </div>
          {preview === "page" ? (
            <PagePreview business={business} brandColor={brandColor} pageTheme={pageTheme} />
          ) : (
            <FormPreview
              business={business}
              form={form}
              brandColor={brandColor}
              pageTheme={pageTheme}
            />
          )}
        </div>
      </div>
      <SaveBar dirty={dirty} saving={update.isPending} onSave={save} onDiscard={discard} />
    </div>
  );
}

type BusinessFields = Pick<
  BusinessUpdateInput,
  | "name"
  | "slug"
  | "description"
  | "phone"
  | "email"
  | "address"
  | "timezone"
  | "currency"
  | "locale"
>;

/**
 * Local form state for some business fields, validated with the shared schema. Only the
 * fields that changed are sent; `values` follows the saved business after each save.
 */
function useBusinessForm<K extends keyof BusinessFields>(
  business: Business,
  read: (business: Business) => Record<K, string>,
) {
  const { t } = useTranslation();
  const update = useUpdateBusiness(business.id);
  const saved = read(business);
  const [values, setValues] = useState(saved);
  const [errors, setErrors] = useState<FieldErrors>({});
  const changed = (Object.keys(saved) as K[]).filter((field) => values[field] !== saved[field]);

  const set = (field: K, value: string) => setValues((current) => ({ ...current, [field]: value }));
  const save = () => {
    const result = validate(businessUpdateSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    const data = result.data as Record<string, unknown>;
    update.mutate(Object.fromEntries(changed.map((field) => [field, data[field]])), {
      onSuccess: (business) => {
        setValues(read(business));
        toast.success(t("common.saved"));
      },
      onError: (error) => {
        setErrors(apiFieldErrors(error));
        toast.error(errorMessage(t, error));
      },
    });
  };
  const discard = () => {
    setValues(saved);
    setErrors({});
  };
  const error = (field: K) => fieldMessage(t, field, errors[field]);
  return {
    values,
    set,
    save,
    discard,
    error,
    dirty: changed.length > 0,
    saving: update.isPending,
  };
}

type GeneralForm = ReturnType<
  typeof useBusinessForm<
    | "name"
    | "slug"
    | "description"
    | "phone"
    | "email"
    | "address"
    | "timezone"
    | "currency"
    | "locale"
  >
>;

/** Who the business is and how to reach it: everything its booking page shows about it. */
function InfoCard({ form }: { form: GeneralForm }) {
  const { t } = useTranslation();
  return (
    <SettingsCard title={t("settings.infoTitle")} description={t("settings.infoHint")}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("fields.businessName")} error={form.error("name")}>
          {(props) => (
            <Input
              {...props}
              value={form.values.name}
              onChange={(event) => form.set("name", event.target.value)}
            />
          )}
        </Field>
        <Field label={t("fields.slug")} error={form.error("slug")}>
          {(props) => (
            <SlugInput
              {...props}
              value={form.values.slug}
              onChange={(event) => form.set("slug", event.target.value.toLowerCase())}
            />
          )}
        </Field>
      </div>
      <Field label={t("fields.description")} optional error={form.error("description")}>
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            value={form.values.description}
            onChange={(event) => form.set("description", event.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-5 md:grid-cols-3">
        <Field label={t("fields.phone")} optional error={form.error("phone")}>
          {(props) => (
            <Input
              {...props}
              type="tel"
              value={form.values.phone}
              onChange={(event) => form.set("phone", event.target.value)}
            />
          )}
        </Field>
        <Field label={t("fields.businessEmail")} optional error={form.error("email")}>
          {(props) => (
            <Input
              {...props}
              type="email"
              value={form.values.email}
              onChange={(event) => form.set("email", event.target.value)}
            />
          )}
        </Field>
        <Field label={t("fields.address")} optional error={form.error("address")}>
          {(props) => (
            <Input
              {...props}
              value={form.values.address}
              onChange={(event) => form.set("address", event.target.value)}
            />
          )}
        </Field>
      </div>
    </SettingsCard>
  );
}

function LinkCard({ business }: { business: Business }) {
  const { t } = useTranslation();
  return (
    <SettingsCard title={t("settings.pageTitle")} description={t("settings.pageHint")}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <CopyField value={publicUrl(business.slug)} label={t("settings.pageTitle")} />
        </div>
        <a
          href={publicUrl(business.slug)}
          target="_blank"
          rel="noreferrer"
          className={buttonClass({ variant: "secondary" })}
        >
          {t("common.open")}
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </div>
    </SettingsCard>
  );
}

function ImagesCard({ business }: { business: Business }) {
  const { t } = useTranslation();
  const { list, upload, remove } = useBusinessImages(business.id);
  if (list.isPending) return <Spinner />;
  const busy = upload.isPending || remove.isPending;
  const uploadImage = (kind: "logo" | "cover") => (image: Blob) =>
    upload.mutate(
      { kind, image },
      {
        onSuccess: () => toast.success(t("settings.imageUpdated")),
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  const removeImage = (kind: "logo" | "cover") => () =>
    remove.mutate(kind, { onSuccess: () => toast.success(t("settings.imageRemoved")) });

  return (
    <SettingsCard title={t("settings.imagesTitle")} description={t("settings.imagesHint")}>
      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <ImageField
          kind="cover"
          url={list.data?.coverUrl ?? null}
          label={t("settings.cover")}
          hint={t("settings.coverHint")}
          busy={busy}
          onUpload={uploadImage("cover")}
          onRemove={removeImage("cover")}
        />
        <ImageField
          kind="logo"
          url={list.data?.logoUrl ?? null}
          label={t("settings.logo")}
          hint={t("settings.logoHint")}
          busy={busy}
          onUpload={uploadImage("logo")}
          onRemove={removeImage("logo")}
        />
      </div>
    </SettingsCard>
  );
}

function ImageField({
  kind,
  url,
  label,
  hint,
  busy,
  onUpload,
  onRemove,
}: {
  kind: "logo" | "cover";
  url: string | null;
  label: string;
  hint: string;
  busy: boolean;
  onUpload: (image: Blob) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      onUpload(await prepareImage(file, kind));
    } catch {
      toast.error(t("errors.image_invalid"));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={url ? t("settings.replaceImage") : t("settings.uploadImage")}
        className={cn(
          "group relative grid place-items-center overflow-hidden border border-zinc-200 bg-zinc-50 text-zinc-400 transition-colors hover:border-zinc-300 hover:text-zinc-600",
          kind === "logo" ? "aspect-square w-full rounded-xl" : "aspect-[3/1] w-full rounded-lg",
          !url && "border-dashed",
        )}
      >
        {url ? (
          <img src={url} alt={label} className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-6" aria-hidden />
        )}
      </button>
      <div>
        <p className="text-sm font-medium text-zinc-800">{label}</p>
        <p className="mt-0.5 text-[13px] text-zinc-500">{hint}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" loading={busy} onClick={() => input.current?.click()}>
          {url ? t("settings.replaceImage") : t("settings.uploadImage")}
        </Button>
        {url && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={busy}
            aria-label={t("settings.removeImage")}
            title={t("settings.removeImage")}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function AppearanceCard({
  business,
  brandColor,
  onBrandColor,
  pageTheme,
  onPageTheme,
}: {
  business: Business;
  brandColor: string;
  onBrandColor: (color: string) => void;
  pageTheme: PageTheme;
  onPageTheme: (theme: PageTheme) => void;
}) {
  const { t } = useTranslation();
  const images = useBusinessImages(business.id);
  const coverUrl = images.list.data?.coverUrl ?? null;
  return (
    <SettingsCard title={t("settings.appearanceTitle")} description={t("settings.appearanceHint")}>
      <ColorChoice
        label={t("settings.brandColor")}
        hint={t("settings.brandColorHint")}
        value={brandColor}
        options={BRAND_COLORS}
        onChange={onBrandColor}
      />
      <div className="space-y-3 border-t border-zinc-100 pt-5">
        <div>
          <p className="text-sm font-medium text-zinc-800">{t("settings.pageBackground")}</p>
          <p className="mt-0.5 text-[13px] text-zinc-500">{t("settings.pageBackgroundHint")}</p>
        </div>
        <div className="light grid grid-cols-2 gap-3 sm:grid-cols-5" style={brandStyle(brandColor)}>
          {PAGE_THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              aria-pressed={theme === pageTheme}
              onClick={() => onPageTheme(theme)}
              className="group text-left outline-none"
            >
              <span
                className={cn(
                  "relative isolate flex aspect-[4/3] items-end justify-center overflow-hidden rounded-xl ring-1 transition",
                  theme === pageTheme
                    ? "ring-2 ring-zinc-900 ring-offset-2"
                    : "ring-zinc-200 group-hover:ring-zinc-300 group-focus-visible:ring-2 group-focus-visible:ring-brand-500",
                )}
              >
                <BookingBackdrop theme={theme} coverUrl={coverUrl} />
                {/* A tiny booking card, to judge the contrast. */}
                <span className="mb-[-6px] h-3/5 w-3/5 rounded-t-lg bg-white/95 p-1.5 shadow-md">
                  <span className="block h-1.5 w-1/2 rounded-full bg-zinc-200" />
                  <span className="mt-1 block h-1.5 w-3/4 rounded-full bg-zinc-100" />
                  <span className="mt-2 block h-2 w-1/3 rounded-full bg-brand-600" />
                </span>
              </span>
              <span className="mt-1.5 block text-[13px] font-medium text-zinc-800">
                {t(`settings.themes.${theme}`)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </SettingsCard>
  );
}

/** Preset swatches plus a custom colour, picked visually or typed as hex. */
function ColorChoice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  options: readonly string[];
  onChange: (color: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const custom = !options.includes(value);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-zinc-800">{label}</p>
        <p className="mt-0.5 text-[13px] text-zinc-500">{hint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        {options.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            aria-pressed={color === value}
            aria-label={color}
            title={color}
            className={cn(
              "grid size-8 place-items-center rounded-full ring-1 ring-zinc-950/10 transition-transform ring-inset hover:scale-110",
              color === value && "ring-2 ring-zinc-900 ring-offset-2",
            )}
            style={{ backgroundColor: color }}
          >
            {color === value && (
              <Check
                className="size-4"
                style={{ color: isLight(color) ? "#18181b" : "#fff" }}
                aria-hidden
              />
            )}
          </button>
        ))}
        <label
          className={cn(
            "relative grid size-8 cursor-pointer place-items-center rounded-full bg-[conic-gradient(#ef4444,#eab308,#22c55e,#06b6d4,#6366f1,#d946ef,#ef4444)] ring-1 ring-zinc-950/10 transition-transform hover:scale-110",
            custom && "ring-2 ring-zinc-900 ring-offset-2",
          )}
          title={t("settings.customColor")}
        >
          <span className="sr-only">{t("settings.customColor")}</span>
          <input
            type="color"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const next = draft.trim().toLowerCase();
            const hex = next.startsWith("#") ? next : `#${next}`;
            if (/^#[0-9a-f]{6}$/.test(hex)) onChange(hex);
            else setDraft(value);
          }}
          aria-label={`${label} (hex)`}
          maxLength={7}
          className="h-8 w-24 font-mono text-xs uppercase"
        />
      </div>
    </div>
  );
}

/** The booking page in miniature, repainted live with the colours being edited. */
function PagePreview({
  business,
  brandColor,
  pageTheme,
}: {
  business: Business;
  brandColor: string;
  pageTheme: PageTheme;
}) {
  const { t, i18n } = useTranslation();
  const images = useBusinessImages(business.id);
  const services = useServices(business.id);
  const sample = services.data?.filter((service) => service.active).slice(0, 2) ?? [];
  // The booking page speaks the business's language, whatever the admin's language is.
  const page = i18n.getFixedT(business.locale);

  return (
    <section aria-label={t("settings.previewTitle")} className="light">
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2">
          <span className="flex gap-1">
            <span className="size-2 rounded-full bg-zinc-300" />
            <span className="size-2 rounded-full bg-zinc-300" />
            <span className="size-2 rounded-full bg-zinc-300" />
          </span>
          <span className="min-w-0 flex-1 truncate rounded bg-white px-2 py-0.5 text-[11px] text-zinc-500 ring-1 ring-zinc-200">
            {publicUrl(business.slug).replace(/^https?:\/\//, "")}
          </span>
        </div>
        <div className="relative isolate p-4" style={brandStyle(brandColor)}>
          <BookingBackdrop theme={pageTheme} coverUrl={images.list.data?.coverUrl ?? null} />
          <div className="overflow-clip rounded-2xl bg-white shadow-xl ring-1 shadow-zinc-950/10 ring-zinc-950/5">
            <BookingHeader
              compact
              business={{
                ...business,
                logoUrl: images.list.data?.logoUrl ?? null,
                coverUrl: images.list.data?.coverUrl ?? null,
              }}
            />
            <div className="mt-3 flex items-center gap-2 border-y border-zinc-100 bg-zinc-50/60 px-4 py-2 text-[11px]">
              <span className="grid size-4 place-items-center rounded-full bg-brand-600 text-[9px] font-semibold text-on-brand">
                1
              </span>
              <span className="font-medium text-zinc-800">{page("booking.steps.service")}</span>
              <span className="h-px w-3 bg-zinc-200" />
              <span className="grid size-4 place-items-center rounded-full bg-zinc-100 text-[9px] text-zinc-400">
                2
              </span>
              <span className="h-px w-3 bg-zinc-200" />
              <span className="grid size-4 place-items-center rounded-full bg-zinc-100 text-[9px] text-zinc-400">
                3
              </span>
            </div>
            <div className="space-y-2 p-4">
              {(sample.length > 0 ? sample : [null]).map((service, index) => (
                <div
                  key={service?.id ?? "placeholder"}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs",
                    index === 0 ? "border-brand-500 bg-brand-50/50" : "border-zinc-200",
                  )}
                >
                  <span className="truncate font-medium text-zinc-900">
                    {service?.name ?? page("services.namePlaceholder")}
                  </span>
                  <span className="shrink-0 font-semibold text-zinc-900 tabular-nums">
                    {service?.priceAmount != null
                      ? formatPrice(service.priceAmount, business.currency)
                      : "—"}
                  </span>
                </div>
              ))}
              <div className="flex justify-end pt-1">
                <span className={buttonClass({ size: "sm" })}>{page("booking.next")}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function RegionCard({ form }: { form: GeneralForm }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const zones = useTimeZoneOptions(language);
  const currencies = useMemo(() => currencyOptions(language), [language]);
  const countries = useTimeZoneCountries();
  const country = countries[form.values.timezone];
  return (
    <SettingsCard title={t("settings.regionTitle")} description={t("settings.regionHint")}>
      <div className="grid gap-5 lg:grid-cols-3">
        <Field
          label={t("fields.timezone")}
          error={form.error("timezone")}
          hint={
            country
              ? t("settings.timezoneCountry", { country: countryName(country, language) })
              : t("settings.timezoneNoCountry")
          }
        >
          {(props) => (
            <Combobox
              {...props}
              value={form.values.timezone}
              onChange={(value) => form.set("timezone", value)}
              options={zones}
              searchPlaceholder={t("settings.searchTimezone")}
              emptyText={t("table.noResults")}
            />
          )}
        </Field>
        <Field label={t("fields.currency")} error={form.error("currency")}>
          {(props) => (
            <Combobox
              {...props}
              value={form.values.currency}
              onChange={(value) => form.set("currency", value)}
              options={currencies}
              searchPlaceholder={t("settings.searchCurrency")}
              emptyText={t("table.noResults")}
            />
          )}
        </Field>
        <Field label={t("fields.locale")}>
          {(props) => (
            <Select
              {...props}
              value={form.values.locale}
              onChange={(event) => form.set("locale", event.target.value)}
            >
              <option value="es">{t("locales.es")}</option>
              <option value="en">{t("locales.en")}</option>
            </Select>
          )}
        </Field>
      </div>
    </SettingsCard>
  );
}

function DeleteCard({ business }: { business: Business }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const remove = useDeleteBusiness(business.id);

  const ask = async () => {
    const ok = await confirm({
      title: t("settings.deleteTitle", { name: business.name }),
      description: t("settings.deleteConfirm"),
      details: (
        ["appointments", "customers", "catalog", "page", "team", "agents", "automations"] as const
      ).map((item) => t(`settings.deleteItems.${item}`)),
      confirmLabel: t("settings.delete"),
      tone: "danger",
      requireText: business.name,
    });
    if (!ok) return;
    // One last, plain "are you sure?" before anything is deleted.
    const sure = await confirm({
      title: t("settings.deleteSureTitle"),
      description: t("settings.deleteSureBody", { name: business.name }),
      confirmLabel: t("settings.deleteSure"),
      tone: "danger",
    });
    if (!sure) return;
    remove.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("settings.deleted"));
        navigate("/admin", { replace: true });
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  return (
    <SettingsCard
      tone="danger"
      title={t("settings.dangerTitle")}
      description={t("settings.dangerBody")}
      action={
        <Button variant="danger" onClick={ask} loading={remove.isPending}>
          {t("settings.delete")}
        </Button>
      }
    />
  );
}
