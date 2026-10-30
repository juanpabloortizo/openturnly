import {
  addDays,
  formatPhone,
  formatPrice,
  fromMinorUnits,
  instantToZoned,
  zonedTimeToInstant,
} from "@openturnly/core";
import type { TFunction } from "i18next";
import { Download, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchable, useClickOutside, useDropdownPosition } from "../../components/combobox.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import type { Period } from "../../components/date-range-picker.tsx";
import { Alert, Badge, Button, Input, Spinner } from "../../components/ui.tsx";
import type { Appointment } from "../../lib/api.ts";
import { useAppointments } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { type Cell, downloadCsv, downloadXlsx } from "../../lib/export.ts";
import { errorMessage } from "../../lib/forms.ts";
import { useBusinessContext } from "./business.tsx";

type Status = "all" | "confirmed" | "cancelled";

/** "Página de reservas", "Panel" or "Agente IA · WhatsApp": where an appointment came from. */
export function bookedVia(
  t: TFunction,
  appointment: Pick<Appointment, "source" | "sourceLabel">,
): string {
  if (appointment.source === "agent") {
    return appointment.sourceLabel
      ? `${t("agenda.sourceAgent")} · ${appointment.sourceLabel}`
      : t("agenda.sourceAgent");
  }
  return appointment.source === "online" ? t("agenda.sourceOnline") : t("agenda.sourceAdmin");
}

/**
 * Every appointment of a period as a table, cancelled ones included, with search, a status
 * filter and downloads for Excel or CSV of exactly what is shown.
 */
