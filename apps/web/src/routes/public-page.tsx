import {
  addDays,
  type BookingDetails,
  type BookingQuestion,
  bookingDetailsSchema,
  formatPhone,
  formatPrice,
  instantToZoned,
  todayIn,
} from "@openturnly/core";
import type { TFunction } from "i18next";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  ChevronLeft,
  Clock,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { BookingBackdrop, isDarkTheme } from "../components/booking-backdrop.tsx";
import { BookingHeader } from "../components/booking-header.tsx";
import { MonthCalendar } from "../components/month-calendar.tsx";
import { PhoneInput } from "../components/phone-input.tsx";
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from "../components/ui.tsx";
import {
  ApiError,
  type BookedAppointment,
  type PublicBusiness,
  type PublicCatalog,
} from "../lib/api.ts";
import { useAvailability, useBook, usePublicCatalog } from "../lib/booking.ts";
import { brandStyle } from "../lib/brand.ts";
import { cn } from "../lib/cn.ts";
import { formatDay, formatDuration } from "../lib/format.ts";
import { type FieldErrors, fieldMessage, validate } from "../lib/forms.ts";
import { useBookingProof } from "../lib/proof.ts";

type Step = "service" | "datetime" | "details" | "confirm";
type T = TFunction;

/** The page a business shares with its customers: /<slug>. */
export function PublicBookingPage() {
  const { slug = "" } = useParams();
  const catalog = usePublicCatalog(slug);
  const { i18n } = useTranslation();
  // Shown in the business's language, without changing the visitor's saved preference.
  const locale = catalog.data?.business.locale ?? i18n.resolvedLanguage ?? "es";
  const t = i18n.getFixedT(locale);

  useEffect(() => {
    if (catalog.data) document.title = catalog.data.business.name;
  }, [catalog.data]);

  if (catalog.isPending) return <Spinner className="min-h-screen" />;
  if (catalog.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 text-center">
        <h1 className="text-xl font-semibold">{t("publicPage.notFoundTitle")}</h1>
        <p className="mt-2 text-sm text-zinc-500">{t("publicPage.notFoundBody")}</p>
      </div>
    );
  }
  const { business } = catalog.data;
  return (
    <div
      className="relative isolate min-h-screen px-3 py-4 sm:px-6 sm:py-14"
      style={brandStyle(business.brandColor)}
    >
      <BookingBackdrop fixed theme={business.pageTheme} coverUrl={business.coverUrl} />
      <main
        className={cn(
          "mx-auto max-w-3xl overflow-clip rounded-3xl bg-white shadow-[0_32px_80px_-24px_rgb(15_15_35/0.35)] ring-1",
          isDarkTheme(business.pageTheme) ? "ring-white/10" : "ring-zinc-950/5",
        )}
      >
        <BookingHeader business={business} />
        <BookingWizard slug={slug} catalog={catalog.data} t={t} locale={locale} />
      </main>
    </div>
  );
}

/** What the customer is typing; checked and cleaned with `bookingDetailsSchema`. */
type DraftCustomer = { firstName: string; lastName: string; phone: string; email: string };

const EMPTY_CUSTOMER: DraftCustomer = { email: "", phone: "", firstName: "", lastName: "" };

/**
 * The customer's details are remembered on their own device after a booking, so the next
 * one is quicker. Nothing is looked up on the server: typing someone's phone number must
 * never reveal their name.
 */
function savedCustomerKey(slug: string) {
  return `openturnly:customer:${slug}`;
}

function readSavedCustomer(slug: string): DraftCustomer | null {
  try {
    const saved = JSON.parse(localStorage.getItem(savedCustomerKey(slug)) ?? "null");
    if (typeof saved?.firstName !== "string" || typeof saved?.lastName !== "string") return null;
    return {
      firstName: saved.firstName,
      lastName: saved.lastName,
      phone: typeof saved.phone === "string" ? saved.phone : "",
      email: typeof saved.email === "string" ? saved.email : "",
    };
  } catch {
    return null;
  }
}

function writeSavedCustomer(slug: string, customer: BookingDetails["customer"] | null) {
  try {
    if (customer) localStorage.setItem(savedCustomerKey(slug), JSON.stringify(customer));
    else localStorage.removeItem(savedCustomerKey(slug));
  } catch {
    // Private mode or blocked storage: the form just starts empty next time.
  }
}

