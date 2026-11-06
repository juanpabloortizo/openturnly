import {
  type BookingForm,
  type BusinessUpdateInput,
  bookingFormSchema,
  businessUpdateSchema,
  formatPrice,
  PAGE_THEMES,
  type PageTheme,
} from "@openturnly/core";
import { ArrowUpRight, Check, ChevronDown, ImagePlus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { BookingBackdrop } from "../../components/booking-backdrop.tsx";
import { BookingHeader } from "../../components/booking-header.tsx";
import { BookingQr } from "../../components/booking-qr.tsx";
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
import { WhatsappTab } from "./whatsapp.tsx";

const TABS = ["general", "page", "integrations", "whatsapp", "automations"] as const;

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
                { value: "whatsapp" as const, label: t("settings.tabs.whatsapp") },
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
        {tab === "whatsapp" && admin && <WhatsappTab />}
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
            <ShareCard business={business} brandColor={brandColor} />
            <BrandCard
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

/** The link to share and its QR code, first: sharing them is what the page is for. */
function ShareCard({ business, brandColor }: { business: Business; brandColor: string }) {
  const { t } = useTranslation();
  const images = useBusinessImages(business.id);
  return (
    <SettingsCard title={t("settings.shareTitle")} description={t("settings.pageHint")}>
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
      {/* Follows the colour being edited, like the preview. */}
      <BookingQr
        url={publicUrl(business.slug)}
        color={brandColor}
        logoUrl={images.list.data?.logoUrl ?? null}
        name={business.name}
        locale={business.locale}
        fileName={`qr-${business.slug}`}
      />
      <SettingRow
        label={t("settings.embedTitle")}
        hint={t("settings.embedHint")}
        value={t("settings.embedValue")}
      >
        <EmbedCode business={business} brandColor={brandColor} />
      </SettingRow>
    </SettingsCard>
  );
}

const htmlAttribute = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The code to paste in the business's own website: the booking page in it, or a button. */
function EmbedCode({ business, brandColor }: { business: Business; brandColor: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"inline" | "button">("inline");
  const [label, setLabel] = useState(() =>
    t("settings.embedLabelDefault", { lng: business.locale }),
  );
  const [iframe, setIframe] = useState(false);
  const origin = window.location.origin;
  const script = `<script src="${origin}/embed.js" async></script>`;
  const code =
    mode === "inline"
      ? `<div data-openturnly="${business.slug}"></div>\n${script}`
      : `<div data-openturnly="${business.slug}" data-mode="button" data-label="${htmlAttribute(label.trim() || t("settings.embedLabelDefault", { lng: business.locale }))}" data-color="${brandColor}"></div>\n${script}`;
  const plain = `<iframe src="${origin}/${business.slug}?embed=1" title="${htmlAttribute(business.name)}" style="width:100%;height:760px;border:0" loading="lazy"></iframe>`;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {(["inline", "button"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => setMode(option)}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
              mode === option
                ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500"
                : "border-zinc-200 hover:border-zinc-300",
            )}
          >
            <span className="block text-sm font-medium text-zinc-800">
              {t(option === "inline" ? "settings.embedInline" : "settings.embedButton")}
            </span>
            <span className="mt-0.5 block text-[13px] text-zinc-500">
              {t(option === "inline" ? "settings.embedInlineHint" : "settings.embedButtonHint")}
            </span>
          </button>
        ))}
      </div>
      {mode === "button" && (
        <Field label={t("settings.embedLabel")}>
          {(props) => (
            <Input
              {...props}
              value={label}
              maxLength={40}
              onChange={(event) => setLabel(event.target.value)}
            />
          )}
        </Field>
      )}
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-zinc-800">{t("settings.embedCode")}</p>
        <CodeBlock code={code} />
        <p className="text-[13px] text-zinc-500">{t("settings.embedWhere")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={iframe}
          onClick={() => setIframe(!iframe)}
          className="text-[13px] font-medium text-brand-700 hover:underline"
        >
          {t("settings.embedIframe")}
        </button>
        <a
          href={`${origin}/${business.slug}?embed=1`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-zinc-600 hover:text-zinc-900"
        >
          {t("settings.embedPreview")}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
      </div>
      {iframe && (
        <div className="space-y-1.5">
          <CodeBlock code={plain} />
          <p className="text-[13px] text-zinc-500">{t("settings.embedIframeHint")}</p>
        </div>
      )}
    </div>
  );
}

