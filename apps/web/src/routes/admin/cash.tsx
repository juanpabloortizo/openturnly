import {
  addDays,
  type CashMovementInput,
  cashMovementSchema,
  formatPrice,
  fromMinorUnits,
  instantToZoned,
  PAYMENT_METHODS,
  type PaymentMethod,
  todayIn,
  zonedTimeToInstant,
} from "@openturnly/core";
import {
  ArrowLeftRight,
  Banknote,
  Download,
  Minus,
  Plus,
  Scale,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "../../components/confirm.tsx";
import { Modal, PageHeader, PageTabs } from "../../components/controls.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import {
  DateRangePicker,
  type Period,
  periodPresets,
} from "../../components/date-range-picker.tsx";
import { MoneyInput } from "../../components/money-input.tsx";
import { toast } from "../../components/toast.tsx";
import { Alert, Button, Card, Field, Input, Select, Spinner } from "../../components/ui.tsx";
import { type CashReport, useCashMutations, useCashReport } from "../../lib/cash.ts";
import { useLocations } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { type Cell, downloadXlsx } from "../../lib/export.ts";
import { errorMessage, validate } from "../../lib/forms.ts";
import { useBusinessContext } from "./business.tsx";

type Flow =
  | "sales"
  | "deposits"
  | "internal"
  | "giftCards"
  | "income"
  | "expense"
  | "transfers"
  | "adjustments";
type NewMovement = "income" | "expense" | "transfer" | "adjustment";

/**
 * "Caja": what came in and went out of a location in a period, where it came from, how it
 * was paid, and the cash that should be in the drawer.
 */