export function AppointmentsList({
  period,
  resourceFilter,
  locationFilter,
  showLocation,
  onOpen,
}: {
  period: Period;
  resourceFilter: string;
  locationFilter: string;
  /** The business has several locations: say where each appointment is. */
  showLocation: boolean;
  onOpen: (appointment: Appointment) => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const tz = business.timezone;
  const [status, setStatus] = useState<Status>("all");
  const [query, setQuery] = useState("");

  // From midnight of the first day to midnight after the last one, in the business's zone.
  const range = useMemo(
    () => ({
      from: new Date(zonedTimeToInstant(period.start, 0, tz)).toISOString(),
      to: new Date(zonedTimeToInstant(addDays(period.end, 1), 0, tz)).toISOString(),
    }),
    [period, tz],
  );
  const appointments = useAppointments(business.id, range, { includeCancelled: true });

  const rows = useMemo(() => {
    const needle = searchable(query.trim());
    return (appointments.data ?? []).filter((appointment) => {
      if (resourceFilter && appointment.resourceId !== resourceFilter) return false;
      if (locationFilter && appointment.locationId !== locationFilter) return false;
      if (status !== "all" && appointment.status !== status) return false;
      if (!needle) return true;
      const { customer } = appointment;
      return searchable(
        `${customer.firstName} ${customer.lastName} ${customer.phone ?? ""} ${customer.email ?? ""} ${appointment.code} ${appointment.serviceName} ${appointment.resourceName ?? ""}`,
      ).includes(needle);
    });
  }, [appointments.data, resourceFilter, locationFilter, status, query]);

  const confirmed = rows.filter((appointment) => appointment.status === "confirmed");
  const total = confirmed.reduce((sum, appointment) => sum + (appointment.priceAmount ?? 0), 0);
  const now = Date.now();

  const day = new Intl.DateTimeFormat(language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const zoned = (iso: string) => instantToZoned(Date.parse(iso), tz);

  const columns: Column<Appointment>[] = [
    {
      key: "when",
      header: t("agenda.colWhen"),
      className: "whitespace-nowrap",
      cell: (appointment) => {
        const start = zoned(appointment.startsAt);
        const end = zoned(appointment.endsAt);
        return (
          <div className={cn(appointment.status === "cancelled" && "opacity-60")}>
            <div className="font-medium text-zinc-900 first-letter:uppercase">
              {day.format(new Date(`${start.date}T12:00:00Z`))}
            </div>
            <div className="text-[13px] text-zinc-500 tabular-nums">
              {start.time} – {end.time}
            </div>
          </div>
        );
      },
    },
    {
      key: "customer",
      header: t("customers.colCustomer"),
      cell: ({ customer }) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-zinc-900">
            {customer.firstName} {customer.lastName}
          </div>
          <div className="truncate text-[13px] text-zinc-500 tabular-nums">
            {customer.phone ? formatPhone(customer.phone) : (customer.email ?? "—")}
          </div>
        </div>
      ),
    },
    {
      key: "service",
      header: t("booking.service"),
      className: "hidden md:table-cell",
      phone: true,
      cell: (appointment) => (
        <div className="min-w-0">
          <div className="truncate text-zinc-900">{appointment.serviceName}</div>
          <div className="truncate text-[13px] text-zinc-500">
            {[appointment.resourceName, showLocation ? appointment.locationName : null]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </div>
      ),
    },
    {
      key: "price",
      header: t("booking.price"),
      className: "hidden sm:table-cell text-right whitespace-nowrap",
      cell: (appointment) => (
        <span className="text-zinc-900 tabular-nums">
          {appointment.priceAmount === null
            ? "—"
            : formatPrice(appointment.priceAmount, business.currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("agenda.colStatus"),
      cell: (appointment) =>
        appointment.status === "cancelled" ? (
          <Badge tone="danger">{t("agenda.statusCancelled")}</Badge>
        ) : Date.parse(appointment.startsAt) > now ? (
          <Badge tone="brand">{t("agenda.statusUpcoming")}</Badge>
        ) : (
          <Badge tone="success">{t("agenda.statusConfirmed")}</Badge>
        ),
    },
    {
      key: "code",
      header: t("booking.code"),
      className: "hidden lg:table-cell",
      cell: (appointment) => (
        <span className="font-mono text-[13px] tracking-wider text-zinc-600">
          {appointment.code}
        </span>
      ),
    },
  ];

  /** The rows as a sheet: one line per appointment, one column per detail. */
  const sheet = (): Cell[][] => {
    const questions = [
      ...new Set(rows.flatMap((appointment) => appointment.answers.map((a) => a.label))),
    ];
    const stamp = (iso: string | null) => {
      if (!iso) return null;
      const { date, time } = zoned(iso);
      return `${date} ${time}`;
    };
    const header: Cell[] = [
      t("booking.code"),
      t("agenda.colStatus"),
      t("agenda.exportDate"),
      t("agenda.exportStart"),
      t("agenda.exportEnd"),
      t("agenda.exportDuration"),
      ...(showLocation ? [t("booking.location")] : []),
      t("booking.service"),
      t("booking.professional"),
      `${t("booking.price")} (${business.currency})`,
      t("booking.firstName"),
      t("booking.lastName"),
      t("booking.phone"),
      t("booking.email"),
      t("agenda.exportSource"),
      t("agenda.exportBookedAt"),
      t("agenda.exportCancelledAt"),
      ...questions,
    ];
    const body = rows.map((appointment): Cell[] => {
      const start = zoned(appointment.startsAt);
      const end = zoned(appointment.endsAt);
      const { customer } = appointment;
      return [
        appointment.code,
        appointment.status === "cancelled"
          ? t("agenda.statusCancelled")
          : t("agenda.statusConfirmed"),
        start.date,
        start.time,
        end.time,
        Math.round((Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000),
        ...(showLocation ? [appointment.locationName] : []),
        appointment.serviceName,
        appointment.resourceName,
        appointment.priceAmount === null
          ? null
          : fromMinorUnits(appointment.priceAmount, business.currency),
        customer.firstName,
        customer.lastName,
        customer.phone,
        customer.email,
        bookedVia(t, appointment),
        stamp(appointment.createdAt),
        stamp(appointment.cancelledAt),
        ...questions.map(
          (label) => appointment.answers.find((answer) => answer.label === label)?.value ?? null,
        ),
      ];
    });
    return [header, ...body];
  };

  const fileName = `${t("agenda.exportFile")}-${business.slug}-${period.start}-${period.end}`;

  return (
    <>
      {appointments.isError && (
        <div className="p-4 pb-0">
          <Alert>{errorMessage(t, appointments.error)}</Alert>
        </div>
      )}
      {/* Edge to edge in the agenda's card, under its own toolbar. */}
      <DataTable
        flush
        columns={columns}
        rows={rows}
        rowKey={(appointment) => appointment.id}
        onRowClick={onOpen}
        pageSize={25}
        empty={appointments.isPending ? <Spinner /> : t("agenda.noAppointments")}
        toolbar={
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("agenda.searchList")}
                  aria-label={t("agenda.searchList")}
                  className="h-8 pl-8"
                />
              </div>
              <div className="inline-flex rounded-md bg-zinc-100 p-0.5">
                {(["all", "confirmed", "cancelled"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={status === option}
                    onClick={() => setStatus(option)}
                    className={cn(
                      "h-7 rounded px-2.5 text-[13px] font-medium transition-colors",
                      status === option
                        ? "bg-white text-zinc-900 shadow-xs"
                        : "text-zinc-500 hover:text-zinc-900",
                    )}
                  >
                    {t(`agenda.filter.${option}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-zinc-500">
                {t("agenda.listSummary", { count: rows.length })}
                {" · "}
                <span className="font-medium text-zinc-800 tabular-nums">
                  {formatPrice(total, business.currency)}
                </span>
              </span>
              <ExportMenu
                disabled={rows.length === 0}
                onExcel={() => downloadXlsx(`${fileName}.xlsx`, t("agenda.exportSheet"), sheet())}
                onCsv={() => downloadCsv(`${fileName}.csv`, sheet())}
              />
            </div>
          </div>
        }
      />
    </>
  );
}

export function ExportMenu({
  disabled,
  onExcel,
  onCsv,
}: {
  disabled: boolean;
  onExcel: () => void;
  onCsv: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const position = useDropdownPosition(open, trigger, 200);
  useClickOutside(open, [trigger, panel], () => setOpen(false));
  const item = "block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-zinc-100";
  return (
    <>
      <Button
        ref={trigger}
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <Download className="size-3.5" aria-hidden />
        {t("agenda.download")}
      </Button>
      {open && (
        <div
          ref={panel}
          style={position}
          className="z-50 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            className={item}
            onClick={() => {
              onExcel();
              setOpen(false);
            }}
          >
            <span className="font-medium text-zinc-900">Excel</span>
            <span className="ml-1.5 text-zinc-400">.xlsx</span>
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              onCsv();
              setOpen(false);
            }}
          >
            <span className="font-medium text-zinc-900">CSV</span>
            <span className="ml-1.5 text-zinc-400">.csv</span>
          </button>
        </div>
      )}
    </>
  );
}
