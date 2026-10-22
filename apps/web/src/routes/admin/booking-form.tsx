import {
  type BookingForm,
  type BookingQuestion,
  type FieldRule,
  MAX_QUESTIONS,
  type PageTheme,
  QUESTION_TYPES,
} from "@openturnly/core";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookingBackdrop } from "../../components/booking-backdrop.tsx";
import { SettingsCard, Toggle } from "../../components/controls.tsx";
import { Button, Input, Select } from "../../components/ui.tsx";
import type { Business } from "../../lib/api.ts";
import { brandStyle } from "../../lib/brand.ts";
import { useBusinessImages } from "../../lib/businesses.ts";
import { cn } from "../../lib/cn.ts";
import { type FieldErrors, fieldMessage } from "../../lib/forms.ts";

const RULES: FieldRule[] = ["required", "optional", "hidden"];

function newQuestion(): BookingQuestion {
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    label: "",
    type: "text",
    required: false,
    options: [],
  };
}

/**
 * What the booking page asks: which contact details are required, optional or left out,
 * and the business's own questions. Saved together with the rest of the booking page.
 */
export function BookingFormCard({
  form,
  onChange: setForm,
  errors,
}: {
  form: BookingForm;
  onChange: Dispatch<SetStateAction<BookingForm>>;
  errors: FieldErrors;
}) {
  const { t } = useTranslation();
  // Options are typed as "Sí, No"; the text is kept apart so commas and spaces stay put.
  const [optionsText, setOptionsText] = useState<Record<string, string>>(() =>
    Object.fromEntries(form.questions.map((q) => [q.id, q.options.join(", ")])),
  );

  const setQuestion = (index: number, patch: Partial<BookingQuestion>) =>
    setForm((current) => ({
      ...current,
      questions: current.questions.map((question, i) =>
        i === index ? { ...question, ...patch } : question,
      ),
    }));

  const contactRow = (field: "phone" | "email", label: string) => (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-medium text-zinc-800">{label}</span>
      <fieldset className="inline-flex rounded-lg bg-zinc-100 p-0.5" aria-label={label}>
        {RULES.map((rule) => (
          <button
            key={rule}
            type="button"
            aria-pressed={form[field] === rule}
            onClick={() => setForm((current) => ({ ...current, [field]: rule }))}
            className={cn(
              "rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
              form[field] === rule
                ? "bg-white text-zinc-900 shadow-xs"
                : "text-zinc-500 hover:text-zinc-800",
            )}
          >
            {t(`bookingForm.rules.${rule}`)}
          </button>
        ))}
      </fieldset>
    </div>
  );

  return (
    <SettingsCard title={t("bookingForm.title")} description={t("bookingForm.hint")}>
      <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 px-4">
        <div className="flex items-center justify-between py-3">
          <span className="text-sm font-medium text-zinc-800">{t("bookingForm.name")}</span>
          <span className="text-[13px] text-zinc-500">{t("bookingForm.always")}</span>
        </div>
        {contactRow("phone", t("booking.phone"))}
        {contactRow("email", t("booking.email"))}
      </div>
      {errors.phone ? (
        <p className="-mt-2 text-[13px] text-red-600">{fieldMessage(t, "phone", errors.phone)}</p>
      ) : (
        <p className="-mt-2 text-[13px] text-zinc-500">{t("bookingForm.note")}</p>
      )}

      <div className="space-y-3 border-t border-zinc-100 pt-5">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">{t("bookingForm.questions")}</h3>
          <p className="mt-0.5 text-[13px] text-zinc-500">{t("bookingForm.questionsHint")}</p>
        </div>
        {form.questions.map((question, index) => (
          <div key={question.id} className="space-y-3 rounded-lg border border-zinc-200 p-3">
            <div className="flex items-start gap-2">
              <GripVertical className="mt-2.5 size-4 shrink-0 text-zinc-300" aria-hidden />
              <div className="min-w-0 flex-1 space-y-1">
                <Input
                  value={question.label}
                  placeholder={t("bookingForm.labelPlaceholder")}
                  aria-label={t("bookingForm.label")}
                  aria-invalid={Boolean(errors[`questions.${index}.label`]) || undefined}
                  onChange={(event) => setQuestion(index, { label: event.target.value })}
                />
              </div>
              <Select
                className="w-36 shrink-0"
                aria-label={t("bookingForm.type")}
                value={question.type}
                onChange={(event) =>
                  setQuestion(index, { type: event.target.value as BookingQuestion["type"] })
                }
              >
                {QUESTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`bookingForm.types.${type}`)}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="mt-0.5"
                aria-label={t("common.delete")}
                title={t("common.delete")}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    questions: current.questions.filter((_, i) => i !== index),
                  }))
                }
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            {question.type === "select" && (
              <div className="pl-6">
                <Input
                  value={optionsText[question.id] ?? ""}
                  placeholder={t("bookingForm.optionsPlaceholder")}
                  aria-label={t("bookingForm.options")}
                  aria-invalid={Boolean(errors[`questions.${index}.options`]) || undefined}
                  onChange={(event) => {
                    const text = event.target.value;
                    setOptionsText((current) => ({ ...current, [question.id]: text }));
                    setQuestion(index, {
                      options: text
                        .split(",")
                        .map((option) => option.trim())
                        .filter(Boolean),
                    });
                  }}
                />
                {errors[`questions.${index}.options`] && (
                  <p className="mt-1 text-[13px] text-red-600">
                    {fieldMessage(t, "options", errors[`questions.${index}.options`])}
                  </p>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 pl-6 text-[13px] text-zinc-600">
              <Toggle
                checked={question.required}
                onChange={(required) => setQuestion(index, { required })}
                label={t("bookingForm.required")}
              />
              <span aria-hidden>{t("bookingForm.required")}</span>
            </div>
          </div>
        ))}
        {form.questions.length < MAX_QUESTIONS && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setForm((current) => ({
                ...current,
                questions: [...current.questions, newQuestion()],
              }))
            }
          >
            <Plus className="size-3.5" aria-hidden />
            {t("bookingForm.addQuestion")}
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}