/** Code to copy as it is, with a button that copies it. */
function CodeBlock({ code }: { code: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const block = useRef<HTMLPreElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Plain http has no clipboard: select it so it can be copied by hand.
      const selection = window.getSelection();
      if (block.current && selection) selection.selectAllChildren(block.current);
    }
  };
  return (
    <div className="relative">
      <pre
        ref={block}
        className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 py-3 pr-24 pl-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-zinc-700"
      >
        {code}
      </pre>
      <Button variant="secondary" size="sm" onClick={copy} className="absolute top-2 right-2">
        {copied ? <Check className="size-4" aria-hidden /> : null}
        {copied ? t("common.copied") : t("common.copy")}
      </Button>
    </div>
  );
}

function SubHeading({ label, hint }: { label: string; hint: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-zinc-800">{label}</p>
      <p className="mt-0.5 text-[13px] text-zinc-500">{hint}</p>
    </div>
  );
}

/** Everything that makes the page look like the business: images, colour and background. */
function BrandCard({
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
  const confirm = useConfirm();
  const { list, upload, remove } = useBusinessImages(business.id);
  const busy = upload.isPending || remove.isPending;
  const uploadImage = (kind: "logo" | "cover") => (image: Blob) =>
    upload.mutate(
      { kind, image },
      {
        onSuccess: () => toast.success(t("settings.imageUpdated")),
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  const removeImage = (kind: "logo" | "cover") => async () => {
    const ok = await confirm({
      title: t(`settings.removeImageTitle.${kind}`),
      description: t("settings.removeImageBody"),
      confirmLabel: t("settings.removeImage"),
      tone: "danger",
    });
    if (ok) remove.mutate(kind, { onSuccess: () => toast.success(t("settings.imageRemoved")) });
  };
  const coverUrl = list.data?.coverUrl ?? null;

  return (
    <SettingsCard title={t("settings.brandTitle")} description={t("settings.brandHint")}>
      <div className="space-y-3">
        <SubHeading label={t("settings.imagesTitle")} hint={t("settings.imagesHint")} />
        {list.isPending ? (
          <Spinner />
        ) : (
          <div className="flex gap-3">
            <ImageField
              kind="logo"
              url={list.data?.logoUrl ?? null}
              label={t("settings.logo")}
              busy={busy}
              onUpload={uploadImage("logo")}
              onRemove={removeImage("logo")}
            />
            <ImageField
              kind="cover"
              url={coverUrl}
              label={t("settings.cover")}
              busy={busy}
              onUpload={uploadImage("cover")}
              onRemove={removeImage("cover")}
            />
          </div>
        )}
      </div>
      <SettingRow
        label={t("settings.brandColor")}
        hint={t("settings.brandColorHint")}
        value={
          <>
            <span
              className="size-5 rounded-full ring-1 ring-zinc-950/10 ring-inset"
              style={{ backgroundColor: brandColor }}
            />
            <span className="font-mono text-xs uppercase">{brandColor}</span>
          </>
        }
      >
        <ColorChoice
          label={t("settings.brandColor")}
          value={brandColor}
          options={BRAND_COLORS}
          onChange={onBrandColor}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.pageBackground")}
        hint={t("settings.pageBackgroundHint")}
        value={
          <>
            <span className="w-12 overflow-hidden rounded-md ring-1 ring-zinc-200">
              <ThemeThumb theme={pageTheme} brandColor={brandColor} coverUrl={coverUrl} />
            </span>
            {t(`settings.themes.${pageTheme}`)}
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
                  "block overflow-hidden rounded-xl ring-1 transition",
                  theme === pageTheme
                    ? "ring-2 ring-zinc-900 ring-offset-2"
                    : "ring-zinc-200 group-hover:ring-zinc-300 group-focus-visible:ring-2 group-focus-visible:ring-brand-500",
                )}
              >
                <ThemeThumb theme={theme} brandColor={brandColor} coverUrl={coverUrl} />
              </span>
              <span className="mt-1.5 block text-[13px] font-medium text-zinc-800">
                {t(`settings.themes.${theme}`)}
              </span>
            </button>
          ))}
        </div>
      </SettingRow>
    </SettingsCard>
  );
}

