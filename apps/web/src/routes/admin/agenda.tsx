import type { DatesSetArg, EventClickArg, EventContentArg, EventInput } from "@fullcalendar/core";
import esLocale from "@fullcalendar/core/locales/es";
import dayGridPlugin from "@fullcalendar/daygrid";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import {
  formatPhone,
  formatPrice,
  instantToZoned,
  parseTime,
  todayIn,
  zonedTimeToInstant,
} from "@openturnly/core";
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Contact,
  Mail,
  Phone,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useConfirm } from "../../components/confirm.tsx";
import { Modal, PageHeader } from "../../components/controls.tsx";
import {
  DateRangePicker,
  type Period,
  periodPresets,
} from "../../components/date-range-picker.tsx";
import { RangeCalendar } from "../../components/range-calendar.tsx";
import { toast } from "../../components/toast.tsx";
import { Alert, Button, buttonClass, Card, Field, Select, Spinner } from "../../components/ui.tsx";
import type { Appointment, WeeklyRange } from "../../lib/api.ts";
import { useProtection } from "../../lib/businesses.ts";
import {
  useAppointmentSlots,
  useAppointments,
  useCancelAppointment,
  useHours,
  useProfessionals,
  useRescheduleAppointment,
  useServices,
} from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { errorMessage } from "../../lib/forms.ts";
import { AppointmentsList, bookedVia } from "./appointments-list.tsx";
import { publicUrl, useBusinessContext } from "./business.tsx";
import { NewAppointmentForm } from "./new-appointment.tsx";

/** One per professional on the calendar, starting with OpenTurnly's petrol. */
const COLORS = ["#0f766e", "#0284c7", "#d97706", "#db2777", "#65a30d", "#7c3aed", "#475569"];

type View = "timeGridDay" | "timeGridThreeDay" | "timeGridWeek" | "dayGridMonth" | "list";

/**
 * The business calendar. FullCalendar runs in "UTC" mode and receives wall-clock times
 * already converted to the business time zone, so the agenda always shows the
 * business's local time, wherever the person looking at it is.
 */
