import {
  addDays,
  formatPrice,
  fromMinorUnits,
  instantToZoned,
  todayIn,
  zonedTimeToInstant,
} from "@openturnly/core";
import { Plus, Receipt, Search, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchable } from "../../components/combobox.tsx";
import { useConfirm } from "../../components/confirm.tsx";
import { Modal, PageHeader, PageTabs } from "../../components/controls.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import {
  DateRangePicker,
  type Period,
  periodPresets,
} from "../../components/date-range-picker.tsx";
import { toast } from "../../components/toast.tsx";
import { Alert, Badge, Button, Input, Select, Spinner } from "../../components/ui.tsx";
import type { Deposit, Sale } from "../../lib/api.ts";
import { useLocations } from "../../lib/catalog.ts";
import { type Cell, downloadCsv, downloadXlsx } from "../../lib/export.ts";
import { errorMessage } from "../../lib/forms.ts";
import { useDepositMutations, useDeposits, useSaleMutations, useSales } from "../../lib/sales.ts";
import { useTab } from "../../lib/tabs.ts";
import { ExportMenu } from "./appointments-list.tsx";
import { useBusinessContext } from "./business.tsx";
import { CheckoutModal, DepositModal } from "./checkout.tsx";

const TABS = ["sales", "deposits"] as const;