/** The "Tus datos" step as customers will see it, in the colours being edited and their language. */
export function FormPreview({
  business,
  form,
  brandColor,
  pageTheme,
}: {
  business: Business;
  form: BookingForm;
  brandColor: string;
  pageTheme: PageTheme;
}) {
  const { t, i18n } = useTranslation();
  const images = useBusinessImages(business.id);
  const page = i18n.getFixedT(business.locale);
  const field = (label: string, optional = false) => (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-zinc-700">
        {label}
        {optional && (
          <span className="ml-1 font-normal text-zinc-400">{page("common.optional")}</span>
        )}
      </p>
      <div className="h-7 rounded-md border border-zinc-200 bg-white" />
    </div>
  );
  return (
    <section aria-label={t("settings.previewTitle")} className="light">
      <div
        className="relative isolate overflow-hidden rounded-xl border border-zinc-200 p-4"
        style={brandStyle(brandColor)}
      >
        <BookingBackdrop theme={pageTheme} coverUrl={images.list.data?.coverUrl ?? null} />
        <div className="space-y-3 rounded-xl bg-white p-4 shadow-lg ring-1 shadow-zinc-950/5 ring-zinc-950/5">
          <p className="text-sm font-semibold text-zinc-900">{page("booking.titles.details")}</p>
          <div className="grid grid-cols-2 gap-2">
            {field(page("booking.firstName"))}
            {field(page("booking.lastName"))}
            {form.phone !== "hidden" && field(page("booking.phone"), form.phone === "optional")}
            {form.email !== "hidden" && field(page("booking.email"), form.email === "optional")}
          </div>
          {form.questions.map((question) => (
            <div key={question.id} className="space-y-1">
              <p className="text-[11px] font-medium text-zinc-700">
                {question.label || page("bookingForm.untitled")}
                {!question.required && (
                  <span className="ml-1 font-normal text-zinc-400">{page("common.optional")}</span>
                )}
              </p>
              {question.type === "select" && question.options.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {question.options.map((option, index) => (
                    <span
                      key={option}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px]",
                        index === 0
                          ? "border-brand-600 bg-brand-600 text-on-brand"
                          : "border-zinc-200 text-zinc-600",
                      )}
                    >
                      {option}
                    </span>
                  ))}
                </div>
              ) : (
                <div
                  className={cn(
                    "rounded-md border border-zinc-200 bg-white",
                    question.type === "textarea" ? "h-12" : "h-7",
                  )}
                />
              )}
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <span className="rounded-md bg-brand-600 px-2.5 py-1 text-[11px] font-medium text-on-brand">
              {page("booking.next")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
