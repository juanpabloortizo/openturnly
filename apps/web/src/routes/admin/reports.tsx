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
import { Alert, Badge, Card, Select, Spinner } from "../../components/ui.tsx";
import { useLocations, useProfessionals } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { type Cell, downloadCsv, downloadXlsx } from "../../lib/export.ts";
import { errorMessage } from "../../lib/forms.ts";
import {
  type CommissionsReport,
  type Figures,
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

/** "+12 %" against the period before, with an arrow so it doesn't rely on colour. */
function Change({ now, before }: { now: number; before: number }) {
  const { t } = useTranslation();
  if (before === 0 && now === 0) {
    return <span className="text-[13px] text-zinc-500">{t("reports.noChange")}</span>;
  }
  const change = before === 0 ? 1 : (now - before) / before;
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[13px] font-medium",
        change > 0 ? "text-emerald-700" : change < 0 ? "text-red-600" : "text-zinc-500",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {before === 0 ? t("reports.new") : `${change > 0 ? "+" : ""}${Math.round(change * 100)} %`}
      <span className="font-normal text-zinc-500">{t("reports.vsBefore")}</span>
    </span>
  );
}

function Tile({
  label,
  value,
  change,
  hint,
}: {
  label: string;
  value: string;
  change: ReactNode;
  hint?: string;
}) {
  return (
    <Card className="p-4" title={hint}>
      <div className="text-[13px] font-medium text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-900 tabular-nums">{value}</div>
      <div className="mt-1">{change}</div>
    </Card>
  );
}

/** Names with a thin bar for their share of the largest, and the exact value on hover. */
function BarList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { label: string; value: number; display: string }[];
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row) => (
            <li key={row.label} title={`${row.label}: ${row.display}`}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate text-zinc-700">{row.label}</span>
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

function Summary({ filter }: { filter: Filter }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const report = useReport<SummaryReport>(business.id, "summary", filter);
  const [showToday, setShowToday] = useState(false);
  const money = (amount: number) => formatPrice(amount, business.currency);
  if (report.isPending) return <Spinner />;
  if (report.isError) return <Alert>{errorMessage(t, report.error)}</Alert>;
  const { current, before, origin, today } = report.data;
  const percent = (figures: Figures) =>
    figures.occupancy === null ? "—" : `${Math.round(figures.occupancy * 100)} %`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label={t("reports.bookings")}
          value={String(current.bookings)}
          change={<Change now={current.bookings} before={before.bookings} />}
        />
        <Tile
          label={t("reports.occupancy")}
          hint={t("reports.occupancyHint")}
          value={percent(current)}
          change={<Change now={current.occupancy ?? 0} before={before.occupancy ?? 0} />}
        />
        <Tile
          label={t("reports.newCustomers")}
          value={String(current.newCustomers)}
          change={<Change now={current.newCustomers} before={before.newCustomers} />}
        />
        <Tile
          label={t("reports.billed")}
          hint={t("reports.billedHint")}
          value={money(current.billed)}
          change={<Change now={current.billed} before={before.billed} />}
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

      <div className="grid gap-4 lg:grid-cols-3">
        <BarList
          title={t("reports.origin")}
          empty={t("reports.nothing")}
          rows={(["online", "admin", "agent"] as const)
            .filter((source) => (origin[source] ?? 0) > 0)
            .map((source) => ({
              label:
                source === "online"
                  ? t("agenda.sourceOnline")
                  : source === "admin"
                    ? t("agenda.sourceAdmin")
                    : t("agenda.sourceAgent"),
              value: origin[source] ?? 0,
              display: String(origin[source] ?? 0),
            }))}
        />
        <BarList
          title={t("reports.topSold")}
          empty={t("reports.nothing")}
          rows={report.data.topServices.map((row) => ({
            label: row.quantity > 1 ? `${row.name} (${row.quantity})` : row.name,
            value: row.amount,
            display: money(row.amount),
          }))}
        />
        <BarList
          title={t("reports.byProfessional")}
          empty={t("reports.nothing")}
          rows={report.data.byProfessional.map((row) => ({
            label: row.name || t("reports.noProfessional"),
            value: row.bookings,
            display: String(row.bookings),
          }))}
        />
      </div>
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
