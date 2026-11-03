import {
  addDays,
  type BookingDetails,
  type BookingQuestion,
  bookingDetailsSchema,
  formatPhone,
  formatPrice,
  GENDERS,
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
  MapPin,
  RotateCcw,
  Search,
  Users,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router";
import { Avatar } from "../components/avatar.tsx";
import { BirthDateField } from "../components/birth-date-field.tsx";
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
import { useAvailability, useBook, useGiftCodeCheck, usePublicCatalog } from "../lib/booking.ts";
import { brandStyle } from "../lib/brand.ts";
import { cn } from "../lib/cn.ts";
import { formatDay, formatDuration } from "../lib/format.ts";
import { type FieldErrors, fieldMessage, validate } from "../lib/forms.ts";
import { useBookingProof } from "../lib/proof.ts";

type Step = "location" | "service" | "datetime" | "details" | "confirm";
type T = TFunction;

/**
 * Inside another website (/<slug>?embed, see public/embed.js): the page has no background
 * of its own and tells the website how tall it is, so it fits without an inner scrollbar.
 */
function useEmbedded(embedded: boolean) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!embedded || !element || window.parent === window) return;
    document.documentElement.classList.add("embedded");
    const report = () =>
      window.parent.postMessage(
        { type: "openturnly:height", height: element.getBoundingClientRect().height },
        "*",
      );
    const observer = new ResizeObserver(report);
    observer.observe(element);
    // Escape pressed in here never reaches the website: it closes the popup through this.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.parent.postMessage({ type: "openturnly:close" }, "*");
    };
    document.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKey);
    };
  }, [embedded]);
  return frame;
}

/** The page a business shares with its customers: /<slug>. */
export function PublicBookingPage() {
  const { slug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const embedded = searchParams.has("embed");
  const catalog = usePublicCatalog(slug);
  const { i18n } = useTranslation();
  // Shown in the business's language, without changing the visitor's saved preference.
  const locale = catalog.data?.business.locale ?? i18n.resolvedLanguage ?? "es";
  const t = i18n.getFixedT(locale);
  const frame = useEmbedded(embedded && catalog.isSuccess);

  useEffect(() => {
    if (catalog.data) document.title = catalog.data.business.name;
  }, [catalog.data]);

  if (catalog.isPending) return <Spinner className={embedded ? "py-24" : "min-h-screen"} />;
  if (catalog.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 text-center">
        <h1 className="text-xl font-semibold">{t("publicPage.notFoundTitle")}</h1>
        <p className="mt-2 text-sm text-zinc-500">{t("publicPage.notFoundBody")}</p>
      </div>
    );
  }
  const { business } = catalog.data;
  if (embedded) {
    // The website around it already shows who the business is: just the booking steps.
    return (
      <div ref={frame} className="p-px" style={brandStyle(business.brandColor)}>
        <main
          className={cn(
            "mx-auto max-w-3xl overflow-clip bg-white",
            // A popup is already a white panel; on the page it's a card.
            searchParams.get("embed") !== "popup" && "rounded-2xl ring-1 ring-zinc-950/10",
          )}
        >
          <BookingWizard slug={slug} catalog={catalog.data} t={t} locale={locale} />
        </main>
      </div>
    );
  }
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
type DraftCustomer = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  birthDate: string;
  document: string;
  gender: string;
};

const EMPTY_CUSTOMER: DraftCustomer = {
  email: "",
  phone: "",
  firstName: "",
  lastName: "",
  birthDate: "",
  document: "",
  gender: "",
};

