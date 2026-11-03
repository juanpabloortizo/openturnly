import { formatPrice, fromMinorUnits, instantToZoned, todayIn } from "@openturnly/core";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Minus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PageHeader, PageTabs } from "../../components/controls.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import {
  DateRangePicker,
  type Period,
  periodPresets,
} from "../../components/date-range-picker.tsx";
import { Alert, Badge, Card, InfoTip, Select, Spinner } from "../../components/ui.tsx";
import { useLocations, useProfessionals } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { type Cell, downloadCsv, downloadXlsx } from "../../lib/export.ts";
import { errorMessage } from "../../lib/forms.ts";
import {
  type CommissionsReport,
  type SummaryReport,
  type TipsReport,
  useReport,
} from "../../lib/reports.ts";
import { useTab } from "../../lib/tabs.ts";
import { ExportMenu } from "./appointments-list.tsx";
import { useBusinessContext } from "./business.tsx";

const TABS = ["summary", "tips", "commissions"] as const;

/** Reports over a period: the summary, tips and commissions, at one location or all. */
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const [tab, setTab] = useTab(TABS);
  const [period, setPeriod] = useState<Period>(
    () => periodPresets(todayIn(business.timezone)).week,
  );
  const locations = useLocations(business.id).data ?? [];
  const [locationId, setLocationId] = useState("");
  const filter = { from: period.start, to: period.end, locationId };

  return (
    <>
      <PageHeader title={t("reports.title")} subtitle={t("reports.subtitle")} />
      <PageTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "summary", label: t("reports.tabs.summary") },
          { value: "tips", label: t("reports.tabs.tips") },
          { value: "commissions", label: t("reports.tabs.commissions") },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangePicker
          value={period}
          onChange={setPeriod}
          today={todayIn(business.timezone)}
          locale={language}
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
        {locations.length > 1 && (
          <Select
            aria-label={t("locations.pick")}
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className="w-52 [&_select]:h-8 [&_select]:text-[13px]"
          >
            <option value="">{t("locations.all")}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {tab === "summary" && <Summary filter={filter} />}
      {tab === "tips" && <Tips filter={filter} period={period} />}
      {tab === "commissions" && <Commissions filter={filter} period={period} />}
    </>
  );
}

type Filter = { from: string; to: string; locationId: string };

/** "19–25 oct": a period of whole days, short. */
function rangeLabel(language: string, from: string, to: string) {
  const format = new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return format.formatRange(Date.parse(`${from}T00:00:00Z`), Date.parse(`${to}T00:00:00Z`));
}

/**
 * "↘ −20 % vs. 19–25 oct: 5": the change against the period before, with an arrow so it
 * doesn't rely on colour, and the figure it's compared with.
 */
function Change({
  now,
  before,
  range,
  format,
  share,
}: {
  now: number;
  before: number;
  range: string;
  format: (value: number) => string;
  /** For a share (0–1) like occupancy: the change in points, "+3 pts", not in percent of it. */
  share?: boolean;
}) {
  const { t } = useTranslation();
  if (before === 0 && now === 0) {
    return <span className="text-xs text-zinc-500">{t("reports.noChange", { range })}</span>;
  }
  const change = share || before !== 0 ? (now - before) / (share ? 1 : before) : 1;
  const points = Math.round(change * 100);
  const text = share
    ? t("reports.points", { value: `${points > 0 ? "+" : ""}${points}` })
    : before === 0
      ? t("reports.new")
      : `${points > 0 ? "+" : ""}${points} %`;
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium",
          change > 0 ? "text-emerald-700" : change < 0 ? "text-red-600" : "text-zinc-500",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {text}
      </span>
      <span className="text-zinc-500">
        {t("reports.vsRange", { range, value: format(before) })}
      </span>
    </span>
  );
}

/** A headline figure, what it means (behind the ⓘ) and how it compares with the period before. */
function Tile({
  label,
  value,
  hint,
  change,
  meter,
}: {
  label: string;
  value: string;
  hint: string;
  change: ReactNode;
  /** 0–1, drawn as a bar under the figure. */
  meter?: number | null;
}) {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-500">
        {label}
        <InfoTip text={hint} label={t("common.whatItMeans", { label })} />
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">
        {value}
      </div>
      {meter !== undefined && (
        <div className="mt-2 h-1.5 rounded-full bg-zinc-100">
          <div
            className="h-1.5 rounded-full bg-brand-500"
            style={{ width: `${Math.min(100, (meter ?? 0) * 100)}%` }}
          />
        </div>
      )}
      <div className="mt-3 border-t border-zinc-100 pt-2.5">{change}</div>
    </Card>
  );
}