/**
 * A setting shown as its current value, so the card stays short; its picker opens below when
 * the row is clicked.
 */
function SettingRow({
  label,
  hint,
  value,
  children,
}: {
  label: string;
  hint: string;
  value: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className="border-t border-zinc-100 pt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen(!open)}
        className="group flex w-full items-center gap-4 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-zinc-800">{label}</span>
          <span className="mt-0.5 block text-[13px] text-zinc-500">{hint}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[13px] text-zinc-600">{value}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-zinc-400 transition-transform group-hover:text-zinc-600",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div id={panel} className="mt-4">
          {children}
        </div>
      )}
    </div>
  );
}

/** A page background in miniature, with a tiny booking card on it to judge the contrast. */
function ThemeThumb({
  theme,
  brandColor,
  coverUrl,
}: {
  theme: PageTheme;
  brandColor: string;
  coverUrl: string | null;
}) {
  return (
    // The light page customers see, whatever the app's theme.
    <span
      className="light relative isolate flex aspect-[4/3] items-end justify-center overflow-hidden"
      style={brandStyle(brandColor)}
    >
      <BookingBackdrop theme={theme} coverUrl={coverUrl} />
      <span className="mb-[-6px] h-3/5 w-3/5 rounded-t-[12%] bg-white/95 p-[6%] shadow-md">
        <span className="block h-[12%] w-1/2 rounded-full bg-zinc-200" />
        <span className="mt-[6%] block h-[12%] w-3/4 rounded-full bg-zinc-100" />
        <span className="mt-[12%] block h-[16%] w-1/3 rounded-full bg-brand-600" />
      </span>
    </span>
  );
}

/** A thumbnail that uploads or replaces the image when clicked; the corner button removes it. */
function ImageField({
  kind,
  url,
  label,
  busy,
  onUpload,
  onRemove,
}: {
  kind: "logo" | "cover";
  url: string | null;
  label: string;
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
    <div className={cn("min-w-0", kind === "logo" ? "w-28 shrink-0" : "max-w-84 flex-1")}>
      <div className="relative">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          aria-label={`${label}: ${url ? t("settings.replaceImage") : t("settings.uploadImage")}`}
          className={cn(
            "group relative grid h-28 w-full place-items-center overflow-hidden rounded-xl border bg-zinc-50 text-zinc-400 transition-colors outline-none hover:border-zinc-300 hover:text-zinc-600 focus-visible:ring-2 focus-visible:ring-brand-500/40",
            url ? "border-zinc-200" : "border-dashed border-zinc-300",
          )}
        >
          {url ? (
            <>
              <img src={url} alt="" className="size-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/50 text-xs font-medium text-[#fff] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <ImagePlus className="size-4" aria-hidden />
                {t("settings.replaceImage")}
              </span>
            </>
          ) : (
            <span className="flex flex-col items-center gap-1.5 text-xs font-medium">
              <ImagePlus className="size-5" aria-hidden />
              {t("settings.uploadImage")}
            </span>
          )}
        </button>
        {url && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={`${label}: ${t("settings.removeImage")}`}
            title={t("settings.removeImage")}
            className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-white text-zinc-500 shadow-sm ring-1 ring-zinc-950/10 transition-colors hover:text-red-600"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <p className="mt-2 text-[13px] font-medium text-zinc-800">{label}</p>
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

/** Preset swatches plus a custom colour, picked visually or typed as hex. */
function ColorChoice({
  label,
  value,
  options,
  onChange,
}: {
  /** For the hex field's name; the row above shows it. */
  label: string;
  value: string;
  options: readonly string[];
  onChange: (color: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const custom = !options.includes(value);

  return (
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
