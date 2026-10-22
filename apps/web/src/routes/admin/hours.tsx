import { addDays, closureSchema, SLOT_INTERVALS, slotsForDate, todayIn } from "@openturnly/core";
import { CalendarOff, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useConfirm } from "../../components/confirm.tsx";
import { PageHeader, PageTabs, SettingsCard, Switch, Toggle } from "../../components/controls.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { type DateRange, RangeCalendar } from "../../components/range-calendar.tsx";
import { toast } from "../../components/toast.tsx";
import { Button, Field, Input, Select, Spinner } from "../../components/ui.tsx";
import { formatHours, openMinutes, WeeklyHoursEditor } from "../../components/weekly-hours.tsx";
import type { Closure, WeeklyRange } from "../../lib/api.ts";
import { useUpdateBusiness } from "../../lib/businesses.ts";
import {
  useClosures,
  useHolidays,
  useHours,
  useProfessionals,
  useSaveHours,
  useServices,
} from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { formatDay } from "../../lib/format.ts";
import { apiFieldErrors, errorMessage, fieldMessage, validate } from "../../lib/forms.ts";
import { countryName, flag } from "../../lib/locale.ts";
import { useTab } from "../../lib/tabs.ts";
import { useBusinessContext } from "./business.tsx";

const TABS = ["weekly", "holidays", "closures", "rules"] as const;

const noon = (date: string) => new Date(`${date}T12:00:00Z`);

function formatDate(date: string, language: string) {
  return new Intl.DateTimeFormat(language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(noon(date));
}

/** "2026-10-24".."2026-10-28" → "24–28 oct 2026"; one day → "sáb, 24 oct 2026". */
function formatRange(start: string, end: string, language: string) {
  if (start === end) return formatDate(start, language);
  return new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(noon(start), noon(end));
}

function daysBetween(start: string, end: string) {
  return Math.round((noon(end).getTime() - noon(start).getTime()) / 86_400_000) + 1;
}

export function HoursPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useTab(TABS);
  return (
    <>
      <PageHeader title={t("hours.title")} subtitle={t("hours.subtitle")} />
      <PageTabs
        tour="hours-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "weekly", label: t("hours.tabs.weekly") },
          { value: "holidays", label: t("hours.tabs.holidays") },
          { value: "closures", label: t("hours.tabs.closures") },
          { value: "rules", label: t("hours.tabs.rules") },
        ]}
      />
      {tab === "weekly" && <OpeningHours />}
      {tab === "holidays" && <Holidays />}
      {tab === "closures" && <Closures />}
      {tab === "rules" && <BookingRules />}
    </>
  );
}

function OpeningHours() {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const hours = useHours(business.id);
  const save = useSaveHours(business.id);
  const [value, setValue] = useState<WeeklyRange[] | null>(null);

  useEffect(() => {
    if (hours.data && value === null) setValue(hours.data.business);
  }, [hours.data, value]);

  return (
    <SettingsCard
      title={t("hours.weeklyTitle")}
      description={t("hours.weeklyHint")}
      footerNote={
        value && value.length > 0
          ? t("hours.weeklyTotal", { hours: formatHours(openMinutes(value)) })
          : t("hours.weeklyNote")
      }
      footer={
        <Button
          loading={save.isPending}
          disabled={value === null}
          onClick={() =>
            value &&
            save.mutate(
              { resourceId: null, hours: value },
              {
                onSuccess: () => toast.success(t("common.saved")),
                onError: (error) =>
                  toast.error(
                    fieldMessage(t, "hours", apiFieldErrors(error).hours) ?? errorMessage(t, error),
                  ),
              },
            )
          }
        >
          {t("common.save")}
        </Button>
      }
    >
      {value === null ? (
        <Spinner />
      ) : (
        <WeeklyHoursEditor value={value} onChange={setValue} timeline />
      )}
    </SettingsCard>
  );
}

const NOTICE_OPTIONS = [0, 30, 60, 120, 240, 720, 1440, 2880];
const ADVANCE_OPTIONS = [7, 14, 30, 60, 90, 180, 365];
/** Until how long before an appointment customers can change it themselves. */
const CHANGE_NOTICE_OPTIONS = [0, 60, 120, 240, 720, 1440, 2880];

