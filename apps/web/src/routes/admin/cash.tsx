import {
  addDays,
  type CashMovementInput,
  cashMovementSchema,
  formatPrice,
  fromMinorUnits,
  instantToZoned,
  MONEY_METHODS,
  PAYMENT_METHODS,
  type PaymentMethod,
  todayIn,
  zonedTimeToInstant,
} from "@openturnly/core";
import {
  ArrowLeftRight,
  Banknote,
  ChevronDown,
  Download,
  Plus,
  Scale,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClickOutside, useMenuPlacement } from "../../components/combobox.tsx";
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
import { type Cell, downloadWorkbook } from "../../lib/export.ts";
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

  const sources: { key: Flow; label: string; value: number }[] = data
    ? [
        { key: "sales", label: t("cash.flows.sales"), value: data.flows.sales },
        { key: "deposits", label: t("cash.flows.deposits"), value: data.flows.deposits },
        { key: "internal", label: t("cash.flows.internal"), value: data.flows.internal },
        { key: "giftCards", label: t("cash.flows.giftCards"), value: data.flows.giftCards },
        { key: "income", label: t("cash.flows.otherIncome"), value: data.flows.otherIncome },
      ]
    : [];
  const cameIn = sources.reduce((total, source) => total + source.value, 0);

  /** A summary sheet with the figures on screen, then every line of the period. */
  const exportReport = () => {
    if (!data) return;
    const units = (amount: number) => fromMinorUnits(amount, business.currency);
    const stamp = (iso: string) => {
      const { date, time } = instantToZoned(Date.parse(iso), tz);
      return [date, time];
    };
    const amountHeader = `${t("checkout.amount")} (${business.currency})`;
    const summary: Cell[][] = [];
    const bold: number[] = [];
    const add = (row: Cell[], strong = false) => {
      if (strong) bold.push(summary.length);
      summary.push(row);
    };
    add([`${t("cash.title")} · ${business.name}`], true);
    add([t("locations.pick"), locationName ?? t("locations.all")]);
    add([t("cash.period"), `${period.start} – ${period.end}`]);
    add([]);
    add([t("cash.sourcesTitle"), amountHeader], true);
    for (const source of sources) add([source.label, units(source.value)]);
    add([t("cash.summary.in"), units(cameIn)], true);
    add([t("cash.flows.expenses"), units(-data.flows.expenses)]);
    add([t("cash.flows.result"), units(data.flows.result)], true);
    add([]);
    add([t("cash.methodsTitle"), amountHeader], true);
    for (const method of MONEY_METHODS)
      add([t(`payments.${method}`), units(data.byMethod[method])]);
    add([]);
    add([t("cash.summary.drawerToday"), units(data.cashInDrawer)], true);
    const detail: Cell[][] = [
      [
        t("cash.colFlow"),
        t("sales.colDate"),
        t("agenda.exportStart"),
        t("locations.pick"),
        t("cash.colDetail"),
        t("checkout.method"),
        amountHeader,
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
    downloadWorkbook(
      `${t("cash.exportFile")}-${business.slug}-${period.start}-${period.end}.xlsx`,
      [
        { name: t("cash.summarySheet"), rows: summary, table: false, bold },
        { name: t("cash.detailSheet"), rows: detail },
      ],
    );
  };

  return (
    <>
      <PageHeader
        title={t("cash.title")}
        subtitle={t("cash.subtitle")}
        actions={<RecordMenu onPick={setCreating} />}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
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
        <Button variant="secondary" className="ml-auto" disabled={!data} onClick={exportReport}>
          <Download className="size-4" aria-hidden />
          {t("cash.export")}
        </Button>
      </div>

      {report.isError && (
        <div className="mb-4">
          <Alert>{errorMessage(t, report.error)}</Alert>
        </div>
      )}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              icon={TrendingUp}
              tone="in"
              label={t("cash.summary.in")}
              value={money(cameIn)}
              hint={t("cash.summary.inHint")}
            />
            <Stat
              icon={TrendingDown}
              tone="out"
              label={t("cash.summary.out")}
              value={money(data.flows.expenses)}
              hint={t("cash.summary.outHint")}
            />
            <Stat
              icon={Wallet}
              tone="result"
              label={t("cash.flows.result")}
              value={money(data.flows.result)}
              hint={t("cash.summary.resultHint")}
            />
            <Stat
              icon={Banknote}
              tone="drawer"
              label={t("cash.inDrawer")}
              value={money(data.cashInDrawer)}
              hint={
                locationName
                  ? t("cash.summary.drawerHintAt", { location: locationName })
                  : t("cash.summary.drawerHint")
              }
            />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-zinc-900">{t("cash.sourcesTitle")}</h2>
              <p className="mt-0.5 text-[13px] text-zinc-500">{t("cash.sourcesHint")}</p>
              <ul className="mt-3">
                {[
                  ...sources,
                  {
                    key: "expense" as const,
                    label: t("cash.flows.expenses"),
                    value: -data.flows.expenses,
                  },
                ].map((source) => (
                  <li key={source.key}>
                    <button
                      type="button"
                      onClick={() => setFlow(source.key)}
                      aria-pressed={flow === source.key}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                        flow === source.key ? "bg-brand-50 text-brand-800" : "hover:bg-zinc-50",
                      )}
                    >
                      <span className={flow === source.key ? "font-medium" : "text-zinc-600"}>
                        {source.label}
                      </span>
                      <Amount value={source.value} money={money} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="flex flex-col p-4">
              <h2 className="text-sm font-semibold text-zinc-900">{t("cash.methodsTitle")}</h2>
              <p className="mt-0.5 text-[13px] text-zinc-500">{t("cash.methodsHint")}</p>
              <ul className="mt-3">
                {MONEY_METHODS.map((method) => (
                  <li
                    key={method}
                    className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-sm"
                  >
                    <span className="text-zinc-600">{t(`payments.${method}`)}</span>
                    <Amount value={data.byMethod[method]} money={money} />
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center justify-between gap-3 border-t border-zinc-100 px-2.5 pt-2.5 text-sm font-semibold text-zinc-900">
                {t("cash.methodsTotal")}
                <span className="tabular-nums">{money(data.flows.result)}</span>
              </div>
            </Card>
          </div>

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

const STAT_TONES = {
  in: "bg-emerald-50 text-emerald-600 ring-emerald-200",
  out: "bg-red-50 text-red-600 ring-red-200",
  result: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  drawer: "bg-brand-50 text-brand-600 ring-brand-200",
};

/** One figure of the period, all the same size so they read as one row. */
function Stat({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: typeof Banknote;
  tone: keyof typeof STAT_TONES;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-zinc-500">{label}</span>
        <span className={cn("grid size-8 place-items-center rounded-lg ring-1", STAT_TONES[tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">
        {value}
      </div>
      <p className="mt-1 text-xs text-zinc-500">{hint}</p>
    </Card>
  );
}

/** Zero greyed out and money going out in red, so the figures that matter stand out. */
function Amount({ value, money }: { value: number; money: (amount: number) => string }) {
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        value === 0 ? "text-zinc-400" : value < 0 ? "text-red-600" : "text-zinc-900",
      )}
    >
      {value < 0 ? `− ${money(-value)}` : money(value)}
    </span>
  );
}

const RECORDS = [
  { kind: "income", icon: TrendingUp },
  { kind: "expense", icon: TrendingDown },
  { kind: "transfer", icon: ArrowLeftRight },
  { kind: "adjustment", icon: Scale },
] as const;

/** The four things registered by hand, each with what it's for. */
function RecordMenu({ onPick }: { onPick: (kind: NewMovement) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const placement = useMenuPlacement(open, wrapper, 340, "right");
  useClickOutside(open, [wrapper], () => setOpen(false));
  return (
    <div ref={wrapper} className="relative">
      <Button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
        <Plus className="size-4" aria-hidden />
        {t("cash.record")}
        <ChevronDown className="size-4 opacity-70" aria-hidden />
      </Button>
      {open && (
        <div
          role="menu"
          style={placement}
          className="absolute top-full right-0 z-30 mt-1 w-[340px] max-w-[calc(100vw-1rem)] rounded-xl bg-white p-1 shadow-lg ring-1 ring-zinc-200"
        >
          {RECORDS.map(({ kind, icon: Icon }) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(kind);
              }}
              className="flex w-full gap-3 rounded-lg px-3 py-2 text-left hover:bg-zinc-100"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden />
              <span>
                <span className="block text-sm font-medium text-zinc-900">
                  {t(`cash.new.${kind}`)}
                </span>
                <span className="block text-[13px] text-zinc-500">{t(`cash.newHint.${kind}`)}</span>
              </span>
            </button>
          ))}
          <p className="mt-1 border-t border-zinc-100 px-3 pt-2 pb-1.5 text-xs text-zinc-500">
            {t("cash.recordNote")}
          </p>
        </div>
      )}
    </div>
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