/** "14 de mayo de 1990". */
function formatBirthDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.parse(`${date}T00:00:00Z`));
}

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
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      firstName: saved.firstName,
      lastName: saved.lastName,
      phone: text(saved.phone),
      email: text(saved.email),
      birthDate: text(saved.birthDate),
      document: text(saved.document),
      gender: text(saved.gender),
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
  const { business, professionals, locations } = catalog;
  // With several locations the customer starts by choosing where. A link to one location
  // (?local=<id>) starts on its services. The time comes before the person: customers see
  // who is free when, instead of picking someone first and finding them fully booked.
  const severalLocations = locations.length > 1;
  const steps: Step[] = [
    ...(severalLocations ? (["location"] as const) : []),
    "service",
    "datetime",
    "details",
    "confirm",
  ];
  const [searchParams] = useSearchParams();
  const linked = locations.find((place) => place.id === searchParams.get("local"));

  const [stepIndex, setStepIndex] = useState(severalLocations && linked ? 1 : 0);
  const [locationId, setLocationId] = useState<string | null>(
    linked?.id ?? (severalLocations ? null : (locations[0]?.id ?? null)),
  );
  const location = locations.find((place) => place.id === locationId);
  // What the chosen location offers.
  const services = location
    ? catalog.services.filter((service) => location.serviceIds.includes(service.id))
    : catalog.services;
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
  // A discount code that worked for the chosen service.
  const [gift, setGift] = useState<{ code: string; discountAmount: number } | null>(null);
  // The anti-bot puzzle is solved in the background from the moment a time is being chosen.
  const takeProof = useBookingProof(slug, stepIndex >= steps.indexOf("datetime"));
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
  /** Picks a service; a different one starts the date, time and person over. */
  const chooseService = (id: string) => {
    if (id !== serviceId) {
      setGift(null);
      setDate(null);
      setTime(null);
      setPreferredId(null);
      setStaffId(null);
    }
    setServiceId(id);
  };
  /** Picks a location; another one starts the service, date, time and person over. */
  const chooseLocation = (id: string) => {
    if (id !== locationId) {
      setServiceId(null);
      setDate(null);
      setTime(null);
      setPreferredId(null);
      setStaffId(null);
    }
    setLocationId(id);
  };
  // Who can do the chosen service, at the chosen location.
  const team = professionals.filter(
    (member) =>
      serviceId &&
      member.serviceIds.includes(serviceId) &&
      (!location || location.professionalIds.includes(member.id)),
  );

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
    // Inside another website, that website scrolls back to the top of the booking page.
    if (searchParams.has("embed") && window.parent !== window) {
      window.parent.postMessage({ type: "openturnly:step" }, "*");
    }
  };
  const next = () => goTo(stepIndex + 1);
  const back = () => goTo(stepIndex - 1);

  const price = (amount: number | null) =>
    amount === null ? t("services.priceOnRequest") : formatPrice(amount, business.currency);

  const confirm = () => {
    if (!service || !date || !time || !details) return;
    book.mutate(
      {
        ...(location ? { locationId: location.id } : {}),
        serviceId: service.id,
        resourceId,
        date,
        time,
        customer: details.customer,
        answers: Object.fromEntries(details.answers.map((answer) => [answer.id, answer.value])),
        ...(gift ? { giftCode: gift.code } : {}),
        website,
      },
      {
        onSuccess: (appointment) => {
          writeSavedCustomer(slug, details.customer);
          setBooked(appointment);
        },
        onError: (error) => {
          const code = error instanceof ApiError ? error.code : "unknown_error";
          // The code stopped working meanwhile (its last use went to someone else).
          if (code === "gift_card_unusable" || code === "gift_card_not_found") setGift(null);
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
          showLocation={severalLocations}
          t={t}
          locale={locale}
          onAgain={() => {
            setBooked(null);
            if (severalLocations) setLocationId(null);
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
    location: t("booking.steps.location"),
    service: t("booking.steps.service"),
    datetime: t("booking.steps.datetime"),
    details: t("booking.steps.details"),
    confirm: t("booking.steps.confirm"),
  };
  const titles: Record<Step, string> = {
    location: t("booking.titles.location"),
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

        {step === "location" && (
          <ul className="space-y-3">
            {locations.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => {
                    chooseLocation(place.id);
                    next();
                  }}
                  className={cn(
                    "group block w-full rounded-2xl border p-4 text-left transition duration-200 hover:-translate-y-px hover:border-brand-300 hover:shadow-[0_12px_28px_-16px_rgb(15_15_35/0.35)] sm:p-5",
                    place.id === locationId
                      ? "border-brand-500 bg-brand-50/40"
                      : "border-zinc-200 bg-white",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-zinc-900">{place.name}</div>
                      {place.address && (
                        <div className="mt-1.5 flex items-start gap-1.5 text-sm text-zinc-500">
                          <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span>{place.address}</span>
                        </div>
                      )}
                      {place.phone && (
                        <div className="mt-1 text-sm text-zinc-500 tabular-nums">{place.phone}</div>
                      )}
                    </div>
                    <ArrowRight
                      className="mt-0.5 size-4 shrink-0 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
                      aria-hidden
                    />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {step === "service" &&
          (services.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("booking.noServices")}</p>
          ) : (
            <ServiceMenu
              services={services}
              selectedId={serviceId}
              price={price}
              onChoose={(id) => {
                chooseService(id);
                next();
              }}
            />
          ))}

        {step === "datetime" && service && (
          <DateTimeStep
            slug={slug}
            catalog={catalog}
            locationId={location?.id ?? null}
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
              ...(severalLocations && location
                ? [
                    {
                      label: t("booking.location"),
                      value: [location.name, location.address].filter(Boolean).join(" · "),
                    },
                  ]
                : []),
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
              ...(details.customer.birthDate
                ? [
                    {
                      label: t("booking.birthDate"),
                      value: formatBirthDate(details.customer.birthDate, locale),
                    },
                  ]
                : []),
              ...(details.customer.document
                ? [{ label: t("booking.document"), value: details.customer.document }]
                : []),
              ...(details.customer.gender
                ? [
                    {
                      label: t("booking.gender"),
                      value: t(`booking.genders.${details.customer.gender}`),
                    },
                  ]
                : []),
              ...details.answers.map((answer) => ({ label: answer.label, value: answer.value })),
              ...(gift && service.priceAmount !== null
                ? [
                    { label: t("booking.price"), value: price(service.priceAmount) },
                    {
                      label: t("booking.discountCode", { code: gift.code }),
                      value: `−${formatPrice(gift.discountAmount, business.currency)}`,
                    },
                  ]
                : []),
            ]}
            total={
              gift && service.priceAmount !== null
                ? formatPrice(service.priceAmount - gift.discountAmount, business.currency)
                : price(service.priceAmount)
            }
            t={t}
          />
        )}
        {step === "confirm" && service && (
          <GiftCodeBox slug={slug} serviceId={service.id} applied={gift} onApply={setGift} t={t} />
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
      {(form.birthDate ?? "hidden") !== "hidden" && (
        <Field
          label={t("booking.birthDate")}
          optional={form.birthDate === "optional"}
          error={fieldMessage(t, "birthDate", errors["customer.birthDate"])}
        >
          {(props) => (
            <BirthDateField
              id={props.id}
              describedBy={props["aria-describedby"]}
              invalid={props["aria-invalid"]}
              value={customer.birthDate}
              onChange={(date) => set("birthDate", date)}
              locale={locale}
              labels={{
                day: t("booking.birthDay"),
                month: t("booking.birthMonth"),
                year: t("booking.birthYear"),
              }}
            />
          )}
        </Field>
      )}
      {(form.document ?? "hidden") !== "hidden" && (
        <Field
          label={t("booking.document")}
          optional={form.document === "optional"}
          error={fieldMessage(t, "document", errors["customer.document"])}
        >
          {(props) => (
            <Input
              {...props}
              maxLength={40}
              value={customer.document}
              onChange={(event) => set("document", event.target.value)}
            />
          )}
        </Field>
      )}
      {(form.gender ?? "hidden") !== "hidden" && (
        <Field
          label={t("booking.gender")}
          optional={form.gender === "optional"}
          error={fieldMessage(t, "gender", errors["customer.gender"])}
        >
          {(props) => (
            <Select
              {...props}
              value={customer.gender}
              onChange={(event) => set("gender", event.target.value)}
            >
              <option value="">{t("booking.genderPlaceholder")}</option>
              {GENDERS.map((gender) => (
                <option key={gender} value={gender}>
                  {t(`booking.genders.${gender}`)}
                </option>
              ))}
            </Select>
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

/** Lowercase and without accents, so "depilacion" finds "Depilación". */
const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * The services to choose from as a compact menu, two short lines each, grouped under their
 * categories (in the order the business put them, the ones without one last), with chips to
 * show one group and a search once the menu is long.
 */
function ServiceMenu({
  services,
  selectedId,
  price,
  onChoose,
}: {
  services: PublicCatalog["services"];
  selectedId: string | null;
  price: (amount: number | null) => string;
  onChoose: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const groups = [...new Set(services.map((item) => item.category ?? ""))].sort(
    (a, b) => Number(a === "") - Number(b === ""),
  );
  const grouped = groups.some((name) => name !== "");
  const words = plain(query).split(/\s+/).filter(Boolean);
  const matches = services.filter(
    (item) =>
      (group === null || (item.category ?? "") === group) &&
      words.every((word) =>
        plain(`${item.name} ${item.description ?? ""} ${item.category ?? ""}`).includes(word),
      ),
  );
  const sections = groups
    .map((name) => ({ name, items: matches.filter((item) => (item.category ?? "") === name) }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="space-y-4">
      {services.length > 6 && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400"
            aria-hidden
          />
          <Input
            type="search"
            aria-label={t("booking.searchServices")}
            placeholder={t("booking.searchServices")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
      )}
      {grouped && groups.length > 1 && (
        // One line that scrolls sideways on a phone, instead of wrapping into several.
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[null, ...groups].map((name) => (
            <button
              key={name ?? "all"}
              type="button"
              aria-pressed={group === name}
              onClick={() => setGroup(name)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-[13px] font-medium whitespace-nowrap transition-colors",
                group === name
                  ? "border-brand-600 bg-brand-600 text-on-brand"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-brand-300",
              )}
            >
              {name === null ? t("booking.allServices") : name || t("booking.otherServices")}
            </button>
          ))}
        </div>
      )}
      {sections.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-500">
          {t("booking.noServiceMatches")}
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.name}>
            {grouped && (
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                {section.name || t("booking.otherServices")}
              </h3>
            )}
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
              {section.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onChoose(item.id)}
                    className={cn(
                      "group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-50/50",
                      item.id === selectedId && "bg-brand-50/60",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-zinc-900">{item.name}</span>
                        <span className="shrink-0 font-semibold text-zinc-900 tabular-nums">
                          {price(item.priceAmount)}
                        </span>
                      </div>
                      {/* One line: the whole description shows on hover. */}
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-zinc-500">
                        <Clock className="size-3 shrink-0" aria-hidden />
                        <span className="shrink-0">{formatDuration(item.durationMin)}</span>
                        {item.description && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="truncate" title={item.description}>
                              {item.description}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <ArrowRight
                      className="size-4 shrink-0 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/** Who to book with: their photo (or initials) and name, plus "anyone" first. */
function TeamPicker({
  label,
  anyLabel,
  members,
  value,
  onChange,
}: {
  label: string;
  anyLabel: string;
  members: TeamMember[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const options = [{ id: null, name: anyLabel, photoUrl: null }, ...members];
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-zinc-800">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((member) => (
          <button
            key={member.id ?? "anyone"}
            type="button"
            aria-pressed={value === member.id}
            onClick={() => onChange(member.id)}
            className={cn(
              "flex max-w-full items-center gap-2 rounded-full border py-1 pr-3.5 pl-1 text-sm transition-colors",
              value === member.id
                ? "border-brand-500 bg-brand-50 font-medium text-brand-800"
                : "border-zinc-200 bg-white text-zinc-700 hover:border-brand-300",
            )}
          >
            {member.id === null ? (
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-500">
                <Users className="size-4" aria-hidden />
              </span>
            ) : (
              <Avatar name={member.name} url={member.photoUrl} className="size-8 text-[11px]" />
            )}
            <span className="truncate">{member.name}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function DateTimeStep({
  slug,
  catalog,
  locationId,
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
  locationId: string | null;
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
    locationId,
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
    <div className="space-y-6">
      {/* Who first, across the whole width; then the day and its times side by side. */}
      {team.length > 1 && (
        <TeamPicker
          label={t("booking.preferredLabel")}
          anyLabel={t("booking.anyProfessional")}
          members={team}
          value={preferredId}
          onChange={onPreferred}
        />
      )}
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
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
                  <TeamPicker
                    label={t("booking.whoAtTime", { time })}
                    anyLabel={t("booking.anyone")}
                    members={free}
                    value={staffId}
                    onChange={onStaff}
                  />
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
  showLocation,
  t,
  locale,
  onAgain,
}: {
  appointment: BookedAppointment;
  showLocation: boolean;
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
            ...(showLocation
              ? [
                  {
                    label: t("booking.location"),
                    value: [appointment.location.name, appointment.location.address]
                      .filter(Boolean)
                      .join(" · "),
                  },
                ]
              : []),
            {
              label: t("booking.date"),
              value: `${formatDay(appointment.date, locale)} · ${appointment.time}`,
            },
            ...(appointment.resourceName
              ? [{ label: t("booking.professional"), value: appointment.resourceName }]
              : []),
            { label: t("booking.service"), value: appointment.serviceName },
            ...(appointment.discountAmount > 0
              ? [
                  {
                    label: t("booking.discount"),
                    value: `−${formatPrice(appointment.discountAmount, appointment.currency)}`,
                  },
                ]
              : []),
          ]}
          total={
            appointment.priceAmount === null
              ? t("services.priceOnRequest")
              : formatPrice(
                  appointment.priceAmount - appointment.discountAmount,
                  appointment.currency,
                )
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

/** "¿Tienes un código de descuento?": checked against the chosen service before booking. */
function GiftCodeBox({
  slug,
  serviceId,
  applied,
  onApply,
  t,
}: {
  slug: string;
  serviceId: string;
  applied: { code: string; discountAmount: number } | null;
  onApply: (gift: { code: string; discountAmount: number } | null) => void;
  t: T;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const check = useGiftCodeCheck(slug);

  if (applied) {
    return (
      <p className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-brand-50/60 px-4 py-3 text-sm">
        <span className="text-zinc-700">{t("booking.codeApplied", { code: applied.code })}</span>
        <button
          type="button"
          className="font-medium text-brand-700 hover:underline"
          onClick={() => onApply(null)}
        >
          {t("booking.removeCode")}
        </button>
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        className="mt-4 text-sm font-medium text-brand-700 hover:underline"
        onClick={() => setOpen(true)}
      >
        {t("booking.haveCode")}
      </button>
    );
  }
  const apply = () => {
    if (!code.trim()) return;
    check.mutate(
      { code, serviceId },
      {
        onSuccess: (result) =>
          onApply({ code: result.code, discountAmount: result.discountAmount }),
      },
    );
  };
  const problem =
    check.error instanceof ApiError
      ? check.error.code === "gift_card_unusable"
        ? t(
            `booking.codeStates.${check.error.fields.code ?? "inactive"}` as "booking.codeStates.inactive",
          )
        : check.error.code === "gift_card_not_found"
          ? t("booking.codeNotFound")
          : t("errors.unknown_error")
      : null;
  return (
    <div className="mt-4 space-y-2">
      <div className="flex gap-2">
        <Input
          aria-label={t("booking.codePlaceholder")}
          placeholder={t("booking.codePlaceholder")}
          className="font-mono uppercase"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
        />
        <Button variant="secondary" onClick={apply} loading={check.isPending}>
          {t("booking.applyCode")}
        </Button>
      </div>
      {problem && <p className="text-[13px] text-red-600">{problem}</p>}
    </div>
  );
}