function BookingRules() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const update = useUpdateBusiness(business.id);
  const [slotIntervalMin, setSlotInterval] = useState(business.slotIntervalMin);
  const [minNoticeMin, setMinNotice] = useState(business.minNoticeMin);
  const [maxAdvanceDays, setMaxAdvance] = useState(business.maxAdvanceDays);
  const [customerChangeNoticeMin, setChangeNotice] = useState(business.customerChangeNoticeMin);

  const noticeLabel = (minutes: number) =>
    minutes === 0
      ? t("hours.noticeNone")
      : minutes < 60
        ? t("hours.minutes", { count: minutes })
        : minutes < 1440
          ? t("hours.hours", { count: minutes / 60 })
          : t("hours.days", { count: minutes / 1440 });

  const rows = [
    {
      label: t("hours.slotInterval"),
      hint: t("hours.slotIntervalHint"),
      control: (
        <Select
          aria-label={t("hours.slotInterval")}
          value={slotIntervalMin}
          onChange={(event) => setSlotInterval(Number(event.target.value))}
        >
          {SLOT_INTERVALS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {t("hours.everyMinutes", { count: minutes })}
            </option>
          ))}
        </Select>
      ),
    },
    {
      label: t("hours.minNotice"),
      hint: t("hours.minNoticeHint"),
      control: (
        <Select
          aria-label={t("hours.minNotice")}
          value={minNoticeMin}
          onChange={(event) => setMinNotice(Number(event.target.value))}
        >
          {NOTICE_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {noticeLabel(minutes)}
            </option>
          ))}
        </Select>
      ),
    },
    {
      label: t("hours.maxAdvance"),
      hint: t("hours.maxAdvanceHint"),
      control: (
        <Select
          aria-label={t("hours.maxAdvance")}
          value={maxAdvanceDays}
          onChange={(event) => setMaxAdvance(Number(event.target.value))}
        >
          {ADVANCE_OPTIONS.map((days) => (
            <option key={days} value={days}>
              {t("hours.days", { count: days })}
            </option>
          ))}
        </Select>
      ),
    },
    {
      label: t("hours.customerChanges"),
      hint: t("hours.customerChangesHint"),
      control: (
        <Select
          aria-label={t("hours.customerChanges")}
          value={customerChangeNoticeMin ?? "never"}
          onChange={(event) =>
            setChangeNotice(event.target.value === "never" ? null : Number(event.target.value))
          }
        >
          <option value="never">{t("hours.customerChangesNever")}</option>
          {CHANGE_NOTICE_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 0
                ? t("hours.customerChangesAnytime")
                : t("hours.customerChangesUntil", { notice: noticeLabel(minutes) })}
            </option>
          ))}
        </Select>
      ),
    },
  ];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <SettingsCard
        title={t("hours.rulesTitle")}
        description={t("hours.rulesHint")}
        footer={
          <Button
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                { slotIntervalMin, minNoticeMin, maxAdvanceDays, customerChangeNoticeMin },
                {
                  onSuccess: () => toast.success(t("common.saved")),
                  onError: (error) => toast.error(errorMessage(t, error)),
                },
              )
            }
          >
            {t("common.save")}
          </Button>
        }
      >
        <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-800">{row.label}</p>
                <p className="mt-0.5 text-[13px] text-zinc-500">{row.hint}</p>
              </div>
              <div className="w-full shrink-0 sm:w-52">{row.control}</div>
            </div>
          ))}
        </div>
      </SettingsCard>
      <SlotsPreview rules={{ slotIntervalMin, minNoticeMin, maxAdvanceDays }} language={language} />
    </div>
  );
}

/** Times the booking page would offer on the next open day, with the rules being edited. */
function SlotsPreview({
  rules,
  language,
}: {
  rules: { slotIntervalMin: number; minNoticeMin: number; maxAdvanceDays: number };
  language: string;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const hours = useHours(business.id);
  const services = useServices(business.id);
  const shortest = Math.min(
    ...(services.data?.filter((service) => service.active).map((s) => s.durationMin) ?? []),
    rules.slotIntervalMin,
  );

  const preview = useMemo(() => {
    const weekly = hours.data?.business ?? [];
    if (weekly.length === 0) return null;
    const schedule = { resourceId: null, hours: weekly, closedDates: new Set<string>(), busy: [] };
    const bookingRules = { ...rules, timeZone: business.timezone };
    const now = Date.now();
    const today = todayIn(business.timezone, now);
    for (let offset = 0; offset <= Math.min(rules.maxAdvanceDays, 14); offset++) {
      const date = addDays(today, offset);
      const slots = slotsForDate(date, shortest, [schedule], bookingRules, now);
      if (slots.length > 0) return { date, times: slots.map((slot) => slot.time) };
    }
    return { date: null, times: [] };
  }, [hours.data, rules, business.timezone, shortest]);

  const visible = preview?.times.slice(0, 15) ?? [];
  const hidden = (preview?.times.length ?? 0) - visible.length;
  const lastDate = addDays(todayIn(business.timezone), rules.maxAdvanceDays);

  return (
    <section className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-5">
      <h2 className="text-[15px] font-semibold text-zinc-900">{t("hours.previewTitle")}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t("hours.previewHint")}</p>
      {preview === null ? (
        <p className="mt-4 text-sm text-zinc-500">{t("hours.previewNoHours")}</p>
      ) : preview.date === null ? (
        <p className="mt-4 text-sm text-zinc-500">{t("hours.previewNoTimes")}</p>
      ) : (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm font-medium text-zinc-900 first-letter:uppercase">
            {formatDay(preview.date, language)}
          </p>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {visible.map((time) => (
              <span
                key={time}
                className="grid h-8 place-items-center rounded-md border border-zinc-200 text-xs font-medium text-zinc-700 tabular-nums"
              >
                {time}
              </span>
            ))}
            {hidden > 0 && (
              <span className="grid h-8 place-items-center rounded-md text-xs text-zinc-500">
                {t("hours.previewMore", { count: hidden })}
              </span>
            )}
          </div>
        </div>
      )}
      <p className="mt-4 text-[13px] text-zinc-500">
        {t("hours.previewUntil", { date: formatDate(lastDate, language) })}
      </p>
    </section>
  );
}