export function CashPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const tz = business.timezone;
  const money = (amount: number) => formatPrice(amount, business.currency);
  const locations = useLocations(business.id).data ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  // One location at a time by default: the drawer is per location.
  const locationId = picked ?? (locations.length > 1 ? (locations[0]?.id ?? "") : "");
  const [period, setPeriod] = useState<Period>(() => periodPresets(todayIn(tz)).today);
  const [flow, setFlow] = useState<Flow>("sales");
  const [creating, setCreating] = useState<NewMovement | null>(null);
  const range = useMemo(
    () => ({
      from: new Date(zonedTimeToInstant(period.start, 0, tz)).toISOString(),
      to: new Date(zonedTimeToInstant(addDays(period.end, 1), 0, tz)).toISOString(),
    }),
    [period, tz],
  );
  const report = useCashReport(business.id, range, locationId || null);
  const data = report.data;
  const locationName = locations.find((location) => location.id === locationId)?.name;

  const steps: { key: Flow; label: string; value: number; sign?: "+" | "−" | "=" }[] = data
    ? [
        { key: "sales", label: t("cash.flows.sales"), value: data.flows.sales },
        { key: "deposits", label: t("cash.flows.deposits"), value: data.flows.deposits, sign: "+" },
        { key: "internal", label: t("cash.flows.internal"), value: data.flows.internal, sign: "+" },
        {
          key: "giftCards",
          label: t("cash.flows.giftCards"),
          value: data.flows.giftCards,
          sign: "+",
        },
        {
          key: "income",
          label: t("cash.flows.otherIncome"),
          value: data.flows.otherIncome,
          sign: "+",
        },
        { key: "expense", label: t("cash.flows.expenses"), value: data.flows.expenses, sign: "−" },
      ]
    : [];

  /** Every line of the period on one sheet, with the flow it belongs to. */
  const exportReport = () => {
    if (!data) return;
    const units = (amount: number) => fromMinorUnits(amount, business.currency);
    const stamp = (iso: string) => {
      const { date, time } = instantToZoned(Date.parse(iso), tz);
      return [date, time];
    };
    const rows: Cell[][] = [
      [
        t("cash.colFlow"),
        t("sales.colDate"),
        t("agenda.exportStart"),
        t("locations.pick"),
        t("cash.colDetail"),
        t("checkout.method"),
        `${t("checkout.amount")} (${business.currency})`,
      ],
      ...data.sales.map((sale): Cell[] => [
        t(`cash.flows.${sale.flow}`),
        ...stamp(sale.createdAt),
        sale.locationName,
        `#${sale.number}${sale.customer ? ` · ${sale.customer}` : ""}`,
        sale.methods.map((method) => t(`payments.${method}`)).join(", "),
        units(sale.amount),
      ]),
      ...data.deposits.map((deposit): Cell[] => [
        t("cash.flows.deposits"),
        ...stamp(deposit.createdAt),
        deposit.locationName,
        deposit.customer,
        t(`payments.${deposit.method}`),
        units(deposit.amount),
      ]),
      ...data.movements.map((move): Cell[] => [
        t(`cash.kinds.${move.kind}`),
        ...stamp(move.createdAt),
        move.locationName,
        [move.category, move.description].filter(Boolean).join(" · "),
        t(`payments.${move.method}`),
        units(move.kind === "expense" || move.kind === "transfer_out" ? -move.amount : move.amount),
      ]),
    ];
    downloadXlsx(
      `${t("cash.exportFile")}-${business.slug}-${period.start}-${period.end}.xlsx`,
      t("cash.title"),
      rows,
    );
  };

  return (
    <>
      <PageHeader
        title={t("cash.title")}
        subtitle={t("cash.subtitle")}
        actions={
          <>
            <Button onClick={() => setCreating("income")}>
              <TrendingUp className="size-4" aria-hidden />
              {t("cash.new.income")}
            </Button>
            <Button variant="secondary" onClick={() => setCreating("expense")}>
              <TrendingDown className="size-4" aria-hidden />
              {t("cash.new.expense")}
            </Button>
            <Button variant="secondary" onClick={() => setCreating("transfer")}>
              <ArrowLeftRight className="size-4" aria-hidden />
              {t("cash.new.transfer")}
            </Button>
            <Button variant="secondary" onClick={() => setCreating("adjustment")}>
              <Scale className="size-4" aria-hidden />
              {t("cash.new.adjustment")}
            </Button>
          </>
        }
      />
      <p className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-[13px] text-sky-800">
        {t("cash.hint")}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="flex flex-wrap items-end gap-3 p-4">
          {locations.length > 1 && (
            <Field label={t("locations.pick")} className="w-56">
              {(props) => (
                <Select
                  {...props}
                  value={locationId}
                  onChange={(event) => setPicked(event.target.value)}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                  <option value="">{t("locations.all")}</option>
                </Select>
              )}
            </Field>
          )}
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-zinc-800">{t("cash.period")}</span>
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
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            disabled={!data}
            onClick={exportReport}
          >
            <Download className="size-3.5" aria-hidden />
            {t("cash.export")}
          </Button>
        </Card>
        <Card className="flex items-center gap-4 p-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
            <Banknote className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-sm text-zinc-500">
              {t("cash.inDrawer")}
              {locationName ? ` · ${locationName}` : ""}
            </div>
            <div className="text-2xl font-semibold text-zinc-900 tabular-nums">
              {data ? money(data.cashInDrawer) : "—"}
            </div>
          </div>
        </Card>
      </div>

      {report.isError && (
        <div className="mt-4">
          <Alert>{errorMessage(t, report.error)}</Alert>
        </div>
      )}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <Card className="mt-4 overflow-x-auto p-4">
            <div className="flex min-w-[52rem] items-stretch gap-2">
              {steps.map((step) => (
                <div key={step.key} className="flex flex-1 items-center gap-2">
                  {step.sign && (
                    <span className="grid size-6 place-items-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-500">
                      {step.sign === "−" ? (
                        <Minus className="size-3" />
                      ) : (
                        <Plus className="size-3" />
                      )}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setFlow(step.key)}
                    className={cn(
                      "min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      flow === step.key
                        ? "border-brand-400 bg-brand-50/50"
                        : "border-zinc-200 hover:border-zinc-300",
                    )}
                  >
                    <div className="text-[12px] text-zinc-500">{step.label}</div>
                    <div className="mt-0.5 font-semibold text-zinc-900 tabular-nums">
                      {money(step.value)}
                    </div>
                  </button>
                </div>
              ))}
              <span className="grid size-6 place-items-center self-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-500">
                =
              </span>
              <div className="flex-1 rounded-lg bg-zinc-900 px-3 py-2.5 text-white">
                <div className="text-[12px] text-zinc-300">{t("cash.flows.result")}</div>
                <div className="mt-0.5 font-semibold tabular-nums">{money(data.flows.result)}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-zinc-100 pt-3 text-[13px]">
              <span className="text-zinc-500">{t("cash.byMethod")}</span>
              {PAYMENT_METHODS.map((method) => (
                <span key={method} className="text-zinc-600">
                  {t(`payments.${method}`)}{" "}
                  <span className="font-medium text-zinc-900 tabular-nums">
                    {money(data.byMethod[method])}
                  </span>
                </span>
              ))}
            </div>
          </Card>

          <div className="mt-6">
            <PageTabs
              value={flow}
              onChange={setFlow}
              tabs={[
                { value: "sales", label: t("cash.flows.sales") },
                { value: "deposits", label: t("cash.flows.deposits") },
                { value: "internal", label: t("cash.flows.internal") },
                { value: "giftCards", label: t("cash.flows.giftCards") },
                { value: "income", label: t("cash.flows.otherIncome") },
                { value: "expense", label: t("cash.flows.expenses") },
                { value: "transfers", label: t("cash.flows.transfers") },
                { value: "adjustments", label: t("cash.flows.adjustments") },
              ]}
            />
            <FlowTable flow={flow} report={data} showLocation={!locationId} />
          </div>
        </>
      )}
      {creating && (
        <CashMovementForm
          kind={creating}
          locationId={locationId || locations[0]?.id || ""}
          categories={[
            ...new Set(
              (data?.movements ?? []).flatMap((move) => (move.category ? [move.category] : [])),
            ),
          ]}
          onClose={() => setCreating(null)}
        />
      )}
    </>
  );
}