/** Names with a thin bar for their share of the largest, and the exact value on hover. */
function BarList({
  title,
  hint,
  rows,
  empty,
}: {
  title: string;
  hint?: string;
  rows: { label: string; value: number; display: string; detail?: string }[];
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      {hint && <p className="mt-0.5 text-[13px] text-zinc-500">{hint}</p>}
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row) => (
            <li key={row.label} title={`${row.label}: ${row.display}`}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate text-zinc-700">
                  {row.label}
                  {row.detail && <span className="text-zinc-400"> · {row.detail}</span>}
                </span>
                <span className="shrink-0 font-medium text-zinc-900 tabular-nums">
                  {row.display}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-zinc-100">
                <div
                  className="h-1.5 rounded-full bg-brand-500"
                  style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The top of the axis: the largest value rounded up to 1, 2, 2.5 or 5 × 10ⁿ. */
function axisTop(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 2.5, 5, 10].find((step) => step * power >= value) ?? 10) * power;
}

/**
 * Bookings or sales of each day (week, month) of the period as columns, one measure at a time
 * (they don't share a scale), with the exact figure on hover.
 */
function TrendChart({
  series,
  money,
}: {
  series: SummaryReport["series"];
  money: (amount: number) => string;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const [measure, setMeasure] = useState<"bookings" | "billed">("bookings");
  const [hovered, setHovered] = useState<number | null>(null);
  const { unit, points } = series;
  const values = points.map((point) => point[measure]);
  const top = axisTop(Math.max(0, ...values));
  const format = measure === "billed" ? money : (value: number) => String(value);
  const compact = new Intl.NumberFormat(language, { notation: "compact" });
  const levels = [top, top / 2].filter((level) => measure === "billed" || Number.isInteger(level));
  const date = (start: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(language, { ...options, timeZone: "UTC" }).format(
      Date.parse(`${start}T00:00:00Z`),
    );

  const full = (start: string) =>
    unit === "day"
      ? date(start, { weekday: "short", day: "numeric", month: "short" })
      : unit === "week"
        ? t("reports.chart.weekOf", { date: date(start, { day: "numeric", month: "short" }) })
        : date(start, { month: "long", year: "numeric" });
  // Up to about eight dates under the axis, so they never run into each other: the day alone,
  // with the month on the first one and when it changes ("30 oct, 31, 1 nov").
  const every = Math.ceil(points.length / 8);
  let shownMonth = "";
  const ticks = points.map((item, index) => {
    if (index % every !== 0) return "";
    if (unit === "month") return date(item.start, { month: "short" });
    const month = item.start.slice(0, 7);
    const label =
      month === shownMonth
        ? date(item.start, { day: "numeric" })
        : date(item.start, { day: "numeric", month: "short" });
    shownMonth = month;
    return label;
  });
  const empty = values.every((value) => value === 0);
  const point = hovered === null ? undefined : points[hovered];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">{t(`reports.chart.${measure}`)}</h3>
          <p className="mt-0.5 text-[13px] text-zinc-500">{t(`reports.chart.units.${unit}`)}</p>
        </div>
        <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="tablist">
          {(["bookings", "billed"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={measure === option}
              onClick={() => setMeasure(option)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                measure === option
                  ? "bg-white text-zinc-900 shadow-xs"
                  : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              {t(`reports.chart.${option}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-7 flex gap-2">
        <div className="relative h-44 w-10 shrink-0 text-right text-[11px] text-zinc-400 tabular-nums">
          {levels.map((value) => (
            <span
              key={value}
              className="absolute right-0 -translate-y-1/2"
              style={{ bottom: `${(value / top) * 100}%` }}
            >
              {measure === "billed" ? compact.format(value) : value}
            </span>
          ))}
          <span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="relative h-44"
            role="img"
            aria-label={`${t(`reports.chart.${measure}`)}: ${points
              .map((item) => `${full(item.start)} ${format(item[measure])}`)
              .join(", ")}`}
          >
            {levels.map((value) => (
              <div
                key={value}
                className="absolute inset-x-0 border-t border-dashed border-zinc-100"
                style={{ bottom: `${(value / top) * 100}%` }}
              />
            ))}
            <div className="absolute inset-x-0 bottom-0 border-t border-zinc-200" />
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {points.map((item, index) => (
                // The whole column height reacts to the pointer, not just the bar.
                <div
                  key={item.start}
                  className="flex h-full min-w-0 flex-1 items-end justify-center"
                  onPointerEnter={() => setHovered(index)}
                  onPointerLeave={() => setHovered(null)}
                >
                  <div
                    className={cn(
                      "w-full max-w-12 rounded-t-[4px] transition-colors",
                      hovered === index ? "bg-brand-600" : "bg-brand-500",
                    )}
                    style={{
                      height: item[measure] > 0 ? `max(2px, ${(item[measure] / top) * 100}%)` : 0,
                    }}
                  />
                </div>
              ))}
            </div>
            {empty && (
              <p className="absolute inset-0 grid place-items-center text-sm text-zinc-500">
                {t("reports.nothing")}
              </p>
            )}
            {point && hovered !== null && (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg"
                style={{
                  left: `${((hovered + 0.5) / points.length) * 100}%`,
                  bottom: `calc(${(point[measure] / top) * 100}% + 8px)`,
                }}
              >
                <div className="text-zinc-300">{full(point.start)}</div>
                <div className="font-semibold tabular-nums">{format(point[measure])}</div>
              </div>
            )}
          </div>
          <div className="mt-1.5 flex gap-[2px] text-[11px] text-zinc-400">
            {points.map((item, index) => (
              <span key={item.start} className="min-w-0 flex-1 text-center whitespace-nowrap">
                {ticks[index]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

const ORIGINS = [
  { source: "online", color: "bg-chart-1" },
  { source: "admin", color: "bg-chart-2" },
  { source: "agent", color: "bg-chart-3" },
] as const;

/** Where bookings came from, as one bar split by share, each part named with its figures. */
function OriginCard({ origin }: { origin: SummaryReport["origin"] }) {
  const { t } = useTranslation();
  const rows = ORIGINS.map((row) => ({ ...row, value: origin[row.source] ?? 0 }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-zinc-900">{t("reports.origin")}</h3>
      <p className="mt-0.5 text-[13px] text-zinc-500">{t("reports.originHint")}</p>
      {total === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{t("reports.nothing")}</p>
      ) : (
        <>
          <div className="mt-4 flex h-2.5 gap-[2px] overflow-hidden rounded-full">
            {rows
              .filter((row) => row.value > 0)
              .map((row) => (
                <div
                  key={row.source}
                  className={row.color}
                  style={{ flexGrow: row.value }}
                  title={`${t(`reports.origins.${row.source}`)}: ${row.value}`}
                />
              ))}
          </div>
          <ul className="mt-4 space-y-2">
            {rows.map((row) => (
              <li key={row.source} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-zinc-700">
                  <span className={cn("size-2.5 shrink-0 rounded-full", row.color)} />
                  <span className="truncate">{t(`reports.origins.${row.source}`)}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-medium text-zinc-900">{row.value}</span>
                  <span className="text-zinc-400">
                    {" "}
                    · {Math.round((row.value / total) * 100)} %
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Summary({ filter }: { filter: Filter }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const report = useReport<SummaryReport>(business.id, "summary", filter);
  const [showToday, setShowToday] = useState(false);
  const money = (amount: number) => formatPrice(amount, business.currency);
  if (report.isPending) return <Spinner />;
  if (report.isError) return <Alert>{errorMessage(t, report.error)}</Alert>;
  const { current, before, today } = report.data;
  const range = rangeLabel(language, report.data.previous.from, report.data.previous.to);
  const count = (value: number) => String(value);
  const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)} %`);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label={t("reports.bookings")}
          value={count(current.bookings)}
          hint={t("reports.bookingsHint")}
          change={
            <Change now={current.bookings} before={before.bookings} range={range} format={count} />
          }
        />
        <Tile
          label={t("reports.occupancy")}
          value={percent(current.occupancy)}
          meter={current.occupancy}
          hint={t("reports.occupancyHint")}
          change={
            <Change
              now={current.occupancy ?? 0}
              before={before.occupancy ?? 0}
              range={range}
              format={percent}
              share
            />
          }
        />
        <Tile
          label={t("reports.newCustomers")}
          value={count(current.newCustomers)}
          hint={t("reports.newCustomersHint")}
          change={
            <Change
              now={current.newCustomers}
              before={before.newCustomers}
              range={range}
              format={count}
            />
          }
        />
        <Tile
          label={t("reports.billed")}
          value={money(current.billed)}
          hint={t("reports.billedHint")}
          change={
            <Change now={current.billed} before={before.billed} range={range} format={money} />
          }
        />
      </div>

      <TrendChart series={report.data.series} money={money} />

      <div className="grid gap-4 lg:grid-cols-3">
        <OriginCard origin={report.data.origin} />
        <BarList
          title={t("reports.topSold")}
          hint={t("reports.topSoldHint")}
          empty={t("reports.nothing")}
          rows={report.data.topServices.map((row) => ({
            label: row.name,
            detail: t("reports.soldCount", { count: row.quantity }),
            value: row.amount,
            display: money(row.amount),
          }))}
        />
        <BarList
          title={t("reports.byProfessional")}
          hint={t("reports.byProfessionalHint")}
          empty={t("reports.nothing")}
          rows={report.data.byProfessional.map((row) => ({
            label: row.name || t("reports.noProfessional"),
            value: row.bookings,
            display: t("reports.appointmentsCount", { count: row.bookings }),
          }))}
        />
      </div>

      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setShowToday((open) => !open)}
          aria-expanded={showToday}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-zinc-900">
            {t("reports.today", { count: today.length })}
          </span>
          <ChevronDown
            className={cn("size-4 text-zinc-400 transition", showToday && "rotate-180")}
            aria-hidden
          />
        </button>
        {showToday && (
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
            {today.length === 0 ? (
              <li className="px-4 py-3 text-sm text-zinc-500">{t("reports.noneToday")}</li>
            ) : (
              today.map((row) => (
                <li key={row.id} className="flex items-center gap-4 px-4 py-2.5 text-sm">
                  <span className="w-12 shrink-0 font-medium text-zinc-900 tabular-nums">
                    {row.time}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-zinc-700">
                    {row.customer} · {row.service}
                    {row.professional ? ` · ${row.professional}` : ""}
                  </span>
                  {row.paid ? (
                    <Badge tone="success">{t("checkout.paid")}</Badge>
                  ) : (
                    <Badge>{t("checkout.unpaid")}</Badge>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Tips({ filter, period }: { filter: Filter; period: Period }) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const professionals = useProfessionals(business.id).data ?? [];
  const [resourceId, setResourceId] = useState("");
  const report = useReport<TipsReport>(business.id, "tips", { ...filter, resourceId });
  const money = (amount: number) => formatPrice(amount, business.currency);
  const day = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  type Row = TipsReport["tips"][number];
  const columns: Column<Row>[] = [
    {
      key: "when",
      header: t("sales.colDate"),
      className: "whitespace-nowrap",
      cell: (row) => {
        const { date, time } = instantToZoned(Date.parse(row.createdAt), business.timezone);
        return (
          <span className="text-zinc-600 tabular-nums">
            {day.format(new Date(`${date}T12:00:00Z`))} · {time}
          </span>
        );
      },
    },
    {
      key: "sale",
      header: t("sales.colNumber"),
      cell: (row) => <span className="text-zinc-900 tabular-nums">#{row.sale.number}</span>,
    },
    {
      key: "customer",
      header: t("sales.colCustomer"),
      className: "hidden sm:table-cell",
      cell: (row) => <span className="text-zinc-600">{row.customer ?? "—"}</span>,
    },
    {
      key: "professional",
      header: t("booking.professional"),
      cell: (row) => <span className="font-medium text-zinc-900">{row.resourceName}</span>,
    },
    {
      key: "amount",
      header: t("checkout.tip"),
      className: "text-right",
      cell: (row) => <span className="text-zinc-900 tabular-nums">{money(row.amount)}</span>,
    },
  ];
  const sheet = (): Cell[][] => [
    [
      t("sales.colDate"),
      t("sales.colNumber"),
      t("locations.pick"),
      t("sales.colCustomer"),
      t("booking.professional"),
      `${t("checkout.tip")} (${business.currency})`,
    ],
    ...(report.data?.tips ?? []).map((row): Cell[] => [
      instantToZoned(Date.parse(row.createdAt), business.timezone).date,
      row.sale.number,
      row.locationName,
      row.customer,
      row.resourceName,
      fromMinorUnits(row.amount, business.currency),
    ]),
  ];
  const fileName = `${t("reports.tipsFile")}-${business.slug}-${period.start}-${period.end}`;

  if (report.isError) return <Alert>{errorMessage(t, report.error)}</Alert>;
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <BarList
        title={t("reports.tipsByProfessional")}
        empty={t("reports.nothing")}
        rows={(report.data?.totals ?? []).map((row) => ({
          label: `${row.name} (${row.count})`,
          value: row.amount,
          display: money(row.amount),
        }))}
      />
      <DataTable
        columns={columns}
        rows={report.data?.tips ?? []}
        rowKey={(row) => row.id}
        pageSize={25}
        empty={report.isPending ? <Spinner /> : t("reports.noTips")}
        toolbar={
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <Select
              aria-label={t("booking.professional")}
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
              className="w-56 [&_select]:h-8 [&_select]:text-[13px]"
            >
              <option value="">{t("agenda.allProfessionals")}</option>
              {professionals.map((professional) => (
                <option key={professional.id} value={professional.id}>
                  {professional.name}
                </option>
              ))}
            </Select>
            <ExportMenu
              disabled={(report.data?.tips.length ?? 0) === 0}
              onExcel={() => downloadXlsx(`${fileName}.xlsx`, t("reports.tabs.tips"), sheet())}
              onCsv={() => downloadCsv(`${fileName}.csv`, sheet())}
            />
          </div>
        }
      />
    </div>
  );
}

function Commissions({ filter, period }: { filter: Filter; period: Period }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const report = useReport<CommissionsReport>(business.id, "commissions", filter);
  const money = (amount: number) => formatPrice(amount, business.currency);
  type Row = CommissionsReport["professionals"][number];
  const rows = report.data?.professionals ?? [];
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("booking.professional"),
      cell: (row) => <span className="font-medium text-zinc-900">{row.name}</span>,
    },
    {
      key: "services",
      header: t("reports.services"),
      className: "text-right whitespace-nowrap",
      cell: (row) => (
        <div className="text-right">
          <div className="text-zinc-900 tabular-nums">{money(row.serviceCommission)}</div>
          <div className="text-[13px] text-zinc-500 tabular-nums">
            {t("reports.rateOf", { rate: row.serviceRate, amount: money(row.services) })}
          </div>
        </div>
      ),
    },
    {
      key: "products",
      header: t("reports.products"),
      className: "hidden sm:table-cell text-right whitespace-nowrap",
      cell: (row) => (
        <div className="text-right">
          <div className="text-zinc-900 tabular-nums">{money(row.productCommission)}</div>
          <div className="text-[13px] text-zinc-500 tabular-nums">
            {t("reports.rateOf", { rate: row.productRate, amount: money(row.products) })}
          </div>
        </div>
      ),
    },
    {
      key: "tips",
      header: t("checkout.tips"),
      className: "hidden md:table-cell text-right",
      cell: (row) => <span className="text-zinc-900 tabular-nums">{money(row.tips)}</span>,
    },
    {
      key: "total",
      header: t("reports.toPay"),
      className: "text-right",
      cell: (row) => (
        <span className="font-semibold text-zinc-900 tabular-nums">{money(row.total)}</span>
      ),
    },
  ];
  const units = (amount: number) => fromMinorUnits(amount, business.currency);
  const sheet = (): Cell[][] => [
    [
      t("booking.professional"),
      t("reports.servicesCount"),
      `${t("reports.services")} (${business.currency})`,
      "% ",
      `${t("reports.serviceCommission")} (${business.currency})`,
      t("reports.productsCount"),
      `${t("reports.products")} (${business.currency})`,
      "%",
      `${t("reports.productCommission")} (${business.currency})`,
      `${t("checkout.tips")} (${business.currency})`,
      `${t("reports.toPay")} (${business.currency})`,
    ],
    ...rows.map((row): Cell[] => [
      row.name,
      row.servicesCount,
      units(row.services),
      row.serviceRate,
      units(row.serviceCommission),
      row.productsCount,
      units(row.products),
      row.productRate,
      units(row.productCommission),
      units(row.tips),
      units(row.total),
    ]),
  ];
  const fileName = `${t("reports.commissionsFile")}-${business.slug}-${period.start}-${period.end}`;

  if (report.isError) return <Alert>{errorMessage(t, report.error)}</Alert>;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-zinc-500">
        {t("reports.commissionsHint")}{" "}
        <Link to="../professionals" className="font-medium text-brand-700 hover:underline">
          {t("nav.professionals")}
        </Link>
      </p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={report.isPending ? <Spinner /> : t("reports.noProfessionals")}
        toolbar={
          <div className="flex flex-1 items-center justify-between gap-3">
            <span className="text-[13px] text-zinc-500">
              {t("reports.totalToPay")}{" "}
              <span className="font-medium text-zinc-900 tabular-nums">{money(total)}</span>
            </span>
            <ExportMenu
              disabled={rows.length === 0}
              onExcel={() =>
                downloadXlsx(`${fileName}.xlsx`, t("reports.tabs.commissions"), sheet())
              }
              onCsv={() => downloadCsv(`${fileName}.csv`, sheet())}
            />
          </div>
        }
      />
    </div>
  );
}