type HolidayRow = { date: string; name: string; closed: boolean };

function Holidays() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage === "en" ? "en" : "es";
  const { business } = useBusinessContext();
  const { list, decide } = useHolidays(business.id, language);
  const update = useUpdateBusiness(business.id);

  const saveSetting = (input: { closedOnHolidays: boolean }) =>
    update.mutate(input, {
      onSuccess: () => toast.success(t("common.saved")),
      onError: (error) => toast.error(errorMessage(t, error)),
    });

  const columns: Column<HolidayRow>[] = [
    {
      key: "date",
      header: t("hours.colDate"),
      className: "whitespace-nowrap sm:w-48",
      cell: (holiday) => (
        <span className="text-zinc-600 tabular-nums first-letter:uppercase">
          {formatDate(holiday.date, language)}
        </span>
      ),
    },
    {
      key: "name",
      header: t("hours.colHoliday"),
      cell: (holiday) => <span className="font-medium text-zinc-900">{holiday.name}</span>,
    },
    {
      key: "open",
      header: t("hours.colOpen"),
      className: "w-24 text-right",
      cell: (holiday) => (
        <Toggle
          checked={!holiday.closed}
          label={`${holiday.name}: ${t("hours.colOpen")}`}
          disabled={decide.isPending}
          onChange={(open) => decide.mutate({ date: holiday.date, closed: !open })}
        />
      ),
    },
  ];

  if (list.isPending) return <Spinner />;
  if (list.isError) return <p className="text-sm text-red-600">{errorMessage(t, list.error)}</p>;

  const closedCount = list.data.holidays.filter((holiday) => holiday.closed).length;

  return (
    <div className="space-y-6">
      <section className="grid divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] lg:divide-x lg:divide-y-0">
        <div className="flex items-start gap-3 p-5">
          {list.data.country && (
            <span className="text-3xl leading-none" aria-hidden>
              {flag(list.data.country)}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-zinc-900">
              {list.data.country
                ? countryName(list.data.country, language)
                : t("hours.noCountryTitle")}
            </h2>
            <p className="mt-1 text-[13px] text-zinc-500">
              {t("hours.countryFromTimezone", { timezone: business.timezone })}{" "}
              <Link to="../settings" className="font-medium text-brand-700 hover:underline">
                {t("hours.changeTimezone")}
              </Link>
            </p>
          </div>
        </div>
        <div className="p-5">
          <Switch
            checked={business.closedOnHolidays}
            onChange={(closedOnHolidays) => saveSetting({ closedOnHolidays })}
            disabled={update.isPending}
            label={t("hours.closedOnHolidays")}
            description={t("hours.closedOnHolidaysHint")}
          />
        </div>
        {list.data.country && (
          <dl className="grid grid-cols-2 gap-3 p-5 lg:w-64">
            <Stat label={t("hours.holidaysClosed")} value={closedCount} />
            <Stat label={t("hours.holidaysOpen")} value={list.data.holidays.length - closedCount} />
          </dl>
        )}
      </section>
      {list.data.country ? (
        <DataTable
          columns={columns}
          rows={list.data.holidays}
          rowKey={(holiday) => holiday.date}
          empty={t("hours.noHolidays")}
          pageSize={10}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-14 text-center text-sm text-zinc-500">
          {t("hours.noCountry")}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2.5">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-zinc-900 tabular-nums">{value}</dd>
    </div>
  );
}

function Closures() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const confirm = useConfirm();
  const { list, add, remove } = useClosures(business.id);
  const holidays = useHolidays(business.id, language === "en" ? "en" : "es");
  const professionals = useProfessionals(business.id);
  const [range, setRange] = useState<DateRange | null>(null);
  const [resourceId, setResourceId] = useState("");
  const [note, setNote] = useState("");
  const today = todayIn(business.timezone);

  // Dots on the calendar: days already closed, and public holidays.
  const marks = useMemo(() => {
    const map = new Map<string, "closed" | "holiday">();
    for (const holiday of holidays.list.data?.holidays ?? []) map.set(holiday.date, "holiday");
    for (const closure of list.data ?? []) {
      for (let day = closure.date; day <= closure.endDate; day = addDays(day, 1)) {
        map.set(day, "closed");
      }
    }
    return map;
  }, [holidays.list.data, list.data]);

  const submit = () => {
    if (!range) {
      toast.error(t("hours.pickDatesFirst"));
      return;
    }
    const result = validate(closureSchema, {
      date: range.start,
      endDate: range.end ?? range.start,
      resourceId: resourceId || null,
      note,
    });
    if (!result.data) {
      toast.error(fieldMessage(t, "endDate", Object.values(result.errors)[0]) ?? "");
      return;
    }
    add.mutate(result.data, {
      onSuccess: () => {
        setRange(null);
        setNote("");
        toast.success(t("hours.closureAdded"));
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  const nameOf = (id: string | null) =>
    id === null
      ? t("hours.wholeBusiness")
      : (professionals.data?.find((professional) => professional.id === id)?.name ?? "—");

  const removeClosure = async (closure: Closure) => {
    const ok = await confirm({
      title: t("hours.removeClosureTitle"),
      description: formatRange(closure.date, closure.endDate, language),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (ok) {
      remove.mutate(closure.id, { onSuccess: () => toast.success(t("hours.closureRemoved")) });
    }
  };

  const columns: Column<Closure>[] = [
    {
      key: "date",
      header: t("hours.colDates"),
      className: "whitespace-nowrap",
      cell: (closure) => (
        <div>
          <div className="font-medium text-zinc-900 tabular-nums first-letter:uppercase">
            {formatRange(closure.date, closure.endDate, language)}
          </div>
          <div className="text-[13px] text-zinc-500">
            {t("hours.dayCount", { count: daysBetween(closure.date, closure.endDate) })}
          </div>
        </div>
      ),
    },
    {
      key: "who",
      header: t("hours.who"),
      cell: (closure) => <span className="text-zinc-600">{nameOf(closure.resourceId)}</span>,
    },
    {
      key: "reason",
      header: t("hours.reason"),
      className: "hidden sm:table-cell",
      cell: (closure) => <span className="text-zinc-600">{closure.note ?? "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (closure) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => removeClosure(closure)}
          aria-label={t("common.delete")}
          title={t("common.delete")}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      ),
    },
  ];

  const end = range?.end ?? range?.start;
  const selection =
    range && end
      ? `${formatRange(range.start, end, language)} · ${t("hours.dayCount", {
          count: daysBetween(range.start, end),
        })}`
      : t("hours.pickDates");

  return (
    <div className="space-y-6">
      <SettingsCard
        title={t("hours.newClosure")}
        description={t("hours.closuresHint")}
        footerNote={
          <span className="inline-flex items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-red-500" />
              {t("hours.legendClosure")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-amber-500" />
              {t("hours.legendHoliday")}
            </span>
          </span>
        }
        footer={
          <Button onClick={submit} loading={add.isPending}>
            <CalendarOff className="size-4" aria-hidden />
            {t("hours.addClosure")}
          </Button>
        }
      >
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <RangeCalendar
            value={range}
            onChange={setRange}
            min={today}
            marks={marks}
            locale={language}
            months={2}
            labels={{ previous: t("booking.previousMonth"), next: t("booking.nextMonth") }}
          />
          <div className="space-y-4 xl:border-l xl:border-zinc-100 xl:pl-8">
            <p
              className={cn(
                "rounded-lg px-3 py-2.5 text-[13px] first-letter:uppercase",
                range ? "bg-brand-50 font-medium text-brand-800" : "bg-zinc-50 text-zinc-600",
              )}
            >
              {selection}
            </p>
            <Field label={t("hours.who")}>
              {(props) => (
                <Select
                  {...props}
                  value={resourceId}
                  onChange={(event) => setResourceId(event.target.value)}
                >
                  <option value="">{t("hours.wholeBusiness")}</option>
                  {professionals.data?.map((professional) => (
                    <option key={professional.id} value={professional.id}>
                      {professional.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("hours.reason")} optional>
              {(props) => (
                <Input
                  {...props}
                  placeholder={t("hours.reasonPlaceholder")}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
      </SettingsCard>
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-zinc-900">{t("hours.upcomingClosures")}</h2>
        <DataTable
          columns={columns}
          rows={list.data ?? []}
          rowKey={(closure) => closure.id}
          empty={t("hours.noClosures")}
        />
      </section>
    </div>
  );
}