function BookingWizard({
  slug,
  catalog,
  t,
  locale,
}: {
  slug: string;
  catalog: PublicCatalog;
  t: T;
  locale: string;
}) {
  const { business, professionals, services } = catalog;
  // The time comes before the person: customers see who is free when, instead of picking
  // someone first and finding them fully booked.
  const steps: Step[] = ["service", "datetime", "details", "confirm"];

  const [stepIndex, setStepIndex] = useState(0);
  const [serviceId, setServiceId] = useState<string | null>(null);
  // Someone the customer wants to see (narrows the times), or null for anyone.
  const [preferredId, setPreferredId] = useState<string | null>(null);
  // Who they picked among those free at the chosen time, or null for "no preference".
  const [staffId, setStaffId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [customer, setCustomer] = useState<DraftCustomer>(
    () => readSavedCustomer(slug) ?? EMPTY_CUSTOMER,
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // The checked and cleaned details, ready to book.
  const [details, setDetails] = useState<BookingDetails | null>(null);
  const [remembered, setRemembered] = useState(() => readSavedCustomer(slug) !== null);
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [booked, setBooked] = useState<BookedAppointment | null>(null);
  // The anti-bot puzzle is solved in the background from the moment a time is being chosen.
  const takeProof = useBookingProof(slug, stepIndex >= 1);
  const book = useBook(slug, takeProof);
  // Usually instant; while a business is flooded with bookings the puzzle takes longer.
  const [slowCheck, setSlowCheck] = useState(false);
  useEffect(() => {
    if (!book.isPending) {
      setSlowCheck(false);
      return;
    }
    const timer = setTimeout(() => setSlowCheck(true), 2_000);
    return () => clearTimeout(timer);
  }, [book.isPending]);

  const step = steps[stepIndex] ?? "service";
  const resourceId = preferredId ?? staffId;
  const professional = professionals.find((member) => member.id === resourceId);
  const service = services.find((item) => item.id === serviceId);
  // Who can do the chosen service.
  const team = professionals.filter((member) => serviceId && member.serviceIds.includes(serviceId));

  // When the step last changed. "Continuar" sits in the same place on every step, so a quick
  // second click would land on the next step's button: submitting an empty form, or booking
  // without a look at the summary.
  const arrivedAt = useRef(0);
  const settled = () => Date.now() - arrivedAt.current > 500;

  const goTo = (index: number) => {
    setNotice(null);
    // Errors only show after trying to continue, not when coming back to the form.
    setErrors({});
    arrivedAt.current = Date.now();
    setStepIndex(Math.max(0, Math.min(index, steps.length - 1)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const next = () => goTo(stepIndex + 1);
  const back = () => goTo(stepIndex - 1);

  const price = (amount: number | null) =>
    amount === null ? t("services.priceOnRequest") : formatPrice(amount, business.currency);

  const confirm = () => {
    if (!service || !date || !time || !details) return;
    book.mutate(
      {
        serviceId: service.id,
        resourceId,
        date,
        time,
        customer: details.customer,
        answers: Object.fromEntries(details.answers.map((answer) => [answer.id, answer.value])),
        website,
      },
      {
        onSuccess: (appointment) => {
          writeSavedCustomer(slug, details.customer);
          setBooked(appointment);
        },
        onError: (error) => {
          const code = error instanceof ApiError ? error.code : "unknown_error";
          if (code === "slot_taken") {
            // Someone got there first: back to the times, which reload without that one.
            setTime(null);
            setStaffId(null);
            goTo(steps.indexOf("datetime"));
          }
          if (code === "already_booked" && error instanceof ApiError) {
            // The same person already has an appointment at that time: say which one.
            const when = instantToZoned(Date.parse(error.fields.startsAt ?? ""), business.timezone);
            setNotice(
              t("booking.errors.already_booked", {
                date: `${formatDay(when.date, locale)} · ${when.time}`,
                code: error.fields.code,
              }),
            );
            return;
          }
          setNotice(
            t([
              `booking.errors.${code}`,
              "errors.unknown_error",
            ] as unknown as "errors.unknown_error"),
          );
        },
      },
    );
  };

  /** Fixing a field clears its error right away instead of at the next try. */
  const clearErrors = (paths: string[]) =>
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([path]) => !paths.includes(path))),
    );
  const editCustomer = (value: DraftCustomer) => {
    const changed = (Object.keys(value) as (keyof DraftCustomer)[]).filter(
      (field) => value[field] !== customer[field],
    );
    clearErrors(changed.map((field) => `customer.${field}`));
    setCustomer(value);
  };
  const editAnswers = (value: Record<string, string>) => {
    clearErrors(
      Object.keys(value).flatMap((id) => (value[id] !== answers[id] ? [`answers.${id}`] : [])),
    );
    setAnswers(value);
  };

  const submitDetails = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(bookingDetailsSchema(business.bookingForm, business.country), {
      customer,
      answers,
    });
    setErrors(result.errors ?? {});
    if (result.data) {
      setDetails(result.data);
      next();
    }
  };

  if (booked) {
    return (
      <div className="mt-6 border-t border-zinc-100">
        <BookingDone
          appointment={booked}
          t={t}
          locale={locale}
          onAgain={() => {
            setBooked(null);
            setServiceId(null);
            setDate(null);
            setTime(null);
            setStepIndex(0);
          }}
        />
      </div>
    );
  }

  const labels: Record<Step, string> = {
    service: t("booking.steps.service"),
    datetime: t("booking.steps.datetime"),
    details: t("booking.steps.details"),
    confirm: t("booking.steps.confirm"),
  };
  const titles: Record<Step, string> = {
    service: t("booking.titles.service"),
    datetime: t("booking.titles.datetime"),
    details: t("booking.titles.details"),
    confirm: t("booking.titles.confirm"),
  };

  return (
    <section className="mt-6">
      <ol className="flex items-center gap-1.5 overflow-x-auto border-y border-zinc-100 bg-zinc-50/70 px-5 py-3.5 [scrollbar-width:none] sm:gap-2 sm:px-8">
        {steps.map((item, index) => {
          const state = index < stepIndex ? "done" : index === stepIndex ? "current" : "todo";
          return (
            <li key={item} className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {index > 0 && (
                <span
                  className={cn(
                    "h-px w-3 sm:w-6",
                    index <= stepIndex ? "bg-brand-300" : "bg-zinc-200",
                  )}
                />
              )}
              <button
                type="button"
                disabled={state === "todo"}
                onClick={() => goTo(index)}
                className="flex items-center gap-2 disabled:cursor-default"
              >
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-xs font-semibold transition-colors",
                    state === "done" && "bg-brand-100 text-brand-700",
                    state === "current" && "bg-brand-600 text-on-brand",
                    state === "todo" && "bg-zinc-100 text-zinc-400",
                  )}
                >
                  {state === "done" ? <Check className="size-3.5" aria-hidden /> : index + 1}
                </span>
                <span
                  className={cn(
                    "text-[13px] font-medium",
                    state === "current" ? "text-zinc-900" : "hidden text-zinc-500 sm:inline",
                  )}
                >
                  {labels[item]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="px-5 py-6 sm:px-8">
        <h2 className="mb-5 text-lg font-semibold text-zinc-900">{titles[step]}</h2>
        {notice && (
          <div className="mb-5">
            <Alert>{notice}</Alert>
          </div>
        )}

        {step === "service" &&
          (services.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("booking.noServices")}</p>
          ) : (
            <ul className="space-y-3">
              {services.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (item.id !== serviceId) {
                        setDate(null);
                        setTime(null);
                        setPreferredId(null);
                        setStaffId(null);
                      }
                      setServiceId(item.id);
                      next();
                    }}
                    className={cn(
                      "group block w-full rounded-2xl border p-4 text-left transition duration-200 hover:-translate-y-px hover:border-brand-300 hover:shadow-[0_12px_28px_-16px_rgb(15_15_35/0.35)] sm:p-5",
                      item.id === serviceId
                        ? "border-brand-500 bg-brand-50/40"
                        : "border-zinc-200 bg-white",
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium text-zinc-900">{item.name}</div>
                        <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                          <Clock className="size-3" aria-hidden />
                          {formatDuration(item.durationMin)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-semibold text-zinc-900 tabular-nums">
                          {price(item.priceAmount)}
                        </span>
                        <ArrowRight
                          className="size-4 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
                          aria-hidden
                        />
                      </div>
                    </div>
                    {item.description && (
                      <p className="mt-3 text-sm whitespace-pre-line text-zinc-500">
                        {item.description}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {step === "datetime" && service && (
          <DateTimeStep
            slug={slug}
            catalog={catalog}
            serviceId={service.id}
            team={team}
            preferredId={preferredId}
            onPreferred={(id) => {
              setPreferredId(id);
              setStaffId(null);
              setTime(null);
            }}
            staffId={staffId}
            onStaff={setStaffId}
            date={date}
            time={time}
            onDate={(value) => {
              setDate(value);
              setTime(null);
              setStaffId(null);
            }}
            onTime={(value) => {
              setTime(value);
              setStaffId(null);
            }}
            t={t}
            locale={locale}
          />
        )}

        {step === "details" && remembered && (
          <p className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-[13px] text-zinc-600">
            {t("booking.rememberedNote", { name: customer.firstName })}
            <button
              type="button"
              onClick={() => {
                writeSavedCustomer(slug, null);
                setCustomer(EMPTY_CUSTOMER);
                setRemembered(false);
              }}
              className="font-medium text-brand-700 hover:underline"
            >
              {t("booking.notMe")}
            </button>
          </p>
        )}

        {step === "details" && (
          <DetailsForm
            // Remounts the phone field when the saved details are cleared.
            key={remembered ? "saved" : "fresh"}
            business={business}
            customer={customer}
            onCustomer={editCustomer}
            answers={answers}
            onAnswers={editAnswers}
            errors={errors}
            website={website}
            onWebsite={setWebsite}
            onSubmit={submitDetails}
            t={t}
            locale={locale}
          />
        )}

        {step === "confirm" && service && date && time && details && (
          <Summary
            rows={[
              { label: t("booking.date"), value: `${formatDay(date, locale)} · ${time}` },
              ...(professional || team.length > 1
                ? [
                    {
                      label: t("booking.professional"),
                      value: professional?.name ?? t("booking.anyone"),
                    },
                  ]
                : []),
              { label: t("booking.service"), value: service.name },
              {
                label: t("booking.customer"),
                value: `${details.customer.firstName} ${details.customer.lastName}`,
              },
              ...(details.customer.phone
                ? [{ label: t("booking.phone"), value: formatPhone(details.customer.phone) }]
                : []),
              ...(details.customer.email
                ? [{ label: t("booking.email"), value: details.customer.email }]
                : []),
              ...details.answers.map((answer) => ({ label: answer.label, value: answer.value })),
            ]}
            total={price(service.priceAmount)}
            t={t}
          />
        )}
        {step === "confirm" && slowCheck && (
          <p className="mt-4 flex items-center gap-2 text-[13px] text-zinc-500" role="status">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {t("booking.verifying")}
          </p>
        )}
      </div>

      {stepIndex > 0 && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-zinc-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-8">
          <Button variant="secondary" onClick={back}>
            <ChevronLeft className="size-4" aria-hidden />
            {t("common.back")}
          </Button>
          {/* Distinct keys: reusing one <button> whose type flips to "submit" mid-click
              would submit the details form the moment it appears. */}
          {step === "confirm" ? (
            <Button key="confirm" onClick={() => settled() && confirm()} loading={book.isPending}>
              <CalendarCheck className="size-4" aria-hidden />
              {t("booking.confirm")}
            </Button>
          ) : step === "details" ? (
            <Button
              key="details"
              type="submit"
              form="details-form"
              onClick={(event) => {
                if (!settled()) event.preventDefault();
              }}
            >
              {t("booking.next")}
            </Button>
          ) : step === "datetime" ? (
            <Button key="datetime" onClick={() => settled() && next()} disabled={!date || !time}>
              {t("booking.next")}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** "Tus datos": name, then whichever contact details and questions the business asks for. */
function DetailsForm({
  business,
  customer,
  onCustomer,
  answers,
  onAnswers,
  errors,
  website,
  onWebsite,
  onSubmit,
  t,
  locale,
}: {
  business: PublicBusiness;
  customer: DraftCustomer;
  onCustomer: (customer: DraftCustomer) => void;
  answers: Record<string, string>;
  onAnswers: (answers: Record<string, string>) => void;
  errors: FieldErrors;
  website: string;
  onWebsite: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  t: T;
  locale: string;
}) {
  const form = business.bookingForm;
  const set = (field: keyof DraftCustomer, value: string) =>
    onCustomer({ ...customer, [field]: value });

  return (
    <form id="details-form" onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-2">
      <Field
        label={t("booking.firstName")}
        error={fieldMessage(t, "name", errors["customer.firstName"])}
      >
        {(props) => (
          <Input
            {...props}
            autoComplete="given-name"
            value={customer.firstName}
            onChange={(event) => set("firstName", event.target.value)}
          />
        )}
      </Field>
      <Field
        label={t("booking.lastName")}
        error={fieldMessage(t, "name", errors["customer.lastName"])}
      >
        {(props) => (
          <Input
            {...props}
            autoComplete="family-name"
            value={customer.lastName}
            onChange={(event) => set("lastName", event.target.value)}
          />
        )}
      </Field>
      {form.phone !== "hidden" && (
        <Field
          label={t("booking.phone")}
          optional={form.phone === "optional"}
          error={fieldMessage(t, "phone", errors["customer.phone"])}
        >
          {(props) => (
            <PhoneInput
              id={props.id}
              invalid={Boolean(errors["customer.phone"])}
              value={customer.phone}
              onChange={(phone) => set("phone", phone)}
              defaultCountry={business.country}
              locale={locale}
              searchPlaceholder={t("booking.searchCountry")}
            />
          )}
        </Field>
      )}
      {form.email !== "hidden" && (
        <Field
          label={t("booking.email")}
          optional={form.email === "optional"}
          error={fieldMessage(t, "email", errors["customer.email"])}
        >
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              value={customer.email}
              onChange={(event) => set("email", event.target.value)}
            />
          )}
        </Field>
      )}
      {form.questions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          value={answers[question.id] ?? ""}
          onChange={(value) => onAnswers({ ...answers, [question.id]: value })}
          error={fieldMessage(t, "answer", errors[`answers.${question.id}`])}
          t={t}
        />
      ))}
      {/* Honeypot: invisible to people, bots fill it in and get rejected. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => onWebsite(event.target.value)}
          />
        </label>
      </div>
    </form>
  );
}

/** One of the business's own questions: free text, a longer text, or a choice. */
function QuestionField({
  question,
  value,
  onChange,
  error,
  t,
}: {
  question: BookingQuestion;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  t: T;
}) {
  return (
    <Field
      label={question.label}
      optional={!question.required}
      error={error}
      className="sm:col-span-2"
    >
      {(props) =>
        question.type === "textarea" ? (
          <Textarea
            {...props}
            rows={3}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : question.type === "select" && question.options.length > 4 ? (
          <Select {...props} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">{t("booking.chooseOption")}</option>
            {question.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        ) : question.type === "select" ? (
          <div id={props.id} className="flex flex-wrap gap-2">
            {question.options.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={value === option}
                aria-describedby={props["aria-describedby"]}
                onClick={() => onChange(value === option ? "" : option)}
                className={cn(
                  "h-9 rounded-lg border px-3.5 text-sm font-medium transition-colors",
                  value === option
                    ? "border-brand-600 bg-brand-600 text-on-brand"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-brand-300",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        ) : (
          <Input {...props} value={value} onChange={(event) => onChange(event.target.value)} />
        )
      }
    </Field>
  );
}

type TeamMember = PublicCatalog["professionals"][number];

function DateTimeStep({
  slug,
  catalog,
  serviceId,
  team,
  preferredId,
  onPreferred,
  staffId,
  onStaff,
  date,
  time,
  onDate,
  onTime,
  t,
  locale,
}: {
  slug: string;
  catalog: PublicCatalog;
  serviceId: string;
  /** Professionals who do this service. */
  team: TeamMember[];
  preferredId: string | null;
  onPreferred: (id: string | null) => void;
  staffId: string | null;
  onStaff: (id: string | null) => void;
  date: string | null;
  time: string | null;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
  t: T;
  locale: string;
}) {
  const today = todayIn(catalog.business.timezone);
  const lastDate = addDays(today, catalog.business.maxAdvanceDays);
  const [month, setMonth] = useState((date ?? today).slice(0, 7));

  const nextMonth = addDays(`${month}-01`, 40).slice(0, 7);
  const from = `${month}-01` < today ? today : `${month}-01`;
  const lastOfMonth = addDays(`${nextMonth}-01`, -1);
  const to = lastOfMonth > lastDate ? lastDate : lastOfMonth;

  const availability = useAvailability(slug, {
    serviceId,
    resourceId: preferredId,
    from,
    to,
  });
  const days = availability.data?.days ?? {};
  const available = useMemo(() => new Set(Object.keys(days)), [days]);
  const times = date ? (days[date] ?? []) : [];
  // Who is free at the chosen time, in the team's order.
  const freeIds = date && time ? (availability.data?.staff[date]?.[time] ?? []) : [];
  const free = team.filter((member) => freeIds.includes(member.id));

  // Pick the first free day of the month so times show up right away.
  useEffect(() => {
    if (!availability.data) return;
    if (date && available.has(date)) return;
    const first = Object.keys(availability.data.days).sort()[0];
    if (first) onDate(first);
  }, [availability.data, available, date, onDate]);

  const noTimesThisMonth = availability.isSuccess && available.size === 0;

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        {team.length > 1 && (
          <Field label={t("booking.preferredLabel")}>
            {(props) => (
              <Select
                {...props}
                value={preferredId ?? ""}
                onChange={(event) => onPreferred(event.target.value || null)}
              >
                <option value="">{t("booking.anyProfessional")}</option>
                {team.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          minMonth={today.slice(0, 7)}
          maxMonth={lastDate.slice(0, 7)}
          available={available}
          selected={date}
          onSelect={onDate}
          loading={availability.isFetching}
          locale={locale}
          labels={{ previous: t("booking.previousMonth"), next: t("booking.nextMonth") }}
        />
      </div>
      <div>
        {noTimesThisMonth ? (
          <p className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-500">
            {t("booking.noTimesMonth")}
          </p>
        ) : date ? (
          <>
            <p className="mb-3 text-sm font-medium text-zinc-900 first-letter:uppercase">
              {formatDay(date, locale)}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3">
              {times.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => onTime(slot)}
                  aria-pressed={slot === time}
                  className={cn(
                    "h-10 rounded-xl border text-sm font-medium tabular-nums transition-colors",
                    slot === time
                      ? "border-brand-600 bg-brand-600 text-on-brand"
                      : "border-zinc-200 bg-white text-zinc-800 hover:border-brand-300 hover:bg-brand-50/40",
                  )}
                >
                  {slot}
                </button>
              ))}
            </div>
            {/* With "anyone", say who is free at that time and let them choose. */}
            {time && preferredId === null && free.length > 1 && (
              <div className="mt-5 rounded-2xl bg-zinc-50 p-4">
                <Field label={t("booking.whoAtTime", { time })}>
                  {(props) => (
                    <Select
                      {...props}
                      value={staffId ?? ""}
                      onChange={(event) => onStaff(event.target.value || null)}
                    >
                      <option value="">{t("booking.anyone")}</option>
                      {free.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            )}
            {time && preferredId === null && free.length === 1 && (
              <p className="mt-5 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600">
                {t("booking.onlyOneFree", { name: free[0]?.name })}
              </p>
            )}
          </>
        ) : (
          availability.isPending && <Spinner />
        )}
      </div>
    </div>
  );
}

function Summary({
  rows,
  total,
  t,
}: {
  rows: { label: string; value: string }[];
  total: string;
  t: T;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200">
      <dl className="divide-y divide-zinc-100">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 px-5 py-3 text-sm">
            <dt className="text-zinc-500">{row.label}</dt>
            <dd className="text-right font-medium text-zinc-900 first-letter:uppercase">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-5 py-4">
        <div>
          <span className="font-medium text-zinc-900">{t("booking.total")}</span>
          <p className="text-xs text-zinc-500">{t("booking.payAtBusiness")}</p>
        </div>
        <span className="text-xl font-semibold text-zinc-900 tabular-nums">{total}</span>
      </div>
    </div>
  );
}

function BookingDone({
  appointment,
  t,
  locale,
  onAgain,
}: {
  appointment: BookedAppointment;
  t: T;
  locale: string;
  onAgain: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-10 text-center sm:px-8">
      <span className="grid size-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
        <Check className="size-7" strokeWidth={3} aria-hidden />
      </span>
      <h2 className="mt-5 text-xl font-semibold text-zinc-900">{t("booking.doneTitle")}</h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">{t("booking.doneBody")}</p>
      <div className="mt-5 rounded-xl border border-dashed border-zinc-300 px-6 py-3">
        <p className="text-xs font-medium text-zinc-500">{t("booking.code")}</p>
        <p className="mt-0.5 font-mono text-2xl font-semibold tracking-[0.2em] text-zinc-900">
          {appointment.code}
        </p>
      </div>
      <div className="mt-7 w-full max-w-md text-left">
        <Summary
          rows={[
            {
              label: t("booking.date"),
              value: `${formatDay(appointment.date, locale)} · ${appointment.time}`,
            },
            ...(appointment.resourceName
              ? [{ label: t("booking.professional"), value: appointment.resourceName }]
              : []),
            { label: t("booking.service"), value: appointment.serviceName },
          ]}
          total={
            appointment.priceAmount === null
              ? t("services.priceOnRequest")
              : formatPrice(appointment.priceAmount, appointment.currency)
          }
          t={t}
        />
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button variant="ghost" onClick={onAgain}>
          <RotateCcw className="size-4" aria-hidden />
          {t("booking.bookAgain")}
        </Button>
      </div>
    </div>
  );
}
