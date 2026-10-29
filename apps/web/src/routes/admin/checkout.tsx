import {
  formatPhone,
  formatPrice,
  instantToZoned,
  PAYMENT_METHODS,
  type PaymentMethod,
  type SaleInput,
} from "@openturnly/core";
import { Plus, Search, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Switch } from "../../components/controls.tsx";
import { MoneyInput } from "../../components/money-input.tsx";
import { toast } from "../../components/toast.tsx";
import { Button, Field, Input, Select, Textarea } from "../../components/ui.tsx";
import type { Appointment, CustomerSummary, Sale } from "../../lib/api.ts";
import {
  useCustomerSearch,
  useLocations,
  useProfessionals,
  useServices,
} from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { formatDay } from "../../lib/format.ts";
import { errorMessage } from "../../lib/forms.ts";
import { lookupGiftCard } from "../../lib/gift-cards.ts";
import { useDepositMutations, useDeposits, useSaleMutations } from "../../lib/sales.ts";
import { useBusinessContext } from "./business.tsx";

type Line = {
  key: string;
  serviceId: string | null;
  appointmentId?: string;
  /** Shown for an appointment's line: the service as it was booked. */
  name?: string;
  resourceId: string | null;
  quantity: number;
  unitPrice: number;
  /** An appointment's discount from the code used to book it. */
  discountAmount: number;
};
type Payment = {
  key: string;
  method: PaymentMethod | "gift_card";
  amount: number;
  /** For a gift card: which one, its code and what it had left. */
  giftCard?: { id: string; code: string; remaining: number };
};
type DiscountCode = { id: string; code: string; percent: number | null; amount: number | null };
type Tip = { key: string; resourceId: string; amount: number };

const newKey = () => crypto.randomUUID();
type Customer = Pick<CustomerSummary, "id" | "firstName" | "lastName" | "phone" | "email">;

/**
 * Charges an appointment (from the calendar) or makes a sale at the counter: the services
 * done, a discount, tips for the professionals and how the customer paid, split across
 * methods if needed. Deposits the customer left are used first.
 */
