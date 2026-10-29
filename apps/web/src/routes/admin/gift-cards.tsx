import {
  formatPrice,
  type GiftCardInput,
  giftCardSchema,
  PAYMENT_METHODS,
  todayIn,
} from "@openturnly/core";
import { Gift, Plus, Shuffle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "../../components/confirm.tsx";
import { EmptyState, Modal, PageHeader, Switch } from "../../components/controls.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { DateField } from "../../components/date-field.tsx";
import { MoneyInput } from "../../components/money-input.tsx";
import { toast } from "../../components/toast.tsx";
import { Alert, Badge, Button, Field, Input, Select, Spinner } from "../../components/ui.tsx";
import type { GiftCard } from "../../lib/api.ts";
import { useLocations } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { errorMessage, type FieldErrors, fieldMessage, validate } from "../../lib/forms.ts";
import { useGiftCardMutations, useGiftCards } from "../../lib/gift-cards.ts";
import { useBusinessContext } from "./business.tsx";

/** 32 characters without 0/O and 1/I, like booking codes. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function randomCode(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}${Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("")}`;
}

const STATE_TONES = {
  active: "success",
  scheduled: "brand",
  inactive: "neutral",
  expired: "neutral",
  used_up: "warning",
  spent: "warning",
} as const;

/** Discount codes and gift cards with a balance. */
export function GiftCardsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const cards = useGiftCards(business.id);
  const [editing, setEditing] = useState<GiftCard | "new" | null>(null);
  const money = (amount: number) => formatPrice(amount, business.currency);
  const date = (value: string) =>
    new Intl.DateTimeFormat(language, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));

  const newButton = (
    <Button data-tour="gift-cards-new" onClick={() => setEditing("new")}>
      <Plus className="size-4" aria-hidden />
      {t("giftCards.new")}
    </Button>
  );

  const columns: Column<GiftCard>[] = [
    {
      key: "code",
      header: t("giftCards.colCode"),
      cell: (card) => (
        <div className="min-w-0">
          <div className="font-mono text-[13px] font-semibold tracking-wider text-zinc-900">
            {card.code}
          </div>
          {(card.customer || card.note) && (
            <div className="truncate text-[13px] text-zinc-500">
              {card.customer ? `${card.customer.firstName} ${card.customer.lastName}` : card.note}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "kind",
      header: t("giftCards.colValue"),
      cell: (card) =>
        card.kind === "discount" ? (
          <span className="text-zinc-700">
            {card.percent !== null
              ? t("giftCards.percentOff", { percent: card.percent })
              : t("giftCards.amountOff", { amount: money(card.amount ?? 0) })}
          </span>
        ) : (
          <span className="text-zinc-700">
            {t("giftCards.balanceOf", { amount: money(card.amount ?? 0) })}
          </span>
        ),
    },
    {
      key: "usage",
      header: t("giftCards.colUsage"),
      className: "hidden sm:table-cell whitespace-nowrap",
      phone: true,
      cell: (card) => (
        <span className="text-zinc-600 tabular-nums">
          {card.kind === "balance"
            ? t("giftCards.remaining", { amount: money(card.remaining ?? 0) })
            : card.maxUses !== null
              ? t("giftCards.usesOf", { uses: card.uses, max: card.maxUses })
              : t("giftCards.uses", { count: card.uses })}
        </span>
      ),
    },
    {
      key: "validity",
      header: t("giftCards.colValidity"),
      className: "hidden md:table-cell whitespace-nowrap",
      cell: (card) => (
        <span className="text-zinc-600 tabular-nums">
          {card.validUntil
            ? t("giftCards.until", { date: date(card.validUntil) })
            : t("giftCards.noExpiry")}
        </span>
      ),
    },
    {
      key: "state",
      header: t("giftCards.colState"),
      cell: (card) => (
        <Badge tone={STATE_TONES[card.state]}>{t(`giftCards.states.${card.state}`)}</Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("giftCards.title")}
        subtitle={t("giftCards.subtitle")}
        actions={newButton}
      />
      {cards.isPending ? (
        <Spinner />
      ) : cards.isError ? (
        <Alert>{errorMessage(t, cards.error)}</Alert>
      ) : cards.data.length === 0 ? (
        <EmptyState
          icon={<Gift className="size-5" aria-hidden />}
          title={t("giftCards.emptyTitle")}
          body={t("giftCards.emptyBody")}
          action={newButton}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={cards.data}
          rowKey={(card) => card.id}
          onRowClick={setEditing}
          searchPlaceholder={t("giftCards.search")}
          matches={(card, query) =>
            `${card.code} ${card.note ?? ""} ${card.customer?.firstName ?? ""} ${card.customer?.lastName ?? ""}`
              .toLowerCase()
              .includes(query)
          }
          empty={t("giftCards.emptyTitle")}
        />
      )}
      {editing === "new" && <NewGiftCard onClose={() => setEditing(null)} />}
      {editing && editing !== "new" && (
        <EditGiftCard card={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function NewGiftCard({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const locations = useLocations(business.id).data?.filter((location) => location.active) ?? [];
  const { create } = useGiftCardMutations(business.id);
  const [kind, setKind] = useState<"discount" | "balance">("discount");
  const [code, setCode] = useState(() => randomCode(""));
  const [discountBy, setDiscountBy] = useState<"percent" | "amount">("percent");
  const [percent, setPercent] = useState("10");
  const [amount, setAmount] = useState(0);
  const [maxUses, setMaxUses] = useState("");
  const [validFrom, setValidFrom] = useState<string | null>(null);
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [paidWith, setPaidWith] = useState<string>("cash");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const today = todayIn(business.timezone);
  const dateLabels = {
    previous: t("agenda.previous"),
    next: t("agenda.next"),
    clear: t("giftCards.noLimit"),
  };

  const submit = () => {
    const common = { code, validFrom, validUntil, note };
    const values: GiftCardInput =
      kind === "discount"
        ? {
            kind,
            ...common,
            percent: discountBy === "percent" ? Number(percent) || 0 : null,
            amount: discountBy === "amount" ? amount : null,
            maxUses: maxUses.trim() ? Number(maxUses) : null,
          }
        : {
            kind,
            ...common,
            amount,
            paidWith: paidWith === "gift" ? null : (paidWith as (typeof PAYMENT_METHODS)[number]),
            ...(locationId ? { locationId } : {}),
          };
    const result = validate(giftCardSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    create.mutate(values, {
      onSuccess: () => {
        toast.success(
          kind === "discount" ? t("giftCards.createdCode") : t("giftCards.createdCard"),
        );
        onClose();
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("giftCards.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            {kind === "balance" && paidWith !== "gift"
              ? t("giftCards.sell", { amount: formatPrice(amount, business.currency) })
              : t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2">
          {(["discount", "balance"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => {
                setKind(option);
                setCode(randomCode(option === "balance" ? "GC-" : ""));
              }}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                kind === option
                  ? "border-brand-500 bg-brand-50/50"
                  : "border-zinc-200 hover:border-zinc-300",
              )}
            >
              <div className="text-sm font-medium text-zinc-900">
                {t(`giftCards.kinds.${option}`)}
              </div>
              <div className="mt-0.5 text-[13px] text-zinc-500">
                {t(`giftCards.kindsHint.${option}`)}
              </div>
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("giftCards.code")} error={fieldMessage(t, "code", errors.code)}>
            {(props) => (
              <div className="flex gap-2">
                <Input
                  {...props}
                  className="font-mono uppercase tracking-wider"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                />
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label={t("giftCards.generate")}
                  title={t("giftCards.generate")}
                  onClick={() => setCode(randomCode(kind === "balance" ? "GC-" : ""))}
                >
                  <Shuffle className="size-4" aria-hidden />
                </Button>
              </div>
            )}
          </Field>
          {kind === "discount" ? (
            <Field
              label={t("giftCards.discount")}
              error={fieldMessage(t, "percent", errors.percent ?? errors.amount)}
            >
              {(props) => (
                <div className="flex gap-2">
                  <Select
                    aria-label={t("giftCards.discountBy")}
                    className="w-24 shrink-0"
                    value={discountBy}
                    onChange={(event) => setDiscountBy(event.target.value as "percent" | "amount")}
                  >
                    <option value="percent">%</option>
                    <option value="amount">$</option>
                  </Select>
                  {discountBy === "percent" ? (
                    <Input
                      {...props}
                      inputMode="numeric"
                      className="text-right tabular-nums"
                      value={percent}
                      onChange={(event) => setPercent(event.target.value.replace(/\D/g, ""))}
                    />
                  ) : (
                    <MoneyInput
                      id={props.id}
                      className="flex-1"
                      currency={business.currency}
                      value={amount}
                      onChange={setAmount}
                    />
                  )}
                </div>
              )}
            </Field>
          ) : (
            <Field label={t("giftCards.value")} error={fieldMessage(t, "amount", errors.amount)}>
              {(props) => (
                <MoneyInput
                  id={props.id}
                  currency={business.currency}
                  value={amount}
                  onChange={setAmount}
                />
              )}
            </Field>
          )}
          <Field label={t("giftCards.validFrom")} optional>
            {(props) => (
              <DateField
                id={props.id}
                value={validFrom}
                onChange={setValidFrom}
                placeholder={t("giftCards.fromToday")}
                min={today}
                locale={language}
                labels={dateLabels}
              />
            )}
          </Field>
          <Field
            label={t("giftCards.validUntil")}
            optional
            error={fieldMessage(t, "endDate", errors.validUntil)}
          >
            {(props) => (
              <DateField
                id={props.id}
                value={validUntil}
                onChange={setValidUntil}
                placeholder={t("giftCards.noExpiry")}
                min={today}
                locale={language}
                labels={dateLabels}
              />
            )}
          </Field>
          {kind === "discount" ? (
            <Field label={t("giftCards.maxUses")} optional hint={t("giftCards.maxUsesHint")}>
              {(props) => (
                <Input
                  {...props}
                  inputMode="numeric"
                  placeholder={t("giftCards.unlimited")}
                  value={maxUses}
                  onChange={(event) => setMaxUses(event.target.value.replace(/\D/g, ""))}
                />
              )}
            </Field>
          ) : (
            <>
              <Field label={t("giftCards.paidWith")} hint={t("giftCards.paidWithHint")}>
                {(props) => (
                  <Select
                    {...props}
                    value={paidWith}
                    onChange={(event) => setPaidWith(event.target.value)}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {t(`payments.${method}`)}
                      </option>
                    ))}
                    <option value="gift">{t("giftCards.courtesy")}</option>
                  </Select>
                )}
              </Field>
              {locations.length > 1 && paidWith !== "gift" && (
                <Field label={t("locations.pick")}>
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
            </>
          )}
          <Field label={t("checkout.note")} optional className="sm:col-span-2">
            {(props) => (
              <Input
                {...props}
                placeholder={t("giftCards.notePlaceholder")}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function EditGiftCard({ card, onClose }: { card: GiftCard; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const confirm = useConfirm();
  const { update, remove } = useGiftCardMutations(business.id);
  const [active, setActive] = useState(card.active);
  const [validFrom, setValidFrom] = useState(card.validFrom);
  const [validUntil, setValidUntil] = useState(card.validUntil);
  const [maxUses, setMaxUses] = useState(card.maxUses === null ? "" : String(card.maxUses));
  const [note, setNote] = useState(card.note ?? "");
  const today = todayIn(business.timezone);
  const dateLabels = {
    previous: t("agenda.previous"),
    next: t("agenda.next"),
    clear: t("giftCards.noLimit"),
  };
  const used = card.uses > 0 || card.spent > 0;

  const save = () =>
    update.mutate(
      {
        id: card.id,
        active,
        validFrom,
        validUntil,
        note,
        ...(card.kind === "discount" ? { maxUses: maxUses.trim() ? Number(maxUses) : null } : {}),
      },
      {
        onSuccess: () => {
          toast.success(t("common.saved"));
          onClose();
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );

  const deleteCard = async () => {
    const ok = await confirm({
      title: t("giftCards.deleteTitle", { code: card.code }),
      description: t("giftCards.deleteBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (ok) {
      remove.mutate(card.id, {
        onSuccess: () => {
          toast.success(t("giftCards.deleted"));
          onClose();
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={card.code}
      description={t(`giftCards.kinds.${card.kind}`)}
      footer={
        <>
          {!used && (
            <Button
              variant="ghost"
              className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700"
              loading={remove.isPending}
              onClick={deleteCard}
            >
              {t("common.delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} loading={update.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("giftCards.validFrom")} optional>
          {(props) => (
            <DateField
              id={props.id}
              value={validFrom}
              onChange={setValidFrom}
              placeholder={t("giftCards.fromToday")}
              min={today}
              locale={language}
              labels={dateLabels}
            />
          )}
        </Field>
        <Field label={t("giftCards.validUntil")} optional>
          {(props) => (
            <DateField
              id={props.id}
              value={validUntil}
              onChange={setValidUntil}
              placeholder={t("giftCards.noExpiry")}
              min={today}
              locale={language}
              labels={dateLabels}
            />
          )}
        </Field>
        {card.kind === "discount" && (
          <Field label={t("giftCards.maxUses")} optional>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                placeholder={t("giftCards.unlimited")}
                value={maxUses}
                onChange={(event) => setMaxUses(event.target.value.replace(/\D/g, ""))}
              />
            )}
          </Field>
        )}
        <Field
          label={t("checkout.note")}
          optional
          className={card.kind === "discount" ? "" : "sm:col-span-2"}
        >
          {(props) => (
            <Input {...props} value={note} onChange={(event) => setNote(event.target.value)} />
          )}
        </Field>
        <div className="border-t border-zinc-100 pt-4 sm:col-span-2">
          <Switch
            checked={active}
            onChange={setActive}
            label={t("giftCards.activeLabel")}
            description={t("giftCards.activeHint")}
          />
        </div>
      </div>
    </Modal>
  );
}
