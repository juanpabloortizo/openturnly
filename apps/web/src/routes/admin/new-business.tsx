import { type BusinessCreateInput, businessCreateSchema, slugify } from "@openturnly/core";
import { type FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate } from "react-router";
import { Combobox } from "../../components/combobox.tsx";
import { PageHeader, SettingsCard } from "../../components/controls.tsx";
import { SlugInput } from "../../components/slug-input.tsx";
import { Alert, Button, buttonClass, Field, Input, Select } from "../../components/ui.tsx";
import { useCreateBusiness } from "../../lib/businesses.ts";
import {
  apiFieldErrors,
  errorMessage,
  type FieldErrors,
  fieldMessage,
  validate,
} from "../../lib/forms.ts";
import {
  browserTimeZone,
  currencyOptions,
  guessCurrency,
  useTimeZoneOptions,
} from "../../lib/locale.ts";
import { useAdminUser } from "./layout.tsx";

export function NewBusinessPage() {
  const { t, i18n } = useTranslation();
  const user = useAdminUser();
  const navigate = useNavigate();
  const create = useCreateBusiness();
  const language = i18n.resolvedLanguage ?? "es";
  const zones = useTimeZoneOptions(language);
  const currencies = useMemo(() => currencyOptions(language), [language]);
  const timezone = browserTimeZone();

  const [values, setValues] = useState<BusinessCreateInput>({
    name: "",
    slug: "",
    timezone,
    currency: guessCurrency(timezone),
    locale: i18n.resolvedLanguage === "en" ? "en" : "es",
  });
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  if (user.role !== "owner") return <Navigate to="/admin" replace />;

  const set = <K extends keyof BusinessCreateInput>(field: K, value: BusinessCreateInput[K]) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(businessCreateSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    create.mutate(result.data, {
      onSuccess: (business) => navigate(`/admin/businesses/${business.id}`),
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  };

  const hasFieldErrors = Object.keys(apiFieldErrors(create.error)).length > 0;

  return (
    <>
      <PageHeader title={t("newBusiness.title")} subtitle={t("newBusiness.subtitle")} />
      <form onSubmit={submit} noValidate className="max-w-3xl space-y-6">
        <SettingsCard title={t("newBusiness.infoTitle")} description={t("newBusiness.infoHint")}>
          {create.isError && !hasFieldErrors && <Alert>{errorMessage(t, create.error)}</Alert>}
          <Field label={t("fields.businessName")} error={fieldMessage(t, "name", errors.name)}>
            {(props) => (
              <Input
                {...props}
                autoFocus
                value={values.name}
                onChange={(event) => {
                  const name = event.target.value;
                  setValues((current) => ({
                    ...current,
                    name,
                    slug: slugEdited ? current.slug : slugify(name),
                  }));
                }}
              />
            )}
          </Field>
          <Field
            label={t("fields.slug")}
            hint={t("fields.slugHint")}
            error={fieldMessage(t, "slug", errors.slug)}
          >
            {(props) => (
              <SlugInput
                {...props}
                value={values.slug}
                onChange={(event) => {
                  setSlugEdited(true);
                  set("slug", event.target.value.toLowerCase());
                }}
              />
            )}
          </Field>
        </SettingsCard>

        <SettingsCard
          title={t("newBusiness.regionTitle")}
          description={t("newBusiness.regionHint")}
          footer={
            <>
              <Link to="/admin" className={buttonClass({ variant: "secondary" })}>
                {t("common.cancel")}
              </Link>
              <Button type="submit" loading={create.isPending}>
                {t("newBusiness.submit")}
              </Button>
            </>
          }
        >
          <Field label={t("fields.timezone")} error={fieldMessage(t, "timezone", errors.timezone)}>
            {(props) => (
              <Combobox
                {...props}
                value={values.timezone}
                onChange={(zone) =>
                  setValues((current) => ({
                    ...current,
                    timezone: zone,
                    currency: guessCurrency(zone),
                  }))
                }
                options={zones}
                searchPlaceholder={t("settings.searchTimezone")}
                emptyText={t("table.noResults")}
              />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={t("fields.currency")}
              error={fieldMessage(t, "currency", errors.currency)}
            >
              {(props) => (
                <Combobox
                  {...props}
                  value={values.currency}
                  onChange={(code) => set("currency", code as BusinessCreateInput["currency"])}
                  options={currencies}
                  searchPlaceholder={t("settings.searchCurrency")}
                  emptyText={t("table.noResults")}
                />
              )}
            </Field>
            <Field label={t("fields.locale")} error={fieldMessage(t, "locale", errors.locale)}>
              {(props) => (
                <Select
                  {...props}
                  value={values.locale}
                  onChange={(event) =>
                    set("locale", event.target.value as BusinessCreateInput["locale"])
                  }
                >
                  <option value="es">{t("locales.es")}</option>
                  <option value="en">{t("locales.en")}</option>
                </Select>
              )}
            </Field>
          </div>
        </SettingsCard>
      </form>
    </>
  );
}