type Row = {
  id: string;
  createdAt: string;
  detail: ReactNode;
  method: string;
  amount: number;
  locationName: string | null;
  /** A movement entered by hand, which can be undone. */
  movementId?: string;
};

function FlowTable({
  flow,
  report,
  showLocation,
}: {
  flow: Flow;
  report: CashReport;
  showLocation: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const confirm = useConfirm();
  const { remove } = useCashMutations(business.id);
  const money = (amount: number) => formatPrice(amount, business.currency);
  const day = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  const methods = (list: PaymentMethod[]) =>
    list.map((method) => t(`payments.${method}`)).join(", ") || "—";
  const movementRows = (kinds: string[]): Row[] =>
    report.movements
      .filter((move) => kinds.includes(move.kind))
      .map((move) => ({
        id: move.id,
        createdAt: move.createdAt,
        detail: (
          <span>
            {move.kind === "transfer_in"
              ? t("cash.kinds.transfer_in")
              : move.kind === "transfer_out"
                ? t("cash.kinds.transfer_out")
                : null}
            {[move.category, move.description].filter(Boolean).join(" · ") || null}
            {move.createdByName && <span className="text-zinc-400"> · {move.createdByName}</span>}
          </span>
        ),
        method: t(`payments.${move.method}`),
        amount:
          move.kind === "expense" || move.kind === "transfer_out" ? -move.amount : move.amount,
        locationName: move.locationName,
        movementId: move.id,
      }));
  const rows: Row[] =
    flow === "deposits"
      ? report.deposits.map((deposit) => ({
          id: deposit.id,
          createdAt: deposit.createdAt,
          detail: [deposit.customer, deposit.note].filter(Boolean).join(" · "),
          method: t(`payments.${deposit.method}`),
          amount: deposit.amount,
          locationName: deposit.locationName,
        }))
      : flow === "sales" || flow === "internal" || flow === "giftCards"
        ? report.sales
            .filter((sale) => sale.flow === flow)
            .map((sale) => ({
              id: sale.id,
              createdAt: sale.createdAt,
              detail: `#${sale.number}${sale.customer ? ` · ${sale.customer}` : ""}`,
              method: methods(sale.methods),
              amount: sale.amount,
              locationName: sale.locationName,
            }))
        : flow === "transfers"
          ? movementRows(["transfer_in", "transfer_out"])
          : flow === "adjustments"
            ? movementRows(["adjustment"])
            : movementRows([flow]);

  const undo = async (row: Row) => {
    if (!row.movementId) return;
    const ok = await confirm({
      title: t("cash.undoTitle"),
      description: t("cash.undoBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (ok) {
      remove.mutate(row.movementId, {
        onSuccess: () => toast.success(t("cash.undone")),
        onError: (error) => toast.error(errorMessage(t, error)),
      });
    }
  };

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
      key: "detail",
      header: t("cash.colDetail"),
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate text-zinc-900">{row.detail || "—"}</div>
          {showLocation && row.locationName && (
            <div className="truncate text-[13px] text-zinc-500">{row.locationName}</div>
          )}
        </div>
      ),
    },
    {
      key: "method",
      header: t("checkout.method"),
      className: "hidden sm:table-cell",
      cell: (row) => <span className="text-zinc-600">{row.method}</span>,
    },
    {
      key: "amount",
      header: t("checkout.amount"),
      className: "text-right whitespace-nowrap",
      cell: (row) => (
        <span
          className={cn(
            "font-medium tabular-nums",
            row.amount < 0 ? "text-red-600" : "text-zinc-900",
          )}
        >
          {row.amount < 0 ? `−${money(-row.amount)}` : money(row.amount)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (row) =>
        row.movementId ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("common.delete")}
            title={t("common.delete")}
            onClick={() => undo(row)}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ) : null,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      pageSize={25}
      empty={t("cash.empty")}
    />
  );
}

function CashMovementForm({
  kind,
  locationId: initialLocation,
  categories,
  onClose,
}: {
  kind: NewMovement;
  locationId: string;
  categories: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const locations = useLocations(business.id).data?.filter((location) => location.active) ?? [];
  const { create } = useCashMutations(business.id);
  const [locationId, setLocationId] = useState(initialLocation);
  const [toLocationId, setToLocationId] = useState("");
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");

  const submit = () => {
    const values: CashMovementInput =
      kind === "income" || kind === "expense"
        ? { kind, locationId, amount, method, category, description }
        : kind === "transfer"
          ? { kind, locationId, amount, ...(toLocationId ? { toLocationId } : {}), description }
          : { kind, locationId, counted: amount, description };
    const result = validate(cashMovementSchema, values);
    if (!result.data) {
      toast.error(t("cash.amountRequired"));
      return;
    }
    create.mutate(values, {
      onSuccess: ({ cashInDrawer }) => {
        toast.success(t("cash.saved", { amount: formatPrice(cashInDrawer, business.currency) }));
        onClose();
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t(`cash.new.${kind}`)}
      description={t(`cash.newHint.${kind}`)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {locations.length > 1 && (
          <Field label={kind === "transfer" ? t("cash.fromLocation") : t("locations.pick")}>
            {(props) => (
              <Select
                {...props}
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {kind === "transfer" && (
          <Field label={t("cash.toLocation")}>
            {(props) => (
              <Select
                {...props}
                value={toLocationId}
                onChange={(event) => setToLocationId(event.target.value)}
              >
                <option value="">{t("cash.outOfRegister")}</option>
                {locations
                  .filter((location) => location.id !== locationId)
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={kind === "adjustment" ? t("cash.counted") : t("checkout.amount")}>
          {(props) => (
            <MoneyInput
              id={props.id}
              currency={business.currency}
              value={amount}
              onChange={setAmount}
            />
          )}
        </Field>
        {(kind === "income" || kind === "expense") && (
          <>
            <Field label={t("checkout.method")}>
              {(props) => (
                <Select
                  {...props}
                  value={method}
                  onChange={(event) => setMethod(event.target.value as PaymentMethod)}
                >
                  {PAYMENT_METHODS.map((option) => (
                    <option key={option} value={option}>
                      {t(`payments.${option}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("cash.category")} optional>
              {(props) => (
                <>
                  <Input
                    {...props}
                    list={`${props.id}-list`}
                    placeholder={t(`cash.categoryPlaceholder.${kind}`)}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  />
                  <datalist id={`${props.id}-list`}>
                    {categories.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
          </>
        )}
        <Field label={t("checkout.note")} optional className="sm:col-span-2">
          {(props) => (
            <Input
              {...props}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