/** Sales ("Ventas") and deposits ("Abonos") over a period, at one location or all. */
export function SalesPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const tz = business.timezone;
  const [tab, setTab] = useTab(TABS);
  const [period, setPeriod] = useState<Period>(() => periodPresets(todayIn(tz)).month);
  const locations = useLocations(business.id);
  const [locationId, setLocationId] = useState("");
  const [selling, setSelling] = useState(false);
  const [depositing, setDepositing] = useState(false);

  const range = useMemo(
    () => ({
      from: new Date(zonedTimeToInstant(period.start, 0, tz)).toISOString(),
      to: new Date(zonedTimeToInstant(addDays(period.end, 1), 0, tz)).toISOString(),
    }),
    [period, tz],
  );

  return (
    <>
      <PageHeader
        title={t("sales.title")}
        subtitle={t("sales.subtitle")}
        actions={
          tab === "sales" ? (
            <Button data-tour="sales-new" onClick={() => setSelling(true)}>
              <Plus className="size-4" aria-hidden />
              {t("sales.new")}
            </Button>
          ) : (
            <Button onClick={() => setDepositing(true)}>
              <Wallet className="size-4" aria-hidden />
              {t("deposits.new")}
            </Button>
          )
        }
      />
      <PageTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "sales", label: t("sales.tabs.sales") },
          { value: "deposits", label: t("sales.tabs.deposits") },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangePicker
          value={period}
          onChange={setPeriod}
          today={todayIn(tz)}
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
        {(locations.data?.length ?? 0) > 1 && (
          <Select
            aria-label={t("locations.pick")}
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className="w-52 [&_select]:h-8 [&_select]:text-[13px]"
          >
            <option value="">{t("locations.all")}</option>
            {locations.data?.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {tab === "sales" ? (
        <SalesTable range={range} period={period} locationId={locationId || null} />
      ) : (
        <DepositsTable range={range} locationId={locationId || null} />
      )}
      {selling && <CheckoutModal onClose={() => setSelling(false)} />}
      {depositing && <DepositModal onClose={() => setDepositing(false)} />}
    </>
  );
}

function SalesTable({
  range,
  period,
  locationId,
}: {
  range: { from: string; to: string };
  period: Period;
  locationId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const sales = useSales(business.id, range, locationId);
  const severalLocations = (useLocations(business.id).data?.length ?? 0) > 1;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Sale | null>(null);
  const money = (amount: number) => formatPrice(amount, business.currency);

  const rows = useMemo(() => {
    const needle = searchable(query.trim());
    return (sales.data ?? []).filter(
      (sale) =>
        !needle ||
        searchable(
          `#${sale.number} ${sale.customer?.firstName ?? ""} ${sale.customer?.lastName ?? ""} ${sale.items.map((item) => `${item.name} ${item.resourceName ?? ""}`).join(" ")}`,
        ).includes(needle),
    );
  }, [sales.data, query]);
  const counted = rows.filter((sale) => sale.status === "paid");
  const total = counted.reduce((sum, sale) => sum + sale.total, 0);

  const when = (iso: string) => {
    const { date, time } = instantToZoned(Date.parse(iso), business.timezone);
    return { date, time };
  };
  const day = new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  const columns: Column<Sale>[] = [
    {
      key: "number",
      header: t("sales.colNumber"),
      className: "w-20 whitespace-nowrap",
      cell: (sale) => (
        <span className="font-medium text-zinc-900 tabular-nums">#{sale.number}</span>
      ),
    },
    {
      key: "when",
      header: t("sales.colDate"),
      className: "whitespace-nowrap",
      cell: (sale) => {
        const { date, time } = when(sale.createdAt);
        return (
          <span className="text-zinc-600 tabular-nums">
            {day.format(new Date(`${date}T12:00:00Z`))} · {time}
          </span>
        );
      },
    },
    {
      key: "customer",
      header: t("sales.colCustomer"),
      cell: (sale) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-zinc-900">
            {sale.customer
              ? `${sale.customer.firstName} ${sale.customer.lastName}`
              : t("sales.noCustomer")}
          </div>
          <div className="truncate text-[13px] text-zinc-500">
            {sale.items[0]?.name}
            {sale.items.length > 1 && ` +${sale.items.length - 1}`}
            {severalLocations && sale.locationName ? ` · ${sale.locationName}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "methods",
      header: t("sales.colPayment"),
      className: "hidden md:table-cell",
      cell: (sale) => (
        <span className="text-zinc-600">
          {[...new Set(sale.payments.map((payment) => t(`payments.${payment.method}`)))].join(
            ", ",
          ) || "—"}
        </span>
      ),
    },
    {
      key: "total",
      header: t("sales.colTotal"),
      className: "text-right whitespace-nowrap",
      cell: (sale) => (
        <div className="text-right">
          <div
            className={
              sale.status === "void"
                ? "text-zinc-400 line-through tabular-nums"
                : "font-medium text-zinc-900 tabular-nums"
            }
          >
            {money(sale.total)}
          </div>
          {sale.tipAmount > 0 && (
            <div className="text-[13px] text-zinc-500 tabular-nums">
              +{money(sale.tipAmount)} {t("sales.tipShort")}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: t("sales.colStatus"),
      className: "hidden sm:table-cell",
      cell: (sale) =>
        sale.status === "void" ? (
          <Badge tone="danger">{t("sales.void")}</Badge>
        ) : sale.internal ? (
          <Badge tone="warning">{t("sales.internal")}</Badge>
        ) : (
          <Badge tone="success">{t("sales.paid")}</Badge>
        ),
    },
  ];

  /** One line per sale line, for Excel or CSV. */
  const sheet = (): Cell[][] => {
    const header: Cell[] = [
      t("sales.colNumber"),
      t("sales.colDate"),
      t("agenda.exportStart"),
      t("sales.colStatus"),
      ...(severalLocations ? [t("locations.pick")] : []),
      t("sales.colCustomer"),
      t("booking.service"),
      t("booking.professional"),
      t("checkout.quantity"),
      `${t("booking.price")} (${business.currency})`,
      `${t("checkout.subtotal")} (${business.currency})`,
      `${t("checkout.discount")} (${business.currency})`,
      `${t("sales.colTotal")} (${business.currency})`,
      `${t("checkout.tips")} (${business.currency})`,
      t("sales.colPayment"),
    ];
    const units = (amount: number) => fromMinorUnits(amount, business.currency);
    const body = rows.flatMap((sale) =>
      sale.items.map((item, index): Cell[] => {
        const { date, time } = when(sale.createdAt);
        const first = index === 0;
        return [
          sale.number,
          date,
          time,
          sale.status === "void"
            ? t("sales.void")
            : sale.internal
              ? t("sales.internal")
              : t("sales.paid"),
          ...(severalLocations ? [sale.locationName] : []),
          sale.customer ? `${sale.customer.firstName} ${sale.customer.lastName}` : null,
          item.name,
          item.resourceName,
          item.quantity,
          units(item.unitPrice),
          first ? units(sale.subtotal) : null,
          first ? units(sale.discountAmount) : null,
          first ? units(sale.total) : null,
          first ? units(sale.tipAmount) : null,
          first
            ? sale.payments
                .map((payment) => `${t(`payments.${payment.method}`)} ${units(payment.amount)}`)
                .join(", ")
            : null,
        ];
      }),
    );
    return [header, ...body];
  };
  const fileName = `${t("sales.exportFile")}-${business.slug}-${period.start}-${period.end}`;

  return (
    <>
      {sales.isError && <Alert>{errorMessage(t, sales.error)}</Alert>}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(sale) => sale.id}
        onRowClick={setOpen}
        pageSize={25}
        empty={
          sales.isPending ? (
            <Spinner />
          ) : (
            <span className="inline-flex flex-col items-center gap-2">
              <Receipt className="size-5 text-zinc-300" aria-hidden />
              {t("sales.empty")}
            </span>
          )
        }
        toolbar={
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("sales.search")}
                aria-label={t("sales.search")}
                className="h-8 pl-8"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-zinc-500">
                {t("sales.summary", { count: counted.length })}
                {" · "}
                <span className="font-medium text-zinc-800 tabular-nums">{money(total)}</span>
              </span>
              <ExportMenu
                disabled={rows.length === 0}
                onExcel={() => downloadXlsx(`${fileName}.xlsx`, t("sales.title"), sheet())}
                onCsv={() => downloadCsv(`${fileName}.csv`, sheet())}
              />
            </div>
          </div>
        }
      />
      {open && <SaleDetails sale={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** One sale in full: lines, discount, tips, payments, and voiding it. */
export function SaleDetails({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const confirm = useConfirm();
  const { void: voidSale } = useSaleMutations(business.id);
  const money = (amount: number) => formatPrice(amount, business.currency);
  const { date, time } = instantToZoned(Date.parse(sale.createdAt), business.timezone);
  const day = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

  const rows = [
    { label: t("sales.colDate"), value: `${day}, ${time}` },
    ...(sale.locationName ? [{ label: t("locations.pick"), value: sale.locationName }] : []),
    {
      label: t("sales.colCustomer"),
      value: sale.customer
        ? `${sale.customer.firstName} ${sale.customer.lastName}`
        : t("sales.noCustomer"),
    },
    ...(sale.soldByName ? [{ label: t("sales.soldBy"), value: sale.soldByName }] : []),
    ...(sale.note ? [{ label: t("checkout.note"), value: sale.note }] : []),
  ];

  const voidIt = async () => {
    const ok = await confirm({
      title: t("sales.voidTitle", { number: sale.number }),
      description: t("sales.voidBody"),
      confirmLabel: t("sales.voidConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    voidSale.mutate(sale.id, {
      onSuccess: () => {
        toast.success(t("sales.voided"));
        onClose();
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("sales.saleTitle", { number: sale.number })}
      footer={
        <>
          {sale.status === "paid" && (
            <Button
              variant="ghost"
              className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700"
              loading={voidSale.isPending}
              onClick={voidIt}
            >
              {t("sales.voidConfirm")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {(sale.status === "void" || sale.internal) && (
          <div className="flex gap-2">
            {sale.status === "void" && <Badge tone="danger">{t("sales.void")}</Badge>}
            {sale.internal && <Badge tone="warning">{t("sales.internal")}</Badge>}
          </div>
        )}
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
        <div className="overflow-hidden rounded-lg border border-zinc-200">
          <ul className="divide-y divide-zinc-100">
            {sale.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-900">
                    {item.quantity > 1 && `${item.quantity} × `}
                    {item.name}
                  </div>
                  {item.resourceName && (
                    <div className="truncate text-[13px] text-zinc-500">{item.resourceName}</div>
                  )}
                </div>
                <span className="shrink-0 text-zinc-900 tabular-nums">{money(item.total)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
            {sale.discountAmount > 0 && (
              <div className="flex justify-between text-zinc-600">
                <dt>{t("checkout.discount")}</dt>
                <dd className="tabular-nums">−{money(sale.discountAmount)}</dd>
              </div>
            )}
            {sale.tips.map((tip) => (
              <div key={tip.id} className="flex justify-between text-zinc-600">
                <dt>{t("sales.tipFor", { name: tip.resourceName })}</dt>
                <dd className="tabular-nums">{money(tip.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between pt-1 text-base font-semibold text-zinc-900">
              <dt>{t("checkout.total")}</dt>
              <dd className="tabular-nums">{money(sale.total + sale.tipAmount)}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-800">{t("checkout.payments")}</h3>
          <ul className="space-y-1 text-sm">
            {sale.payments.map((payment) => (
              <li key={payment.id} className="flex justify-between">
                <span className="text-zinc-600">{t(`payments.${payment.method}`)}</span>
                <span className="text-zinc-900 tabular-nums">{money(payment.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

function DepositsTable({
  range,
  locationId,
}: {
  range: { from: string; to: string };
  locationId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const deposits = useDeposits(business.id, { ...range, locationId });
  const { void: giveBack } = useDepositMutations(business.id);
  const confirm = useConfirm();
  const money = (amount: number) => formatPrice(amount, business.currency);
  const day = new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  const returnDeposit = async (deposit: Deposit) => {
    const ok = await confirm({
      title: t("deposits.voidTitle"),
      description: t("deposits.voidBody", { amount: money(deposit.amount) }),
      confirmLabel: t("deposits.voidConfirm"),
      tone: "danger",
    });
    if (ok) {
      giveBack.mutate(deposit.id, {
        onSuccess: () => toast.success(t("deposits.voided")),
        onError: (error) => toast.error(errorMessage(t, error)),
      });
    }
  };

  const columns: Column<Deposit>[] = [
    {
      key: "when",
      header: t("sales.colDate"),
      className: "whitespace-nowrap",
      cell: (deposit) => {
        const { date, time } = instantToZoned(Date.parse(deposit.createdAt), business.timezone);
        return (
          <span className="text-zinc-600 tabular-nums">
            {day.format(new Date(`${date}T12:00:00Z`))} · {time}
          </span>
        );
      },
    },
    {
      key: "customer",
      header: t("sales.colCustomer"),
      cell: (deposit) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-zinc-900">
            {deposit.customer.firstName} {deposit.customer.lastName}
          </div>
          <div className="truncate text-[13px] text-zinc-500">
            {[
              deposit.appointmentCode &&
                t("deposits.forAppointment", { code: deposit.appointmentCode }),
              deposit.note,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </div>
      ),
    },
    {
      key: "method",
      header: t("checkout.method"),
      className: "hidden sm:table-cell",
      cell: (deposit) => <span className="text-zinc-600">{t(`payments.${deposit.method}`)}</span>,
    },
    {
      key: "amount",
      header: t("checkout.amount"),
      className: "text-right whitespace-nowrap",
      cell: (deposit) => (
        <span
          className={
            deposit.status === "void"
              ? "text-zinc-400 line-through tabular-nums"
              : "font-medium text-zinc-900 tabular-nums"
          }
        >
          {money(deposit.amount)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("sales.colStatus"),
      cell: (deposit) =>
        deposit.status === "void" ? (
          <Badge>{t("deposits.returned")}</Badge>
        ) : deposit.appliedSale ? (
          <Badge tone="success">
            {t("deposits.usedIn", { number: deposit.appliedSale.number })}
          </Badge>
        ) : (
          <Badge tone="brand">{t("deposits.available")}</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "w-28 text-right",
      cell: (deposit) =>
        deposit.status === "active" && !deposit.appliedSale ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={() => returnDeposit(deposit)}
          >
            {t("deposits.voidConfirm")}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      {deposits.isError && <Alert>{errorMessage(t, deposits.error)}</Alert>}
      <DataTable
        columns={columns}
        rows={deposits.data ?? []}
        rowKey={(deposit) => deposit.id}
        pageSize={25}
        empty={deposits.isPending ? <Spinner /> : t("deposits.empty")}
      />
    </>
  );
}
