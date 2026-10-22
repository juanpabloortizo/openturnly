import { formatPhone, instantToZoned, staffBookingSchema, todayIn } from "@openturnly/core";
import { Search, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/controls.tsx";
import { PhoneInput } from "../../components/phone-input.tsx";
import { RangeCalendar } from "../../components/range-calendar.tsx";
import { toast } from "../../components/toast.tsx";
import { Button, Field, Input, Select, Spinner } from "../../components/ui.tsx";
import { ApiError, type CustomerSummary } from "../../lib/api.ts";
import {
  useCreateAppointment,
  useCustomerSearch,
  useNewAppointmentSlots,
  useProfessionals,
  useServices,
} from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { formatDay } from "../../lib/format.ts";
import { errorMessage, type FieldErrors, fieldMessage, validate } from "../../lib/forms.ts";
import { useBusinessContext } from "./business.tsx";

const EMPTY_CUSTOMER = { firstName: "", lastName: "", phone: "", email: "" };

/**
 * Books an appointment from the agenda (a phone call, someone at the counter): an
 * existing customer or a new one, a service, who attends, and a free time. Professionals
 * always book for themselves.
 */
export function NewAppointmentForm({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const isProfessional = business.access.role === "professional";
  const services = useServices(business.id);
  const professionals = useProfessionals(business.id);
  const create = useCreateAppointment(business.id);
  const today = todayIn(business.timezone);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<CustomerSummary | null>(null);
  const [draft, setDraft] = useState(EMPTY_CUSTOMER);
  const activeServices = services.data?.filter((service) => service.active) ?? [];
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [resourceId, setResourceId] = useState<string | null>(
    isProfessional ? business.access.resourceId : null,
  );
  const [date, setDate] = useState(today);
  const [time, setTime] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  // Start on the first service once they load.
  useEffect(() => {
    if (serviceId === null && activeServices[0]) setServiceId(activeServices[0].id);
  }, [serviceId, activeServices]);

  const results = useCustomerSearch(business.id, debounced);
  const slots = useNewAppointmentSlots(business.id, serviceId, date);
  const team = (professionals.data ?? []).filter(
    (professional) => serviceId && professional.serviceIds.includes(serviceId),
  );
  const times = (slots.data ?? []).filter(
    (slot) => resourceId === null || slot.resourceIds.includes(resourceId),
  );
  const me = professionals.data?.find((professional) => professional.id === resourceId);

  const save = () => {
    const input = {
      serviceId: serviceId ?? "",
      resourceId,
      date,
      time: time ?? "",
      ...(mode === "existing" && picked ? { customerId: picked.id } : {}),
      ...(mode === "new" ? { customer: draft } : {}),
    };
    const result = validate(staffBookingSchema, input);
    setErrors(result.errors ?? {});
    if (!result.data) {
      if (result.errors?.customerId) toast.error(t("agenda.pickCustomer"));
      else if (result.errors?.time) toast.error(t("agenda.pickTime"));
      return;
    }
    create.mutate(input, {
      onSuccess: () => {
        toast.success(t("agenda.created"));
        onClose();
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === "already_booked") {
          const when = instantToZoned(Date.parse(error.fields.startsAt ?? ""), business.timezone);
          toast.error(
            t("agenda.alreadyBooked", {
              date: `${formatDay(when.date, language)} · ${when.time}`,
              code: error.fields.code,
            }),
          );
          return;
        }
        if (error instanceof ApiError && error.code === "slot_taken") {
          setTime(null);
          slots.refetch();
        }
        toast.error(errorMessage(t, error));
      },
    });
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("agenda.newTitle")}
      description={t("agenda.newHint")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} loading={create.isPending}>
            {t("agenda.createAppointment")}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-800">{t("customers.colCustomer")}</p>
              <div className="inline-flex rounded-md bg-zinc-100 p-0.5">
                {(["existing", "new"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={mode === option}
                    onClick={() => setMode(option)}
                    className={cn(
                      "h-7 rounded px-2.5 text-[13px] font-medium transition-colors",
                      mode === option
                        ? "bg-white text-zinc-900 shadow-xs"
                        : "text-zinc-500 hover:text-zinc-900",
                    )}
                  >
                    {t(`agenda.customerMode.${option}`)}
                  </button>
                ))}
              </div>
            </div>
            {mode === "existing" ? (
              picked ? (
                <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2.5">
                  <span className="grid size-8 place-items-center rounded-full bg-white text-brand-700">
                    <UserRound className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">
                      {picked.firstName} {picked.lastName}
                    </p>
                    <p className="truncate text-[13px] text-zinc-500">
                      {picked.phone ? formatPhone(picked.phone) : picked.email}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPicked(null)}
                    aria-label={t("agenda.changeCustomer")}
                    title={t("agenda.changeCustomer")}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400"
                      aria-hidden
                    />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("agenda.searchCustomer")}
                      aria-label={t("agenda.searchCustomer")}
                      className="pl-8"
                    />
                  </div>
                  {debounced.trim().length >= 2 && (
                    <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-zinc-200">
                      {results.isPending ? (
                        <Spinner />
                      ) : (results.data ?? []).length === 0 ? (
                        <p className="px-3 py-3 text-[13px] text-zinc-500">
                          {t("agenda.noCustomerFound")}{" "}
                          <button
                            type="button"
                            onClick={() => setMode("new")}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {t("agenda.createCustomer")}
                          </button>
                        </p>
                      ) : (
                        results.data?.map((customer) => (
                          <button
                            key={customer.id}
                            type="button"
                            onClick={() => setPicked(customer)}
                            className="flex w-full items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-zinc-50"
                          >
                            <span className="truncate font-medium text-zinc-900">
                              {customer.firstName} {customer.lastName}
                            </span>
                            <span className="shrink-0 text-[13px] text-zinc-500 tabular-nums">
                              {customer.phone ? formatPhone(customer.phone) : customer.email}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t("booking.firstName")}
                  error={fieldMessage(t, "name", errors["customer.firstName"])}
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={draft.firstName}
                      onChange={(event) => setDraft({ ...draft, firstName: event.target.value })}
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
                      value={draft.lastName}
                      onChange={(event) => setDraft({ ...draft, lastName: event.target.value })}
                    />
                  )}
                </Field>
                {/* Full rows: the country picker leaves too little room for the number. */}
                <Field
                  label={t("booking.phone")}
                  error={fieldMessage(t, "phone", errors["customer.phone"])}
                  className="sm:col-span-2"
                >
                  {(props) => (
                    <PhoneInput
                      id={props.id}
                      invalid={Boolean(errors["customer.phone"])}
                      value={draft.phone}
                      onChange={(phone) => setDraft({ ...draft, phone })}
                      defaultCountry={business.country}
                      locale={language}
                      searchPlaceholder={t("booking.searchCountry")}
                    />
                  )}
                </Field>
                <Field
                  label={t("booking.email")}
                  optional
                  error={fieldMessage(t, "email", errors["customer.email"])}
                  className="sm:col-span-2"
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="email"
                      value={draft.email}
                      onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                    />
                  )}
                </Field>
              </div>
            )}
          </div>

          <Field label={t("booking.service")}>
            {(props) => (
              <Select
                {...props}
                value={serviceId ?? ""}
                onChange={(event) => {
                  setServiceId(event.target.value || null);
                  setTime(null);
                }}
              >
                {activeServices.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {isProfessional
            ? me && (
                <p className="text-[13px] text-zinc-500">
                  {t("agenda.bookedForYou", { name: me.name })}
                </p>
              )
            : (professionals.data?.length ?? 0) > 0 && (
                <Field label={t("booking.professional")}>
                  {(props) => (
                    <Select
                      {...props}
                      value={resourceId ?? ""}
                      onChange={(event) => {
                        setResourceId(event.target.value || null);
                        setTime(null);
                      }}
                    >
                      <option value="">{t("agenda.anyFree")}</option>
                      {team.map((professional) => (
                        <option key={professional.id} value={professional.id}>
                          {professional.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
        </div>

        <div className="min-w-0 space-y-4">
          <RangeCalendar
            value={{ start: date, end: date }}
            onChange={(range) => {
              setDate(range.start);
              setTime(null);
            }}
            min={today}
            locale={language}
            labels={{ previous: t("agenda.previous"), next: t("agenda.next") }}
          />
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-800">{t("agenda.newTime")}</p>
            {slots.isPending ? (
              <Spinner />
            ) : times.length === 0 ? (
              <p className="rounded-lg bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                {t("agenda.noFreeTimes")}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {times.map((slot) => (
                  <button
                    key={slot.time}
                    type="button"
                    onClick={() => setTime(slot.time)}
                    aria-pressed={slot.time === time}
                    className={cn(
                      "h-9 rounded-lg border text-sm font-medium tabular-nums transition-colors",
                      slot.time === time
                        ? "border-brand-600 bg-brand-600 text-on-brand"
                        : "border-zinc-200 text-zinc-700 hover:border-brand-300",
                    )}
                  >
                    {slot.time}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