export function CheckoutModal({
  appointment,
  onClose,
  onDone,
}: {
  appointment?: Appointment;
  onClose: () => void;
  onDone?: (sale: Sale) => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const currency = business.currency;
  const money = (amount: number) => formatPrice(amount, currency);
  const services = useServices(business.id);
  const professionals = useProfessionals(business.id);
  const locations = useLocations(business.id);
  const { create } = useSaleMutations(business.id);

  const places = (locations.data ?? []).filter(
    (location) => location.active || location.id === appointment?.locationId,
  );
  const [locationId, setLocationId] = useState<string | null>(appointment?.locationId ?? null);
  const location = places.find((place) => place.id === locationId) ?? places[0];
  const [customer, setCustomer] = useState<Customer | null>(appointment?.customer ?? null);
  const [internal, setInternal] = useState(false);
  const [lines, setLines] = useState<Line[]>(() =>
    appointment
      ? [
          {
            key: newKey(),
            serviceId: appointment.serviceId,
            appointmentId: appointment.id,
            name: appointment.serviceName,
            resourceId: appointment.resourceId,
            quantity: 1,
            unitPrice: appointment.priceAmount ?? 0,
            discountAmount: appointment.discountAmount,
          },
        ]
      : [],
  );
  const [discount, setDiscount] = useState(0);
  // A discount code applied here, which keeps the discount in step with the subtotal.
  const [discountCode, setDiscountCode] = useState<DiscountCode | null>(null);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [tips, setTips] = useState<Tip[]>([]);
  const [payments, setPayments] = useState<Payment[]>([
    { key: newKey(), method: "cash", amount: 0 },
  ]);
  // The first payment follows the total until someone types an amount.
  const [paymentsEdited, setPaymentsEdited] = useState(false);
  const [note, setNote] = useState("");

  // Deposits the customer left and hasn't used, the appointment's ticked from the start.
  const deposits = useDeposits(business.id, { customerId: customer?.id }, { enabled: !!customer });
  const available = (deposits.data ?? []).filter(
    (deposit) => deposit.status === "active" && !deposit.appliedSale,
  );
  const [usedDeposits, setUsedDeposits] = useState<string[] | null>(null);
  useEffect(() => {
    if (usedDeposits === null && deposits.data) {
      setUsedDeposits(
        available
          .filter((deposit) => appointment && deposit.appointmentId === appointment.id)
          .map((deposit) => deposit.id),
      );
    }
  }, [deposits.data, available, appointment, usedDeposits]);
  const depositTotal = available
    .filter((deposit) => usedDeposits?.includes(deposit.id))
    .reduce((sum, deposit) => sum + deposit.amount, 0);

  const offered = (services.data ?? []).filter(
    (service) => service.active && (!location || location.serviceIds.includes(service.id)),
  );
  const team = (professionals.data ?? []).filter(
    (professional) => !location || location.resourceIds.includes(professional.id),
  );

  const subtotal = lines.reduce(
    (sum, line) => sum + Math.max(0, line.quantity * line.unitPrice - line.discountAmount),
    0,
  );
  useEffect(() => {
    if (!discountCode) return;
    setDiscount(
      discountCode.percent !== null
        ? Math.round((subtotal * discountCode.percent) / 100)
        : Math.min(discountCode.amount ?? 0, subtotal),
    );
  }, [discountCode, subtotal]);
  const total = Math.max(0, subtotal - discount);
  const tipTotal = tips.reduce((sum, tip) => sum + tip.amount, 0);
  const due = total + tipTotal;
  const paid = depositTotal + payments.reduce((sum, payment) => sum + payment.amount, 0);
  const difference = paid - due;

  // Keep the single payment equal to what's left to pay, until it's edited by hand.
  const remaining = Math.max(0, due - depositTotal);
  useEffect(() => {
    if (paymentsEdited) return;
    setPayments((current) =>
      current.length === 1 && current[0] && current[0].amount !== remaining
        ? [{ ...current[0], amount: remaining }]
        : current,
    );
  }, [remaining, paymentsEdited]);

  const editLine = (key: string, change: Partial<Line>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  const addLine = () => {
    const service = offered[0];
    if (!service) return;
    setLines((current) => [
      ...current,
      {
        key: newKey(),
        serviceId: service.id,
        resourceId: appointment?.resourceId ?? null,
        quantity: 1,
        unitPrice: service.priceAmount ?? 0,
        discountAmount: 0,
      },
    ]);
  };
  /** A code typed at the counter: a discount code, or a gift card paying with its balance. */
  const applyCode = async () => {
    if (!code.trim()) return;
    setChecking(true);
    try {
      const card = await lookupGiftCard(business.id, code);
      if (card.state !== "active") {
        toast.error(t("checkout.codeState", { state: t(`giftCards.states.${card.state}`) }));
        return;
      }
      if (card.kind === "discount") {
        setDiscountCode({
          id: card.id,
          code: card.code,
          percent: card.percent,
          amount: card.amount,
        });
      } else if (!payments.some((payment) => payment.giftCard?.id === card.id)) {
        const amount = Math.min(card.remaining ?? 0, remaining);
        setPaymentsEdited(true);
        setPayments((current) => [
          {
            key: newKey(),
            method: "gift_card",
            amount,
            giftCard: { id: card.id, code: card.code, remaining: card.remaining ?? 0 },
          },
          // The rest is left to what was there.
          ...(current.length === 1 && current[0]
            ? [{ ...current[0], amount: Math.max(0, remaining - amount) }]
            : current),
        ]);
      }
      setCode("");
    } catch (error) {
      toast.error(errorMessage(t, error));
    } finally {
      setChecking(false);
    }
  };

  const editPayment = (key: string, change: Partial<Payment>) => {
    if (change.amount !== undefined) setPaymentsEdited(true);
    setPayments((current) =>
      current.map((payment) => (payment.key === key ? { ...payment, ...change } : payment)),
    );
  };

  const submit = () => {
    if (lines.length === 0) {
      toast.error(t("checkout.noLines"));
      return;
    }
    if (discount > subtotal) {
      toast.error(t("errors.discount_too_big"));
      return;
    }
    if (difference !== 0) {
      toast.error(t("errors.payments_mismatch"));
      return;
    }
    const input: SaleInput = {
      locationId: location?.id,
      customerId: customer?.id ?? null,
      internal,
      ...(discountCode ? { giftCardId: discountCode.id } : {}),
      items: lines.map((line) => ({
        kind: "service",
        serviceId: line.serviceId,
        ...(line.appointmentId ? { appointmentId: line.appointmentId } : {}),
        resourceId: line.resourceId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
      })),
      discountAmount: discount,
      tips: tips.filter((tip) => tip.amount > 0),
      payments: [
        ...available
          .filter((deposit) => usedDeposits?.includes(deposit.id))
          .map((deposit) => ({
            method: "deposit" as const,
            amount: deposit.amount,
            depositId: deposit.id,
          })),
        ...payments
          .filter((payment) => payment.amount > 0)
          .map(({ method, amount, giftCard }) => ({
            method,
            amount,
            ...(giftCard ? { giftCardId: giftCard.id } : {}),
          })),
      ],
      note,
    };
    create.mutate(input, {
      onSuccess: (sale) => {
        toast.success(t("checkout.done", { number: sale.number }));
        onDone?.(sale);
        onClose();
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  return (
    <Modal
      open
      wide="xl"
      onClose={onClose}
      title={
        appointment
          ? t("checkout.titleAppointment", {
              name: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
            })
          : t("checkout.title")
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={difference !== 0}>
            {t("checkout.charge", { amount: money(due) })}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {appointment ? (
              <div className="rounded-lg bg-zinc-50 px-3 py-2.5 text-sm sm:col-span-2">
                <span className="font-medium text-zinc-900">
                  {appointment.customer.firstName} {appointment.customer.lastName}
                </span>
                <span className="text-zinc-500">
                  {" · "}
                  {appointment.code} ·{" "}
                  {formatDay(
                    instantToZoned(Date.parse(appointment.startsAt), business.timezone).date,
                    language,
                  )}
                </span>
              </div>
            ) : (
              <CustomerPicker value={customer} onChange={setCustomer} />
            )}
            {!appointment && places.length > 1 && (
              <Field label={t("locations.pick")}>
                {(props) => (
                  <Select
                    {...props}
                    value={location?.id ?? ""}
                    onChange={(event) => setLocationId(event.target.value)}
                  >
                    {places.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-800">{t("checkout.items")}</h3>
              <Button variant="ghost" size="sm" onClick={addLine} disabled={offered.length === 0}>
                <Plus className="size-3.5" aria-hidden />
                {t("checkout.addService")}
              </Button>
            </div>
            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-6 text-center text-sm text-zinc-500">
                {t("checkout.noLines")}
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                {lines.map((line) => (
                  <li key={line.key} className="space-y-2 p-3">
                    <div className="flex items-center gap-2">
                      {line.appointmentId ? (
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                          {line.name}
                          {line.discountAmount > 0 && (
                            <span className="ml-2 font-normal text-brand-700">
                              {t("checkout.bookedDiscount", {
                                code: appointment?.giftCode ?? "",
                                amount: money(line.discountAmount),
                              })}
                            </span>
                          )}
                        </span>
                      ) : (
                        <Select
                          aria-label={t("booking.service")}
                          className="min-w-0 flex-1"
                          value={line.serviceId ?? ""}
                          onChange={(event) => {
                            const service = offered.find((item) => item.id === event.target.value);
                            editLine(line.key, {
                              serviceId: event.target.value,
                              unitPrice: service?.priceAmount ?? line.unitPrice,
                            });
                          }}
                        >
                          {offered.map((service) => (
                            <option key={service.id} value={service.id}>
                              {service.name}
                            </option>
                          ))}
                        </Select>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("common.delete")}
                        title={t("common.delete")}
                        onClick={() =>
                          setLines((current) => current.filter((item) => item.key !== line.key))
                        }
                      >
                        <X className="size-4" aria-hidden />
                      </Button>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_8rem] gap-2">
                      <Select
                        aria-label={t("booking.professional")}
                        value={line.resourceId ?? ""}
                        onChange={(event) =>
                          editLine(line.key, { resourceId: event.target.value || null })
                        }
                      >
                        <option value="">{t("checkout.nobody")}</option>
                        {team.map((professional) => (
                          <option key={professional.id} value={professional.id}>
                            {professional.name}
                          </option>
                        ))}
                      </Select>
                      <Input
                        aria-label={t("checkout.quantity")}
                        inputMode="numeric"
                        className="text-center tabular-nums"
                        value={String(line.quantity)}
                        onChange={(event) =>
                          editLine(line.key, {
                            quantity: Math.min(999, Math.max(1, Number(event.target.value) || 1)),
                          })
                        }
                      />
                      <MoneyInput
                        aria-label={t("booking.price")}
                        currency={currency}
                        value={line.unitPrice}
                        onChange={(amount) => editLine(line.key, { unitPrice: amount })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-800">{t("checkout.tips")}</h3>
              <Button
                variant="ghost"
                size="sm"
                disabled={team.length === 0}
                onClick={() =>
                  setTips((current) => [
                    ...current,
                    {
                      key: newKey(),
                      resourceId:
                        lines.find((line) => line.resourceId)?.resourceId ?? team[0]?.id ?? "",
                      amount: 0,
                    },
                  ])
                }
              >
                <Plus className="size-3.5" aria-hidden />
                {t("checkout.addTip")}
              </Button>
            </div>
            {tips.length === 0 ? (
              <p className="text-[13px] text-zinc-500">{t("checkout.tipsHint")}</p>
            ) : (
              <ul className="space-y-2">
                {tips.map((tip) => (
                  <li key={tip.key} className="grid grid-cols-[minmax(0,1fr)_8rem_2rem] gap-2">
                    <Select
                      aria-label={t("booking.professional")}
                      value={tip.resourceId}
                      onChange={(event) =>
                        setTips((current) =>
                          current.map((item) =>
                            item.key === tip.key
                              ? { ...item, resourceId: event.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      {team.map((professional) => (
                        <option key={professional.id} value={professional.id}>
                          {professional.name}
                        </option>
                      ))}
                    </Select>
                    <MoneyInput
                      aria-label={t("checkout.tip")}
                      currency={currency}
                      value={tip.amount}
                      onChange={(amount) =>
                        setTips((current) =>
                          current.map((item) =>
                            item.key === tip.key ? { ...item, amount } : item,
                          ),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.delete")}
                      onClick={() =>
                        setTips((current) => current.filter((item) => item.key !== tip.key))
                      }
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Field label={t("checkout.note")} optional>
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                className="min-h-0"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
          {!appointment && (
            <Switch
              checked={internal}
              onChange={setInternal}
              label={t("checkout.internal")}
              description={t("checkout.internalHint")}
            />
          )}
        </div>

        <aside className="space-y-4 md:border-l md:border-zinc-100 md:pl-6">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">{t("checkout.subtotal")}</dt>
              <dd className="text-zinc-900 tabular-nums">{money(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-zinc-500">
                {discountCode ? (
                  <span className="inline-flex items-center gap-1">
                    {t("checkout.discount")}
                    <span className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-brand-700">
                      {discountCode.code}
                    </span>
                    <button
                      type="button"
                      aria-label={t("checkout.removeCode")}
                      title={t("checkout.removeCode")}
                      className="text-zinc-400 hover:text-zinc-700"
                      onClick={() => {
                        setDiscountCode(null);
                        setDiscount(0);
                      }}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ) : (
                  t("checkout.discount")
                )}
              </dt>
              <dd className="w-32">
                <MoneyInput
                  aria-label={t("checkout.discount")}
                  currency={currency}
                  value={discount}
                  invalid={discount > subtotal}
                  disabled={discountCode !== null}
                  onChange={setDiscount}
                />
              </dd>
            </div>
            {tipTotal > 0 && (
              <div className="flex justify-between">
                <dt className="text-zinc-500">{t("checkout.tips")}</dt>
                <dd className="text-zinc-900 tabular-nums">{money(tipTotal)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-zinc-200 pt-2 text-base font-semibold">
              <dt className="text-zinc-900">{t("checkout.total")}</dt>
              <dd className="text-zinc-900 tabular-nums">{money(due)}</dd>
            </div>
          </dl>

          <div className="flex gap-2">
            <Input
              aria-label={t("checkout.code")}
              placeholder={t("checkout.code")}
              className="font-mono uppercase"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyCode();
                }
              }}
            />
            <Button variant="secondary" onClick={applyCode} loading={checking}>
              {t("checkout.apply")}
            </Button>
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-800">{t("checkout.payments")}</h3>
            {available.length > 0 && (
              <ul className="space-y-1.5">
                {available.map((deposit) => (
                  <li key={deposit.id}>
                    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-brand-50/60 px-3 py-2 text-sm">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-4 accent-brand-600"
                          checked={usedDeposits?.includes(deposit.id) ?? false}
                          onChange={(event) =>
                            setUsedDeposits((current) =>
                              event.target.checked
                                ? [...(current ?? []), deposit.id]
                                : (current ?? []).filter((id) => id !== deposit.id),
                            )
                          }
                        />
                        <span className="text-zinc-700">
                          {t("checkout.useDeposit", {
                            date: formatDay(deposit.createdAt.slice(0, 10), language),
                          })}
                        </span>
                      </span>
                      <span className="font-medium text-zinc-900 tabular-nums">
                        {money(deposit.amount)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <ul className="space-y-2">
              {payments.map((payment) => (
                <li key={payment.key} className="grid grid-cols-[minmax(0,1fr)_8rem_2rem] gap-2">
                  {payment.giftCard ? (
                    <span className="flex min-w-0 flex-col justify-center rounded-md bg-brand-50/60 px-2.5 text-[13px]">
                      <span className="truncate font-medium text-zinc-800">
                        {t("payments.gift_card")} · {payment.giftCard.code}
                      </span>
                      <span className="text-[11px] text-zinc-500 tabular-nums">
                        {t("checkout.cardLeft", { amount: money(payment.giftCard.remaining) })}
                      </span>
                    </span>
                  ) : (
                    <Select
                      aria-label={t("checkout.method")}
                      value={payment.method}
                      onChange={(event) =>
                        editPayment(payment.key, { method: event.target.value as PaymentMethod })
                      }
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {t(`payments.${method}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                  <MoneyInput
                    aria-label={t("checkout.amount")}
                    currency={currency}
                    value={payment.amount}
                    onChange={(amount) => editPayment(payment.key, { amount })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("common.delete")}
                    disabled={payments.length === 1}
                    onClick={() =>
                      setPayments((current) => current.filter((item) => item.key !== payment.key))
                    }
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPaymentsEdited(true);
                setPayments((current) => [
                  ...current,
                  { key: newKey(), method: "card", amount: Math.max(0, -difference) },
                ]);
              }}
            >
              <Plus className="size-3.5" aria-hidden />
              {t("checkout.addPayment")}
            </Button>
            <p
              className={cn(
                "rounded-lg px-3 py-2 text-[13px] font-medium",
                difference === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800",
              )}
            >
              {difference === 0
                ? t("checkout.balanced")
                : difference < 0
                  ? t("checkout.missing", { amount: money(-difference) })
                  : t("checkout.over", { amount: money(difference) })}
            </p>
          </section>
        </aside>
      </div>
    </Modal>
  );
}

/** An optional customer for a sale at the counter, searched by name, phone or email. */
function CustomerPicker({
  value,
  onChange,
}: {
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const results = useCustomerSearch(business.id, debounced);
  const matches = useMemo(() => (results.data ?? []).slice(0, 5), [results.data]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm sm:col-span-2">
        <span className="flex min-w-0 items-center gap-2">
          <UserRound className="size-4 shrink-0 text-zinc-400" aria-hidden />
          <span className="truncate font-medium text-zinc-900">
            {value.firstName} {value.lastName}
          </span>
          <span className="truncate text-zinc-500 tabular-nums">
            {value.phone ? formatPhone(value.phone) : (value.email ?? "")}
          </span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("agenda.changeCustomer")}
          onClick={() => onChange(null)}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    );
  }
  return (
    <div className="relative sm:col-span-2">
      <Field label={t("checkout.customer")} optional>
        {(props) => (
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <Input
              {...props}
              type="search"
              className="pl-8"
              placeholder={t("agenda.searchCustomer")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}
      </Field>
      {debounced.trim().length >= 2 && (
        <ul className="mt-1 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-zinc-500">{t("agenda.noCustomerFound")}</li>
          ) : (
            matches.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50"
                  onClick={() => {
                    onChange(customer);
                    setQuery("");
                  }}
                >
                  <span className="truncate font-medium text-zinc-900">
                    {customer.firstName} {customer.lastName}
                  </span>
                  <span className="truncate text-zinc-500 tabular-nums">
                    {customer.phone ? formatPhone(customer.phone) : (customer.email ?? "")}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Money a customer leaves in advance ("abono"): for an appointment from the calendar, or
 * for a later visit from Sales. It's used up when their appointment is charged.
 */
export function DepositModal({
  appointment,
  onClose,
}: {
  appointment?: Appointment;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const { create } = useDepositMutations(business.id);
  const [customer, setCustomer] = useState<Customer | null>(appointment?.customer ?? null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [note, setNote] = useState("");

  const submit = () => {
    if (!customer) {
      toast.error(t("agenda.pickCustomer"));
      return;
    }
    if (amount <= 0) {
      toast.error(t("deposits.amountRequired"));
      return;
    }
    create.mutate(
      {
        customerId: customer.id,
        appointmentId: appointment?.id ?? null,
        ...(appointment?.locationId ? { locationId: appointment.locationId } : {}),
        amount,
        method,
        note,
      },
      {
        onSuccess: () => {
          toast.success(t("deposits.created"));
          onClose();
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("deposits.new")}
      description={t("deposits.newHint")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            {t("deposits.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {appointment ? (
          <p className="rounded-lg bg-zinc-50 px-3 py-2.5 text-sm sm:col-span-2">
            <span className="font-medium text-zinc-900">
              {appointment.customer.firstName} {appointment.customer.lastName}
            </span>
            <span className="text-zinc-500">
              {" · "}
              {appointment.serviceName} · {appointment.code}
            </span>
          </p>
        ) : (
          <CustomerPicker value={customer} onChange={setCustomer} />
        )}
        <Field label={t("checkout.amount")}>
          {(props) => (
            <MoneyInput
              id={props.id}
              currency={business.currency}
              value={amount}
              onChange={setAmount}
            />
          )}
        </Field>
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
        <Field label={t("checkout.note")} optional className="sm:col-span-2">
          {(props) => (
            <Input {...props} value={note} onChange={(event) => setNote(event.target.value)} />
          )}
        </Field>
      </div>
    </Modal>
  );
}