export function AgendaPage() {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const tz = business.timezone;
  const calendar = useRef<FullCalendar>(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const [view, setView] = useState<View>(isMobile ? "list" : "timeGridWeek");
  const [creating, setCreating] = useState(false);
  // Professionals see only their own appointments (the server filters them too).
  const isProfessional = business.access.role === "professional";
  const protection = useProtection(business.id, !isProfessional);
  // The list shows any period; it starts on the current month.
  const [period, setPeriod] = useState<Period>(() => periodPresets(todayIn(tz)).month);
  const [title, setTitle] = useState("");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [resourceFilter, setResourceFilter] = useState("");
  const [selected, setSelected] = useState<Appointment | null>(null);

  const appointments = useAppointments(business.id, range);
  const professionals = useProfessionals(business.id);
  const services = useServices(business.id);
  const hours = useHours(business.id);

  const colorOf = useMemo(() => {
    const ids = professionals.data?.map((professional) => professional.id) ?? [];
    return (id: string | null) =>
      (id ? COLORS[ids.indexOf(id) % COLORS.length] : undefined) ?? COLORS[0] ?? "#0f766e";
  }, [professionals.data]);

  const toWallClock = (iso: string) => {
    const { date, time } = instantToZoned(Date.parse(iso), tz);
    return `${date}T${time}:00`;
  };

  const events: EventInput[] = (appointments.data ?? [])
    .filter((appointment) => !resourceFilter || appointment.resourceId === resourceFilter)
    .map((appointment) => {
      const color = colorOf(appointment.resourceId);
      return {
        id: appointment.id,
        title: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
        start: toWallClock(appointment.startsAt),
        end: toWallClock(appointment.endsAt),
        // Soft tint with a solid left edge; text follows the theme for contrast.
        backgroundColor: `${color}1f`,
        borderColor: color,
        textColor: "var(--color-zinc-900)",
        extendedProps: { appointment },
      };
    });

  const allRanges = [
    ...(hours.data?.business ?? []),
    ...Object.values(hours.data?.professionals ?? {}).flat(),
  ];
  const { slotMinTime, slotMaxTime } = visibleHours(allRanges, events);

  const onDatesSet = (info: DatesSetArg) => {
    setTitle(info.view.title);
    // In UTC mode the view's dates are the business's calendar dates.
    const from = new Date(zonedTimeToInstant(info.startStr.slice(0, 10), 0, tz)).toISOString();
    const to = new Date(zonedTimeToInstant(info.endStr.slice(0, 10), 0, tz)).toISOString();
    setRange((current) => (current?.from === from && current.to === to ? current : { from, to }));
  };

  const api = () => calendar.current?.getApi();
  const changeView = (next: View) => {
    setView(next);
    // The list is our own table; the calendar remounts on the chosen view when it returns.
    if (next !== "list") api()?.changeView(next);
  };

  // A whole week or month doesn't fit a phone's width: three days instead.
  const views: { value: View; label: string }[] = isMobile
    ? [
        { value: "timeGridDay", label: t("agenda.viewDay") },
        { value: "timeGridThreeDay", label: t("agenda.viewThreeDays") },
        { value: "list", label: t("agenda.viewList") },
      ]
    : [
        { value: "timeGridDay", label: t("agenda.viewDay") },
        { value: "timeGridWeek", label: t("agenda.viewWeek") },
        { value: "dayGridMonth", label: t("agenda.viewMonth") },
        { value: "list", label: t("agenda.viewList") },
      ];

  const hasServices = (services.data?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title={t("agenda.title")}
        subtitle={t("agenda.subtitle")}
        actions={
          <>
            <a
              href={publicUrl(business.slug)}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({ variant: "secondary" })}
              data-tour="agenda-bookingPage"
            >
              {t("nav.bookingPage")}
              <ArrowUpRight className="size-4" aria-hidden />
            </a>
            <Button
              data-tour="agenda-new"
              onClick={() => setCreating(true)}
              disabled={isProfessional && !business.access.resourceId}
              title={
                isProfessional && !business.access.resourceId ? t("errors.no_profile") : undefined
              }
            >
              <Plus className="size-4" aria-hidden />
              {t("agenda.newAppointment")}
            </Button>
          </>
        }
      />

      {protection.data?.active && (
        <div className="mb-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
          <div>
            <p className="font-medium">
              {t("agenda.surge.title", { count: protection.data.lastHour })}
            </p>
            <p className="mt-0.5 text-amber-800">{t("agenda.surge.body")}</p>
          </div>
        </div>
      )}

      {services.data && !hasServices && (
        <GettingStarted
          hasHours={(hours.data?.business.length ?? 0) > 0}
          hasProfessionals={(professionals.data?.length ?? 0) > 0}
        />
      )}

      <Card className="overflow-hidden rounded-xl">
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3"
          data-tour="agenda-calendar"
        >
          {view === "list" ? (
            <DateRangePicker
              value={period}
              onChange={setPeriod}
              today={todayIn(tz)}
              locale={i18n.resolvedLanguage ?? "es"}
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
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => api()?.today()}>
                {t("agenda.today")}
              </Button>
              <div className="flex">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => api()?.prev()}
                  aria-label={t("agenda.previous")}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => api()?.next()}
                  aria-label={t("agenda.next")}
                >
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
              <h2 className="text-[15px] font-semibold text-zinc-900 first-letter:uppercase">
                {title}
              </h2>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!isProfessional && (professionals.data?.length ?? 0) > 0 && (
              <Select
                aria-label={t("agenda.filterProfessional")}
                value={resourceFilter}
                onChange={(event) => setResourceFilter(event.target.value)}
                className="w-56 [&_select]:h-8 [&_select]:text-[13px]"
              >
                <option value="">{t("agenda.allProfessionals")}</option>
                {professionals.data?.map((professional) => (
                  <option key={professional.id} value={professional.id}>
                    {professional.name}
                  </option>
                ))}
              </Select>
            )}
            <div
              className="inline-flex rounded-md bg-zinc-100 p-0.5"
              role="tablist"
              data-tour="agenda-views"
            >
              {views.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={view === option.value}
                  onClick={() => changeView(option.value)}
                  className={cn(
                    "h-7 rounded px-2.5 text-[13px] font-medium transition-colors",
                    view === option.value
                      ? "bg-white text-zinc-900 shadow-xs"
                      : "text-zinc-500 hover:text-zinc-900",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {view === "list" ? (
          <AppointmentsList period={period} resourceFilter={resourceFilter} onOpen={setSelected} />
        ) : (
          <>
            {appointments.isError && (
              <div className="p-4">
                <Alert>{errorMessage(t, appointments.error)}</Alert>
              </div>
            )}
            <div className="openturnly-calendar">
              <FullCalendar
                ref={calendar}
                plugins={[timeGridPlugin, dayGridPlugin]}
                initialView={view}
                views={{ timeGridThreeDay: { type: "timeGrid", duration: { days: 3 } } }}
                headerToolbar={false}
                locales={[esLocale]}
                locale={i18n.resolvedLanguage === "es" ? "es" : "en"}
                timeZone="UTC"
                now={() => toWallClock(new Date().toISOString())}
                firstDay={1}
                height="auto"
                allDaySlot={false}
                nowIndicator
                expandRows
                slotMinTime={slotMinTime}
                slotMaxTime={slotMaxTime}
                slotDuration="00:30:00"
                // Appointments at the same time sit side by side instead of on top of each other.
                slotEventOverlap={false}
                slotLabelInterval="01:00"
                dayHeaderFormat={{ weekday: "short", day: "numeric" }}
                businessHours={(hours.data?.business ?? []).map((range) => ({
                  daysOfWeek: [range.weekday],
                  startTime: range.start,
                  endTime: range.end,
                }))}
                eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
                slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
                events={events}
                eventContent={(info: EventContentArg) => <EventCard info={info} />}
                datesSet={onDatesSet}
                eventClick={(info: EventClickArg) =>
                  setSelected(info.event.extendedProps.appointment as Appointment)
                }
              />
            </div>
          </>
        )}
      </Card>

      {selected && <AppointmentDetails appointment={selected} onClose={() => setSelected(null)} />}
      {creating && <NewAppointmentForm onClose={() => setCreating(false)} />}
    </>
  );
}

function EventCard({ info }: { info: EventContentArg }) {
  const appointment = info.event.extendedProps.appointment as Appointment;
  const start = info.timeText.split(/\s*[-–]\s*/)[0];
  if (info.view.type === "dayGridMonth") {
    return (
      <span className="flex min-w-0 items-center gap-1.5 px-1 text-[11px]">
        <span className="text-zinc-500 tabular-nums">{start}</span>
        <span className="truncate font-medium text-zinc-900">{info.event.title}</span>
      </span>
    );
  }
  // Name first (who is coming), then when and what; longer slots also show who attends.
  const minutes = ((info.event.end?.getTime() ?? 0) - (info.event.start?.getTime() ?? 0)) / 60_000;
  if (minutes < 30) {
    return (
      <div className="flex h-full min-w-0 items-center gap-1.5 overflow-hidden px-2 text-[11px] leading-none">
        <span className="text-zinc-600 tabular-nums">{start}</span>
        <span className="truncate font-semibold text-zinc-900">{info.event.title}</span>
      </div>
    );
  }
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden px-2 py-1 leading-snug">
      <span className="truncate text-xs font-semibold text-zinc-900">{info.event.title}</span>
      <span className="truncate text-[11px] text-zinc-600">
        <span className="tabular-nums">{start}</span> · {appointment.serviceName}
      </span>
      {minutes > 30 && appointment.resourceName && (
        <span className="truncate text-[11px] text-zinc-500">{appointment.resourceName}</span>
      )}
    </div>
  );
}

/** First and last hour worth showing, from opening hours and loaded appointments. */
function visibleHours(ranges: WeeklyRange[], events: EventInput[]) {
  const minutes = [
    ...ranges.flatMap((range) => [parseTime(range.start), parseTime(range.end)]),
    ...events.flatMap((event) => [
      parseTime(String(event.start).slice(11, 16)),
      parseTime(String(event.end).slice(11, 16)) || 24 * 60,
    ]),
  ];
  if (minutes.length === 0) return { slotMinTime: "07:00:00", slotMaxTime: "21:00:00" };
  const first = Math.max(0, Math.floor(Math.min(...minutes) / 60) - 1);
  const last = Math.min(24, Math.ceil(Math.max(...minutes) / 60) + 1);
  const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00:00`;
  return { slotMinTime: pad(first), slotMaxTime: pad(last) };
}

/** Shown until the business has services, since nobody can book before that. */
function GettingStarted({
  hasHours,
  hasProfessionals,
}: {
  hasHours: boolean;
  hasProfessionals: boolean;
}) {
  const { t } = useTranslation();
  const steps = [
    { done: false, label: t("agenda.stepServices"), to: "services" },
    { done: hasHours, label: t("agenda.stepHours"), to: "hours" },
    { done: hasProfessionals, label: t("agenda.stepProfessionals"), to: "professionals" },
    { done: false, label: t("agenda.stepShare"), to: "settings?tab=page" },
  ];
  return (
    <Card className="mb-6 rounded-xl p-5 sm:p-6">
      <h2 className="font-semibold text-zinc-900">{t("agenda.startTitle")}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t("agenda.startBody")}</p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.to}>
            <Link
              to={step.to}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm hover:bg-zinc-50"
            >
              {step.done ? (
                <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
              ) : (
                <Circle className="size-5 text-zinc-300" aria-hidden />
              )}
              <span className="font-medium text-zinc-400">{index + 1}.</span>
              <span className="text-zinc-700">{step.label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function AppointmentDetails({
  appointment,
  onClose,
}: {
  appointment: Appointment;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const confirm = useConfirm();
  const cancel = useCancelAppointment(business.id);
  const [editing, setEditing] = useState(false);
  const isProfessional = business.access.role === "professional";
  const start = instantToZoned(Date.parse(appointment.startsAt), business.timezone);
  const end = instantToZoned(Date.parse(appointment.endsAt), business.timezone);
  const day = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${start.date}T12:00:00Z`));
  const { customer } = appointment;

  const cancelled = appointment.status === "cancelled";
  const rows = [
    { label: t("booking.code"), value: appointment.code },
    ...(cancelled ? [{ label: t("agenda.colStatus"), value: t("agenda.statusCancelled") }] : []),
    { label: t("booking.date"), value: `${day}, ${start.time} – ${end.time}` },
    { label: t("booking.service"), value: appointment.serviceName },
    ...(appointment.resourceName
      ? [{ label: t("booking.professional"), value: appointment.resourceName }]
      : []),
    {
      label: t("booking.price"),
      value:
        appointment.priceAmount === null
          ? t("services.priceOnRequest")
          : formatPrice(appointment.priceAmount, business.currency),
    },
    // Answers to the business's own questions.
    ...appointment.answers.map((answer) => ({ label: answer.label, value: answer.value })),
    { label: t("agenda.bookedVia"), value: bookedVia(t, appointment) },
  ];

  const cancelAppointment = async () => {
    const ok = await confirm({
      title: t("agenda.cancelTitle"),
      description: t("agenda.confirmCancel"),
      confirmLabel: t("agenda.cancelAppointment"),
      tone: "danger",
    });
    if (!ok) return;
    cancel.mutate(appointment.id, {
      onSuccess: () => {
        toast.success(t("agenda.cancelled"));
        onClose();
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  if (editing) {
    return (
      <RescheduleForm appointment={appointment} onBack={() => setEditing(false)} onDone={onClose} />
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${customer.firstName} ${customer.lastName}`}
      footer={
        <>
          {isProfessional ? (
            <span className="mr-auto" />
          ) : (
            <Link
              to={`customers?customer=${customer.id}`}
              className={buttonClass({ variant: "ghost", className: "mr-auto" })}
            >
              <Contact className="size-4" aria-hidden />
              {t("customers.viewCustomer")}
            </Link>
          )}
          {cancelled ? (
            <Button variant="secondary" onClick={onClose}>
              {t("common.close")}
            </Button>
          ) : (
            <>
              {/* Cancelling is for the business's admins. */}
              {!isProfessional && (
                <Button
                  variant="secondary"
                  className="text-red-600 hover:text-red-700"
                  loading={cancel.isPending}
                  onClick={cancelAppointment}
                >
                  {t("agenda.cancelAppointment")}
                </Button>
              )}
              <Button onClick={() => setEditing(true)}>
                <CalendarClock className="size-4" aria-hidden />
                {t("agenda.reschedule")}
              </Button>
            </>
          )}
        </>
      }
    >
      <dl className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
            <dt className="shrink-0 text-zinc-500">{row.label}</dt>
            <dd className="text-right font-medium text-zinc-900 first-letter:uppercase">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {customer.phone && (
          <a
            href={`tel:${customer.phone}`}
            className={buttonClass({ variant: "secondary", className: "justify-start" })}
          >
            <Phone className="size-4 text-zinc-400" aria-hidden />
            <span className="tabular-nums">{formatPhone(customer.phone)}</span>
          </a>
        )}
        {customer.email && (
          <a
            href={`mailto:${customer.email}`}
            className={buttonClass({ variant: "secondary", className: "min-w-0 justify-start" })}
          >
            <Mail className="size-4 shrink-0 text-zinc-400" aria-hidden />
            <span className="truncate">{customer.email}</span>
          </a>
        )}
      </div>
    </Modal>
  );
}

/**
 * Moves an appointment: another day, time, professional or service. Only times where the
 * appointment fits are offered (its own current time counts as free).
 */
function RescheduleForm({
  appointment,
  onBack,
  onDone,
}: {
  appointment: Appointment;
  onBack: () => void;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const services = useServices(business.id);
  const professionals = useProfessionals(business.id);
  const reschedule = useRescheduleAppointment(business.id);
  const isProfessional = business.access.role === "professional";
  const current = instantToZoned(Date.parse(appointment.startsAt), business.timezone);
  const today = todayIn(business.timezone);
  const [date, setDate] = useState(current.date < today ? today : current.date);
  const [serviceId, setServiceId] = useState(
    appointment.serviceId ?? services.data?.[0]?.id ?? null,
  );
  const [resourceId, setResourceId] = useState(appointment.resourceId);
  const [time, setTime] = useState<string | null>(current.date === date ? current.time : null);
  const slots = useAppointmentSlots(business.id, appointment.id, serviceId, date);

  const team = (professionals.data ?? []).filter(
    (professional) => serviceId && professional.serviceIds.includes(serviceId),
  );
  const times = (slots.data ?? []).filter(
    (slot) => resourceId === null || slot.resourceIds.includes(resourceId),
  );
  const { customer } = appointment;

  const save = () => {
    if (!serviceId || !time) return;
    reschedule.mutate(
      { id: appointment.id, serviceId, resourceId, date, time },
      {
        onSuccess: () => {
          toast.success(t("agenda.rescheduled"));
          onDone();
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  };

  return (
    <Modal
      open
      wide
      onClose={onDone}
      title={t("agenda.rescheduleTitle", { name: `${customer.firstName} ${customer.lastName}` })}
      description={t("agenda.rescheduleHint", { code: appointment.code })}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onBack}>
            <ChevronLeft className="size-4" aria-hidden />
            {t("common.back")}
          </Button>
          <Button onClick={save} loading={reschedule.isPending} disabled={!serviceId || !time}>
            {t("agenda.saveChanges")}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[17rem_minmax(0,1fr)]">
        <RangeCalendar
          value={{ start: date, end: date }}
          onChange={(range) => {
            setDate(range.start);
            setTime(null);
          }}
          min={today}
          locale={i18n.resolvedLanguage ?? "es"}
          labels={{ previous: t("agenda.previous"), next: t("agenda.next") }}
        />
        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
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
                  {services.data?.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {!isProfessional && (professionals.data?.length ?? 0) > 0 && (
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
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-800">{t("agenda.newTime")}</p>
            {slots.isPending ? (
              <Spinner />
            ) : times.length === 0 ? (
              <p className="rounded-lg bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                {t("agenda.noFreeTimes")}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
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
                      slot.time === current.time &&
                        date === current.date &&
                        slot.time !== time &&
                        "border-dashed",
                    )}
                    title={
                      slot.time === current.time && date === current.date
                        ? t("agenda.currentTime")
                        : undefined
                    }
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
